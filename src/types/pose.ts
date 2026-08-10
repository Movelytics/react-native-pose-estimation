/**
 * Backend-agnostic pose types.
 *
 * MoveNet backends emit the 17-point COCO topology. Apple Vision
 * (`VNDetectHumanBodyPoseRequest`) emits those 17 plus two extras
 * (`neck`, `root`) — see `VISION_EXTRA_KEYPOINT_NAMES` and
 * docs/NATIVE_POSE_BACKENDS.md. Downstream engine code that only knows
 * COCO safely ignores unknown names.
 */

export type CocoKeypointName =
  | 'nose'
  | 'left_eye'
  | 'right_eye'
  | 'left_ear'
  | 'right_ear'
  | 'left_shoulder'
  | 'right_shoulder'
  | 'left_elbow'
  | 'right_elbow'
  | 'left_wrist'
  | 'right_wrist'
  | 'left_hip'
  | 'right_hip'
  | 'left_knee'
  | 'right_knee'
  | 'left_ankle'
  | 'right_ankle';

/** Extra joints from Apple Vision body pose (not in COCO-17 / MoveNet). */
export type VisionExtraKeypointName = 'neck' | 'root';

export type KeypointName = CocoKeypointName | VisionExtraKeypointName;

export const COCO_KEYPOINT_NAMES: readonly CocoKeypointName[] = [
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
export const VISION_EXTRA_KEYPOINT_NAMES: readonly VisionExtraKeypointName[] = [
  'neck',
  'root',
];

/** Full Apple Vision body-pose set (19): COCO-17 + neck + root. */
export const VISION_KEYPOINT_NAMES: readonly KeypointName[] = [
  ...COCO_KEYPOINT_NAMES,
  ...VISION_EXTRA_KEYPOINT_NAMES,
];

export interface Keypoint {
  name: KeypointName;
  /** Horizontal position, normalized to [0, 1] relative to the input image width. */
  x: number;
  /** Vertical position, normalized to [0, 1] relative to the input image height. */
  y: number;
  /** Optional depth (reserved for future 3D-capable backends). */
  z?: number;
  /** Confidence score in [0, 1]. */
  score: number;
}

export interface Pose {
  keypoints: Keypoint[];
  /** Overall pose confidence in [0, 1] (mean of keypoint scores for MoveNet). */
  score: number;
  /** Capture timestamp in milliseconds (host clock). */
  timestampMs: number;
}
