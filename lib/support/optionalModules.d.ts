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
/**
 * Expo Go has no vision-camera native binaries. Requiring them there throws
 * (and React Native LogBox still surfaces it even when wrapped in
 * try/catch). Detect Expo Go *before* any of those requires.
 */
export declare function isExpoGo(): boolean;
/** react-native-vision-camera 4.x — subset used by PoseCameraView. */
export interface VisionCameraFrame {
    width: number;
    height: number;
    orientation: string;
    timestamp: number;
}
export interface VisionCameraModule {
    Camera: any;
    useCameraDevice(position: 'front' | 'back'): unknown | undefined;
    useCameraPermission(): {
        hasPermission: boolean;
        requestPermission: () => Promise<boolean>;
    };
    useFrameProcessor(processor: (frame: VisionCameraFrame) => void, deps: unknown[]): unknown;
}
/** react-native-worklets-core 1.x — subset used by PoseCameraView. */
export interface WorkletsCoreModule {
    useSharedValue<T>(initial: T): {
        value: T;
    };
    useRunOnJS<A extends unknown[]>(fn: (...args: A) => void, deps: unknown[]): (...args: A) => void;
}
export declare function getVisionCamera(): VisionCameraModule | null;
export declare function getWorkletsCore(): WorkletsCoreModule | null;
