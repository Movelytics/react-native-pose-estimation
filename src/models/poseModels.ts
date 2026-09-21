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
export const ONLINE_POSE_DETECTION_VERSION = '2.1.3';

const JSDELIVR = 'https://cdn.jsdelivr.net/npm';

/** Docs API / Front `model` query aliases. */
export type PoseModelAlias =
  | 'movenet'
  | 'movenet-singlepose-lightning'
  | 'lightning'
  | 'blazepose'
  | (string & {});

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
export const BLAZEPOSE_ON_OFFLINE_SDK_WARNING =
  'model=blazepose loads BlazePose from the network (CDN @tensorflow-models/pose-detection). ' +
  'This package (@pose-tracker/react-native-pose-estimation) still ships bundled MoveNet ' +
  'for offline use, which is unused in this mode and inflates the app. Switch to ' +
  '@pose-tracker/react-native-pose-estimation-light if you do not need offline MoveNet.';

export function defaultPoseDetectionCdnUrl(
  cdnBase: string = JSDELIVR,
  version: string = ONLINE_POSE_DETECTION_VERSION,
): string {
  const base = cdnBase.replace(/\/$/, '');
  return `${base}/@tensorflow-models/pose-detection@${version}/dist/pose-detection.min.js`;
}

/**
 * Resolve which pose model the offline WebView should run.
 * Default: bundled MoveNet. `blazepose` requires network for pose-detection.
 */
export function resolvePoseModel(options: ResolvePoseModelOptions = {}): ResolvedPoseModel {
  const key = (options.model ?? 'movenet').trim().toLowerCase();
  if (key === '' || key === 'movenet' || key === 'movenet-singlepose-lightning' || key === 'lightning') {
    return { modelId: 'movenet-singlepose-lightning', kind: 'movenet-graph' };
  }
  if (key === 'blazepose') {
    return { modelId: 'blazepose', kind: 'blazepose' };
  }
  throw new Error(
    `Unknown model "${options.model}". Use "movenet" (default, bundled offline) or "blazepose" (CDN, requires network).`,
  );
}
