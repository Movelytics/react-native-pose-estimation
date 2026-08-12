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
import { type ConfigureOptions } from './api/configure';
import { UsageTracker } from './api/track';
import { EngineLoader, type EngineLoadResult, type FileStore } from './engine/EngineLoader';
import type { PoseRuntimeParts } from './runtime/RuntimeCache';
import type { CustomExerciseDescriptor } from './engine/types';
import type { PoseBackend, PoseInputFrame } from './backends/PoseBackend';
import type { ExerciseConfig, SdkManifest } from './types/manifest';
import type { ColdStartMode, PreloadOptions } from './types/preload';
import type { SkeletonDefinition } from './types/skeleton';
import type { ErrorEvent, PoseTrackerEventListener, PoseTrackerMode, PoseTrackerStatus } from './types/events';
import type { Pose } from './types/pose';
import type { AccelerationDiagnostics, AccelerationState } from './types/acceleration';
import { type QualityState } from './quality/AdaptiveQualityController';
import { type CapturePriority, type QualityChoice, type QualityProfile } from './quality/profiles';
import { type ClassicMessageListener } from './events/classicMessage';
import { type PoseTrackerFeatures, type ResolvedFeatures } from './types/features';
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
     * @internal PoseTracker QA only — not a supported public API.
     * See `.private/ENGINE_DEBUG_QA.md` (do not document in Mintlify).
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
     * @internal PoseTracker QA only — not a supported public API.
     * Defaults to {@link PoseTrackerClientOptions.debugEngine}.
     */
    debug?: boolean;
}
export declare class PoseTrackerClient {
    private status;
    private mode;
    private lastError;
    private manifest;
    private engine;
    private engineSource;
    private session;
    private currentExerciseId;
    private apiToken;
    private backend;
    private readonly engineLoader;
    private readonly files;
    private readonly tracker;
    private readonly quality;
    private readonly listeners;
    private readonly messageListeners;
    private readonly stateListeners;
    private preloadPromise;
    /** Last requested cold-start mode (default basic — no getUserMedia). */
    private coldStartMode;
    private configurePromise;
    /** One handshake per configuration cycle, shared by runtime warm + engine load. */
    private handshakePromise;
    /** Pose-runtime payload resolution (handshake + versioned cache warm). */
    private runtimePromise;
    /**
     * Metered-session gate: with an API key, the `camera_start` track call must
     * succeed online before key-gated features run ('refused' = offline/quota).
     */
    private meteredSessionState;
    /** Last camera_start payload — lets configure() retry a refused metered gate. */
    private lastCameraStartInfo;
    /** Consecutive engine processPose failures (see SESSION_ERROR_STREAK_LIMIT). */
    private sessionErrorStreak;
    /** Requested tracking features with WebView-parity defaults applied. */
    private readonly features;
    /** WebView-only keys passed by untyped hosts (blazepose, poseEngine, …). */
    private readonly unsupportedFeatureKeys;
    /** One-shot flags so plan-gating errors are not re-emitted on every retry. */
    private featureGateReported;
    private keypointsSuppressionLogged;
    private readonly options;
    constructor(apiToken?: string, options?: PoseTrackerClientOptions);
    /** Backend selection — see {@link PreferredBackend}. */
    private createBackend;
    getStatus(): PoseTrackerStatus;
    getMode(): PoseTrackerMode;
    /** Last non-fatal or fatal error (also emitted as an `error` event). */
    getError(): ErrorEvent | null;
    getManifest(): SdkManifest | null;
    /** Plan type from the manifest ('free', 'developer', …) or null (keyless/offline). */
    getPlanType(): string | null;
    /** Requested tracking features with WebView-parity defaults applied. */
    getFeatures(): ResolvedFeatures;
    /** 'remote-cache' | 'remote-download' | null (keypoints-only). */
    getEngineSource(): EngineLoadResult['source'] | null;
    /**
     * GPU-acceleration verdict from the warm-up health check ('unknown' until
     * preload/warmup completes). See docs/ANDROID_GL_ACCELERATION.md.
     */
    getAcceleration(): AccelerationState;
    /** Full diagnostics (backend, timings, GL renderer, flags, downgrade trail). */
    getAccelerationDiagnostics(): AccelerationDiagnostics | null;
    /**
     * Adaptive camera-quality state (profile, capability score, mean FPS).
     * See docs/ADAPTIVE_QUALITY.md.
     */
    getQualityState(): QualityState;
    /** Resolve (and cache) the initial quality profile before mounting the WebView. */
    resolveQualityProfile(): Promise<QualityProfile>;
    /** Mark the active profile as PROBING (crash-loop guard) before page boot. */
    beginQualitySession(): Promise<void>;
    /**
     * Wire the live WebView injector so auto-downgrades can restart getUserMedia.
     * Called by {@link WebViewPoseView}.
     */
    setQualityApplyHandler(fn: ((profile: QualityProfile) => void) | undefined): void;
    addEventListener(listener: PoseTrackerEventListener): () => void;
    /**
     * Classic PoseTracker WebView parity: receive `sendDataToNative`-shaped JSON
     * (`{ type: 'keypoints', data: [...] }`, `{ type: 'initialization', message, ready }`, …).
     * Prefer typed {@link addEventListener} for new apps; use this to migrate
     * existing `onMessage` parsers with minimal changes.
     */
    addMessageListener(listener: ClassicMessageListener): () => void;
    /** Fired on any status/mode/manifest change. */
    onStateChange(listener: () => void): () => void;
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
    preload(options?: PreloadOptions): Promise<void>;
    /** Alias of preload(), matching the Sency-style naming. */
    warmup(options?: PreloadOptions): Promise<void>;
    /** Current preferred cold-start mode (for hosts / WebView wiring). */
    getColdStartMode(): ColdStartMode;
    private doPreload;
    /**
     * After model ready, optionally open the camera for `coldStart: 'full'`.
     * No-op for basic, or when the WebView already booted with coldStart=full.
     */
    private ensureColdStartMode;
    /**
     * Pose runtime shipped in the package (TF.js + MoveNet + page runtime).
     * Synchronous under the hood; Promise for a stable async API used by
     * {@link WebViewPoseView}. No network, no download.
     */
    getRuntimeParts(): Promise<PoseRuntimeParts>;
    /**
     * Load a custom skeleton overlay by Strapi `api_uuid`
     * (WebView `?skeleton=<uuid>`). Pass the result to
     * `<WebViewPoseView skeletonDef={…} />` or let the view fetch via
     * `skeletonUuid`.
     */
    fetchSkeleton(uuid: string): Promise<SkeletonDefinition>;
    private loadBundledRuntime;
    /**
     * One handshake per configuration cycle — shared by the pose-runtime warm
     * and the engine load, with or without API key. Never throws; resolves to
     * null when unreachable AND no sealed session cache can be replayed.
     */
    private resolveManifestOnce;
    private doResolveManifestOnce;
    /**
     * Revocation signal: purge the sealed engine artifacts and downgrade to
     * keypoints-only. The public pose-runtime cache is NOT purged (public
     * payload, keypoints-only keeps working).
     */
    private handleRevocation;
    /**
     * Usage metering — fired when the WebView reports the camera started with
     * the model ready. With an API key the call MUST succeed (quota check +
     * counter increment + usage row): offline metered sessions are refused.
     * Without a key the event is fire-and-forget with a local retry queue.
     */
    private handleCameraStart;
    /** Backend init + warm-up. An init failure surfaces as status 'error'. */
    private initAndWarmupBackend;
    /**
     * Runtime (re)configuration — the keypoints-only → full-engine upgrade
     * path. Can be called before or after `ready`; when the camera pipeline
     * is already running it keeps running, business events simply start once
     * the engine is loaded. Resolves to true when full-engine mode is active.
     */
    configure(apiToken?: string): Promise<boolean>;
    /**
     * Re-run the `camera_start` metered gate after a configure() retry. A
     * session refused offline becomes usable as soon as the network is back —
     * WebView parity: the front revalidates on reload, the SDK on configure().
     */
    private retryMeteredSessionIfRefused;
    /**
     * Handshake + engine load. Never throws; returns whether full-engine mode
     * was reached. `silentStatus` avoids status regressions (e.g. hot upgrade
     * while `ready` and the camera is streaming).
     */
    private tryConfigure;
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
    private resolveManifest;
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
    private validateRequestedFeatures;
    private resolveModel;
    getAvailableExercises(): ExerciseConfig[];
    /**
     * Custom exercises shipped inside the engine bundle (jump_analysis,
     * air_time_jump — WebView `customHandlers.js` parity). Empty in
     * keypoints-only mode or with an engine bundle older than 1.2.0.
     */
    getAvailableCustomExercises(): CustomExerciseDescriptor[];
    startExercise(exerciseId: string, options?: StartExerciseOptions): void;
    /** Custom engine session (jump_analysis / air_time_jump). */
    private startCustomExercise;
    /**
     * Engine → host emission gate (WebView parity): `angles`,
     * `recommendations` and `progression` only stream when their flag is on.
     * Double safety on top of the engine-side flags — a cached engine bundle
     * predating features support still gets filtered here.
     */
    private emitFromSession;
    /** Ends the active session (emits a final `exercise_summary`). */
    stopExercise(): void;
    getCurrentExerciseId(): string | null;
    /** Active inference backend (auto-selected, forced, or injected). */
    getBackend(): PoseBackend;
    /** Raw pose estimation, no engine involvement. */
    estimatePose(frame: PoseInputFrame): Promise<Pose | null>;
    /**
     * Full pipeline for one camera frame: pose estimation + `keypoints` event
     * (both modes), then engine processing when a session is active
     * (full-engine mode). Mode upgrades take effect transparently here.
     */
    processFrame(frame: PoseInputFrame): Promise<Pose | null>;
    /**
     * Feed an externally-estimated pose into the pipeline: `keypoints` event
     * (both modes) + engine processing when a session is active. This is how
     * the vision-camera path (`PoseCameraView`) delivers poses computed
     * synchronously inside the frame-processor worklet.
     */
    ingestPose(pose: Pose): void;
    dispose(): Promise<void>;
    private setStatus;
    private setMode;
    private reportError;
    private notifyState;
    private emit;
}
