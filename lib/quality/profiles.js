"use strict";
/**
 * Camera / preprocess quality tiers for the WebView MoveNet runtime.
 *
 * Inspired by Sency's PoseModelChoice ladder (Prime → … → Basic), adapted to
 * our stack: MoveNet Lightning always runs at 192×192; what changes is the
 * **camera capture resolution**.
 *
 * FPS policy uses a **minimum target** (floor), not a single setpoint:
 *   - iOS: min 30 — acceptable/ideal band roughly 30–50+ FPS
 *   - Android: min from {@link ANDROID_MIN_TARGET_FPS} (experiment default 10)
 *
 * Warm-up benches estimate execute cost; AdaptiveChoice picks a capture
 * profile before getUserMedia when the estimate is below the platform floor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUALITY_PROFILES = exports.QUALITY_SETTLE_MS = exports.LOW_FPS_STREAK_BEFORE_DOWNGRADE = exports.CRITICAL_FPS_THRESHOLD = exports.TARGET_MEDIAN_MS = exports.TARGET_FPS = exports.IDEAL_FPS_RANGE_ANDROID = exports.IDEAL_FPS_RANGE_IOS = exports.MIN_TARGET_FPS_DEFAULT = exports.MIN_TARGET_FPS_IOS = exports.MIN_TARGET_FPS_ANDROID = exports.QUALITY_LADDER = void 0;
exports.getCriticalFpsThreshold = getCriticalFpsThreshold;
exports.currentQualityPlatform = currentQualityPlatform;
exports.getMinTargetFps = getMinTargetFps;
exports.getIdealFpsRange = getIdealFpsRange;
exports.minMedianMsForMinTarget = minMedianMsForMinTarget;
exports.getQualityProfile = getQualityProfile;
exports.nextLowerQualityProfile = nextLowerQualityProfile;
exports.isQualityProfileId = isQualityProfileId;
exports.qualityLadderIndex = qualityLadderIndex;
exports.lowerQualityProfile = lowerQualityProfile;
exports.profileFromWarmupMedianMs = profileFromWarmupMedianMs;
exports.estimatedFpsFromMedianMs = estimatedFpsFromMedianMs;
const react_native_1 = require("react-native");
const captureMode_1 = require("./captureMode");
/**
 * Ordered highest → lowest. `nextLowerQualityProfile` walks this ladder.
 */
exports.QUALITY_LADDER = [
    'prime',
    'pro',
    'lite',
    'ultralite',
    'basic',
];
/**
 * Android minimum acceptable inference FPS (floor).
 * Sourced from {@link ANDROID_MIN_TARGET_FPS} so the experiment flag is the
 * single knob (see captureMode.ts).
 */
exports.MIN_TARGET_FPS_ANDROID = captureMode_1.ANDROID_MIN_TARGET_FPS;
/**
 * iOS minimum acceptable inference FPS (floor).
 * Acceptable/ideal experience is typically 30–50+ on Apple GPU.
 */
exports.MIN_TARGET_FPS_IOS = 30;
/** Fallback floor for unknown platforms. */
exports.MIN_TARGET_FPS_DEFAULT = exports.MIN_TARGET_FPS_ANDROID;
/**
 * Documented “good experience” bands (not hard caps).
 * Downgrades / warnings use the **min** only.
 */
exports.IDEAL_FPS_RANGE_IOS = { min: exports.MIN_TARGET_FPS_IOS, idealMax: 50 };
exports.IDEAL_FPS_RANGE_ANDROID = { min: exports.MIN_TARGET_FPS_ANDROID, idealMax: 30 };
/**
 * @deprecated Use {@link getMinTargetFps} / {@link MIN_TARGET_FPS_ANDROID}.
 * Kept as the Android floor so older imports keep a sensible number.
 */
exports.TARGET_FPS = exports.MIN_TARGET_FPS_ANDROID;
/** @deprecated Use {@link minMedianMsForMinTarget}. */
exports.TARGET_MEDIAN_MS = 1000 / exports.MIN_TARGET_FPS_ANDROID;
/**
 * Critical alert when FPS stays well below the platform minimum target
 * (even on `basic`). Android: &lt;10; iOS: &lt;20.
 */
function getCriticalFpsThreshold(platform = currentQualityPlatform()) {
    if (platform === 'ios')
        return 20;
    return 10;
}
/** @deprecated Prefer {@link getCriticalFpsThreshold}. */
exports.CRITICAL_FPS_THRESHOLD = 10;
/** Consecutive samples below min-target before auto-downgrade. */
/** Sustained samples below the inference budget before a live downgrade. */
exports.LOW_FPS_STREAK_BEFORE_DOWNGRADE = 4;
/**
 * Ignore live downgrade decisions for this long after ready / a quality swap
 * (camera restart tanks the first 1 Hz stats samples).
 */
exports.QUALITY_SETTLE_MS = 5000;
exports.QUALITY_PROFILES = {
    prime: {
        id: 'prime',
        label: 'Prime (1280×720 @30)',
        idealWidth: 1280,
        idealHeight: 720,
        idealFrameRate: 30,
        minStableFps: exports.MIN_TARGET_FPS_ANDROID,
    },
    pro: {
        id: 'pro',
        label: 'Pro (960×540 @30)',
        idealWidth: 960,
        idealHeight: 540,
        idealFrameRate: 30,
        minStableFps: exports.MIN_TARGET_FPS_ANDROID,
    },
    lite: {
        id: 'lite',
        label: 'Lite (640×480 @30)',
        idealWidth: 640,
        idealHeight: 480,
        idealFrameRate: 30,
        minStableFps: exports.MIN_TARGET_FPS_ANDROID,
    },
    ultralite: {
        id: 'ultralite',
        label: 'UltraLite (480×360 @24)',
        idealWidth: 480,
        idealHeight: 360,
        idealFrameRate: 24,
        minStableFps: exports.MIN_TARGET_FPS_ANDROID,
    },
    basic: {
        id: 'basic',
        label: 'Basic (320×240 @20)',
        idealWidth: 320,
        idealHeight: 240,
        idealFrameRate: 20,
        minStableFps: exports.MIN_TARGET_FPS_ANDROID,
    },
};
function currentQualityPlatform() {
    if (react_native_1.Platform.OS === 'ios')
        return 'ios';
    if (react_native_1.Platform.OS === 'android')
        return 'android';
    return 'other';
}
/** Platform minimum target FPS (floor — not a setpoint). */
function getMinTargetFps(platform = currentQualityPlatform()) {
    if (platform === 'ios')
        return exports.MIN_TARGET_FPS_IOS;
    if (platform === 'android')
        return captureMode_1.ANDROID_MIN_TARGET_FPS;
    return exports.MIN_TARGET_FPS_DEFAULT;
}
function getIdealFpsRange(platform = currentQualityPlatform()) {
    if (platform === 'ios')
        return exports.IDEAL_FPS_RANGE_IOS;
    if (platform === 'android')
        return exports.IDEAL_FPS_RANGE_ANDROID;
    return { min: exports.MIN_TARGET_FPS_DEFAULT, idealMax: 30 };
}
/** Max warm-up median ms that still meets a given min-target FPS. */
function minMedianMsForMinTarget(minTargetFps) {
    return 1000 / minTargetFps;
}
function getQualityProfile(id) {
    return exports.QUALITY_PROFILES[id];
}
function nextLowerQualityProfile(id) {
    const idx = exports.QUALITY_LADDER.indexOf(id);
    if (idx < 0 || idx >= exports.QUALITY_LADDER.length - 1)
        return null;
    return exports.QUALITY_LADDER[idx + 1];
}
function isQualityProfileId(value) {
    return Object.prototype.hasOwnProperty.call(exports.QUALITY_PROFILES, value);
}
function qualityLadderIndex(id) {
    return exports.QUALITY_LADDER.indexOf(id);
}
/** Lower or equal quality (higher index) wins. */
function lowerQualityProfile(a, b) {
    return qualityLadderIndex(a) >= qualityLadderIndex(b) ? a : b;
}
/**
 * Map warm-up execute median (zeros, no camera) → max safe capture profile.
 *
 * Thresholds scale with the platform **minimum target** FPS. Warm-up ignores
 * bitmap cost, so anything over the floor budget must stay on `basic` —
 * the old `≤ 1.3× budget → ultralite` band upgraded Mali devices that were
 * already below the floor (e.g. 120 ms zeros → ultralite → live ~8 FPS).
 */
function profileFromWarmupMedianMs(medianMs, minTargetFps = getMinTargetFps()) {
    if (medianMs == null || !Number.isFinite(medianMs))
        return 'basic';
    const budget = minMedianMsForMinTarget(minTargetFps);
    // Over the floor on zeros alone → basic only (camera adds more cost).
    if (medianMs > budget)
        return 'basic';
    // At / under the floor with headroom → higher capture ok
    if (medianMs <= budget * 0.6)
        return 'prime';
    if (medianMs <= budget * 0.75)
        return 'pro';
    if (medianMs <= budget * 0.9)
        return 'lite';
    return 'ultralite';
}
function estimatedFpsFromMedianMs(medianMs) {
    if (medianMs == null || !Number.isFinite(medianMs) || medianMs <= 0)
        return null;
    return 1000 / medianMs;
}
