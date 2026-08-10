/**
 * Guarded access to the Apple Vision body-pose frame-processor plugin.
 *
 * The plugin lives in this package's `ios/` folder (VisionCamera Swift
 * FrameProcessorPlugin + `VNDetectHumanBodyPoseRequest`). It is only linked
 * in native iOS builds — never in Expo Go. All requires are gated by
 * `Platform.OS === 'ios' && !isExpoGo()` so Metro/Expo Go never evaluate
 * Nitro/VisionCamera code paths unintentionally.
 */
/** JS name registered via `VISION_EXPORT_SWIFT_FRAME_PROCESSOR(..., detectBodyPose)`. */
export declare const VISION_BODY_POSE_PLUGIN_NAME = "detectBodyPose";
export interface VisionFrameProcessorPlugin {
    call(frame: unknown, args?: Record<string, unknown>): unknown;
}
/**
 * True when we are on a native iOS build (not Expo Go) where the Vision
 * frame-processor plugin can be loaded. Does not require Nitro / TFLite.
 */
export declare function isVisionBackendAvailable(): boolean;
/**
 * vision-camera + worklets present on iOS native build — enough to mount the
 * Vision path of `PoseCameraView` once the backend has initialized.
 */
export declare function isVisionPoseCameraAvailable(): boolean;
/**
 * Lazily init the VisionCamera frame-processor plugin. Cached; `null` when
 * the native binary does not include our Swift plugin (Expo Go, Android,
 * or a host that excluded the pod).
 */
export declare function getVisionBodyPosePlugin(): VisionFrameProcessorPlugin | null;
/** Test helper — clears the plugin cache between availability probes. */
export declare function resetVisionPluginCacheForTests(): void;
