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

import type { Keypoint, KeypointName, Pose } from '../../types/pose';

/** Vision `VNHumanBodyPoseObservation.JointName` camelCase → SDK name. */
export const VISION_JOINT_TO_SDK: Readonly<Record<string, KeypointName>> = {
  nose: 'nose',
  leftEye: 'left_eye',
  rightEye: 'right_eye',
  leftEar: 'left_ear',
  rightEar: 'right_ear',
  leftShoulder: 'left_shoulder',
  rightShoulder: 'right_shoulder',
  leftElbow: 'left_elbow',
  rightElbow: 'right_elbow',
  leftWrist: 'left_wrist',
  rightWrist: 'right_wrist',
  leftHip: 'left_hip',
  rightHip: 'right_hip',
  leftKnee: 'left_knee',
  rightKnee: 'right_knee',
  leftAnkle: 'left_ankle',
  rightAnkle: 'right_ankle',
  neck: 'neck',
  root: 'root',
};

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
export function poseFromVisionPluginResult(
  result: VisionPluginResult | null | undefined,
  timestampMs: number = Date.now(),
): Pose | null {
  'worklet';
  // Inlined — worklets cannot capture module-level imports reliably.
  const ORDER: KeypointName[] = [
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
    'neck',
    'root',
  ];
  const ALIAS: Record<string, KeypointName> = {
    nose: 'nose',
    leftEye: 'left_eye',
    rightEye: 'right_eye',
    leftEar: 'left_ear',
    rightEar: 'right_ear',
    leftShoulder: 'left_shoulder',
    rightShoulder: 'right_shoulder',
    leftElbow: 'left_elbow',
    rightElbow: 'right_elbow',
    leftWrist: 'left_wrist',
    rightWrist: 'right_wrist',
    leftHip: 'left_hip',
    rightHip: 'right_hip',
    leftKnee: 'left_knee',
    rightKnee: 'right_knee',
    leftAnkle: 'left_ankle',
    rightAnkle: 'right_ankle',
    neck: 'neck',
    root: 'root',
    left_eye: 'left_eye',
    right_eye: 'right_eye',
    left_ear: 'left_ear',
    right_ear: 'right_ear',
    left_shoulder: 'left_shoulder',
    right_shoulder: 'right_shoulder',
    left_elbow: 'left_elbow',
    right_elbow: 'right_elbow',
    left_wrist: 'left_wrist',
    right_wrist: 'right_wrist',
    left_hip: 'left_hip',
    right_hip: 'right_hip',
    left_knee: 'left_knee',
    right_knee: 'right_knee',
    left_ankle: 'left_ankle',
    right_ankle: 'right_ankle',
  };

  if (!result || !result.joints || result.joints.length === 0) {
    return null;
  }

  const byName: Partial<Record<KeypointName, Keypoint>> = {};
  for (let i = 0; i < result.joints.length; i++) {
    const joint = result.joints[i];
    if (!joint) {
      continue;
    }
    const mapped = ALIAS[joint.name];
    if (!mapped) {
      continue;
    }
    const x = clamp01(joint.x);
    const y = clamp01(joint.y);
    const score = clamp01(joint.score);
    byName[mapped] = { name: mapped, x, y, score };
  }

  const keypoints: Keypoint[] = [];
  let scoreSum = 0;
  let scoreCount = 0;
  for (let i = 0; i < ORDER.length; i++) {
    const name = ORDER[i] as KeypointName;
    const existing = byName[name];
    if (existing) {
      keypoints.push(existing);
      if (existing.score > 0) {
        scoreSum += existing.score;
        scoreCount += 1;
      }
    } else {
      keypoints.push({ name, x: 0, y: 0, score: 0 });
    }
  }

  if (scoreCount === 0) {
    return null;
  }

  return {
    keypoints,
    score: scoreSum / scoreCount,
    timestampMs,
  };
}

function clamp01(n: number): number {
  'worklet';
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}
