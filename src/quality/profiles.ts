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

import { Platform } from 'react-native';

import { ANDROID_MIN_TARGET_FPS } from './captureMode';

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
export const QUALITY_LADDER: readonly QualityProfileId[] = [
  'prime',
  'pro',
  'lite',
  'ultralite',
  'basic',
] as const;

/**
 * Android minimum acceptable inference FPS (floor).
 * Sourced from {@link ANDROID_MIN_TARGET_FPS} so the experiment flag is the
 * single knob (see captureMode.ts).
 */
export const MIN_TARGET_FPS_ANDROID = ANDROID_MIN_TARGET_FPS;

/**
 * iOS minimum acceptable inference FPS (floor).
 * Acceptable/ideal experience is typically 30–50+ on Apple GPU.
 */
export const MIN_TARGET_FPS_IOS = 30;

/** Fallback floor for unknown platforms. */
export const MIN_TARGET_FPS_DEFAULT = MIN_TARGET_FPS_ANDROID;

/**
 * Documented “good experience” bands (not hard caps).
 * Downgrades / warnings use the **min** only.
 */
export const IDEAL_FPS_RANGE_IOS: FpsRange = { min: MIN_TARGET_FPS_IOS, idealMax: 50 };
export const IDEAL_FPS_RANGE_ANDROID: FpsRange = { min: MIN_TARGET_FPS_ANDROID, idealMax: 30 };

/**
 * @deprecated Use {@link getMinTargetFps} / {@link MIN_TARGET_FPS_ANDROID}.
 * Kept as the Android floor so older imports keep a sensible number.
 */
export const TARGET_FPS = MIN_TARGET_FPS_ANDROID;

/** @deprecated Use {@link minMedianMsForMinTarget}. */
export const TARGET_MEDIAN_MS = 1000 / MIN_TARGET_FPS_ANDROID;

/**
 * Critical alert when FPS stays well below the platform minimum target
 * (even on `basic`). Android: &lt;10; iOS: &lt;20.
 */
export function getCriticalFpsThreshold(platform: QualityPlatform = currentQualityPlatform()): number {
  if (platform === 'ios') return 20;
  return 10;
}

/** @deprecated Prefer {@link getCriticalFpsThreshold}. */
export const CRITICAL_FPS_THRESHOLD = 10;

/** Consecutive samples below min-target before auto-downgrade. */
/** Sustained samples below the inference budget before a live downgrade. */
export const LOW_FPS_STREAK_BEFORE_DOWNGRADE = 4;

/**
 * Ignore live downgrade decisions for this long after ready / a quality swap
 * (camera restart tanks the first 1 Hz stats samples).
 */
export const QUALITY_SETTLE_MS = 5_000;

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  prime: {
    id: 'prime',
    label: 'Prime (1280×720 @30)',
    idealWidth: 1280,
    idealHeight: 720,
    idealFrameRate: 30,
    minStableFps: MIN_TARGET_FPS_ANDROID,
  },
  pro: {
    id: 'pro',
    label: 'Pro (960×540 @30)',
    idealWidth: 960,
    idealHeight: 540,
    idealFrameRate: 30,
    minStableFps: MIN_TARGET_FPS_ANDROID,
  },
  lite: {
    id: 'lite',
    label: 'Lite (640×480 @30)',
    idealWidth: 640,
    idealHeight: 480,
    idealFrameRate: 30,
    minStableFps: MIN_TARGET_FPS_ANDROID,
  },
  ultralite: {
    id: 'ultralite',
    label: 'UltraLite (480×360 @24)',
    idealWidth: 480,
    idealHeight: 360,
    idealFrameRate: 24,
    minStableFps: MIN_TARGET_FPS_ANDROID,
  },
  basic: {
    id: 'basic',
    label: 'Basic (320×240 @20)',
    idealWidth: 320,
    idealHeight: 240,
    idealFrameRate: 20,
    minStableFps: MIN_TARGET_FPS_ANDROID,
  },
};

export function currentQualityPlatform(): QualityPlatform {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'other';
}

/** Platform minimum target FPS (floor — not a setpoint). */
export function getMinTargetFps(platform: QualityPlatform = currentQualityPlatform()): number {
  if (platform === 'ios') return MIN_TARGET_FPS_IOS;
  if (platform === 'android') return ANDROID_MIN_TARGET_FPS;
  return MIN_TARGET_FPS_DEFAULT;
}

export function getIdealFpsRange(platform: QualityPlatform = currentQualityPlatform()): FpsRange {
  if (platform === 'ios') return IDEAL_FPS_RANGE_IOS;
  if (platform === 'android') return IDEAL_FPS_RANGE_ANDROID;
  return { min: MIN_TARGET_FPS_DEFAULT, idealMax: 30 };
}

/** Max warm-up median ms that still meets a given min-target FPS. */
export function minMedianMsForMinTarget(minTargetFps: number): number {
  return 1000 / minTargetFps;
}

export function getQualityProfile(id: QualityProfileId): QualityProfile {
  return QUALITY_PROFILES[id];
}

export function nextLowerQualityProfile(id: QualityProfileId): QualityProfileId | null {
  const idx = QUALITY_LADDER.indexOf(id);
  if (idx < 0 || idx >= QUALITY_LADDER.length - 1) return null;
  return QUALITY_LADDER[idx + 1]!;
}

export function isQualityProfileId(value: string): value is QualityProfileId {
  return Object.prototype.hasOwnProperty.call(QUALITY_PROFILES, value);
}

export function qualityLadderIndex(id: QualityProfileId): number {
  return QUALITY_LADDER.indexOf(id);
}

/** Lower or equal quality (higher index) wins. */
export function lowerQualityProfile(
  a: QualityProfileId,
  b: QualityProfileId,
): QualityProfileId {
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
export function profileFromWarmupMedianMs(
  medianMs: number | null,
  minTargetFps: number = getMinTargetFps(),
): QualityProfileId {
  if (medianMs == null || !Number.isFinite(medianMs)) return 'basic';
  const budget = minMedianMsForMinTarget(minTargetFps);
  // Over the floor on zeros alone → basic only (camera adds more cost).
  if (medianMs > budget) return 'basic';
  // At / under the floor with headroom → higher capture ok
  if (medianMs <= budget * 0.6) return 'prime';
  if (medianMs <= budget * 0.75) return 'pro';
  if (medianMs <= budget * 0.9) return 'lite';
  return 'ultralite';
}

export function estimatedFpsFromMedianMs(medianMs: number | null): number | null {
  if (medianMs == null || !Number.isFinite(medianMs) || medianMs <= 0) return null;
  return 1000 / medianMs;
}
