/**
 * Apple Vision body-pose joint → SDK keypoint mapping.
 *
 * `VNDetectHumanBodyPoseRequest` exposes 19 joints. Seventeen align 1:1 with
 * the COCO / MoveNet topology; `neck` and `root` (mid-hip) are Vision extras
 * kept under their Vision names so A/B overlays can show the full set.
 *
 * Vision normalized points use a **bottom-left** origin — the native plugin
 * already flips Y (`y = 1 - visionY`) before returning joints here.
 *
 * `poseFromVisionPluginResult` carries a `'worklet'` directive so
 * PoseCameraView can call it on the frame-processor thread.
 */
import type { KeypointName, Pose } from '../../types/pose';
/** Vision `VNHumanBodyPoseObservation.JointName` camelCase → SDK name. */
export declare const VISION_JOINT_TO_SDK: Readonly<Record<string, KeypointName>>;
/** One joint as returned by the native frame-processor plugin. */
export interface VisionPluginJoint {
    name: string;
    x: number;
    y: number;
    score: number;
}
/** Payload of `detectBodyPose` frame-processor plugin (already Y-flipped). */
export interface VisionPluginResult {
    joints: VisionPluginJoint[];
    /** Wall time of the Vision request on the frame-processor thread, ms. */
    inferenceTimeMs?: number;
}
/**
 * Build a SDK `Pose` from the native plugin result. Unknown joint names are
 * dropped; missing joints are filled with score 0 so overlays stay
 * topology-stable when a joint is absent.
 */
export declare function poseFromVisionPluginResult(result: VisionPluginResult | null | undefined, timestampMs?: number): Pose | null;
