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
export type QualityProfileId = 'prime' | 'pro' | 'lite' | 'ultralite' | 'basic';
/** Host-facing choice, mirrors Sency's AdaptiveChoice + explicit override. */
export type QualityChoice = 'AdaptiveChoice' | QualityProfileId;
/**
 * Host trade-off between pose FPS and camera preview sharpness.
 *
 * - `performance` (default) — AdaptiveChoice may lower capture (esp. Android
 *   soft-cap / warm-up / live downgrade) so inference stays near the platform
 *   FPS floor. Preview can look soft on mid-range Android.
 * - `quality` — keep high capture / skip FPS-driven capture downgrades.
 *   Preview stays sharp; pose FPS may drop well below the floor. The SDK still
 *   emits `performance_warning` when slow.
 *
 * Explicit {@link QualityChoice} profile ids still pin the starting tier;
 * `quality` only disables automatic FPS-driven drops.
 */
export type CapturePriority = 'performance' | 'quality';
export type QualityPlatform = 'ios' | 'android' | 'other';
export interface FpsRange {
    /** Soft lower bound of the “good experience” band (same as min target on that OS). */
    min: number;
    /**
     * Soft upper reference for docs / UI (“we’re happy around here”).
     * Not a hard cap — exceeding it is fine.
     */
    idealMax: number;
}
export interface QualityProfile {
    id: QualityProfileId;
    /** Human label for diagnostics / docs. */
    label: string;
    /** getUserMedia ideal width (CSS pixels / sensor). */
    idealWidth: number;
    /** getUserMedia ideal height. */
    idealHeight: number;
    /** getUserMedia ideal frameRate. */
    idealFrameRate: number;
    /**
     * Per-profile floor used when AdaptiveChoice has not overridden via platform.
     * Live controller uses {@link getMinTargetFps} instead.
     */
    minStableFps: number;
}
/**
 * Ordered highest → lowest. `nextLowerQualityProfile` walks this ladder.
 */
export declare const QUALITY_LADDER: readonly QualityProfileId[];
/**
 * Android minimum acceptable inference FPS (floor).
 * Sourced from {@link ANDROID_MIN_TARGET_FPS} so the experiment flag is the
 * single knob (see captureMode.ts).
 */
export declare const MIN_TARGET_FPS_ANDROID = 10;
/**
 * iOS minimum acceptable inference FPS (floor).
 * Acceptable/ideal experience is typically 30–50+ on Apple GPU.
 */
export declare const MIN_TARGET_FPS_IOS = 30;
/** Fallback floor for unknown platforms. */
export declare const MIN_TARGET_FPS_DEFAULT = 10;
/**
 * Documented “good experience” bands (not hard caps).
 * Downgrades / warnings use the **min** only.
 */
export declare const IDEAL_FPS_RANGE_IOS: FpsRange;
export declare const IDEAL_FPS_RANGE_ANDROID: FpsRange;
/**
 * @deprecated Use {@link getMinTargetFps} / {@link MIN_TARGET_FPS_ANDROID}.
 * Kept as the Android floor so older imports keep a sensible number.
 */
export declare const TARGET_FPS = 10;
/** @deprecated Use {@link minMedianMsForMinTarget}. */
export declare const TARGET_MEDIAN_MS: number;
/**
 * Critical alert when FPS stays well below the platform minimum target
 * (even on `basic`). Android: &lt;10; iOS: &lt;20.
 */
export declare function getCriticalFpsThreshold(platform?: QualityPlatform): number;
/** @deprecated Prefer {@link getCriticalFpsThreshold}. */
export declare const CRITICAL_FPS_THRESHOLD = 10;
/** Consecutive samples below min-target before auto-downgrade. */
/** Sustained samples below the inference budget before a live downgrade. */
export declare const LOW_FPS_STREAK_BEFORE_DOWNGRADE = 4;
/**
 * Ignore live downgrade decisions for this long after ready / a quality swap
 * (camera restart tanks the first 1 Hz stats samples).
 */
export declare const QUALITY_SETTLE_MS = 5000;
export declare const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile>;
export declare function currentQualityPlatform(): QualityPlatform;
/** Platform minimum target FPS (floor — not a setpoint). */
export declare function getMinTargetFps(platform?: QualityPlatform): number;
export declare function getIdealFpsRange(platform?: QualityPlatform): FpsRange;
/** Max warm-up median ms that still meets a given min-target FPS. */
export declare function minMedianMsForMinTarget(minTargetFps: number): number;
export declare function getQualityProfile(id: QualityProfileId): QualityProfile;
export declare function nextLowerQualityProfile(id: QualityProfileId): QualityProfileId | null;
export declare function isQualityProfileId(value: string): value is QualityProfileId;
export declare function qualityLadderIndex(id: QualityProfileId): number;
/** Lower or equal quality (higher index) wins. */
export declare function lowerQualityProfile(a: QualityProfileId, b: QualityProfileId): QualityProfileId;
/**
 * Map warm-up execute median (zeros, no camera) → max safe capture profile.
 *
 * Thresholds scale with the platform **minimum target** FPS. Warm-up ignores
 * bitmap cost, so anything over the floor budget must stay on `basic` —
 * the old `≤ 1.3× budget → ultralite` band upgraded Mali devices that were
 * already below the floor (e.g. 120 ms zeros → ultralite → live ~8 FPS).
 */
export declare function profileFromWarmupMedianMs(medianMs: number | null, minTargetFps?: number): QualityProfileId;
export declare function estimatedFpsFromMedianMs(medianMs: number | null): number | null;
