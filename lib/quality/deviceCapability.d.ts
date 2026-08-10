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
import type { QualityProfileId } from './profiles';
export interface DeviceCapabilitySnapshot {
    platform: 'ios' | 'android' | 'other';
    /** Android API level or iOS major version when available. */
    osVersion: number | null;
    /** Total device RAM in GiB when a probe is available. */
    totalMemoryGiB: number | null;
    /** WebGL UNMASKED_RENDERER when known (after first WebView ready). */
    glRenderer: string | null;
    /** 0–100 composite score. */
    score: number;
    /** Profile suggested by the score (before crash-guard / caps). */
    suggestedProfile: QualityProfileId;
    reasons: string[];
}
export declare function isMaliRenderer(renderer: string | null | undefined): boolean;
/**
 * Map capability score → profile (before Mali / crash-guard caps).
 * Thresholds calibrated so mid-range Android (Mali-G52 era) lands on UltraLite.
 */
export declare function profileFromScore(score: number): QualityProfileId;
export declare function scoreDeviceCapability(options?: {
    glRenderer?: string | null;
}): DeviceCapabilitySnapshot;
