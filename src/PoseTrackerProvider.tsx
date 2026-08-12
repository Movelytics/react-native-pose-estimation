/**
 * React layer: `PoseTrackerProvider` owns a `PoseTrackerClient`, and
 * `usePoseTracker` gives screens access to the pipeline plus typed event
 * callbacks.
 *
 * Recommended usage:
 * - Mount the provider near the app root — with or without an API token
 *   (without token, the SDK runs in keypoints-only mode).
 * - **Mounting the provider does not load MoveNet** unless `autoPreload` is
 *   true. On the screen *before* the camera (e.g. home), call `preload()` /
 *   `warmup()` (default **basic** = model only, no camera permission). For
 *   WebView, mount a 1×1 `<WebViewPoseView coldStart="basic" />` warmer so
 *   MoveNet can load — see docs/PRELOAD.md.
 * - Call `configure(apiToken)` at any time to upgrade keypoints-only →
 *   full-engine without restarting the camera pipeline.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { PoseTrackerClient, type PoseTrackerClientOptions, type StartExerciseOptions } from './client';
import type { PoseInputFrame } from './backends/PoseBackend';
import type { ExerciseConfig, SdkManifest } from './types/manifest';
import type { PreloadOptions } from './types/preload';
import type {
  ErrorEvent,
  PoseTrackerCallbacks,
  PoseTrackerEvent,
  PoseTrackerEventListener,
  PoseTrackerMode,
  PoseTrackerStatus,
} from './types/events';
import type { Pose } from './types/pose';
import type { AccelerationDiagnostics, AccelerationState } from './types/acceleration';
import type { QualityState } from './quality/AdaptiveQualityController';

export interface PoseTrackerContextValue {
  /**
   * The underlying orchestrator. Escape hatch for advanced integrations
   * (e.g. `PoseCameraView` reads the active backend and ingests poses
   * computed in the vision-camera worklet). Stable across renders.
   */
  client: PoseTrackerClient;
  status: PoseTrackerStatus;
  /** 'keypoints-only' (no validated key/session) or 'full-engine'. */
  mode: PoseTrackerMode;
  /**
   * GPU-acceleration verdict from the warm-up health check: 'unknown' until
   * warm-up completes, then 'gpu' | 'cpu-fallback' | 'unavailable'. Can
   * downgrade mid-session after an Android GL context loss. See
   * docs/ANDROID_GL_ACCELERATION.md.
   */
  acceleration: AccelerationState;
  /** Full GPU diagnostics (backend, timings, GL renderer, flags, downgrade trail). */
  accelerationDiagnostics: AccelerationDiagnostics | null;
  /**
   * Adaptive camera-quality profile (AdaptiveChoice + crash-guard + FPS
   * auto-downgrade). `capturePriority` reflects the host option (`performance`
   * default vs `quality`). See docs/ADAPTIVE_QUALITY.md.
   */
  quality: QualityState;
  /** Last (possibly non-fatal) error; `ready` + keypoints-only can coexist with it. */
  error: ErrorEvent | null;
  manifest: SdkManifest | null;
  /** Empty in keypoints-only mode. */
  exercises: ExerciseConfig[];
  /**
   * Warm-up (handshake + engine + model). Default `coldStart: 'basic'` —
   * no getUserMedia. Pass `{ coldStart: 'full' }` to also open the camera.
   */
  preload: (options?: PreloadOptions) => Promise<void>;
  /** Alias of preload(). */
  warmup: (options?: PreloadOptions) => Promise<void>;
  /**
   * Hot (re)configuration: validates the token and loads the engine without
   * touching the camera pipeline. Resolves to true on full-engine mode.
   */
  configure: (apiToken?: string) => Promise<boolean>;
  /**
   * Start an FSM exercise (manifest) or a custom one (`jump_analysis`,
   * `air_time_jump`). Options: `difficulty`, `userHeightCm`, `devicePitchDeg`.
   */
  startExercise: (exerciseId: string, options?: StartExerciseOptions) => void;
  stopExercise: () => void;
  estimatePose: (frame: PoseInputFrame) => Promise<Pose | null>;
  processFrame: (frame: PoseInputFrame) => Promise<Pose | null>;
  addEventListener: (listener: PoseTrackerEventListener) => () => void;
  /**
   * Classic PoseTracker WebView JSON stream (`sendDataToNative` shape).
   * Same as `usePoseTracker({ onMessage })`.
   */
  addMessageListener: (
    listener: (message: import('./events/classicMessage').ClassicNativeMessage) => void,
  ) => () => void;
}

const PoseTrackerContext = createContext<PoseTrackerContextValue | null>(null);

export interface PoseTrackerProviderProps {
  /** Optional: without a token the SDK runs in keypoints-only mode. */
  apiToken?: string;
  options?: PoseTrackerClientOptions;
  /** Start preloading as soon as the provider mounts. Default: false. */
  autoPreload?: boolean;
  children: React.ReactNode;
}

export function PoseTrackerProvider({
  apiToken,
  options,
  autoPreload = false,
  children,
}: PoseTrackerProviderProps): React.JSX.Element {
  const clientRef = useRef<PoseTrackerClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new PoseTrackerClient(apiToken, options);
  }
  const client = clientRef.current;

  const [status, setStatus] = useState<PoseTrackerStatus>(client.getStatus());
  const [mode, setMode] = useState<PoseTrackerMode>(client.getMode());
  const [error, setError] = useState<ErrorEvent | null>(null);
  const [manifest, setManifest] = useState<SdkManifest | null>(null);
  const [exercises, setExercises] = useState<ExerciseConfig[]>([]);
  const [acceleration, setAcceleration] = useState<AccelerationState>(client.getAcceleration());
  const [accelerationDiagnostics, setAccelerationDiagnostics] =
    useState<AccelerationDiagnostics | null>(client.getAccelerationDiagnostics());
  const [quality, setQuality] = useState<QualityState>(client.getQualityState());

  useEffect(() => {
    const offState = client.onStateChange(() => {
      setStatus(client.getStatus());
      setMode(client.getMode());
      setError(client.getError());
      setManifest(client.getManifest());
      setExercises(client.getAvailableExercises());
      setAcceleration(client.getAcceleration());
      setAccelerationDiagnostics(client.getAccelerationDiagnostics());
      setQuality(client.getQualityState());
    });
    if (autoPreload) {
      client.preload().catch(() => {
        // Error is surfaced through status/error state and the error event.
      });
    }
    return () => {
      offState();
    };
  }, [client, autoPreload]);

  useEffect(() => {
    return () => {
      client.dispose().catch(() => {});
    };
  }, [client]);

  const preload = useCallback(
    (options?: PreloadOptions) => client.preload(options),
    [client],
  );
  const configureFn = useCallback((token?: string) => client.configure(token), [client]);
  const startExercise = useCallback(
    (id: string, exerciseOptions?: StartExerciseOptions) => client.startExercise(id, exerciseOptions),
    [client],
  );
  const stopExercise = useCallback(() => client.stopExercise(), [client]);
  const estimatePose = useCallback(
    (frame: PoseInputFrame) => client.estimatePose(frame),
    [client],
  );
  const processFrame = useCallback(
    (frame: PoseInputFrame) => client.processFrame(frame),
    [client],
  );
  const addEventListener = useCallback(
    (listener: PoseTrackerEventListener) => client.addEventListener(listener),
    [client],
  );
  const addMessageListener = useCallback(
    (listener: (message: import('./events/classicMessage').ClassicNativeMessage) => void) =>
      client.addMessageListener(listener),
    [client],
  );

  const value = useMemo<PoseTrackerContextValue>(
    () => ({
      client,
      status,
      mode,
      acceleration,
      accelerationDiagnostics,
      quality,
      error,
      manifest,
      exercises,
      preload,
      warmup: preload,
      configure: configureFn,
      startExercise,
      stopExercise,
      estimatePose,
      processFrame,
      addEventListener,
      addMessageListener,
    }),
    [
      client,
      status,
      mode,
      acceleration,
      accelerationDiagnostics,
      quality,
      error,
      manifest,
      exercises,
      preload,
      configureFn,
      startExercise,
      stopExercise,
      estimatePose,
      processFrame,
      addEventListener,
      addMessageListener,
    ],
  );

  return <PoseTrackerContext.Provider value={value}>{children}</PoseTrackerContext.Provider>;
}

/**
 * Access the PoseTracker pipeline and subscribe to typed events.
 *
 * ```tsx
 * const { status, mode, processFrame, configure } = usePoseTracker({
 *   onKeypoints: (e) => drawSkeleton(e.keypoints),   // both modes
 *   onCounter: (e) => setReps(e.count),              // full-engine only
 * });
 * ```
 */
export function usePoseTracker(callbacks: PoseTrackerCallbacks = {}): PoseTrackerContextValue {
  const context = useContext(PoseTrackerContext);
  if (!context) {
    throw new Error('usePoseTracker must be used within a <PoseTrackerProvider>.');
  }

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    const offEvents = context.addEventListener((event: PoseTrackerEvent) => {
      const cb = callbacksRef.current;
      switch (event.type) {
        case 'initialization':
          cb.onInitialization?.(event);
          break;
        case 'error':
          cb.onError?.(event);
          break;
        case 'warning':
          cb.onWarning?.(event);
          break;
        case 'keypoints':
          cb.onKeypoints?.(event);
          break;
        case 'angles':
          cb.onAngles?.(event);
          break;
        case 'counter':
          cb.onCounter?.(event);
          break;
        case 'posture':
          cb.onPosture?.(event);
          break;
        case 'progression':
          cb.onProgression?.(event);
          break;
        case 'engine_debug':
          cb.onEngineDebug?.(event);
          break;
        case 'recommendations':
          cb.onRecommendations?.(event);
          break;
        case 'form_score':
          cb.onFormScore?.(event);
          break;
        case 'exercise_summary':
          cb.onExerciseSummary?.(event);
          break;
        case 'jump_calibration':
          cb.onJumpCalibration?.(event);
          break;
        case 'jump_started':
          cb.onJumpStarted?.(event);
          break;
        case 'jump_height':
          cb.onJumpHeight?.(event);
          break;
        case 'jump_discarded':
          cb.onJumpDiscarded?.(event);
          break;
        case 'jump_result':
          cb.onJumpResult?.(event);
          break;
        case 'jump_summary':
          cb.onJumpSummary?.(event);
          break;
        case 'quality_changed':
          cb.onQualityChanged?.(event);
          break;
        case 'performance_warning':
          cb.onPerformanceWarning?.(event);
          break;
        case 'runtime_download_progress':
          cb.onRuntimeDownloadProgress?.(event);
          break;
      }
    });
    const offMessages = context.addMessageListener((message) => {
      callbacksRef.current.onMessage?.(message);
    });
    return () => {
      offEvents();
      offMessages();
    };
  }, [context]);

  return context;
}
