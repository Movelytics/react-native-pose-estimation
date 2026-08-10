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
import React from 'react';
import { PoseTrackerClient, type PoseTrackerClientOptions, type StartExerciseOptions } from './client';
import type { PoseInputFrame } from './backends/PoseBackend';
import type { ExerciseConfig, SdkManifest } from './types/manifest';
import type { PreloadOptions } from './types/preload';
import type { ErrorEvent, PoseTrackerCallbacks, PoseTrackerEventListener, PoseTrackerMode, PoseTrackerStatus } from './types/events';
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
    addMessageListener: (listener: (message: import('./events/classicMessage').ClassicNativeMessage) => void) => () => void;
}
export interface PoseTrackerProviderProps {
    /** Optional: without a token the SDK runs in keypoints-only mode. */
    apiToken?: string;
    options?: PoseTrackerClientOptions;
    /** Start preloading as soon as the provider mounts. Default: false. */
    autoPreload?: boolean;
    children: React.ReactNode;
}
export declare function PoseTrackerProvider({ apiToken, options, autoPreload, children, }: PoseTrackerProviderProps): React.JSX.Element;
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
export declare function usePoseTracker(callbacks?: PoseTrackerCallbacks): PoseTrackerContextValue;
