"use strict";
/**
 * Lightweight device capability score → initial quality profile.
 *
 * Sency's AdaptiveChoice uses RAM / CPU freq / first API level. In Expo Go we
 * only have a subset of signals without extra native deps; we combine:
 *   - Platform (iOS is typically 3–5× faster on WebGL MoveNet)
 *   - Android API level
 *   - Optional RAM via expo-device / react-native DeviceInfo when present
 *   - GL renderer hint (Mali mid-range) once known from the WebView
 *
 * Score is 0–100; mapped to a QualityProfileId. Brand/year caps from Sency
 * are approximated via API level + Mali detection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMaliRenderer = isMaliRenderer;
exports.profileFromScore = profileFromScore;
exports.scoreDeviceCapability = scoreDeviceCapability;
const react_native_1 = require("react-native");
const captureMode_1 = require("./captureMode");
function probeTotalMemoryGiB() {
    // Optional peers — never required.
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Device = require('expo-device');
        const bytes = Device.totalMemory;
        if (typeof bytes === 'number' && bytes > 0)
            return bytes / (1024 * 1024 * 1024);
    }
    catch {
        /* ignore */
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const DeviceInfo = require('react-native-device-info');
        // sync API may exist
        if (typeof DeviceInfo.getTotalMemorySync === 'function') {
            const bytes = DeviceInfo.getTotalMemorySync();
            if (typeof bytes === 'number' && bytes > 0)
                return bytes / (1024 * 1024 * 1024);
        }
    }
    catch {
        /* ignore */
    }
    return null;
}
function parseOsVersion() {
    const v = react_native_1.Platform.Version;
    if (typeof v === 'number')
        return v;
    if (typeof v === 'string') {
        const major = parseInt(v.split('.')[0] ?? '', 10);
        return Number.isFinite(major) ? major : null;
    }
    return null;
}
function isMaliRenderer(renderer) {
    return !!(renderer && /mali/i.test(renderer));
}
/**
 * Map capability score → profile (before Mali / crash-guard caps).
 * Thresholds calibrated so mid-range Android (Mali-G52 era) lands on UltraLite.
 */
function profileFromScore(score) {
    if (score >= 78)
        return 'prime';
    if (score >= 62)
        return 'pro';
    if (score >= 48)
        return 'lite';
    if (score >= 32)
        return 'ultralite';
    return 'basic';
}
function scoreDeviceCapability(options) {
    const reasons = [];
    const platform = react_native_1.Platform.OS === 'ios' ? 'ios' : react_native_1.Platform.OS === 'android' ? 'android' : 'other';
    const osVersion = parseOsVersion();
    const totalMemoryGiB = probeTotalMemoryGiB();
    const glRenderer = options?.glRenderer ?? null;
    let score = 0;
    if (platform === 'ios') {
        // Apple GPU WebGL MoveNet is typically <20 ms — start high.
        score += 55;
        reasons.push('platform=ios (+55)');
        if (osVersion != null) {
            if (osVersion >= 17) {
                score += 15;
                reasons.push(`ios>=17 (+15)`);
            }
            else if (osVersion >= 15) {
                score += 10;
                reasons.push(`ios>=15 (+10)`);
            }
            else {
                score += 5;
                reasons.push(`ios legacy (+5)`);
            }
        }
    }
    else if (platform === 'android') {
        score += 18;
        reasons.push('platform=android (+18)');
        if (osVersion != null) {
            if (osVersion >= 34) {
                score += 14;
                reasons.push(`api>=34 (+14)`);
            }
            else if (osVersion >= 31) {
                score += 10;
                reasons.push(`api>=31 (+10)`);
            }
            else if (osVersion >= 28) {
                score += 6;
                reasons.push(`api>=28 (+6)`);
            }
            else {
                reasons.push(`api=${osVersion} (+0)`);
            }
        }
    }
    else {
        score += 20;
        reasons.push('platform=other (+20)');
    }
    if (totalMemoryGiB != null) {
        if (totalMemoryGiB >= 8) {
            score += 20;
            reasons.push(`ram>=8GiB (+20)`);
        }
        else if (totalMemoryGiB >= 6) {
            score += 14;
            reasons.push(`ram>=6GiB (+14)`);
        }
        else if (totalMemoryGiB >= 4) {
            score += 8;
            reasons.push(`ram>=4GiB (+8)`);
        }
        else {
            reasons.push(`ram=${totalMemoryGiB.toFixed(1)}GiB (+0)`);
        }
    }
    else {
        // Neutral default when RAM unknown: don't assume high-end.
        score += 6;
        reasons.push('ram=unknown (+6)');
    }
    if (isMaliRenderer(glRenderer)) {
        // Mali mid-range: HD camera preprocess alone can cost ~100 ms/frame.
        score = Math.min(score, 40);
        reasons.push('gl=Mali cap score≤40');
    }
    score = Math.max(0, Math.min(100, score));
    let suggested = profileFromScore(score);
    // Hard caps (Sency-style).
    if (platform === 'android' && suggested === 'prime') {
        suggested = 'pro';
        reasons.push('android cap: prime→pro');
    }
    // Mali → ultralite hard cap: gated by captureMode (see captureMode.ts REVERT).
    if (captureMode_1.ENABLE_MALI_HARD_CAP &&
        isMaliRenderer(glRenderer) &&
        (suggested === 'prime' || suggested === 'pro')) {
        suggested = 'ultralite';
        reasons.push('mali cap: →ultralite');
    }
    return {
        platform,
        osVersion,
        totalMemoryGiB,
        glRenderer,
        score,
        suggestedProfile: suggested,
        reasons,
    };
}
