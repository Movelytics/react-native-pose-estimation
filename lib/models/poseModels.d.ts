/**
 * Pose-model selection for the offline SDK.
 *
 * Default is bundled MoveNet SinglePose Lightning (no network).
 * `blazepose` is opt-in and loads `@tensorflow-models/pose-detection` from
 * CDN inside the WebView — same detector path as the light SDK. The npm
 * package still ships unused MoveNet weights in that mode; hosts should
 * switch to `@pose-tracker/react-native-pose-estimation-light`.
 */
/** pose-detection UMD pin (BlazePose CDN). Matches the light SDK. */
export declare const ONLINE_POSE_DETECTION_VERSION = "2.1.3";
/** Docs API / Front `model` query aliases. */
export type PoseModelAlias = 'movenet' | 'movenet-singlepose-lightning' | 'lightning' | 'blazepose' | (string & {});
export type PoseModelKind = 'movenet-graph' | 'blazepose';
export interface ResolvePoseModelOptions {
    /**
     * Docs API `model` query parity (`movenet` default, `blazepose`).
     * Unknown values throw.
     */
    model?: PoseModelAlias;
}
export interface ResolvedPoseModel {
    modelId: string;
    kind: PoseModelKind;
}
/**
 * Metro / logcat warning when BlazePose is selected on this (offline) package.
 * The model is fetched from the network; bundled MoveNet is unused.
 */
export declare const BLAZEPOSE_ON_OFFLINE_SDK_WARNING: string;
export declare function defaultPoseDetectionCdnUrl(cdnBase?: string, version?: string): string;
/**
 * Resolve which pose model the offline WebView should run.
 * Default: bundled MoveNet. `blazepose` requires network for pose-detection.
 */
export declare function resolvePoseModel(options?: ResolvePoseModelOptions): ResolvedPoseModel;
