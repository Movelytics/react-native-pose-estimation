/**
 * Guarded access to the OPTIONAL native modules used by the Apple Vision
 * backend: react-native-vision-camera + react-native-worklets-core.
 *
 * They are `peerDependenciesMeta.optional` — a host that only uses the
 * WebView runtime (the default, Expo Go compatible) does not install them.
 *
 * 1. Every `require` is wrapped in try/catch. Metro marks dependencies
 *    required inside a try block as *optional* when
 *    `transformer.allowOptionalDependencies` is enabled (the Expo default),
 *    so bundling never fails when a module is absent.
 * 2. The SDK must not depend on these packages' TypeScript types, so the
 *    interfaces below are minimal *structural* typings of the APIs we
 *    consume (react-native-vision-camera 4.x, worklets-core 1.x).
 */

declare function require(name: string): unknown;

/**
 * Expo Go has no vision-camera native binaries. Requiring them there throws
 * (and React Native LogBox still surfaces it even when wrapped in
 * try/catch). Detect Expo Go *before* any of those requires.
 */
export function isExpoGo(): boolean {
  try {
    // Avoid a hard dependency on expo-constants: same signal Nitro uses.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native') as {
      NativeModules: {
        NativeUnimoduleProxy?: {
          modulesConstants?: { ExponentConstants?: { appOwnership?: string } };
        };
      };
    };
    return (
      NativeModules.NativeUnimoduleProxy?.modulesConstants?.ExponentConstants
        ?.appOwnership === 'expo'
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Structural typings (subset actually consumed by the SDK)
// ---------------------------------------------------------------------------

/** react-native-vision-camera 4.x — subset used by PoseCameraView. */
export interface VisionCameraFrame {
  width: number;
  height: number;
  orientation: string; // 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right'
  timestamp: number;
}

export interface VisionCameraModule {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Camera: any; // React component class
  useCameraDevice(position: 'front' | 'back'): unknown | undefined;
  useCameraPermission(): { hasPermission: boolean; requestPermission: () => Promise<boolean> };
  useFrameProcessor(processor: (frame: VisionCameraFrame) => void, deps: unknown[]): unknown;
}

/** react-native-worklets-core 1.x — subset used by PoseCameraView. */
export interface WorkletsCoreModule {
  useSharedValue<T>(initial: T): { value: T };
  useRunOnJS<A extends unknown[]>(fn: (...args: A) => void, deps: unknown[]): (...args: A) => void;
}

// ---------------------------------------------------------------------------
// Guarded requires (cached; `undefined` = not probed yet, `null` = missing)
// ---------------------------------------------------------------------------

// NOTE: every `require` below uses a STRING LITERAL — Metro cannot resolve
// dynamic `require(variable)` calls and would fail the build.

let visionCamera: VisionCameraModule | null | undefined;
let workletsCore: WorkletsCoreModule | null | undefined;

export function getVisionCamera(): VisionCameraModule | null {
  if (visionCamera === undefined) {
    if (isExpoGo()) {
      visionCamera = null;
    } else {
      try {
        visionCamera = require('react-native-vision-camera') as VisionCameraModule;
      } catch {
        visionCamera = null;
      }
      if (visionCamera && typeof visionCamera.useFrameProcessor !== 'function') {
        visionCamera = null;
      }
    }
  }
  return visionCamera;
}

export function getWorkletsCore(): WorkletsCoreModule | null {
  if (workletsCore === undefined) {
    if (isExpoGo()) {
      workletsCore = null;
    } else {
      try {
        workletsCore = require('react-native-worklets-core') as WorkletsCoreModule;
      } catch {
        workletsCore = null;
      }
      if (workletsCore && typeof workletsCore.useRunOnJS !== 'function') {
        workletsCore = null;
      }
    }
  }
  return workletsCore;
}
