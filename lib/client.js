"use strict";
/**
 * Framework-agnostic orchestrator. `PoseTrackerProvider` is a thin React
 * wrapper around this class.
 *
 * Lifecycle (exposed as `PoseTrackerStatus`):
 *   idle → configuring (handshake attempt) → downloading (engine bundle)
 *        → warming (TF runtime + model + dummy inferences) → ready | error
 *
 * Operating modes (commercial boundary, see ARCHITECTURE.md §Modes):
 * - 'keypoints-only': always reachable — bundled MoveNet + warm-up + camera
 *   pipeline, raw `keypoints` events only. A failed handshake (offline,
 *   missing/invalid token, quota) NEVER blocks `ready`: it degrades to this
 *   mode with a non-fatal `error` event. `error` status is reserved for
 *   unrecoverable local failures (model load).
 * - 'full-engine': requires a validated handshake — live, or replayed from
 *   the encrypted session cache written after a previous successful
 *   handshake (Sency-style offline cold start). The npm package itself
 *   ships ZERO movement intelligence.
 *
 * The mode upgrades at runtime without restarting the camera pipeline:
 * `configure()` can be called at any time (e.g. when the network comes back
 * or the host obtains a token) — the inference backend is untouched, and
 * business events simply start flowing once the engine is up.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoseTrackerClient = void 0;
const configure_1 = require("./api/configure");
const track_1 = require("./api/track");
const EngineLoader_1 = require("./engine/EngineLoader");
const EngineLoader_2 = require("./engine/EngineLoader");
const bundledRuntime_1 = require("./backends/webview/bundledRuntime");
const obfuscate_1 = require("./cache/obfuscate");
const VisionPoseBackend_1 = require("./backends/vision/VisionPoseBackend");
const WebViewPoseBackend_1 = require("./backends/webview/WebViewPoseBackend");
const aliases_1 = require("./exercises/aliases");
const engineChannel_1 = require("./engineChannel");
const skeleton_1 = require("./api/skeleton");
const logReport_1 = require("./diagnostics/logReport");
const AdaptiveQualityController_1 = require("./quality/AdaptiveQualityController");
const profiles_1 = require("./quality/profiles");
const classicMessage_1 = require("./events/classicMessage");
const features_1 = require("./types/features");
const MANIFEST_CACHE_KEY = 'session.sealed';
const ENGINE_VERSION_KEY = 'engine.version';
/** Consecutive engine `processPose` failures before the session is stopped. */
const SESSION_ERROR_STREAK_LIMIT = 30;
/**
 * Fallback descriptor when no manifest is available. The model itself is NOT
 * bundled anymore (stub-loader architecture): it arrives inside the
 * pose-runtime payload, this descriptor only feeds backend init metadata.
 */
const DEFAULT_MOVENET = {
    modelId: 'movenet-singlepose-lightning',
    format: 'tfjs-graph-model',
    inputSize: 192,
    deliveredBy: 'pose-runtime',
    version: '4',
};
class PoseTrackerClient {
    constructor(apiToken, options = {}) {
        this.status = 'idle';
        this.mode = 'keypoints-only';
        this.lastError = null;
        this.manifest = null;
        this.engine = null;
        this.engineSource = null;
        this.session = null;
        this.currentExerciseId = null;
        this.listeners = new Set();
        this.messageListeners = new Set();
        this.stateListeners = new Set();
        this.preloadPromise = null;
        /** Last requested cold-start mode (default basic — no getUserMedia). */
        this.coldStartMode = 'basic';
        this.configurePromise = null;
        /** One handshake per configuration cycle, shared by runtime warm + engine load. */
        this.handshakePromise = null;
        /** Pose-runtime payload resolution (handshake + versioned cache warm). */
        this.runtimePromise = null;
        /**
         * Metered-session gate: with an API key, the `camera_start` track call must
         * succeed online before key-gated features run ('refused' = offline/quota).
         */
        this.meteredSessionState = 'idle';
        /** Last camera_start payload — lets configure() retry a refused metered gate. */
        this.lastCameraStartInfo = null;
        /** Consecutive engine processPose failures (see SESSION_ERROR_STREAK_LIMIT). */
        this.sessionErrorStreak = 0;
        /** One-shot flags so plan-gating errors are not re-emitted on every retry. */
        this.featureGateReported = { unsupported: false, freeBlock: false, missingToken: false };
        this.keypointsSuppressionLogged = false;
        // Default: dump every diagnostic line to Metro / logcat so Android FPS
        // issues (CPU fallback) are visible without any host wiring.
        this.options = {
            ...options,
            onDiagnostic: options.onDiagnostic ?? logReport_1.defaultDiagnosticLogger,
        };
        this.apiToken = apiToken ?? null;
        const resolved = (0, features_1.resolveFeatures)(options.features);
        this.features = resolved.features;
        this.unsupportedFeatureKeys = resolved.unsupportedKeys;
        (0, logReport_1.logPlatformBanner)();
        this.options.onDiagnostic?.(`[posetracker] client created preferredBackend=${this.options.preferredBackend ?? 'auto'} ` +
            `qualityChoice=${this.options.qualityChoice ?? 'AdaptiveChoice'} ` +
            `capturePriority=${this.options.capturePriority ?? 'performance'} ` +
            `hasApiToken=${Boolean(this.apiToken)} ` +
            `features=${JSON.stringify(this.features)}` +
            (this.unsupportedFeatureKeys.length > 0
                ? ` unsupportedFeatureKeys=${this.unsupportedFeatureKeys.join(',')}`
                : ''));
        this.quality = new AdaptiveQualityController_1.AdaptiveQualityController({
            choice: this.options.qualityChoice ?? 'AdaptiveChoice',
            capturePriority: this.options.capturePriority ?? 'performance',
            onDiagnostic: this.options.onDiagnostic,
            onQualityChanged: (event) => {
                // Typed: quality_changed. Classic onMessage maps it to type "warning".
                this.emit(event);
                this.notifyState();
            },
            onPerformanceWarning: (event) => {
                this.emit(event);
            },
        });
        this.backend = options.backend ?? this.createBackend();
        this.engineLoader =
            options.engineLoader ??
                new EngineLoader_1.EngineLoader({
                    fileStore: options.fileStore,
                    onDiagnostic: this.options.onDiagnostic,
                });
        this.files =
            options.fileStore !== undefined ? options.fileStore : (0, EngineLoader_2.createNativeFileStore)('posetracker-engine');
        this.tracker = options.usageTracker ?? new track_1.UsageTracker({ baseUrl: options.baseUrl });
        this.options.onDiagnostic?.(`[posetracker] selected backend=${this.backend.name} ` +
            `bundledPoseRuntime=${(0, bundledRuntime_1.getBundledRuntimeVersion)()} ` +
            `fileStore=${this.files ? 'native' : 'none'}`);
    }
    /** Backend selection — see {@link PreferredBackend}. */
    createBackend() {
        const shared = {
            onDiagnostic: this.options.onDiagnostic,
            // Surface mid-session downgrades to the provider/hook without polling.
            onAccelerationChange: () => this.notifyState(),
        };
        const preferred = this.options.preferredBackend ?? 'auto';
        if (preferred === 'vision') {
            // Explicit opt-in only (iOS native build). On Android / Expo Go,
            // init() throws a clear error — no silent swap, the host asked for
            // Vision. The WebView runtime remains available as a manual retry.
            return new VisionPoseBackend_1.VisionPoseBackend(shared);
        }
        // 'auto' | 'webview': the offline WebView MoveNet runtime, both platforms.
        return new WebViewPoseBackend_1.WebViewPoseBackend({
            ...shared,
            onWarmupEstimate: (info) => {
                const pageProfile = (0, profiles_1.isQualityProfileId)(info.profileId) ? info.profileId : null;
                void this.quality.onWarmupEstimate({
                    medianInferenceMs: info.medianInferenceMs,
                    glRenderer: info.glRenderer,
                    pageSelectedProfile: pageProfile,
                });
            },
            onReady: (info) => {
                const pageProfile = info.profileId && (0, profiles_1.isQualityProfileId)(info.profileId) ? info.profileId : null;
                void this.quality.onRuntimeReady({
                    glRenderer: info.glRenderer,
                    medianInferenceMs: info.medianInferenceMs,
                    pageSelectedProfile: pageProfile,
                });
                // Usage metering happens HERE: camera started with the model ready
                // (not at handshake, not at preload).
                void this.handleCameraStart({
                    backend: info.backend,
                    profileId: info.profileId ?? null,
                });
            },
            onStats: (stats) => {
                void this.quality.onStats({
                    fps: stats.fps,
                    medianInferenceMs: stats.medianInferenceMs,
                    videoSize: stats.videoSize,
                    backend: stats.backend,
                });
            },
            onTrackerEvent: (event) => {
                this.emit(event);
            },
        });
    }
    // -------------------------------------------------------------------------
    // Introspection & events
    // -------------------------------------------------------------------------
    getStatus() {
        return this.status;
    }
    getMode() {
        return this.mode;
    }
    /** Last non-fatal or fatal error (also emitted as an `error` event). */
    getError() {
        return this.lastError;
    }
    getManifest() {
        return this.manifest;
    }
    /** Plan type from the manifest ('free', 'developer', …) or null (keyless/offline). */
    getPlanType() {
        return this.manifest?.plan?.plan ?? null;
    }
    /** Requested tracking features with WebView-parity defaults applied. */
    getFeatures() {
        return { ...this.features };
    }
    /** 'remote-cache' | 'remote-download' | null (keypoints-only). */
    getEngineSource() {
        return this.engineSource;
    }
    /**
     * GPU-acceleration verdict from the warm-up health check ('unknown' until
     * preload/warmup completes). See docs/ANDROID_GL_ACCELERATION.md.
     */
    getAcceleration() {
        return this.getAccelerationDiagnostics()?.state ?? 'unknown';
    }
    /** Full diagnostics (backend, timings, GL renderer, flags, downgrade trail). */
    getAccelerationDiagnostics() {
        return this.backend.getAcceleration?.() ?? null;
    }
    /**
     * Adaptive camera-quality state (profile, capability score, mean FPS).
     * See docs/ADAPTIVE_QUALITY.md.
     */
    getQualityState() {
        return this.quality.getState();
    }
    /** Resolve (and cache) the initial quality profile before mounting the WebView. */
    resolveQualityProfile() {
        return this.quality.resolveInitialProfile();
    }
    /** Mark the active profile as PROBING (crash-loop guard) before page boot. */
    beginQualitySession() {
        return this.quality.beginSession();
    }
    /**
     * Wire the live WebView injector so auto-downgrades can restart getUserMedia.
     * Called by {@link WebViewPoseView}.
     */
    setQualityApplyHandler(fn) {
        this.quality.setApplyProfile(fn);
    }
    addEventListener(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    /**
     * Classic PoseTracker WebView parity: receive `sendDataToNative`-shaped JSON
     * (`{ type: 'keypoints', data: [...] }`, `{ type: 'initialization', message, ready }`, …).
     * Prefer typed {@link addEventListener} for new apps; use this to migrate
     * existing `onMessage` parsers with minimal changes.
     */
    addMessageListener(listener) {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    }
    /** Fired on any status/mode/manifest change. */
    onStateChange(listener) {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }
    // -------------------------------------------------------------------------
    // Preload / warmup
    // -------------------------------------------------------------------------
    /**
     * Idempotent warm-up: bundled pose runtime, optional engine handshake,
     * then backend cold-start. Does **not** run when the provider mounts
     * (unless `autoPreload`). For WebView, mount a `WebViewPoseView` so the
     * page can load MoveNet — see docs/PRELOAD.md.
     *
     * Cold-start modes (`options.coldStart`):
     * - `basic` (**default**): model + WebGL zeros only — **no getUserMedia**,
     *   so lobby / home preload never prompts for camera permission.
     * - `full`: also open the camera (legacy). Pair with
     *   `<WebViewPoseView coldStart="full" />` or call after basic ready to
     *   upgrade via `__PT_OPEN_CAMERA`.
     *
     * Always reaches `ready` unless the local model path fails; a failed
     * handshake degrades to keypoints-only mode.
     */
    preload(options) {
        const mode = options?.coldStart === 'full' ? 'full' : 'basic';
        this.coldStartMode = mode;
        // Already model-ready: only upgrade to full if requested.
        if (this.status === 'ready' && this.preloadPromise) {
            return this.preloadPromise.then(() => this.ensureColdStartMode(mode));
        }
        if (!this.preloadPromise) {
            this.preloadPromise = this.doPreload()
                .then(() => this.ensureColdStartMode(mode))
                .catch((err) => {
                // Allow a retry after a failed preload (model failure).
                this.preloadPromise = null;
                throw err;
            });
        }
        else if (mode === 'full') {
            // Upgrade an in-flight basic preload once it finishes.
            return this.preloadPromise.then(() => this.ensureColdStartMode('full'));
        }
        return this.preloadPromise;
    }
    /** Alias of preload(), matching the Sency-style naming. */
    warmup(options) {
        return this.preload(options);
    }
    /** Current preferred cold-start mode (for hosts / WebView wiring). */
    getColdStartMode() {
        return this.coldStartMode;
    }
    async doPreload() {
        // 1. Bundled pose runtime — instant, no network (MoveNet + TF.js in npm).
        await this.getRuntimeParts();
        // 2. Handshake — optional for keypoints-only; required path for engine.
        //    Never fatal by itself (offline / no key → keypoints-only).
        this.setStatus('configuring');
        await this.resolveManifestOnce();
        // 3. Engine (API key path, never fatal — degrades to keypoints-only) ---
        this.setStatus('downloading');
        await this.tryConfigure({ silentStatus: true });
        // 4. Flush queued anonymous usage events (best-effort) -----------------
        void this.tracker.flushQueue();
        // 5. WebView backend warm-up (fatal on failure) ------------------------
        //    Waits for page `ready` after model zeros — camera is optional.
        try {
            this.setStatus('warming');
            await this.initAndWarmupBackend();
        }
        catch (err) {
            this.reportError({
                type: 'error',
                code: 'model_load_failed',
                message: err instanceof Error ? err.message : String(err),
            });
            this.setStatus('error');
            throw err;
        }
        this.setStatus('ready');
        this.emit({
            type: 'initialization',
            step: 'ready',
            message: 'running',
            ready: true,
            mode: this.mode,
            acceleration: this.getAcceleration(),
        });
    }
    /**
     * After model ready, optionally open the camera for `coldStart: 'full'`.
     * No-op for basic, or when the WebView already booted with coldStart=full.
     */
    async ensureColdStartMode(mode) {
        if (mode !== 'full')
            return;
        const backend = this.backend;
        if (!(backend instanceof WebViewPoseBackend_1.WebViewPoseBackend))
            return;
        if (backend.isCameraOpened())
            return;
        await backend.openCamera();
    }
    // -------------------------------------------------------------------------
    // Pose-runtime payload (bundled in npm)
    // -------------------------------------------------------------------------
    /**
     * Pose runtime shipped in the package (TF.js + MoveNet + page runtime).
     * Synchronous under the hood; Promise for a stable async API used by
     * {@link WebViewPoseView}. No network, no download.
     */
    getRuntimeParts() {
        if (!this.runtimePromise) {
            this.runtimePromise = Promise.resolve(this.loadBundledRuntime());
        }
        return this.runtimePromise;
    }
    /**
     * Load a custom skeleton overlay by Strapi `api_uuid`
     * (WebView `?skeleton=<uuid>`). Pass the result to
     * `<WebViewPoseView skeletonDef={…} />` or let the view fetch via
     * `skeletonUuid`.
     */
    fetchSkeleton(uuid) {
        return (0, skeleton_1.fetchSkeletonDefinition)(uuid, { baseUrl: this.options.baseUrl });
    }
    loadBundledRuntime() {
        const parts = (0, bundledRuntime_1.getBundledRuntimeParts)();
        this.options.onDiagnostic?.(`[posetracker] pose-runtime bundled version=${parts.version} ` +
            `pipelineWasm=${parts.pipelineWasmB64 ? 'yes' : 'no'}`);
        return parts;
    }
    /**
     * One handshake per configuration cycle — shared by the pose-runtime warm
     * and the engine load, with or without API key. Never throws; resolves to
     * null when unreachable AND no sealed session cache can be replayed.
     */
    resolveManifestOnce() {
        if (!this.handshakePromise) {
            this.handshakePromise = this.doResolveManifestOnce().then((manifest) => {
                if (!manifest) {
                    // Allow later retries (network may come back).
                    this.handshakePromise = null;
                }
                return manifest;
            });
        }
        return this.handshakePromise;
    }
    async doResolveManifestOnce() {
        const localVersions = {
            poseRuntime: (0, bundledRuntime_1.getBundledRuntimeVersion)(),
            engine: (await this.files?.read(ENGINE_VERSION_KEY).catch(() => null)) ?? null,
        };
        if (this.apiToken) {
            const manifest = await this.resolveManifest(this.apiToken, localVersions);
            if (manifest) {
                this.manifest = manifest;
                if (manifest.revoked === true) {
                    await this.handleRevocation('Access revoked by the backend.');
                }
            }
            return manifest;
        }
        // Keyless handshake: public manifest (pose-runtime descriptor only).
        try {
            const manifest = await (0, configure_1.configure)(null, { ...this.options, localVersions });
            this.manifest = manifest;
            return manifest;
        }
        catch {
            // Offline keyless: the runtime cache decides what is possible.
            return null;
        }
    }
    /**
     * Revocation signal: purge the sealed engine artifacts and downgrade to
     * keypoints-only. The public pose-runtime cache is NOT purged (public
     * payload, keypoints-only keeps working).
     */
    async handleRevocation(message) {
        const engineVersion = await this.files?.read(ENGINE_VERSION_KEY).catch(() => null);
        if (engineVersion) {
            await this.files?.remove(`engine-${engineVersion}.sealed`).catch(() => { });
            await this.files?.remove(ENGINE_VERSION_KEY).catch(() => { });
        }
        await this.files?.remove(MANIFEST_CACHE_KEY).catch(() => { });
        this.engine = null;
        this.engineSource = null;
        this.stopExercise();
        this.setMode('keypoints-only');
        this.reportError({ type: 'error', code: 'invalid_token', message });
    }
    /**
     * Usage metering — fired when the WebView reports the camera started with
     * the model ready. With an API key the call MUST succeed (quota check +
     * counter increment + usage row): offline metered sessions are refused.
     * Without a key the event is fire-and-forget with a local retry queue.
     */
    async handleCameraStart(info) {
        this.lastCameraStartInfo = info;
        const params = {
            backend: info.backend,
            profileId: info.profileId,
            poseModelProfile: this.options.poseModelProfile ?? 'AdaptiveChoice',
            qualityChoice: this.options.qualityChoice ?? 'AdaptiveChoice',
            mode: this.mode,
            exercise: this.currentExerciseId,
            runtimeVersion: (0, bundledRuntime_1.getBundledRuntimeVersion)(),
        };
        if (!this.apiToken) {
            void this.tracker.trackAnonymous({ event: 'camera_start', params });
            return;
        }
        this.meteredSessionState = 'pending';
        try {
            await this.tracker.trackMetered({ event: 'camera_start', apiToken: this.apiToken, params });
            this.meteredSessionState = 'validated';
            this.options.onDiagnostic?.('[posetracker] camera_start tracked (metered session validated)');
        }
        catch (err) {
            this.meteredSessionState = 'refused';
            if (err instanceof track_1.TrackError && err.code === 'network') {
                this.reportError({
                    type: 'error',
                    code: 'offline_metered',
                    message: 'API-key features are not available offline: PoseTracker cannot ' +
                        'count their usage. Keypoints-only keeps running from the cache; ' +
                        'reconnect to start a metered session.',
                });
            }
            else if (err instanceof track_1.TrackError && err.code === 'invalid_token') {
                await this.handleRevocation('API key invalid or revoked — engine cache purged.');
            }
            else if (err instanceof track_1.TrackError && err.code === 'quota_exceeded') {
                this.reportError({ type: 'error', code: 'quota_exceeded', message: err.message });
            }
            else {
                this.reportError({
                    type: 'error',
                    code: 'internal',
                    message: `Usage tracking failed: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }
    }
    /** Backend init + warm-up. An init failure surfaces as status 'error'. */
    async initAndWarmupBackend() {
        try {
            await this.backend.init({ model: this.resolveModel() });
            await this.backend.warmup();
        }
        catch (err) {
            (0, logReport_1.logAccelerationReport)(this.getAccelerationDiagnostics(), {
                phase: 'init-failed',
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
        // Always dump the full report to Metro after warm-up.
        (0, logReport_1.logAccelerationReport)(this.getAccelerationDiagnostics(), {
            phase: 'warmup-complete',
            backend: this.backend.name,
            mode: this.mode,
        });
    }
    /**
     * Runtime (re)configuration — the keypoints-only → full-engine upgrade
     * path. Can be called before or after `ready`; when the camera pipeline
     * is already running it keeps running, business events simply start once
     * the engine is loaded. Resolves to true when full-engine mode is active.
     */
    configure(apiToken) {
        if (apiToken !== undefined && apiToken !== this.apiToken) {
            this.apiToken = apiToken;
            this.configurePromise = null;
            // New credentials: re-handshake (the previous one may be keyless).
            this.handshakePromise = null;
            // The plan may change with the token: re-arm the feature gating errors.
            this.featureGateReported.freeBlock = false;
            this.featureGateReported.missingToken = false;
        }
        // Explicit configure() (e.g. Test key) must be allowed to retry even when
        // a previous attempt failed or the crash-guard blocked the bundle.
        if (this.mode !== 'full-engine') {
            this.configurePromise = null;
        }
        if (!this.configurePromise) {
            this.configurePromise = this.tryConfigure({
                silentStatus: this.status === 'ready',
                forceEngineRetry: true,
            })
                .then((ok) => {
                if (!ok) {
                    // Allow retries (network may come back).
                    this.configurePromise = null;
                }
                // Network is (possibly) back: a metered session refused at camera
                // start (offline) can now be validated without restarting the camera.
                this.retryMeteredSessionIfRefused();
                return ok;
            })
                .catch(() => {
                this.configurePromise = null;
                return false;
            });
        }
        return this.configurePromise;
    }
    /**
     * Re-run the `camera_start` metered gate after a configure() retry. A
     * session refused offline becomes usable as soon as the network is back —
     * WebView parity: the front revalidates on reload, the SDK on configure().
     */
    retryMeteredSessionIfRefused() {
        if (this.meteredSessionState === 'refused' && this.apiToken && this.lastCameraStartInfo) {
            this.options.onDiagnostic?.('[posetracker] retrying metered camera_start after configure() (was refused)');
            void this.handleCameraStart(this.lastCameraStartInfo);
        }
    }
    /**
     * Handshake + engine load. Never throws; returns whether full-engine mode
     * was reached. `silentStatus` avoids status regressions (e.g. hot upgrade
     * while `ready` and the camera is streaming).
     */
    async tryConfigure({ silentStatus, forceEngineRetry = false, }) {
        if (this.mode === 'full-engine') {
            return true;
        }
        if (!this.apiToken) {
            // No API key: keypoints-only, by design. Not an error — unless the
            // host requested key-gated features (WebView parity: token required).
            this.validateRequestedFeatures();
            this.setMode('keypoints-only');
            return false;
        }
        const manifest = await this.resolveManifestOnce();
        if (!manifest || manifest.revoked === true) {
            this.setMode('keypoints-only');
            return false;
        }
        this.manifest = manifest;
        // Plan is now known: replicate the TrackingAppV3 load-time gating.
        this.validateRequestedFeatures();
        if (!silentStatus) {
            this.setStatus('downloading');
        }
        const secret = (0, obfuscate_1.deriveCacheSecret)(this.apiToken);
        if (forceEngineRetry && manifest.engine) {
            await this.engineLoader.clearGuard(manifest.engine);
        }
        const result = await this.engineLoader.load(manifest.engine ?? null, secret, {
            forceRetry: forceEngineRetry,
        });
        if (!result) {
            const detail = this.engineLoader.lastError;
            this.reportError({
                type: 'error',
                code: 'engine_load_failed',
                message: detail
                    ? `Engine bundle unavailable — ${detail}`
                    : 'Engine bundle unavailable (offline without cache, or integrity/evaluation failure) — running keypoints-only.',
            });
            this.setMode('keypoints-only');
            return false;
        }
        this.engine = result.engine;
        this.engineSource = result.source;
        // Remember the sealed engine version so a revocation can purge it.
        if (manifest.engine?.version) {
            await this.files?.write(ENGINE_VERSION_KEY, manifest.engine.version).catch(() => { });
        }
        this.setMode('full-engine');
        return true;
    }
    /**
     * Handshake with the session-cache fallback:
     * - live call → cache the manifest, sealed with the token-derived secret;
     * - network/server failure → replay the sealed cached manifest (only
     *   readable with the same token: the "already configured once" proof);
     * - invalid token → purge the cache (a revoked key must not keep the
     *   engine alive) and report a non-fatal error;
     * - quota exceeded → non-fatal error, cache kept (transient condition)
     *   but not replayed this session.
     */
    async resolveManifest(apiToken, localVersions) {
        const secret = (0, obfuscate_1.deriveCacheSecret)(apiToken);
        try {
            const manifest = await (0, configure_1.configure)(apiToken, { ...this.options, localVersions });
            await this.files?.write(MANIFEST_CACHE_KEY, (0, obfuscate_1.sealString)(JSON.stringify(manifest), secret)).catch(() => { });
            return manifest;
        }
        catch (err) {
            if (err instanceof configure_1.ConfigureError && err.code === 'invalid_token') {
                // Revoked/invalid key: purge the sealed session AND engine caches —
                // a revoked key must not keep the business logic alive.
                await this.handleRevocation(err.message);
                return null;
            }
            if (err instanceof configure_1.ConfigureError && err.code === 'quota_exceeded') {
                this.reportError({ type: 'error', code: 'quota_exceeded', message: err.message });
                return null;
            }
            // Network/server failure: replay the encrypted session cache.
            const sealed = await this.files?.read(MANIFEST_CACHE_KEY);
            if (sealed) {
                const plain = (0, obfuscate_1.openString)(sealed, secret);
                if (plain) {
                    try {
                        return JSON.parse(plain);
                    }
                    catch {
                        await this.files?.remove(MANIFEST_CACHE_KEY).catch(() => { });
                    }
                }
            }
            this.reportError({
                type: 'error',
                code: 'network',
                message: 'Handshake unreachable and no cached session — running keypoints-only.',
            });
            return null;
        }
    }
    /**
     * WebView parity — the load-time gating of `TrackingAppV3`:
     * - `blazepose` / `poseEngine` / other WebView-only keys → clear error
     *   (this SDK ships MoveNet Lightning only);
     * - developer features requested WITHOUT an API key → the front's exact
     *   "Invalid params… token=YOUR API_KEY…" message;
     * - plan `free` + angles/recommendations/progression → the front's exact
     *   "You cannot use developer features." message (keypoints alone stays
     *   allowed here: pose-only mode is free; the +exercise case is enforced
     *   in {@link startExercise}).
     * All non-fatal: keypoints-only pose estimation keeps running. One-shot
     * per condition so `configure()` retries don't spam the host.
     */
    validateRequestedFeatures() {
        if (this.unsupportedFeatureKeys.length > 0 && !this.featureGateReported.unsupported) {
            this.featureGateReported.unsupported = true;
            this.reportError({
                type: 'error',
                code: 'feature_not_supported',
                message: (0, features_1.featureNotSupportedMessage)(this.unsupportedFeatureKeys[0]),
            });
        }
        const f = this.features;
        const requestsDevFeatures = f.angles || f.recommendations || f.progression || f.keypoints;
        if (!requestsDevFeatures) {
            return;
        }
        if (!this.apiToken) {
            if (!this.featureGateReported.missingToken) {
                this.featureGateReported.missingToken = true;
                this.reportError({ type: 'error', code: 'invalid_token', message: features_1.INVALID_TOKEN_MESSAGE });
            }
            return;
        }
        if (this.getPlanType() === 'free') {
            const blocked = (0, features_1.freeBlockedFeatures)(f, { withExercise: false });
            if (blocked.length > 0 && !this.featureGateReported.freeBlock) {
                this.featureGateReported.freeBlock = true;
                this.options.onDiagnostic?.(`[posetracker] free plan blocked features: ${blocked.join(', ')}`);
                this.reportError({
                    type: 'error',
                    code: 'free_plan_feature_blocked',
                    message: features_1.FREE_PLAN_FEATURES_MESSAGE,
                });
            }
        }
    }
    resolveModel() {
        if (this.manifest) {
            const model = this.manifest.models[this.manifest.resolvedProfile];
            if (model) {
                return model;
            }
        }
        return DEFAULT_MOVENET;
    }
    // -------------------------------------------------------------------------
    // Exercise sessions (full-engine mode only)
    // -------------------------------------------------------------------------
    getAvailableExercises() {
        if (this.mode !== 'full-engine')
            return [];
        if ((0, engineChannel_1.normalizeEngineChannel)(this.options.engine) === 'v4') {
            const listed = this.engine?.listExercises?.() ?? [];
            if (listed.length)
                return listed.map((e) => this.v4ExerciseConfig(e));
        }
        return this.manifest?.exercises ?? [];
    }
    getEngineChannel() {
        return (0, engineChannel_1.normalizeEngineChannel)(this.options.engine);
    }
    v4ExerciseConfig(entry) {
        const type = entry.type === 'static' ? 'static' : 'dynamic';
        return {
            id: entry.id,
            name: entry.displayName || entry.id,
            type,
            movement: {
                name: entry.id,
                type,
                scale_acceptance: {},
                movement_steps: [],
                movement_initial_posture: null,
            },
        };
    }
    /**
     * Custom exercises shipped inside the engine bundle (jump_analysis,
     * air_time_jump — WebView `customHandlers.js` parity). Empty in
     * keypoints-only mode or with an engine bundle older than 1.2.0.
     */
    getAvailableCustomExercises() {
        if (this.mode !== 'full-engine' || !this.engine?.listCustomExercises) {
            return [];
        }
        return this.engine.listCustomExercises();
    }
    startExercise(exerciseId, options = {}) {
        if (this.status !== 'ready') {
            throw new Error(`Cannot start exercise while status is '${this.status}' — call preload() first.`);
        }
        if (this.mode !== 'full-engine' || !this.engine) {
            throw new Error("Exercises require full-engine mode (validated API key). The SDK is running keypoints-only — call configure(apiToken) first.");
        }
        if (this.meteredSessionState === 'refused') {
            throw new Error('API-key features are not available offline: PoseTracker could not ' +
                'track this session (camera_start failed — no network or quota ' +
                'exceeded). Reconnect and retry.');
        }
        if (this.unsupportedFeatureKeys.length > 0) {
            const message = (0, features_1.featureNotSupportedMessage)(this.unsupportedFeatureKeys[0]);
            this.reportError({ type: 'error', code: 'feature_not_supported', message });
            throw new Error(message);
        }
        // WebView parity: `free` cannot run developer features — and keypoints
        // combined with an exercise counts as one (pose-only keypoints stay free).
        if (this.getPlanType() === 'free') {
            const blocked = (0, features_1.freeBlockedFeatures)(this.features, { withExercise: true });
            if (blocked.length > 0) {
                this.reportError({
                    type: 'error',
                    code: 'free_plan_feature_blocked',
                    message: features_1.FREE_PLAN_FEATURES_MESSAGE,
                });
                throw new Error(features_1.FREE_PLAN_FEATURES_MESSAGE);
            }
        }
        if ((0, engineChannel_1.requiresEngineV4)(exerciseId) && (0, engineChannel_1.normalizeEngineChannel)(this.options.engine) !== 'v4') {
            const message = `Exercise '${exerciseId}' requires engine: 'v4'`;
            this.reportError({ type: 'error', code: 'invalid_exercise', message });
            throw new Error(message);
        }
        if ((0, engineChannel_1.normalizeEngineChannel)(this.options.engine) === 'v4') {
            const listed = this.engine.listExercises?.() ?? [];
            const v4Hit = listed.find((e) => e.id === exerciseId);
            if (v4Hit) {
                this.beginEngineSession(this.v4ExerciseConfig(v4Hit), options);
                return;
            }
            const customs = this.getAvailableCustomExercises();
            const custom = customs.find((e) => e.id === exerciseId) ??
                (0, aliases_1.findExerciseByIdOrAlias)(exerciseId, customs);
            if (custom) {
                this.startCustomExercise(custom, options);
                return;
            }
            const message = `Exercise '${exerciseId}' is not available in V4 engine`;
            this.reportError({ type: 'error', code: 'invalid_exercise', message });
            throw new Error(message);
        }
        const available = this.getAvailableExercises();
        const exercise = (0, aliases_1.findExerciseByIdOrAlias)(exerciseId, available);
        if (!exercise) {
            // Custom exercises live in the engine bundle, not the movement manifest
            // (WebView customHandlers.js parity: jump_analysis, air_time_jump).
            const customs = this.getAvailableCustomExercises();
            const custom = customs.find((e) => e.id === exerciseId) ??
                (0, aliases_1.findExerciseByIdOrAlias)(exerciseId, customs);
            if (custom) {
                this.startCustomExercise(custom, options);
                return;
            }
            // Front literal (CameraFeedV3): error `invalid_exercise`.
            const message = `Exercise '${exerciseId}' is not available in V3 engine`;
            this.reportError({ type: 'error', code: 'invalid_exercise', message });
            throw new Error(message);
        }
        this.beginEngineSession(exercise, options);
    }
    beginEngineSession(exercise, options) {
        if (!this.engine)
            return;
        this.stopExercise();
        this.currentExerciseId = exercise.id;
        this.keypointsSuppressionLogged = false;
        const debug = options.debug ?? this.options.debugEngine === true;
        this.session = this.engine.createSession({
            exercise,
            locale: this.options.locale ?? 'en',
            difficulty: options.difficulty,
            minGrade: this.features.minGrade ?? undefined,
            debug,
            features: {
                angles: this.features.angles,
                recommendations: this.features.recommendations,
                progression: this.features.progression,
            },
        }, (event) => this.emitFromSession(event));
        this.options.onDiagnostic?.(`[posetracker] startExercise id=${exercise.id} difficulty=${options.difficulty ?? 'medium'} ` +
            `debug=${debug} engine=${this.engine.version} minGrade=${this.features.minGrade ?? 'off'}`);
    }
    /** Custom engine session (jump_analysis / air_time_jump). */
    startCustomExercise(custom, options) {
        if (!this.engine?.createCustomSession) {
            throw new Error(`The cached engine bundle is too old for custom exercise '${custom.id}' — reconnect so the SDK can update it.`);
        }
        // Front literal (CameraFeedV3): error `jump_analysis_missing_height`.
        if (custom.id === 'jump_analysis' && (!options.userHeightCm || options.userHeightCm <= 0)) {
            const message = 'User height (userHeightCm) must be provided for jump_analysis exercise';
            this.reportError({ type: 'error', code: 'jump_analysis_missing_height', message });
            throw new Error(message);
        }
        this.stopExercise();
        this.currentExerciseId = custom.id;
        this.keypointsSuppressionLogged = false;
        this.session = this.engine.createCustomSession({
            exerciseId: custom.id,
            locale: this.options.locale ?? 'en',
            userHeightCm: options.userHeightCm,
            devicePitchDeg: options.devicePitchDeg,
        }, (event) => this.emitFromSession(event));
    }
    /**
     * Engine → host emission gate (WebView parity): `angles`,
     * `recommendations` and `progression` only stream when their flag is on.
     * Double safety on top of the engine-side flags — a cached engine bundle
     * predating features support still gets filtered here.
     */
    emitFromSession(event) {
        if (event.type === 'angles' && !this.features.angles)
            return;
        if (event.type === 'recommendations' && !this.features.recommendations)
            return;
        if (event.type === 'progression' && !this.features.progression)
            return;
        this.emit(event);
    }
    /** Ends the active session (emits a final `exercise_summary`). */
    stopExercise() {
        // end() runs remotely-delivered engine code — a throw must not leave the
        // client stuck with a dead session (startExercise calls stopExercise).
        try {
            this.session?.end();
        }
        catch (err) {
            this.options.onDiagnostic?.('[posetracker] engine session end() threw: ' +
                (err instanceof Error ? err.message : String(err)));
        }
        this.session = null;
        this.currentExerciseId = null;
        this.sessionErrorStreak = 0;
    }
    getCurrentExerciseId() {
        return this.currentExerciseId;
    }
    // -------------------------------------------------------------------------
    // Frame pipeline (both modes)
    // -------------------------------------------------------------------------
    /** Active inference backend (auto-selected, forced, or injected). */
    getBackend() {
        return this.backend;
    }
    /** Raw pose estimation, no engine involvement. */
    estimatePose(frame) {
        return this.backend.estimatePose(frame);
    }
    /**
     * Full pipeline for one camera frame: pose estimation + `keypoints` event
     * (both modes), then engine processing when a session is active
     * (full-engine mode). Mode upgrades take effect transparently here.
     */
    async processFrame(frame) {
        const pose = await this.estimatePose(frame);
        if (!pose) {
            return null;
        }
        this.ingestPose(pose);
        return pose;
    }
    /**
     * Feed an externally-estimated pose into the pipeline: `keypoints` event
     * (both modes) + engine processing when a session is active. This is how
     * the vision-camera path (`PoseCameraView`) delivers poses computed
     * synchronously inside the frame-processor worklet.
     */
    ingestPose(pose) {
        // WebView parity: DURING an exercise session, raw keypoints only stream
        // when the `keypoints` feature is on (paid plans — free + keypoints +
        // exercise is rejected in startExercise). Pose-only mode (no session)
        // always streams: that is the SDK's free offline base.
        if (!this.session || this.features.keypoints) {
            this.emit({
                type: 'keypoints',
                keypoints: pose.keypoints,
                score: pose.score,
                timestampMs: pose.timestampMs,
            });
        }
        else if (!this.keypointsSuppressionLogged) {
            this.keypointsSuppressionLogged = true;
            this.options.onDiagnostic?.('[posetracker] keypoints events paused during the exercise session ' +
                '(features.keypoints=false, WebView parity) — they resume on stopExercise().');
        }
        if (this.session) {
            // The engine is remotely-delivered code: one bad frame must not crash
            // the ingest path, and a session that fails on EVERY frame must not
            // keep throwing at camera rate (battery). After a streak of failures
            // the session is terminated with an error event.
            try {
                this.session.processPose(pose);
                this.sessionErrorStreak = 0;
            }
            catch (err) {
                this.sessionErrorStreak += 1;
                const message = err instanceof Error ? err.message : String(err);
                if (this.sessionErrorStreak === 1) {
                    this.options.onDiagnostic?.(`[posetracker] engine session processPose threw: ${message}`);
                }
                if (this.sessionErrorStreak >= SESSION_ERROR_STREAK_LIMIT) {
                    const exerciseId = this.currentExerciseId;
                    this.session = null; // skip end(): the session is already broken
                    this.currentExerciseId = null;
                    this.sessionErrorStreak = 0;
                    this.reportError({
                        type: 'error',
                        code: 'internal',
                        message: `Exercise session '${exerciseId ?? '?'}' failed repeatedly ` +
                            `(${message}) — session stopped, keypoints keep streaming.`,
                    });
                }
            }
        }
    }
    async dispose() {
        this.stopExercise();
        this.quality.setApplyProfile(undefined);
        await this.backend.dispose();
        this.listeners.clear();
        this.messageListeners.clear();
        this.stateListeners.clear();
        this.preloadPromise = null;
        this.configurePromise = null;
        this.handshakePromise = null;
        this.runtimePromise = null;
        this.meteredSessionState = 'idle';
        this.lastCameraStartInfo = null;
        this.featureGateReported = { unsupported: false, freeBlock: false, missingToken: false };
        this.keypointsSuppressionLogged = false;
        this.engine = null;
        this.engineSource = null;
        this.manifest = null;
        this.mode = 'keypoints-only';
        this.setStatus('idle');
    }
    // -------------------------------------------------------------------------
    setStatus(status) {
        this.status = status;
        if (status === 'configuring' || status === 'downloading' || status === 'warming') {
            this.emit({
                type: 'initialization',
                step: status,
                message: status === 'configuring'
                    // Front / GitBook literal (sic): hosts may string-match this.
                    ? 'checking you plan and access'
                    : status === 'downloading'
                        ? 'downloading engine'
                        : 'loading pose model',
                ready: false,
            });
        }
        this.notifyState();
    }
    setMode(mode) {
        if (this.mode !== mode) {
            this.mode = mode;
            this.notifyState();
        }
    }
    reportError(error) {
        this.lastError = error;
        this.emit(error);
        this.notifyState();
    }
    notifyState() {
        this.stateListeners.forEach((l) => l());
    }
    emit(event) {
        // A throwing host listener must never break other listeners or the frame
        // pipeline (emit is called from the per-frame ingest path).
        this.listeners.forEach((l) => {
            try {
                l(event);
            }
            catch (err) {
                this.options.onDiagnostic?.(`[posetracker] event listener threw on '${event.type}': ` +
                    (err instanceof Error ? err.message : String(err)));
            }
        });
        if (this.messageListeners.size === 0) {
            // Skip the classic-message conversion entirely (per-frame allocation).
            return;
        }
        const classic = (0, classicMessage_1.toClassicNativeMessage)(event);
        if (classic == null) {
            // SDK-only events (e.g. engine_debug) have no classic equivalent.
            return;
        }
        this.messageListeners.forEach((l) => {
            try {
                l(classic);
            }
            catch (err) {
                this.options.onDiagnostic?.(`[posetracker] message listener threw on '${event.type}': ` +
                    (err instanceof Error ? err.message : String(err)));
            }
        });
    }
}
exports.PoseTrackerClient = PoseTrackerClient;
