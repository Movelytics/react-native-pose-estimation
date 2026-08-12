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

import { configure as handshake, ConfigureError, type ConfigureOptions } from './api/configure';
import { TrackError, UsageTracker } from './api/track';
import { EngineLoader, type EngineLoadResult, type FileStore } from './engine/EngineLoader';
import { createNativeFileStore } from './engine/EngineLoader';
import type { PoseRuntimeParts } from './runtime/RuntimeCache';
import {
  getBundledRuntimeParts,
  getBundledRuntimeVersion,
} from './backends/webview/bundledRuntime';
import { deriveCacheSecret, openString, sealString } from './cache/obfuscate';
import type { CustomExerciseDescriptor, EngineSession, PoseTrackerEngine } from './engine/types';
import type { PoseBackend, PoseInputFrame } from './backends/PoseBackend';
import { VisionPoseBackend } from './backends/vision/VisionPoseBackend';
import { WebViewPoseBackend } from './backends/webview/WebViewPoseBackend';
import { findExerciseByIdOrAlias } from './exercises/aliases';
import { fetchSkeletonDefinition } from './api/skeleton';
import type { ExerciseConfig, ModelDescriptor, SdkManifest } from './types/manifest';
import type { ColdStartMode, PreloadOptions } from './types/preload';
import type { SkeletonDefinition } from './types/skeleton';
import type {
  ErrorEvent,
  PoseTrackerEvent,
  PoseTrackerEventListener,
  PoseTrackerMode,
  PoseTrackerStatus,
} from './types/events';
import type { Pose } from './types/pose';
import type { AccelerationDiagnostics, AccelerationState } from './types/acceleration';
import {
  defaultDiagnosticLogger,
  logAccelerationReport,
  logPlatformBanner,
} from './diagnostics/logReport';
import {
  AdaptiveQualityController,
  type QualityState,
} from './quality/AdaptiveQualityController';
import {
  isQualityProfileId,
  type CapturePriority,
  type QualityChoice,
  type QualityProfile,
} from './quality/profiles';
import {
  toClassicNativeMessage,
  type ClassicMessageListener,
} from './events/classicMessage';
import {
  FREE_PLAN_FEATURES_MESSAGE,
  INVALID_TOKEN_MESSAGE,
  featureNotSupportedMessage,
  freeBlockedFeatures,
  resolveFeatures,
  type PoseTrackerFeatures,
  type ResolvedFeatures,
} from './types/features';

const MANIFEST_CACHE_KEY = 'session.sealed';
const ENGINE_VERSION_KEY = 'engine.version';

/** Consecutive engine `processPose` failures before the session is stopped. */
const SESSION_ERROR_STREAK_LIMIT = 30;

/**
 * Fallback descriptor when no manifest is available. The model itself is NOT
 * bundled anymore (stub-loader architecture): it arrives inside the
 * pose-runtime payload, this descriptor only feeds backend init metadata.
 */
const DEFAULT_MOVENET: ModelDescriptor = {
  modelId: 'movenet-singlepose-lightning',
  format: 'tfjs-graph-model',
  inputSize: 192,
  deliveredBy: 'pose-runtime',
  version: '4',
};

/**
 * Inference backend selection:
 * - 'auto' (default) / 'webview': MoveNet SinglePose Lightning (17 keypoints,
 *   192×192) inside a Chromium/WKWebView — TF.js WebGL, fully offline (model
 *   + runtime bundled in the package). This is the SDK's base runtime on
 *   BOTH platforms: same stack as the PoseTracker WebView product, real-time
 *   on Android mid-range AND iOS, works in Expo Go.
 * - 'vision': Apple Vision (`VNDetectHumanBodyPoseRequest`) — iOS native
 *   builds only, explicit opt-in. No automatic fallback: an init failure
 *   surfaces as status 'error'.
 */
export type PreferredBackend = 'auto' | 'webview' | 'vision';

export interface PoseTrackerClientOptions extends ConfigureOptions {
  /** Injectable for tests / custom hosts (takes precedence over `preferredBackend`). */
  backend?: PoseBackend;
  /** See {@link PreferredBackend}. */
  preferredBackend?: PreferredBackend;
  engineLoader?: EngineLoader;
  fileStore?: FileStore | null;
  /** Injectable for tests. */
  usageTracker?: UsageTracker;
  /**
   * Camera / preprocess quality tier. Default `AdaptiveChoice` — picks a
   * profile from device capability, crash-loop guard, and live FPS.
   * See docs/ADAPTIVE_QUALITY.md.
   */
  qualityChoice?: QualityChoice;
  /**
   * Trade-off between pose FPS and camera preview sharpness.
   * Default `performance` — SDK may lower capture (esp. Android) to hold the
   * FPS floor. Pass `quality` to keep a sharp preview and accept slower pose
   * updates (no FPS-driven capture downgrade). See docs/ADAPTIVE_QUALITY.md.
   */
  capturePriority?: CapturePriority;
  /**
   * Tracking feature flags — SDK port of the WebView query params
   * (`angles`, `recommendations`, `progression`, `keypoints`, `minGrade`)
   * with the SAME plan gating and error messages as the WebView product:
   * paid plans only; `free` gets the exact `TrackingAppV3` error strings.
   * Defaults: everything off (WebView parity). Pose-only keypoints (no
   * exercise) always stream and are never gated. See docs/FEATURES.md.
   */
  features?: PoseTrackerFeatures;
  /**
   * Receives SDK diagnostic lines (GL flags, GPU health check, fallbacks,
   * context-loss recoveries). Route to your logger/telemetry; useful for
   * triaging Android GPU issues in the field.
   */
  onDiagnostic?: (message: string) => void;
  /**
   * When true, exercise sessions request `engine_debug` snapshots from the
   * remote engine (bundle ≥ 1.2.4). Overridable per call via
   * `startExercise(id, { debug: true|false })`.
   */
  debugEngine?: boolean;
}

/**
 * Per-session options for {@link PoseTrackerClient.startExercise} — the SDK
 * port of the WebView query params `difficulty`, `userHeightCm` and
 * `devicePitchDeg`.
 */
export interface StartExerciseOptions {
  /**
   * Difficulty key into the movement `scale_acceptance` maps (FSM exercises).
   * WebView `difficulty` param parity. Default: 'medium'.
   */
  difficulty?: string;
  /** Athlete height in cm — REQUIRED by `jump_analysis` (cm/pixel calibration). */
  userHeightCm?: number;
  /** Device pitch in degrees — jump exercises compensate camera tilt. */
  devicePitchDeg?: number;
  /**
   * Request throttled `engine_debug` events for this session (movement FSM
   * QA). Defaults to {@link PoseTrackerClientOptions.debugEngine}.
   */
  debug?: boolean;
}

export class PoseTrackerClient {
  private status: PoseTrackerStatus = 'idle';
  private mode: PoseTrackerMode = 'keypoints-only';
  private lastError: ErrorEvent | null = null;
  private manifest: SdkManifest | null = null;
  private engine: PoseTrackerEngine | null = null;
  private engineSource: EngineLoadResult['source'] | null = null;
  private session: EngineSession | null = null;
  private currentExerciseId: string | null = null;
  private apiToken: string | null;

  private backend: PoseBackend;
  private readonly engineLoader: EngineLoader;
  private readonly files: FileStore | null;
  private readonly tracker: UsageTracker;
  private readonly quality: AdaptiveQualityController;
  private readonly listeners = new Set<PoseTrackerEventListener>();
  private readonly messageListeners = new Set<ClassicMessageListener>();
  private readonly stateListeners = new Set<() => void>();
  private preloadPromise: Promise<void> | null = null;
  /** Last requested cold-start mode (default basic — no getUserMedia). */
  private coldStartMode: ColdStartMode = 'basic';
  private configurePromise: Promise<boolean> | null = null;
  /** One handshake per configuration cycle, shared by runtime warm + engine load. */
  private handshakePromise: Promise<SdkManifest | null> | null = null;
  /** Pose-runtime payload resolution (handshake + versioned cache warm). */
  private runtimePromise: Promise<PoseRuntimeParts> | null = null;
  /**
   * Metered-session gate: with an API key, the `camera_start` track call must
   * succeed online before key-gated features run ('refused' = offline/quota).
   */
  private meteredSessionState: 'idle' | 'pending' | 'validated' | 'refused' = 'idle';
  /** Last camera_start payload — lets configure() retry a refused metered gate. */
  private lastCameraStartInfo: { backend: string; profileId: string | null } | null = null;
  /** Consecutive engine processPose failures (see SESSION_ERROR_STREAK_LIMIT). */
  private sessionErrorStreak = 0;

  /** Requested tracking features with WebView-parity defaults applied. */
  private readonly features: ResolvedFeatures;
  /** WebView-only keys passed by untyped hosts (blazepose, poseEngine, …). */
  private readonly unsupportedFeatureKeys: string[];
  /** One-shot flags so plan-gating errors are not re-emitted on every retry. */
  private featureGateReported = { unsupported: false, freeBlock: false, missingToken: false };
  private keypointsSuppressionLogged = false;

  private readonly options: PoseTrackerClientOptions;

  constructor(apiToken?: string, options: PoseTrackerClientOptions = {}) {
    // Default: dump every diagnostic line to Metro / logcat so Android FPS
    // issues (CPU fallback) are visible without any host wiring.
    this.options = {
      ...options,
      onDiagnostic: options.onDiagnostic ?? defaultDiagnosticLogger,
    };
    this.apiToken = apiToken ?? null;
    const resolved = resolveFeatures(options.features);
    this.features = resolved.features;
    this.unsupportedFeatureKeys = resolved.unsupportedKeys;
    logPlatformBanner();
    this.options.onDiagnostic?.(
      `[posetracker] client created preferredBackend=${this.options.preferredBackend ?? 'auto'} ` +
        `qualityChoice=${this.options.qualityChoice ?? 'AdaptiveChoice'} ` +
        `capturePriority=${this.options.capturePriority ?? 'performance'} ` +
        `hasApiToken=${Boolean(this.apiToken)} ` +
        `features=${JSON.stringify(this.features)}` +
        (this.unsupportedFeatureKeys.length > 0
          ? ` unsupportedFeatureKeys=${this.unsupportedFeatureKeys.join(',')}`
          : ''),
    );
    this.quality = new AdaptiveQualityController({
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
      new EngineLoader({
        fileStore: options.fileStore,
        onDiagnostic: this.options.onDiagnostic,
      });
    this.files =
      options.fileStore !== undefined ? options.fileStore : createNativeFileStore('posetracker-engine');
    this.tracker = options.usageTracker ?? new UsageTracker({ baseUrl: options.baseUrl });
    this.options.onDiagnostic?.(
      `[posetracker] selected backend=${this.backend.name} ` +
        `bundledPoseRuntime=${getBundledRuntimeVersion()} ` +
        `fileStore=${this.files ? 'native' : 'none'}`,
    );
  }

  /** Backend selection — see {@link PreferredBackend}. */
  private createBackend(): PoseBackend {
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
      return new VisionPoseBackend(shared);
    }

    // 'auto' | 'webview': the offline WebView MoveNet runtime, both platforms.
    return new WebViewPoseBackend({
      ...shared,
      onWarmupEstimate: (info) => {
        const pageProfile = isQualityProfileId(info.profileId) ? info.profileId : null;
        void this.quality.onWarmupEstimate({
          medianInferenceMs: info.medianInferenceMs,
          glRenderer: info.glRenderer,
          pageSelectedProfile: pageProfile,
        });
      },
      onReady: (info) => {
        const pageProfile =
          info.profileId && isQualityProfileId(info.profileId) ? info.profileId : null;
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

  getStatus(): PoseTrackerStatus {
    return this.status;
  }

  getMode(): PoseTrackerMode {
    return this.mode;
  }

  /** Last non-fatal or fatal error (also emitted as an `error` event). */
  getError(): ErrorEvent | null {
    return this.lastError;
  }

  getManifest(): SdkManifest | null {
    return this.manifest;
  }

  /** Plan type from the manifest ('free', 'developer', …) or null (keyless/offline). */
  getPlanType(): string | null {
    return this.manifest?.plan?.plan ?? null;
  }

  /** Requested tracking features with WebView-parity defaults applied. */
  getFeatures(): ResolvedFeatures {
    return { ...this.features };
  }

  /** 'remote-cache' | 'remote-download' | null (keypoints-only). */
  getEngineSource(): EngineLoadResult['source'] | null {
    return this.engineSource;
  }

  /**
   * GPU-acceleration verdict from the warm-up health check ('unknown' until
   * preload/warmup completes). See docs/ANDROID_GL_ACCELERATION.md.
   */
  getAcceleration(): AccelerationState {
    return this.getAccelerationDiagnostics()?.state ?? 'unknown';
  }

  /** Full diagnostics (backend, timings, GL renderer, flags, downgrade trail). */
  getAccelerationDiagnostics(): AccelerationDiagnostics | null {
    return this.backend.getAcceleration?.() ?? null;
  }

  /**
   * Adaptive camera-quality state (profile, capability score, mean FPS).
   * See docs/ADAPTIVE_QUALITY.md.
   */
  getQualityState(): QualityState {
    return this.quality.getState();
  }

  /** Resolve (and cache) the initial quality profile before mounting the WebView. */
  resolveQualityProfile(): Promise<QualityProfile> {
    return this.quality.resolveInitialProfile();
  }

  /** Mark the active profile as PROBING (crash-loop guard) before page boot. */
  beginQualitySession(): Promise<void> {
    return this.quality.beginSession();
  }

  /**
   * Wire the live WebView injector so auto-downgrades can restart getUserMedia.
   * Called by {@link WebViewPoseView}.
   */
  setQualityApplyHandler(fn: ((profile: QualityProfile) => void) | undefined): void {
    this.quality.setApplyProfile(fn);
  }

  addEventListener(listener: PoseTrackerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Classic PoseTracker WebView parity: receive `sendDataToNative`-shaped JSON
   * (`{ type: 'keypoints', data: [...] }`, `{ type: 'initialization', message, ready }`, …).
   * Prefer typed {@link addEventListener} for new apps; use this to migrate
   * existing `onMessage` parsers with minimal changes.
   */
  addMessageListener(listener: ClassicMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Fired on any status/mode/manifest change. */
  onStateChange(listener: () => void): () => void {
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
  preload(options?: PreloadOptions): Promise<void> {
    const mode: ColdStartMode = options?.coldStart === 'full' ? 'full' : 'basic';
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
    } else if (mode === 'full') {
      // Upgrade an in-flight basic preload once it finishes.
      return this.preloadPromise.then(() => this.ensureColdStartMode('full'));
    }
    return this.preloadPromise;
  }

  /** Alias of preload(), matching the Sency-style naming. */
  warmup(options?: PreloadOptions): Promise<void> {
    return this.preload(options);
  }

  /** Current preferred cold-start mode (for hosts / WebView wiring). */
  getColdStartMode(): ColdStartMode {
    return this.coldStartMode;
  }

  private async doPreload(): Promise<void> {
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
    } catch (err) {
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
  private async ensureColdStartMode(mode: ColdStartMode): Promise<void> {
    if (mode !== 'full') return;
    const backend = this.backend;
    if (!(backend instanceof WebViewPoseBackend)) return;
    if (backend.isCameraOpened()) return;
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
  getRuntimeParts(): Promise<PoseRuntimeParts> {
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
  fetchSkeleton(uuid: string): Promise<SkeletonDefinition> {
    return fetchSkeletonDefinition(uuid, { baseUrl: this.options.baseUrl });
  }

  private loadBundledRuntime(): PoseRuntimeParts {
    const parts = getBundledRuntimeParts();
    this.options.onDiagnostic?.(
      `[posetracker] pose-runtime bundled version=${parts.version} ` +
        `pipelineWasm=${parts.pipelineWasmB64 ? 'yes' : 'no'}`,
    );
    return parts;
  }

  /**
   * One handshake per configuration cycle — shared by the pose-runtime warm
   * and the engine load, with or without API key. Never throws; resolves to
   * null when unreachable AND no sealed session cache can be replayed.
   */
  private resolveManifestOnce(): Promise<SdkManifest | null> {
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

  private async doResolveManifestOnce(): Promise<SdkManifest | null> {
    const localVersions = {
      poseRuntime: getBundledRuntimeVersion(),
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
      const manifest = await handshake(null, { ...this.options, localVersions });
      this.manifest = manifest;
      return manifest;
    } catch {
      // Offline keyless: the runtime cache decides what is possible.
      return null;
    }
  }

  /**
   * Revocation signal: purge the sealed engine artifacts and downgrade to
   * keypoints-only. The public pose-runtime cache is NOT purged (public
   * payload, keypoints-only keeps working).
   */
  private async handleRevocation(message: string): Promise<void> {
    const engineVersion = await this.files?.read(ENGINE_VERSION_KEY).catch(() => null);
    if (engineVersion) {
      await this.files?.remove(`engine-${engineVersion}.sealed`).catch(() => {});
      await this.files?.remove(ENGINE_VERSION_KEY).catch(() => {});
    }
    await this.files?.remove(MANIFEST_CACHE_KEY).catch(() => {});
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
  private async handleCameraStart(info: {
    backend: string;
    profileId: string | null;
  }): Promise<void> {
    this.lastCameraStartInfo = info;
    const params = {
      backend: info.backend,
      profileId: info.profileId,
      poseModelProfile: this.options.poseModelProfile ?? 'AdaptiveChoice',
      qualityChoice: this.options.qualityChoice ?? 'AdaptiveChoice',
      mode: this.mode,
      exercise: this.currentExerciseId,
      runtimeVersion: getBundledRuntimeVersion(),
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
    } catch (err) {
      this.meteredSessionState = 'refused';
      if (err instanceof TrackError && err.code === 'network') {
        this.reportError({
          type: 'error',
          code: 'offline_metered',
          message:
            'API-key features are not available offline: PoseTracker cannot ' +
            'count their usage. Keypoints-only keeps running from the cache; ' +
            'reconnect to start a metered session.',
        });
      } else if (err instanceof TrackError && err.code === 'invalid_token') {
        await this.handleRevocation('API key invalid or revoked — engine cache purged.');
      } else if (err instanceof TrackError && err.code === 'quota_exceeded') {
        this.reportError({ type: 'error', code: 'quota_exceeded', message: err.message });
      } else {
        this.reportError({
          type: 'error',
          code: 'internal',
          message: `Usage tracking failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  /** Backend init + warm-up. An init failure surfaces as status 'error'. */
  private async initAndWarmupBackend(): Promise<void> {
    try {
      await this.backend.init({ model: this.resolveModel() });
      await this.backend.warmup();
    } catch (err) {
      logAccelerationReport(this.getAccelerationDiagnostics(), {
        phase: 'init-failed',
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    // Always dump the full report to Metro after warm-up.
    logAccelerationReport(this.getAccelerationDiagnostics(), {
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
  configure(apiToken?: string): Promise<boolean> {
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
  private retryMeteredSessionIfRefused(): void {
    if (this.meteredSessionState === 'refused' && this.apiToken && this.lastCameraStartInfo) {
      this.options.onDiagnostic?.(
        '[posetracker] retrying metered camera_start after configure() (was refused)',
      );
      void this.handleCameraStart(this.lastCameraStartInfo);
    }
  }

  /**
   * Handshake + engine load. Never throws; returns whether full-engine mode
   * was reached. `silentStatus` avoids status regressions (e.g. hot upgrade
   * while `ready` and the camera is streaming).
   */
  private async tryConfigure({
    silentStatus,
    forceEngineRetry = false,
  }: {
    silentStatus: boolean;
    forceEngineRetry?: boolean;
  }): Promise<boolean> {
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
    const secret = deriveCacheSecret(this.apiToken);
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
      await this.files?.write(ENGINE_VERSION_KEY, manifest.engine.version).catch(() => {});
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
  private async resolveManifest(
    apiToken: string,
    localVersions?: ConfigureOptions['localVersions'],
  ): Promise<SdkManifest | null> {
    const secret = deriveCacheSecret(apiToken);
    try {
      const manifest = await handshake(apiToken, { ...this.options, localVersions });
      await this.files?.write(MANIFEST_CACHE_KEY, sealString(JSON.stringify(manifest), secret)).catch(() => {});
      return manifest;
    } catch (err) {
      if (err instanceof ConfigureError && err.code === 'invalid_token') {
        // Revoked/invalid key: purge the sealed session AND engine caches —
        // a revoked key must not keep the business logic alive.
        await this.handleRevocation(err.message);
        return null;
      }
      if (err instanceof ConfigureError && err.code === 'quota_exceeded') {
        this.reportError({ type: 'error', code: 'quota_exceeded', message: err.message });
        return null;
      }

      // Network/server failure: replay the encrypted session cache.
      const sealed = await this.files?.read(MANIFEST_CACHE_KEY);
      if (sealed) {
        const plain = openString(sealed, secret);
        if (plain) {
          try {
            return JSON.parse(plain) as SdkManifest;
          } catch {
            await this.files?.remove(MANIFEST_CACHE_KEY).catch(() => {});
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
  private validateRequestedFeatures(): void {
    if (this.unsupportedFeatureKeys.length > 0 && !this.featureGateReported.unsupported) {
      this.featureGateReported.unsupported = true;
      this.reportError({
        type: 'error',
        code: 'feature_not_supported',
        message: featureNotSupportedMessage(this.unsupportedFeatureKeys[0]!),
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
        this.reportError({ type: 'error', code: 'invalid_token', message: INVALID_TOKEN_MESSAGE });
      }
      return;
    }

    if (this.getPlanType() === 'free') {
      const blocked = freeBlockedFeatures(f, { withExercise: false });
      if (blocked.length > 0 && !this.featureGateReported.freeBlock) {
        this.featureGateReported.freeBlock = true;
        this.options.onDiagnostic?.(
          `[posetracker] free plan blocked features: ${blocked.join(', ')}`,
        );
        this.reportError({
          type: 'error',
          code: 'free_plan_feature_blocked',
          message: FREE_PLAN_FEATURES_MESSAGE,
        });
      }
    }
  }

  private resolveModel(): ModelDescriptor {
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

  getAvailableExercises(): ExerciseConfig[] {
    return this.mode === 'full-engine' ? this.manifest?.exercises ?? [] : [];
  }

  /**
   * Custom exercises shipped inside the engine bundle (jump_analysis,
   * air_time_jump — WebView `customHandlers.js` parity). Empty in
   * keypoints-only mode or with an engine bundle older than 1.2.0.
   */
  getAvailableCustomExercises(): CustomExerciseDescriptor[] {
    if (this.mode !== 'full-engine' || !this.engine?.listCustomExercises) {
      return [];
    }
    return this.engine.listCustomExercises();
  }

  startExercise(exerciseId: string, options: StartExerciseOptions = {}): void {
    if (this.status !== 'ready') {
      throw new Error(`Cannot start exercise while status is '${this.status}' — call preload() first.`);
    }
    if (this.mode !== 'full-engine' || !this.engine) {
      throw new Error(
        "Exercises require full-engine mode (validated API key). The SDK is running keypoints-only — call configure(apiToken) first.",
      );
    }
    if (this.meteredSessionState === 'refused') {
      throw new Error(
        'API-key features are not available offline: PoseTracker could not ' +
          'track this session (camera_start failed — no network or quota ' +
          'exceeded). Reconnect and retry.',
      );
    }
    if (this.unsupportedFeatureKeys.length > 0) {
      const message = featureNotSupportedMessage(this.unsupportedFeatureKeys[0]!);
      this.reportError({ type: 'error', code: 'feature_not_supported', message });
      throw new Error(message);
    }
    // WebView parity: `free` cannot run developer features — and keypoints
    // combined with an exercise counts as one (pose-only keypoints stay free).
    if (this.getPlanType() === 'free') {
      const blocked = freeBlockedFeatures(this.features, { withExercise: true });
      if (blocked.length > 0) {
        this.reportError({
          type: 'error',
          code: 'free_plan_feature_blocked',
          message: FREE_PLAN_FEATURES_MESSAGE,
        });
        throw new Error(FREE_PLAN_FEATURES_MESSAGE);
      }
    }
    const available = this.getAvailableExercises();
    const exercise = findExerciseByIdOrAlias(exerciseId, available);
    if (!exercise) {
      // Custom exercises live in the engine bundle, not the movement manifest
      // (WebView customHandlers.js parity: jump_analysis, air_time_jump).
      const customs = this.getAvailableCustomExercises();
      const custom =
        customs.find((e) => e.id === exerciseId) ??
        findExerciseByIdOrAlias(exerciseId, customs);
      if (custom) {
        this.startCustomExercise(custom, options);
        return;
      }
      // Front literal (CameraFeedV3): error `invalid_exercise`.
      const message = `Exercise '${exerciseId}' is not available in V3 engine`;
      this.reportError({ type: 'error', code: 'invalid_exercise', message });
      throw new Error(message);
    }
    this.stopExercise();
    this.currentExerciseId = exerciseId;
    this.keypointsSuppressionLogged = false;
    const debug = options.debug ?? this.options.debugEngine === true;
    this.session = this.engine.createSession(
      {
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
      },
      (event) => this.emitFromSession(event),
    );
    this.options.onDiagnostic?.(
      `[posetracker] startExercise id=${exercise.id} difficulty=${options.difficulty ?? 'medium'} ` +
        `debug=${debug} engine=${this.engine.version} minGrade=${this.features.minGrade ?? 'off'}`,
    );
  }

  /** Custom engine session (jump_analysis / air_time_jump). */
  private startCustomExercise(custom: CustomExerciseDescriptor, options: StartExerciseOptions): void {
    if (!this.engine?.createCustomSession) {
      throw new Error(
        `The cached engine bundle is too old for custom exercise '${custom.id}' — reconnect so the SDK can update it.`,
      );
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
    this.session = this.engine.createCustomSession(
      {
        exerciseId: custom.id,
        locale: this.options.locale ?? 'en',
        userHeightCm: options.userHeightCm,
        devicePitchDeg: options.devicePitchDeg,
      },
      (event) => this.emitFromSession(event),
    );
  }

  /**
   * Engine → host emission gate (WebView parity): `angles`,
   * `recommendations` and `progression` only stream when their flag is on.
   * Double safety on top of the engine-side flags — a cached engine bundle
   * predating features support still gets filtered here.
   */
  private emitFromSession(event: PoseTrackerEvent): void {
    if (event.type === 'angles' && !this.features.angles) return;
    if (event.type === 'recommendations' && !this.features.recommendations) return;
    if (event.type === 'progression' && !this.features.progression) return;
    this.emit(event);
  }

  /** Ends the active session (emits a final `exercise_summary`). */
  stopExercise(): void {
    // end() runs remotely-delivered engine code — a throw must not leave the
    // client stuck with a dead session (startExercise calls stopExercise).
    try {
      this.session?.end();
    } catch (err) {
      this.options.onDiagnostic?.(
        '[posetracker] engine session end() threw: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
    this.session = null;
    this.currentExerciseId = null;
    this.sessionErrorStreak = 0;
  }

  getCurrentExerciseId(): string | null {
    return this.currentExerciseId;
  }

  // -------------------------------------------------------------------------
  // Frame pipeline (both modes)
  // -------------------------------------------------------------------------

  /** Active inference backend (auto-selected, forced, or injected). */
  getBackend(): PoseBackend {
    return this.backend;
  }

  /** Raw pose estimation, no engine involvement. */
  estimatePose(frame: PoseInputFrame): Promise<Pose | null> {
    return this.backend.estimatePose(frame);
  }

  /**
   * Full pipeline for one camera frame: pose estimation + `keypoints` event
   * (both modes), then engine processing when a session is active
   * (full-engine mode). Mode upgrades take effect transparently here.
   */
  async processFrame(frame: PoseInputFrame): Promise<Pose | null> {
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
  ingestPose(pose: Pose): void {
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
    } else if (!this.keypointsSuppressionLogged) {
      this.keypointsSuppressionLogged = true;
      this.options.onDiagnostic?.(
        '[posetracker] keypoints events paused during the exercise session ' +
          '(features.keypoints=false, WebView parity) — they resume on stopExercise().',
      );
    }
    if (this.session) {
      // The engine is remotely-delivered code: one bad frame must not crash
      // the ingest path, and a session that fails on EVERY frame must not
      // keep throwing at camera rate (battery). After a streak of failures
      // the session is terminated with an error event.
      try {
        this.session.processPose(pose);
        this.sessionErrorStreak = 0;
      } catch (err) {
        this.sessionErrorStreak += 1;
        const message = err instanceof Error ? err.message : String(err);
        if (this.sessionErrorStreak === 1) {
          this.options.onDiagnostic?.(
            `[posetracker] engine session processPose threw: ${message}`,
          );
        }
        if (this.sessionErrorStreak >= SESSION_ERROR_STREAK_LIMIT) {
          const exerciseId = this.currentExerciseId;
          this.session = null; // skip end(): the session is already broken
          this.currentExerciseId = null;
          this.sessionErrorStreak = 0;
          this.reportError({
            type: 'error',
            code: 'internal',
            message:
              `Exercise session '${exerciseId ?? '?'}' failed repeatedly ` +
              `(${message}) — session stopped, keypoints keep streaming.`,
          });
        }
      }
    }
  }

  async dispose(): Promise<void> {
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

  private setStatus(status: PoseTrackerStatus): void {
    this.status = status;
    if (status === 'configuring' || status === 'downloading' || status === 'warming') {
      this.emit({
        type: 'initialization',
        step: status,
        message:
          status === 'configuring'
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

  private setMode(mode: PoseTrackerMode): void {
    if (this.mode !== mode) {
      this.mode = mode;
      this.notifyState();
    }
  }

  private reportError(error: ErrorEvent): void {
    this.lastError = error;
    this.emit(error);
    this.notifyState();
  }

  private notifyState(): void {
    this.stateListeners.forEach((l) => l());
  }

  private emit(event: PoseTrackerEvent): void {
    // A throwing host listener must never break other listeners or the frame
    // pipeline (emit is called from the per-frame ingest path).
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch (err) {
        this.options.onDiagnostic?.(
          `[posetracker] event listener threw on '${event.type}': ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    });
    if (this.messageListeners.size === 0) {
      // Skip the classic-message conversion entirely (per-frame allocation).
      return;
    }
    const classic = toClassicNativeMessage(event);
    if (classic == null) {
      // SDK-only events (e.g. engine_debug) have no classic equivalent.
      return;
    }
    this.messageListeners.forEach((l) => {
      try {
        l(classic);
      } catch (err) {
        this.options.onDiagnostic?.(
          `[posetracker] message listener threw on '${event.type}': ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    });
  }
}
