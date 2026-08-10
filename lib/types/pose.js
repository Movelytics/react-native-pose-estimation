"use strict";
/**
 * Backend-agnostic pose types.
 *
 * MoveNet backends emit the 17-point COCO topology. Apple Vision
 * (`VNDetectHumanBodyPoseRequest`) emits those 17 plus two extras
 * (`neck`, `root`) — see `VISION_EXTRA_KEYPOINT_NAMES` and
 * docs/NATIVE_POSE_BACKENDS.md. Downstream engine code that only knows
 * COCO safely ignores unknown names.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VISION_KEYPOINT_NAMES = exports.VISION_EXTRA_KEYPOINT_NAMES = exports.COCO_KEYPOINT_NAMES = void 0;
exports.COCO_KEYPOINT_NAMES = [
    'nose',
    'left_eye',
    'right_eye',
    'left_ear',
    'right_ear',
    'left_shoulder',
    'right_shoulder',
    'left_elbow',
    'right_elbow',
    'left_wrist',
    'right_wrist',
    'left_hip',
    'right_hip',
    'left_knee',
    'right_knee',
    'left_ankle',
    'right_ankle',
];
/** Vision-only joints appended after the COCO-aligned 17. */
exports.VISION_EXTRA_KEYPOINT_NAMES = [
    'neck',
    'root',
];
/** Full Apple Vision body-pose set (19): COCO-17 + neck + root. */
exports.VISION_KEYPOINT_NAMES = [
    ...exports.COCO_KEYPOINT_NAMES,
    ...exports.VISION_EXTRA_KEYPOINT_NAMES,
];
