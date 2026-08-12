/**
 * SDK event types.
 *
 * These mirror the postMessage payloads of the existing PoseTracker WebView
 * API (keypoints, angles, counter, posture, progression, recommendations,
 * form_score, exercise_summary) so existing integrations can migrate with
 * minimal changes: the WebView `onMessage` JSON becomes a typed callback.
 */

import type { Keypoint } from './pose';
import type { AccelerationState } from './acceleration';
import type { QualityProfile, QualityProfileId } from '../quality/profiles';

export type PoseTrackerStatus =
  | 'idle'
  | 'configuring'
  | 'downloading'
  | 'warming'
  | 'ready'
  | 'error';

/**
 * Operating mode (commercial boundary):
 * - 'keypoints-only': no validated API key/session — the SDK provides its
 *   core value only (bundled MoveNet, warm-up, camera pipeline) and streams
 *   raw `keypoints` events. No business events (counter, angles, posture,
 *   progression, recommendations, form_score, exercise_summary).
 * - 'full-engine': a handshake succeeded (live or from the encrypted local
 *   session cache) and the engine bundle is loaded — all events available.
 *
 * The mode can upgrade at runtime (keypoints-only → full-engine) without
 * restarting the camera pipeline, via `configure()` or a preload retry.
 */
export type PoseTrackerMode = 'keypoints-only' | 'full-engine';

export type InitializationStep =
  | 'configuring'
  | 'downloading'
  | 'warming'
  | 'accessing_webcam'
  | 'loading_media'
  | 'loading_pose_model'
  | 'ready';

export interface InitializationEvent {
  type: 'initialization';
  /**
   * Machine step. Classic PoseTracker used free-form `message` strings
   * ("accessing webcam", "loading pose model", "running"); both are set.
   */
  step: InitializationStep;
  /** Human-readable status (PoseTracker WebView parity). */
  message: string;
  ready: boolean;
  /** Present on the `ready` step. */
  mode?: PoseTrackerMode;
  /**
   * Present on the `ready` step: GPU-acceleration verdict from the warm-up
   * health check ('gpu' | 'cpu-fallback' | 'unavailable'). See
   * docs/ANDROID_GL_ACCELERATION.md.
   */
  acceleration?: AccelerationState;
}

export interface ErrorEvent {
  type: 'error';
  code:
    | 'invalid_token'
    | 'quota_exceeded'
    | 'network'
    /**
     * First launch, no network, empty runtime cache: the pose runtime cannot
     * be initialized without downloading the payload once. Fatal.
     */
    | 'network_required'
    /**
     * Offline with an API key: metered features (engine/exercises) are
     * refused because PoseTracker cannot count their usage. Non-fatal —
     * keypoints-only keeps running from the cache.
     */
    | 'offline_metered'
    /**
     * The `free` plan requested developer features (angles, recommendations,
     * progression, or keypoints combined with an exercise). Same message as
     * the PoseTracker WebView (`TrackingAppV3`). Non-fatal: keypoints-only
     * pose estimation keeps running.
     */
    | 'free_plan_feature_blocked'
    /**
     * A WebView-only option was requested (blazepose, poseEngine,
     * mediapipeModel, …): this SDK ships MoveNet Lightning only.
     */
    | 'feature_not_supported'
    /** Unknown exercise id (WebView parity: `invalid_exercise`). */
    | 'invalid_exercise'
    /** jump_analysis requires `userHeightCm` (WebView parity). */
    | 'jump_analysis_missing_height'
    | 'model_load_failed'
    | 'engine_load_failed'
    | 'integrity_check_failed'
    | 'webview_error'
    | 'device_too_slow'
    | 'backend_fallback_wasm'
    | 'internal';
  message: string;
}

/**
 * Non-fatal warning the host can surface (telemetry / soft UX).
 * Classic WebView sometimes used `type: "warning"`; V3 degradations often
 * reuse `type: "error"` with a code — see {@link PerformanceWarningEvent}.
 */
export interface WarningEvent {
  type: 'warning';
  code:
    | 'quality_downgraded'
    | 'backend_fallback_wasm'
    | 'webview'
    | 'internal';
  message: string;
  timestampMs: number;
}

export interface KeypointsEvent {
  type: 'keypoints';
  keypoints: Keypoint[];
  /** Mean confidence of the pose. */
  score: number;
  timestampMs: number;
}

export interface AngleValue {
  /** Angle id from the exercise config, e.g. "left_knee". */
  id: string;
  side: 'left' | 'right' | 'center';
  degrees: number;
  /** Min confidence of the three keypoints defining the angle. */
  score: number;
}

export interface AnglesEvent {
  type: 'angles';
  angles: AngleValue[];
  timestampMs: number;
}

/**
 * Letter grade for a 0–100 form score (GitBook / Front BaseExercise):
 * A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F &lt; 60.
 */
export type FormGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Valid `minGrade` filter values (F is not a valid minGrade config). */
export type MinGrade = 'A' | 'B' | 'C' | 'D';

/**
 * Nested form score on a counted rep — GitBook / WebView V3
 * `counter.form_score` (authoritative grade for that rep).
 */
export interface CounterFormScore {
  /** Score of the rep that was just counted, 0–100. */
  score: number;
  /** Running average across counted reps, 0–100. */
  average: number;
  grade: FormGrade;
}

export interface CounterEvent {
  type: 'counter';
  count: number;
  /**
   * Authoritative form score for the counted rep (WebView
   * `counter.form_score`). Prefer this over a standalone `form_score` event
   * when mirroring the tracking endpoint.
   */
  formScore?: CounterFormScore;
  /** Similarity score vs. reference movement for the last rep, when a reference is active. */
  referenceScore?: number;
  timestampMs: number;
}

export interface PostureEvent {
  type: 'posture';
  /** True when the user placement satisfies the exercise posture requirements. */
  ready: boolean;
  /** Localized human hint ("Face the camera", "Get ready…"). */
  hint: string;
  /** WebView parity: placement direction hint ("in-frame", "face-camera", "profile-camera"). */
  direction?: string;
  missingKeypoints: string[];
  timestampMs: number;
}

export interface ProgressionEvent {
  type: 'progression';
  /** Movement progression within the current rep, 0–100. */
  value: number;
  timestampMs: number;
}

/**
 * Throttled movement / rep-FSM snapshot for QA (engine ≥ 1.2.4).
 * Enable via `PoseTrackerClientOptions.debugEngine` or `startExercise(..., { debug: true })`.
 */
export interface EngineDebugEvent {
  type: 'engine_debug';
  exerciseId: string;
  engineVersion: string;
  ready: boolean;
  postureHint: string;
  direction?: string;
  missingKeypoints: string[];
  stepIndex: number;
  stepCount: number;
  stepPosition: number | null;
  stepProgression: number;
  progression: number;
  /** Raw FSM rep count (before minGrade gate). */
  rawCount: number;
  /** Public counter after minGrade gate. */
  publicCount: number;
  difficulty: string;
  minGrade: MinGrade | null;
  pointOfView: 'low' | 'up';
  computeError?: string;
  lastSkipReason: string | null;
  posesProcessed: number;
  visibleKeypoints: number;
  knees: { left: number | null; right: number | null };
  timestampMs: number;
}

export interface RecommendationsEvent {
  type: 'recommendations';
  /** Localized form advice strings. */
  recommendations: string[];
  timestampMs: number;
}

export interface FormScoreEvent {
  type: 'form_score';
  /** Score of the last completed rep, 0–100. */
  score: number;
  /** Running average across the session, 0–100. */
  average: number;
  grade: FormGrade;
  timestampMs: number;
}

export interface RepSummary {
  index: number;
  formScore: number;
  durationMs: number;
  referenceScore?: number;
}

export interface ExerciseSummaryEvent {
  type: 'exercise_summary';
  exercise: string;
  counter: number;
  averageFormScore: number;
  averageSimilarity?: number;
  grade: FormGrade;
  history: RepSummary[];
  durationMs: number;
  timestampMs: number;
}

// ---------------------------------------------------------------------------
// Custom jump exercises (jump_analysis / air_time_jump) — WebView parity:
// same event `type` strings and field names as the front's sendDataToNative
// payloads (CameraFeedV3 runCustomHandlerCompute).
// ---------------------------------------------------------------------------

export interface VisibleHipsInfo {
  left: boolean;
  right: boolean;
}

/** jump_analysis only: cm/pixel calibration established from userHeightCm. */
export interface JumpCalibrationEvent {
  type: 'jump_calibration';
  calibrated: true;
  cmPerPixel: number;
  baselineY: number | null;
  visibleHips: VisibleHipsInfo;
  /** WebView literal: "Calibration complete - ready to jump". */
  message: string;
  timestampMs: number;
}

/** Push-off detected — measurement in progress. */
export interface JumpStartedEvent {
  type: 'jump_started';
  /** WebView literal: "Jump detected - measuring height". */
  message: string;
  timestampMs: number;
}

/** Live/final jump height. `final: true` closes the jump (see JumpResultEvent). */
export interface JumpHeightEvent {
  type: 'jump_height';
  jumpHeightCm: number;
  baselineY?: number | null;
  minY?: number | null;
  measuring: boolean;
  landed: boolean;
  final?: boolean;
  deltaPixels?: number;
  sideUsed?: string | null;
  airTimeMs?: number;
  airTimeSeconds?: number;
  visibleHips?: VisibleHipsInfo;
  timestampMs: number;
}

/** Detection aborted (approach toward camera, timeout, tracking lost…). */
export interface JumpDiscardedEvent {
  type: 'jump_discarded';
  reason: string;
  userMessage: string;
  timestampMs: number;
}

/** One completed jump (final height for jump N). */
export interface JumpResultEvent {
  type: 'jump_result';
  jumpNumber: number;
  jumpHeightCm: number;
  airTimeMs?: number;
  airTimeSeconds?: number;
  baselineY?: number | null;
  minY?: number | null;
  deltaPixels?: number;
  sideUsed?: string | null;
  visibleHips?: VisibleHipsInfo;
  timestampMs: number;
}

export interface JumpSummaryEntry {
  jumpNumber: number;
  jumpHeightCm: number;
  airTimeMs?: number;
  airTimeSeconds?: number;
}

/** Running summary of all completed jumps (emitted after each jump_result). */
export interface JumpSummaryEvent {
  type: 'jump_summary';
  totalJumps: number;
  avgJumpHeight: number;
  maxJumpHeight: number;
  minJumpHeight: number;
  avgAirTimeSeconds?: number;
  jumps: JumpSummaryEntry[];
  timestampMs: number;
}

/**
 * Camera / preprocess quality tier changed (AdaptiveChoice auto-downgrade,
 * crash-guard recovery, or GL capability hint). English, for app developers.
 */
export interface QualityChangedEvent {
  type: 'quality_changed';
  previousProfile: QualityProfileId;
  activeProfile: QualityProfileId;
  reason:
    | 'low_fps'
    | 'device_capability'
    | 'crash_guard'
    | 'warmup_estimate'
    | 'manual';
  detail: string;
  profile: QualityProfile;
  /** Present when reason is warmup_estimate / low_fps. */
  estimatedFps?: number | null;
  medianInferenceMs?: number | null;
  timestampMs: number;
}

/**
 * Fired when mean inference FPS stays critically low. English developer alert —
 * surface in your own telemetry / support tooling; do not show raw to end users
 * unless you localize it.
 */
export interface PerformanceWarningEvent {
  type: 'performance_warning';
  code: 'device_too_slow';
  message: string;
  meanFps: number;
  thresholdFps: number;
  activeProfile: QualityProfileId;
  medianInferenceMs: number | null;
  videoSize?: string;
  timestampMs: number;
}

/**
 * Download progress of the pose-runtime payload (first preload, or version
 * update). Lets the host app show a loader/progress bar during the initial
 * ~9 MB download; never fired when the cache is already up-to-date.
 */
export interface RuntimeDownloadProgressEvent {
  type: 'runtime_download_progress';
  /** Part being downloaded (tfjs, tfjs-wasm, model, weights, pipeline, runtime). */
  part: string;
  completedParts: number;
  totalParts: number;
  /** Size of the current part, from the signed manifest. */
  partBytes: number;
  timestampMs: number;
}

export type PoseTrackerEvent =
  | InitializationEvent
  | ErrorEvent
  | WarningEvent
  | RuntimeDownloadProgressEvent
  | KeypointsEvent
  | AnglesEvent
  | CounterEvent
  | PostureEvent
  | ProgressionEvent
  | EngineDebugEvent
  | RecommendationsEvent
  | FormScoreEvent
  | ExerciseSummaryEvent
  | JumpCalibrationEvent
  | JumpStartedEvent
  | JumpHeightEvent
  | JumpDiscardedEvent
  | JumpResultEvent
  | JumpSummaryEvent
  | QualityChangedEvent
  | PerformanceWarningEvent;

export type PoseTrackerEventType = PoseTrackerEvent['type'];

export type PoseTrackerEventListener = (event: PoseTrackerEvent) => void;

/**
 * Typed per-event callbacks, convenient for `usePoseTracker({ onCounter, ... })`.
 * Also accepts {@link onMessage} for classic PoseTracker WebView JSON parity.
 */
export interface PoseTrackerCallbacks {
  onInitialization?: (event: InitializationEvent) => void;
  onError?: (event: ErrorEvent) => void;
  onWarning?: (event: WarningEvent) => void;
  onKeypoints?: (event: KeypointsEvent) => void;
  onAngles?: (event: AnglesEvent) => void;
  onCounter?: (event: CounterEvent) => void;
  onPosture?: (event: PostureEvent) => void;
  onProgression?: (event: ProgressionEvent) => void;
  onEngineDebug?: (event: EngineDebugEvent) => void;
  onRecommendations?: (event: RecommendationsEvent) => void;
  onFormScore?: (event: FormScoreEvent) => void;
  onExerciseSummary?: (event: ExerciseSummaryEvent) => void;
  onJumpCalibration?: (event: JumpCalibrationEvent) => void;
  onJumpStarted?: (event: JumpStartedEvent) => void;
  onJumpHeight?: (event: JumpHeightEvent) => void;
  onJumpDiscarded?: (event: JumpDiscardedEvent) => void;
  onJumpResult?: (event: JumpResultEvent) => void;
  onJumpSummary?: (event: JumpSummaryEvent) => void;
  onQualityChanged?: (event: QualityChangedEvent) => void;
  onPerformanceWarning?: (event: PerformanceWarningEvent) => void;
  onRuntimeDownloadProgress?: (event: RuntimeDownloadProgressEvent) => void;
  /**
   * Classic PoseTracker `sendDataToNative` JSON stream (same `type` / field
   * names as the WebView product). Fires for every typed event.
   */
  onMessage?: (message: import('../events/classicMessage').ClassicNativeMessage) => void;
}
