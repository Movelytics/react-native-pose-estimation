"use strict";
/**
 * Guarded access to the Apple Vision body-pose frame-processor plugin.
 *
 * The plugin lives in this package's `ios/` folder (VisionCamera Swift
 * FrameProcessorPlugin + `VNDetectHumanBodyPoseRequest`). It is only linked
 * in native iOS builds — never in Expo Go. All requires are gated by
 * `Platform.OS === 'ios' && !isExpoGo()` so Metro/Expo Go never evaluate
 * Nitro/VisionCamera code paths unintentionally.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VISION_BODY_POSE_PLUGIN_NAME = void 0;
exports.isVisionBackendAvailable = isVisionBackendAvailable;
exports.isVisionPoseCameraAvailable = isVisionPoseCameraAvailable;
exports.getVisionBodyPosePlugin = getVisionBodyPosePlugin;
exports.resetVisionPluginCacheForTests = resetVisionPluginCacheForTests;
const react_native_1 = require("react-native");
const optionalModules_1 = require("../../support/optionalModules");
/** JS name registered via `VISION_EXPORT_SWIFT_FRAME_PROCESSOR(..., detectBodyPose)`. */
exports.VISION_BODY_POSE_PLUGIN_NAME = 'detectBodyPose';
let cachedPlugin;
/**
 * True when we are on a native iOS build (not Expo Go) where the Vision
 * frame-processor plugin can be loaded. Does not require Nitro / TFLite.
 */
function isVisionBackendAvailable() {
    if (react_native_1.Platform.OS !== 'ios' || (0, optionalModules_1.isExpoGo)()) {
        return false;
    }
    if ((0, optionalModules_1.getVisionCamera)() === null || (0, optionalModules_1.getWorkletsCore)() === null) {
        return false;
    }
    return getVisionBodyPosePlugin() !== null;
}
/**
 * vision-camera + worklets present on iOS native build — enough to mount the
 * Vision path of `PoseCameraView` once the backend has initialized.
 */
function isVisionPoseCameraAvailable() {
    return (react_native_1.Platform.OS === 'ios' &&
        !(0, optionalModules_1.isExpoGo)() &&
        (0, optionalModules_1.getVisionCamera)() !== null &&
        (0, optionalModules_1.getWorkletsCore)() !== null);
}
/**
 * Lazily init the VisionCamera frame-processor plugin. Cached; `null` when
 * the native binary does not include our Swift plugin (Expo Go, Android,
 * or a host that excluded the pod).
 */
function getVisionBodyPosePlugin() {
    if (cachedPlugin !== undefined) {
        return cachedPlugin;
    }
    if (react_native_1.Platform.OS !== 'ios' || (0, optionalModules_1.isExpoGo)()) {
        cachedPlugin = null;
        return cachedPlugin;
    }
    try {
        const mod = require('react-native-vision-camera');
        const proxy = mod.VisionCameraProxy;
        if (!proxy || typeof proxy.initFrameProcessorPlugin !== 'function') {
            cachedPlugin = null;
            return cachedPlugin;
        }
        const plugin = proxy.initFrameProcessorPlugin(exports.VISION_BODY_POSE_PLUGIN_NAME, {});
        cachedPlugin = plugin ?? null;
    }
    catch {
        cachedPlugin = null;
    }
    return cachedPlugin;
}
/** Test helper — clears the plugin cache between availability probes. */
function resetVisionPluginCacheForTests() {
    cachedPlugin = undefined;
}
