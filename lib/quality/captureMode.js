"use strict";
/**
 * Camera capture + Android perf experiment knobs (WebView getUserMedia / MoveNet).
 *
 * iOS is never mutated by the Android-only flags below — {@link buildPoseHtml}
 * forces frame-skip / soft-cap / preprocess overrides off on iOS.
 *
 * ## Experiment stack 2026-08-06
 * 1. `device-native` cold open (Front-aligned) + optional Android soft-cap
 * 2. Android frame-skip between inferences
 * 3. Android lighter preprocess (`canvas-direct`)
 * 4. Android min-target floor 10 FPS (downgrade only when truly needed)
 * 5. Verbose perf debug in WebView stats / HUD
 *
 * ## REVERT to previous stable behaviour
 * 1. `CAPTURE_CONSTRAINT_MODE = 'profile-constrained'`
 * 2. `ENABLE_MALI_HARD_CAP = true`
 * 3. `ANDROID_INFER_FRAME_SKIP = 0`
 * 4. `ANDROID_PREPROCESS_PATH = 'imagebitmap'`
 * 5. `ANDROID_SOFT_CAP_PROFILE = null` (experiment currently pins `'basic'`)
 * 6. `ANDROID_MIN_TARGET_FPS = 15`
 * 7. `ANDROID_PERF_DEBUG = false`
 * 8. Rebuild: `npm run build:runtime-payload && npm run build`
 * 9. Refresh testapp link + `npx expo start -c`
 *
 * You also have a zip archive of the previous SDK as a full rollback.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANDROID_PERF_DEBUG = exports.ANDROID_MIN_TARGET_FPS = exports.ANDROID_SOFT_CAP_PROFILE = exports.ANDROID_PREPROCESS_PATH = exports.ANDROID_INFER_FRAME_SKIP = exports.ENABLE_MALI_HARD_CAP = exports.CAPTURE_CONSTRAINT_MODE = void 0;
/**
 * - `device-native` — facingMode only (like PoseTrackerFront). Preview = device default (often HD).
 * - `profile-constrained` — ideal width/height/frameRate from the AdaptiveChoice ladder.
 */
exports.CAPTURE_CONSTRAINT_MODE = 'device-native';
/**
 * When true, Mali GL renderers are hard-capped to UltraLite at capability score
 * time (previous SDK default). Disable for the Front-aligned experiment so RN
 * does not immediately setQuality() back down to 480×360 after a native HD open.
 */
exports.ENABLE_MALI_HARD_CAP = false;
/**
 * Android-only: ready rAF ticks to skip between MoveNet inferences.
 * Preview stays at full capture quality.
 *
 * - `0` — off
 * - `1` — every other ready tick
 * - `2` — every 3rd, etc.
 */
exports.ANDROID_INFER_FRAME_SKIP = 1;
/**
 * Android-only preprocess path. iOS always uses `imagebitmap` (unchanged).
 */
exports.ANDROID_PREPROCESS_PATH = 'canvas-direct';
/**
 * Android-only cold-open soft cap. When set, getUserMedia uses this profile’s
 * width/height as ideal+max even in `device-native` mode (so the device cannot
 * open unrestricted 1080p). Set `null` for fully unconstrained facingMode-only.
 *
 * Mali-G52 evidence (2026-08-06): `basic` 240×320 ≈ 10 FPS median; `ultralite`
 * 360×480 ≈ 8 FPS — pin soft-cap to `basic` to hold the 10 FPS floor.
 * Live `setQuality` cannot go lower than basic.
 */
exports.ANDROID_SOFT_CAP_PROFILE = 'basic';
/**
 * Android AdaptiveChoice floor (min target FPS). Downgrade when median
 * inference ms stays above ~1.2 × (1000/floor). iOS stays on
 * {@link MIN_TARGET_FPS_IOS} (30).
 */
exports.ANDROID_MIN_TARGET_FPS = 10;
/**
 * When true (Android), WebView posts rich `experiments` + `leverHints` on each
 * 1 Hz stats tick and mirrors a compact line on the HUD. RN logs the same via
 * the existing diagnostic listener. iOS ignores this flag.
 */
exports.ANDROID_PERF_DEBUG = true;
