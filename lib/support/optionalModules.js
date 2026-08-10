"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExpoGo = isExpoGo;
exports.getVisionCamera = getVisionCamera;
exports.getWorkletsCore = getWorkletsCore;
/**
 * Expo Go has no vision-camera native binaries. Requiring them there throws
 * (and React Native LogBox still surfaces it even when wrapped in
 * try/catch). Detect Expo Go *before* any of those requires.
 */
function isExpoGo() {
    try {
        // Avoid a hard dependency on expo-constants: same signal Nitro uses.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { NativeModules } = require('react-native');
        return (NativeModules.NativeUnimoduleProxy?.modulesConstants?.ExponentConstants
            ?.appOwnership === 'expo');
    }
    catch {
        return false;
    }
}
// ---------------------------------------------------------------------------
// Guarded requires (cached; `undefined` = not probed yet, `null` = missing)
// ---------------------------------------------------------------------------
// NOTE: every `require` below uses a STRING LITERAL — Metro cannot resolve
// dynamic `require(variable)` calls and would fail the build.
let visionCamera;
let workletsCore;
function getVisionCamera() {
    if (visionCamera === undefined) {
        if (isExpoGo()) {
            visionCamera = null;
        }
        else {
            try {
                visionCamera = require('react-native-vision-camera');
            }
            catch {
                visionCamera = null;
            }
            if (visionCamera && typeof visionCamera.useFrameProcessor !== 'function') {
                visionCamera = null;
            }
        }
    }
    return visionCamera;
}
function getWorkletsCore() {
    if (workletsCore === undefined) {
        if (isExpoGo()) {
            workletsCore = null;
        }
        else {
            try {
                workletsCore = require('react-native-worklets-core');
            }
            catch {
                workletsCore = null;
            }
            if (workletsCore && typeof workletsCore.useRunOnJS !== 'function') {
                workletsCore = null;
            }
        }
    }
    return workletsCore;
}
