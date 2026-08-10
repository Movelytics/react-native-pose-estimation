/**
 * Guarded access to the Apple Vision body-pose frame-processor plugin.
 *
 * The plugin lives in this package's `ios/` folder (VisionCamera Swift
 * FrameProcessorPlugin + `VNDetectHumanBodyPoseRequest`). It is only linked
 * in native iOS builds — never in Expo Go. All requires are gated by
 * `Platform.OS === 'ios' && !isExpoGo()` so Metro/Expo Go never evaluate
 * Nitro/VisionCamera code paths unintentionally.
 */

import { Platform } from 'react-native';

import { getVisionCamera, getWorkletsCore, isExpoGo } from '../../support/optionalModules';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function require(name: string): unknown;

/** JS name registered via `VISION_EXPORT_SWIFT_FRAME_PROCESSOR(..., detectBodyPose)`. */
export const VISION_BODY_POSE_PLUGIN_NAME = 'detectBodyPose';

export interface VisionFrameProcessorPlugin {
  call(frame: unknown, args?: Record<string, unknown>): unknown;
}

interface VisionCameraProxyModule {
  VisionCameraProxy: {
    initFrameProcessorPlugin(
      name: string,
      options?: Record<string, unknown>,
    ): VisionFrameProcessorPlugin | null | undefined;
  };
}

let cachedPlugin: VisionFrameProcessorPlugin | null | undefined;

/**
 * True when we are on a native iOS build (not Expo Go) where the Vision
 * frame-processor plugin can be loaded. Does not require Nitro / TFLite.
 */
export function isVisionBackendAvailable(): boolean {
  if (Platform.OS !== 'ios' || isExpoGo()) {
    return false;
  }
  if (getVisionCamera() === null || getWorkletsCore() === null) {
    return false;
  }
  return getVisionBodyPosePlugin() !== null;
}

/**
 * vision-camera + worklets present on iOS native build — enough to mount the
 * Vision path of `PoseCameraView` once the backend has initialized.
 */
export function isVisionPoseCameraAvailable(): boolean {
  return (
    Platform.OS === 'ios' &&
    !isExpoGo() &&
    getVisionCamera() !== null &&
    getWorkletsCore() !== null
  );
}

/**
 * Lazily init the VisionCamera frame-processor plugin. Cached; `null` when
 * the native binary does not include our Swift plugin (Expo Go, Android,
 * or a host that excluded the pod).
 */
export function getVisionBodyPosePlugin(): VisionFrameProcessorPlugin | null {
  if (cachedPlugin !== undefined) {
    return cachedPlugin;
  }
  if (Platform.OS !== 'ios' || isExpoGo()) {
    cachedPlugin = null;
    return cachedPlugin;
  }
  try {
    const mod = require('react-native-vision-camera') as VisionCameraProxyModule;
    const proxy = mod.VisionCameraProxy;
    if (!proxy || typeof proxy.initFrameProcessorPlugin !== 'function') {
      cachedPlugin = null;
      return cachedPlugin;
    }
    const plugin = proxy.initFrameProcessorPlugin(VISION_BODY_POSE_PLUGIN_NAME, {});
    cachedPlugin = plugin ?? null;
  } catch {
    cachedPlugin = null;
  }
  return cachedPlugin;
}

/** Test helper — clears the plugin cache between availability probes. */
export function resetVisionPluginCacheForTests(): void {
  cachedPlugin = undefined;
}
