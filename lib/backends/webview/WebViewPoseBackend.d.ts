/**
 * WebView inference backend — the SDK's base runtime on BOTH platforms.
 *
 * Runs MoveNet SinglePose Lightning (17 keypoints, 192×192) inside a real
 * browser WebGL context (Chromium ANGLE on Android, WKWebView on iOS) — the
 * same approach the PoseTracker WebView product uses in production, and the
 * only one real-time across the whole Android park in Expo Go. Fully
 * offline: TF.js and the model ship inside the npm package (poseHtml.ts).
 *
 * The WebView owns the camera (`getUserMedia`). Frames are NOT pushed from
 * React Native — `estimatePose()` returns the latest pose posted by the page.
 * Mount {@link WebViewPoseView} (or a 1×1 warmer) to attach the runtime.
 */
import type { PoseBackend, PoseBackendInitOptions, PoseInputFrame } from '../PoseBackend';
import type { Pose } from '../../types/pose';
import type { AccelerationDiagnostics, AccelerationState, DiagnosticListener } from '../../types/acceleration';
import type { PoseTrackerEvent } from '../../types/events';
export type WebViewPoseMessage = {
    type: 'ready';
    backend: string;
    medianInferenceMs: number | null;
    warmUpRunsMs: number[];
    estimatedFps?: number | null;
    profileId?: string;
    /** false after basic (model-only) cold-start; true once getUserMedia ran. */
    cameraOpened?: boolean;
    coldStart?: 'basic' | 'full';
    gl: {
        renderer: string | null;
        vendor: string | null;
        version: string | null;
    } | null;
    note?: string | null;
} | {
    type: 'warmup_estimate';
    medianInferenceMs: number | null;
    estimatedFps: number | null;
    /** Platform floor (iOS 30 / Android 15). */
    minTargetFps: number;
    /** @deprecated Use {@link minTargetFps}. */
    targetFps?: number;
    profileId: string;
    previousProfileId?: string;
    idealWidth?: number;
    idealHeight?: number;
    gl?: {
        renderer: string | null;
        vendor: string | null;
        version: string | null;
    } | null;
} | {
    type: 'pose';
    keypoints: Array<{
        name: string;
        x: number;
        y: number;
        score: number;
    }>;
    score: number;
    inferenceTimeMs: number;
    timestampMs: number;
} | {
    type: 'stats';
    fps: number;
    medianInferenceMs: number | null;
    estimatedFpsFromMedian?: number | null;
    frames: number;
    backend: string;
    breakdown?: {
        drawMs: number | null;
        fromPixelsMs: number | null;
        executeMs: number | null;
        totalPipelineMs?: number | null;
    };
    windowCounts?: {
        inferred: number;
        skipped: number;
    };
    experiments?: Record<string, unknown>;
    leverHints?: {
        dominantStage?: string;
        dominantMs?: number;
        bitmapShare?: number;
        fromPixelsShare?: number;
        executeShare?: number;
        hints?: string[];
    } | null;
    videoSize?: string;
    mode?: string;
} | {
    type: 'initialization';
    message: string;
    ready?: boolean;
    step?: 'accessing_webcam' | 'loading_media' | 'loading_pose_model' | 'ready';
} | {
    type: 'warning';
    message: string;
    code?: string;
} | {
    type: 'diag';
    message: string;
} | {
    type: 'error';
    message: string;
    code?: string;
};
export interface WebViewPoseStats {
    fps: number;
    medianInferenceMs: number | null;
    estimatedFpsFromMedian?: number | null;
    frames: number;
    backend: string;
    videoSize?: string;
    mode?: string;
    breakdown?: {
        drawMs: number | null;
        fromPixelsMs: number | null;
        executeMs: number | null;
        totalPipelineMs?: number | null;
    };
    windowCounts?: {
        inferred: number;
        skipped: number;
    };
    experiments?: Record<string, unknown>;
    leverHints?: {
        dominantStage?: string;
        dominantMs?: number;
        bitmapShare?: number;
        fromPixelsShare?: number;
        executeShare?: number;
        hints?: string[];
    } | null;
}
export interface WebViewPoseBackendOptions {
    onDiagnostic?: DiagnosticListener;
    onAccelerationChange?: (state: AccelerationState) => void;
    /** Fired on every pose from the WebView (used by WebViewPoseView / ingest). */
    onPose?: (pose: Pose, inferenceTimeMs: number) => void;
    /** Fired when the Chromium page reports ready (model + backend warmed). */
    onReady?: (info: {
        backend: string;
        medianInferenceMs: number | null;
        estimatedFps?: number | null;
        profileId?: string | null;
        glRenderer: string | null;
    }) => void;
    /**
     * Fired after zeros warm-up, typically *before* getUserMedia — used to pick
     * a capture profile targeting ≥15 FPS.
     */
    onWarmupEstimate?: (info: {
        medianInferenceMs: number | null;
        estimatedFps: number | null;
        profileId: string;
        glRenderer: string | null;
    }) => void;
    /** Fired ~1 Hz with inference FPS / breakdown (adaptive quality input). */
    onStats?: (stats: WebViewPoseStats) => void;
    /**
     * Promotes page-level init / warning / error into typed {@link PoseTrackerEvent}s
     * so the host can listen the same way as the classic PoseTracker WebView.
     */
    onTrackerEvent?: (event: PoseTrackerEvent) => void;
}
export declare class WebViewPoseBackend implements PoseBackend {
    readonly name = "webview-movenet";
    private acceleration;
    private attached;
    private ready;
    private warm;
    /** True after the page successfully opened getUserMedia. */
    private cameraOpened;
    private openCameraHandler;
    private lastPose;
    private inferenceTimesMs;
    private medianInferenceMs;
    private glRenderer;
    private glVendor;
    private glVersion;
    private tfjsBackend;
    private reasons;
    private readyWaiters;
    private cameraWaiters;
    private readonly onDiagnostic;
    private readonly onAccelerationChange;
    private onPose;
    private onReady;
    private onWarmupEstimate;
    private onStats;
    private onTrackerEvent;
    constructor(options?: WebViewPoseBackendOptions);
    /** Host view calls this when the WebView mounts / unmounts. */
    setAttached(attached: boolean): void;
    setOnPose(handler: ((pose: Pose, inferenceTimeMs: number) => void) | undefined): void;
    setOnReady(handler: WebViewPoseBackendOptions['onReady']): void;
    setOnStats(handler: WebViewPoseBackendOptions['onStats']): void;
    /** Feed a message from the WebView `onMessage` handler. */
    handleMessage(raw: string): void;
    init(_options: PoseBackendInitOptions): Promise<void>;
    warmup(): Promise<void>;
    /** Whether getUserMedia has already run in the attached page. */
    isCameraOpened(): boolean;
    /**
     * Host injects `__PT_OPEN_CAMERA` via {@link setOpenCameraHandler}.
     * Used when upgrading basic → full cold-start without remounting the page.
     */
    setOpenCameraHandler(handler: (() => void) | undefined): void;
    /**
     * Open getUserMedia after a basic (model-only) ready. No-op if the page
     * already opened the camera (coldStart=full boot).
     */
    openCamera(): Promise<void>;
    estimatePose(_frame: PoseInputFrame): Promise<Pose | null>;
    getAcceleration(): AccelerationDiagnostics | null;
    dispose(): Promise<void>;
    private waitUntilReady;
    private waitUntilCameraOpened;
    private flushReadyWaiters;
    private flushCameraWaiters;
    private setAcceleration;
}
export declare function isWebViewPoseBackend(backend: PoseBackend): backend is WebViewPoseBackend;
