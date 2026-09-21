"use strict";
/**
 * Pose-model selection for the offline SDK.
 *
 * Default is bundled MoveNet SinglePose Lightning (no network).
 * `blazepose` is opt-in and loads `@tensorflow-models/pose-detection` from
 * CDN inside the WebView — same detector path as the light SDK. The npm
 * package still ships unused MoveNet weights in that mode; hosts should
 * switch to `@pose-tracker/react-native-pose-estimation-light`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLAZEPOSE_ON_OFFLINE_SDK_WARNING = exports.ONLINE_POSE_DETECTION_VERSION = void 0;
exports.defaultPoseDetectionCdnUrl = defaultPoseDetectionCdnUrl;
exports.resolvePoseModel = resolvePoseModel;
/** pose-detection UMD pin (BlazePose CDN). Matches the light SDK. */
exports.ONLINE_POSE_DETECTION_VERSION = '2.1.3';
const JSDELIVR = 'https://cdn.jsdelivr.net/npm';
/**
 * Metro / logcat warning when BlazePose is selected on this (offline) package.
 * The model is fetched from the network; bundled MoveNet is unused.
 */
exports.BLAZEPOSE_ON_OFFLINE_SDK_WARNING = 'model=blazepose loads BlazePose from the network (CDN @tensorflow-models/pose-detection). ' +
    'This package (@pose-tracker/react-native-pose-estimation) still ships bundled MoveNet ' +
    'for offline use, which is unused in this mode and inflates the app. Switch to ' +
    '@pose-tracker/react-native-pose-estimation-light if you do not need offline MoveNet.';
function defaultPoseDetectionCdnUrl(cdnBase = JSDELIVR, version = exports.ONLINE_POSE_DETECTION_VERSION) {
    const base = cdnBase.replace(/\/$/, '');
    return `${base}/@tensorflow-models/pose-detection@${version}/dist/pose-detection.min.js`;
}
/**
 * Resolve which pose model the offline WebView should run.
 * Default: bundled MoveNet. `blazepose` requires network for pose-detection.
 */
function resolvePoseModel(options = {}) {
    const key = (options.model ?? 'movenet').trim().toLowerCase();
    if (key === '' || key === 'movenet' || key === 'movenet-singlepose-lightning' || key === 'lightning') {
        return { modelId: 'movenet-singlepose-lightning', kind: 'movenet-graph' };
    }
    if (key === 'blazepose') {
        return { modelId: 'blazepose', kind: 'blazepose' };
    }
    throw new Error(`Unknown model "${options.model}". Use "movenet" (default, bundled offline) or "blazepose" (CDN, requires network).`);
}
