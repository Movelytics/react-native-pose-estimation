/**
 * Apple Vision implementation of `PoseBackend` (iOS only).
 *
 * Uses `VNDetectHumanBodyPoseRequest` via a VisionCamera frame-processor
 * plugin shipped in this package's `ios/` folder. Up to 19 anatomical
 * joints (COCO-17 + `neck` + `root`). Primary fast path is
 * `PoseCameraView` → worklet → native plugin (CVPixelBuffer, no RGB copy).
 *
 * Never loaded in Expo Go (`isExpoGo()` guard). On Android,
 * `init()` throws {@link VisionUnavailableError} so the client can fall
 * back to TFLite / TF.js when selection is `'auto'`.
 */
import type { PoseBackend, PoseBackendInitOptions, PoseInputFrame } from '../PoseBackend';
import type { Pose } from '../../types/pose';
import type { AccelerationDiagnostics, AccelerationState, DiagnosticListener } from '../../types/acceleration';
import { type VisionFrameProcessorPlugin } from './optionalVision';
import { type VisionPluginResult } from './mapVisionJoints';
/** Thrown when Apple Vision cannot run (wrong platform, Expo Go, missing pod). */
export declare class VisionUnavailableError extends Error {
    constructor(message: string);
}
export interface VisionPoseBackendOptions {
    maxAcceptableInferenceMs?: number;
    onDiagnostic?: DiagnosticListener;
    onAccelerationChange?: (state: AccelerationState) => void;
}
/**
 * Opaque frame accepted on the JS path: either a VisionCamera `Frame`
 * (preferred — passed through to the plugin) or a pre-decoded
 * {@link VisionPluginResult} (for tests / hosts that already ran Vision).
 */
export type VisionPoseInput = VisionPluginResult | {
    __visionCameraFrame: true;
};
export declare class VisionPoseBackend implements PoseBackend {
    private readonly options;
    readonly name = "apple-vision";
    private plugin;
    private warm;
    private acceleration;
    private inferenceTimesMs;
    private reasons;
    private readonly maxAcceptableInferenceMs;
    private readonly onDiagnostic;
    private readonly onAccelerationChange;
    constructor(options?: VisionPoseBackendOptions);
    init(_options: PoseBackendInitOptions): Promise<void>;
    /**
     * Vision has no separate model load — warm-up records the accelerator
     * verdict. Real timings come from the first camera frames via
     * {@link recordInferenceTime}.
     */
    warmup(): Promise<void>;
    /**
     * JS-path estimation. Accepts:
     * - a VisionCamera `Frame` (has `.width`/`.height` and is callable via plugin);
     * - a precomputed {@link VisionPluginResult} `{ joints }`.
     *
     * Prefer `PoseCameraView` (worklet) for production — this path is for
     * TensorCamera-style hosts and unit tests.
     */
    estimatePose(frame: PoseInputFrame): Promise<Pose | null>;
    getAcceleration(): AccelerationDiagnostics | null;
    dispose(): Promise<void>;
    /** Plugin handle for PoseCameraView worklets. */
    getFrameProcessorPlugin(): VisionFrameProcessorPlugin | null;
    /** Feed live inference timings from the camera worklet into diagnostics. */
    recordInferenceTime(ms: number): void;
    private setAcceleration;
    private noteReason;
    private requirePlugin;
}
