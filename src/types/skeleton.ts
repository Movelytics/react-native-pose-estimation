/**
 * Skeleton overlay definition — same JSON shape as Strapi `api::skeleton.skeleton`
 * / PoseTrackerFront `DEFAULT_SKELETON` (WebView `?skeleton=<api_uuid>`).
 */

export interface SkeletonCirclesStyle {
  circleFillColor: string;
  circleStrokeColor: string;
  strokeWidth: string | number;
  radius: string | number;
}

export interface SkeletonLinesStyle {
  lineStrokeColor: string;
  strokeWidth: string | number;
}

export interface SkeletonAnglesStyle {
  fontColor?: string;
  strokeColor?: string;
}

export interface SkeletonDefinition {
  keypoints: string[];
  /** Named pairs `"left_hip||left_knee"`. */
  keypoint_lines: string[];
  keypoint_angles?: string[];
  circles: SkeletonCirclesStyle;
  lines: SkeletonLinesStyle;
  angles?: SkeletonAnglesStyle;
}

/** PoseTracker API default (navy `#010A73` + gold `#FFC300`). */
export const DEFAULT_SKELETON_DEFINITION: SkeletonDefinition = {
  keypoints: [
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
  ],
  keypoint_lines: [
    'right_shoulder||left_shoulder',
    'right_hip||left_hip',
    'right_hip||right_shoulder',
    'right_hip||right_knee',
    'right_ankle||right_knee',
    'right_shoulder||right_elbow',
    'right_wrist||right_elbow',
    'left_hip||left_shoulder',
    'left_hip||left_knee',
    'left_ankle||left_knee',
    'left_shoulder||left_elbow',
    'left_wrist||left_elbow',
  ],
  keypoint_angles: [],
  angles: { fontColor: '#000000', strokeColor: '#FFC300' },
  circles: {
    circleFillColor: '#010A73',
    circleStrokeColor: '#FFC300',
    strokeWidth: '4',
    radius: '8',
  },
  lines: { lineStrokeColor: '#010A73', strokeWidth: '4' },
};
