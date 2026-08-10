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
/** How getUserMedia chooses resolution on cold open. */
export type CaptureConstraintMode = 'device-native' | 'profile-constrained';
/**
 * Letterbox preprocess path inside the WebView (Android experiment only).
 * - `imagebitmap` — draw 192² canvas → createImageBitmap → fromPixels (legacy)
 * - `canvas-direct` — draw 192² canvas → fromPixels(canvas) (skips ImageBitmap)
 */
export type AndroidPreprocessPath = 'imagebitmap' | 'canvas-direct';
/** Soft-cap ladder ids (mirrors QualityProfileId; kept local to avoid import cycles). */
export type AndroidSoftCapProfile = 'prime' | 'pro' | 'lite' | 'ultralite' | 'basic';
/**
 * - `device-native` — facingMode only (like PoseTrackerFront). Preview = device default (often HD).
 * - `profile-constrained` — ideal width/height/frameRate from the AdaptiveChoice ladder.
 */
export declare const CAPTURE_CONSTRAINT_MODE: CaptureConstraintMode;
/**
 * When true, Mali GL renderers are hard-capped to UltraLite at capability score
 * time (previous SDK default). Disable for the Front-aligned experiment so RN
 * does not immediately setQuality() back down to 480×360 after a native HD open.
 */
export declare const ENABLE_MALI_HARD_CAP = false;
/**
 * Android-only: ready rAF ticks to skip between MoveNet inferences.
 * Preview stays at full capture quality.
 *
 * - `0` — off
 * - `1` — every other ready tick
 * - `2` — every 3rd, etc.
 */
export declare const ANDROID_INFER_FRAME_SKIP = 1;
/**
 * Android-only preprocess path. iOS always uses `imagebitmap` (unchanged).
 */
export declare const ANDROID_PREPROCESS_PATH: AndroidPreprocessPath;
/**
 * Android-only cold-open soft cap. When set, getUserMedia uses this profile’s
 * width/height as ideal+max even in `device-native` mode (so the device cannot
 * open unrestricted 1080p). Set `null` for fully unconstrained facingMode-only.
 *
 * Mali-G52 evidence (2026-08-06): `basic` 240×320 ≈ 10 FPS median; `ultralite`
 * 360×480 ≈ 8 FPS — pin soft-cap to `basic` to hold the 10 FPS floor.
 * Live `setQuality` cannot go lower than basic.
 */
export declare const ANDROID_SOFT_CAP_PROFILE: AndroidSoftCapProfile | null;
/**
 * Android AdaptiveChoice floor (min target FPS). Downgrade when median
 * inference ms stays above ~1.2 × (1000/floor). iOS stays on
 * {@link MIN_TARGET_FPS_IOS} (30).
 */
export declare const ANDROID_MIN_TARGET_FPS = 10;
/**
 * When true (Android), WebView posts rich `experiments` + `leverHints` on each
 * 1 Hz stats tick and mirrors a compact line on the HUD. RN logs the same via
 * the existing diagnostic listener. iOS ignores this flag.
 */
export declare const ANDROID_PERF_DEBUG = true;
