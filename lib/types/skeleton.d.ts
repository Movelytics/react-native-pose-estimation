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
export declare const DEFAULT_SKELETON_DEFINITION: SkeletonDefinition;
