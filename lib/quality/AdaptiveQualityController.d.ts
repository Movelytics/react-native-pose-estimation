/**
 * Adaptive camera-quality controller (Sency AdaptiveChoice + RuntimeGuard).
 *
 * Uses a platform **minimum target FPS** (floor), not a single setpoint:
 *   - iOS: min 30 (acceptable band ~30–50+)
 *   - Android: min 15 (mid-range GPUs rarely match iOS)
 *
 * Flow:
 *  1. Resolve an initial profile from device capability + crash-loop guard.
 *  2. WebView benches MoveNet on zeros *before* opening the camera → estimated
 *     FPS. If estimate < min-target, drop capture profile then open webcam.
 *  3. Live 1 Hz stats: if mean FPS < min-target → downgrade again.
 *  4. Emit `performance_warning` when even `basic` cannot hold the floor.
 */
import { type KeyValueStore } from '../engine/EngineLoader';
import type { PerformanceWarningEvent, QualityChangedEvent } from '../types/events';
import { type DeviceCapabilitySnapshot } from './deviceCapability';
import { type FpsRange, type CapturePriority, type QualityChoice, type QualityProfile, type QualityProfileId } from './profiles';
export interface QualityStatsSample {
    fps: number;
    medianInferenceMs: number | null;
    videoSize?: string;
    backend?: string;
}
export interface AdaptiveQualityControllerOptions {
    /** Explicit override; default AdaptiveChoice. */
    choice?: QualityChoice;
    /**
     * `performance` (default) vs `quality` — see {@link CapturePriority}.
     * When `quality`, FPS-driven capture downgrades are skipped.
     */
    capturePriority?: CapturePriority;
    keyValueStore?: KeyValueStore | null;
    onDiagnostic?: (message: string) => void;
    onQualityChanged?: (event: QualityChangedEvent) => void;
    onPerformanceWarning?: (event: PerformanceWarningEvent) => void;
    /** Apply constraints to the live WebView (restart getUserMedia). */
    applyProfile?: (profile: QualityProfile) => void;
}
export interface QualityState {
    choice: QualityChoice;
    /** Host capture vs FPS trade-off (default `performance`). */
    capturePriority: CapturePriority;
    activeProfile: QualityProfileId;
    profile: QualityProfile;
    capability: DeviceCapabilitySnapshot;
    meanFps: number | null;
    /** Last warm-up estimate (1000/medianMs), before or at camera open. */
    warmupEstimatedFps: number | null;
    warmupMedianMs: number | null;
    lowFpsStreak: number;
    lastWarningAtMs: number | null;
    /** Platform floor (iOS 30 / Android 15) — not a setpoint. */
    minTargetFps: number;
    /** Soft “good experience” band for docs / host UI. */
    idealFpsRange: FpsRange;
    /** @deprecated Use {@link minTargetFps}. */
    targetFps: number;
}
export declare class AdaptiveQualityController {
    private readonly choice;
    private readonly capturePriority;
    private readonly kv;
    private readonly guard;
    private readonly onDiagnostic;
    private readonly onQualityChanged;
    private readonly onPerformanceWarning;
    private applyProfile;
    private capability;
    private activeProfile;
    private resolved;
    private fpsWindow;
    private lowFpsStreak;
    private lastWarningAtMs;
    private downgradeInFlight;
    private warmupEstimatedFps;
    private warmupMedianMs;
    private warmupApplied;
    /** Earliest time live low-FPS downgrades are allowed (settle after camera open/swap). */
    private settleUntilMs;
    constructor(options?: AdaptiveQualityControllerOptions);
    /** Host capture vs FPS trade-off. */
    getCapturePriority(): CapturePriority;
    prefersCaptureQuality(): boolean;
    setApplyProfile(fn: ((profile: QualityProfile) => void) | undefined): void;
    getState(): QualityState;
    /** Platform minimum target FPS (floor). */
    getMinTargetFps(): number;
    getActiveProfile(): QualityProfile;
    /**
     * Resolve the profile to boot with. Call once before building WebView HTML.
     * Walks down the ladder past any FAILED / crash-PROBING keys.
     */
    resolveInitialProfile(): Promise<QualityProfile>;
    /** Call immediately before the WebView page boots this profile. */
    beginSession(): Promise<void>;
    /**
     * Warm-up zeros bench result (before / around getUserMedia).
     * Picks the safer of (warmup median → profile) and (device capability).
     * May **upgrade** away from a stale last-good when the bench shows headroom
     * (e.g. 15 ms median on iPhone stuck on ultralite).
     */
    onWarmupEstimate(options: {
        medianInferenceMs: number | null;
        glRenderer?: string | null;
        /** Profile the HTML page already selected from the same estimate (sync). */
        pageSelectedProfile?: QualityProfileId | null;
    }): Promise<void>;
    /** Call when the WebView posts `ready`. */
    onRuntimeReady(options?: {
        glRenderer?: string | null;
        medianInferenceMs?: number | null;
        pageSelectedProfile?: QualityProfileId | null;
    }): Promise<void>;
    /** Feed 1 Hz WebView stats. May auto-downgrade and/or warn. */
    onStats(sample: QualityStatsSample): Promise<void>;
    private downgradeTo;
    private meanFps;
    private persistActive;
}
