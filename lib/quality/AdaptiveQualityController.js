"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdaptiveQualityController = void 0;
const configure_1 = require("../api/configure");
const EngineLoader_1 = require("../engine/EngineLoader");
const deviceCapability_1 = require("./deviceCapability");
const profiles_1 = require("./profiles");
const RuntimeGuard_1 = require("./RuntimeGuard");
const ACTIVE_KEY = 'posetracker.quality.active';
class AdaptiveQualityController {
    constructor(options = {}) {
        this.resolved = false;
        this.fpsWindow = [];
        this.lowFpsStreak = 0;
        this.lastWarningAtMs = null;
        this.downgradeInFlight = false;
        this.warmupEstimatedFps = null;
        this.warmupMedianMs = null;
        this.warmupApplied = false;
        /** Earliest time live low-FPS downgrades are allowed (settle after camera open/swap). */
        this.settleUntilMs = 0;
        this.choice = options.choice ?? 'AdaptiveChoice';
        this.capturePriority = options.capturePriority === 'quality' ? 'quality' : 'performance';
        this.kv =
            options.keyValueStore !== undefined
                ? options.keyValueStore
                : (0, EngineLoader_1.createAsyncKeyValueStore)();
        this.guard = new RuntimeGuard_1.RuntimeGuard(this.kv, configure_1.SDK_VERSION);
        this.onDiagnostic = options.onDiagnostic;
        this.onQualityChanged = options.onQualityChanged;
        this.onPerformanceWarning = options.onPerformanceWarning;
        this.applyProfile = options.applyProfile;
        this.capability = (0, deviceCapability_1.scoreDeviceCapability)();
        this.activeProfile =
            this.choice === 'AdaptiveChoice'
                ? this.capturePriority === 'quality'
                    ? 'prime'
                    : this.capability.suggestedProfile
                : this.choice;
    }
    /** Host capture vs FPS trade-off. */
    getCapturePriority() {
        return this.capturePriority;
    }
    prefersCaptureQuality() {
        return this.capturePriority === 'quality';
    }
    setApplyProfile(fn) {
        this.applyProfile = fn;
    }
    getState() {
        const platform = (0, profiles_1.currentQualityPlatform)();
        const minTargetFps = (0, profiles_1.getMinTargetFps)(platform);
        return {
            choice: this.choice,
            capturePriority: this.capturePriority,
            activeProfile: this.activeProfile,
            profile: (0, profiles_1.getQualityProfile)(this.activeProfile),
            capability: this.capability,
            meanFps: this.meanFps(),
            warmupEstimatedFps: this.warmupEstimatedFps,
            warmupMedianMs: this.warmupMedianMs,
            lowFpsStreak: this.lowFpsStreak,
            lastWarningAtMs: this.lastWarningAtMs,
            minTargetFps,
            idealFpsRange: (0, profiles_1.getIdealFpsRange)(platform),
            targetFps: minTargetFps,
        };
    }
    /** Platform minimum target FPS (floor). */
    getMinTargetFps() {
        return (0, profiles_1.getMinTargetFps)((0, profiles_1.currentQualityPlatform)());
    }
    getActiveProfile() {
        return (0, profiles_1.getQualityProfile)(this.activeProfile);
    }
    /**
     * Resolve the profile to boot with. Call once before building WebView HTML.
     * Walks down the ladder past any FAILED / crash-PROBING keys.
     */
    async resolveInitialProfile() {
        if (this.resolved)
            return this.getActiveProfile();
        this.capability = (0, deviceCapability_1.scoreDeviceCapability)();
        let candidate = this.choice === 'AdaptiveChoice'
            ? this.capturePriority === 'quality'
                ? 'prime'
                : this.capability.suggestedProfile
            : this.choice;
        // capturePriority=quality: do not restore a low last-good (that would
        // defeat the host's request for sharp preview). Crash-guard still applies.
        if (this.choice === 'AdaptiveChoice' && this.kv && this.capturePriority !== 'quality') {
            try {
                const saved = await this.kv.getItem(ACTIVE_KEY);
                if (saved && (0, profiles_1.isQualityProfileId)(saved) && isAtMost(saved, candidate)) {
                    // Honor last-good only when it is at most one tier below the
                    // capability suggestion. A bigger gap is almost always a stale
                    // floor (e.g. iPhone score→pro stuck on ultralite after an old
                    // crash / bad session). Crash-guard FAILED marks still apply below.
                    const gap = (0, profiles_1.qualityLadderIndex)(saved) - (0, profiles_1.qualityLadderIndex)(candidate);
                    if (gap <= 1) {
                        candidate = saved;
                        this.onDiagnostic?.(`[posetracker] quality: restored last-good profile=${candidate}`);
                    }
                    else {
                        this.onDiagnostic?.(`[posetracker] quality: ignoring stale last-good=${saved} ` +
                            `(suggested=${candidate}, gap=${gap} tiers) — re-probing from capability`);
                    }
                }
            }
            catch {
                /* ignore */
            }
        }
        const suggested = candidate;
        let safety = 0;
        while (safety++ < 8) {
            const crashed = await this.guard.consumeCrashIfProbing(candidate);
            const failed = crashed || (await this.guard.isFailed(candidate));
            if (!failed)
                break;
            const lower = (0, profiles_1.nextLowerQualityProfile)(candidate);
            this.onDiagnostic?.(`[posetracker] quality: profile=${candidate} marked failed (crash-guard) → ` +
                (lower ?? 'none'));
            if (!lower)
                break;
            candidate = lower;
        }
        // Poisoned ladder: aborted getUserMedia races used to mark every tier
        // FAILED and pin the device on basic. If we dropped ≥2 tiers below the
        // capability suggestion, clear those marks and re-probe from suggested.
        const drop = (0, profiles_1.qualityLadderIndex)(candidate) - (0, profiles_1.qualityLadderIndex)(suggested);
        if (drop >= 2 && this.choice === 'AdaptiveChoice') {
            this.onDiagnostic?.(`[posetracker] quality: clearing poisoned crash-guard ` +
                `(${suggested}→${candidate}, drop=${drop}) — re-probing from ${suggested}`);
            let walk = suggested;
            while (walk) {
                await this.guard.clear(walk);
                if (walk === candidate)
                    break;
                walk = (0, profiles_1.nextLowerQualityProfile)(walk);
            }
            candidate = suggested;
        }
        this.activeProfile = candidate;
        this.resolved = true;
        const minTarget = this.getMinTargetFps();
        const band = (0, profiles_1.getIdealFpsRange)();
        this.onDiagnostic?.(`[posetracker] quality: initial profile=${candidate} ` +
            `minTargetFps=${minTarget} idealBand=${band.min}-${band.idealMax}+ ` +
            `choice=${this.choice} capturePriority=${this.capturePriority} ` +
            `score=${this.capability.score} ` +
            `reasons=[${this.capability.reasons.join('; ')}]`);
        return this.getActiveProfile();
    }
    /** Call immediately before the WebView page boots this profile. */
    async beginSession() {
        if (!this.resolved)
            await this.resolveInitialProfile();
        await this.guard.markProbing(this.activeProfile);
        this.onDiagnostic?.(`[posetracker] quality: guard PROBING profile=${this.activeProfile}`);
    }
    /**
     * Warm-up zeros bench result (before / around getUserMedia).
     * Picks the safer of (warmup median → profile) and (device capability).
     * May **upgrade** away from a stale last-good when the bench shows headroom
     * (e.g. 15 ms median on iPhone stuck on ultralite).
     */
    async onWarmupEstimate(options) {
        const med = options.medianInferenceMs;
        const est = (0, profiles_1.estimatedFpsFromMedianMs)(med);
        const minTarget = this.getMinTargetFps();
        this.warmupMedianMs = med;
        this.warmupEstimatedFps = est;
        if (options.glRenderer) {
            this.capability = (0, deviceCapability_1.scoreDeviceCapability)({ glRenderer: options.glRenderer });
        }
        const fromWarmup = (0, profiles_1.profileFromWarmupMedianMs)(med, minTarget);
        const fromGl = this.choice === 'AdaptiveChoice' ? this.capability.suggestedProfile : this.activeProfile;
        // Safer of bench vs capability — do NOT clamp to activeProfile/page
        // (that permanently froze devices on a stale ultralite last-good).
        let next = (0, profiles_1.lowerQualityProfile)(fromWarmup, fromGl);
        if (this.capturePriority === 'quality') {
            // Host opted out of FPS-driven capture cuts — keep / raise to prime.
            next = this.choice === 'AdaptiveChoice' ? 'prime' : this.activeProfile;
            this.onDiagnostic?.(`[posetracker] quality: capturePriority=quality — skipping FPS warm-up downgrade ` +
                `(est=${est != null ? est.toFixed(1) : '?'} fps); holding profile=${next}`);
        }
        else {
            // Never upgrade when zeros warm-up is already below the floor — camera
            // preprocess only adds cost (Mali: basic~10fps, ultralite upgrade~8fps).
            const belowFloor = est != null && est < minTarget;
            if (belowFloor && (0, profiles_1.qualityLadderIndex)(next) < (0, profiles_1.qualityLadderIndex)(this.activeProfile)) {
                this.onDiagnostic?.(`[posetracker] quality: warmup below floor (est=${est.toFixed(1)} < ${minTarget}) ` +
                    `— blocking upgrade ${this.activeProfile} → ${next}, staying ${this.activeProfile}`);
                next = this.activeProfile;
            }
        }
        const upgrading = (0, profiles_1.qualityLadderIndex)(next) < (0, profiles_1.qualityLadderIndex)(this.activeProfile);
        this.onDiagnostic?.(`[posetracker] quality: warmup medianMs=${med != null ? med.toFixed(1) : '?'} ` +
            `estimatedFps=${est != null ? est.toFixed(1) : '?'} ` +
            `minTarget=${minTarget} → profile=${next} (was ${this.activeProfile}` +
            `${upgrading ? ', upgrade' : ''})`);
        if (next !== this.activeProfile) {
            // Page posts warmup_estimate *before* getUserMedia and now opens at
            // fromWarmup. Never inject setQuality during that window — it aborts
            // the in-flight getUserMedia ("The operation was aborted") and fails init.
            // Sync RN state only; live setQuality remains for post-ready downgrades.
            const pageAlreadyApplied = options.pageSelectedProfile != null && options.pageSelectedProfile === next;
            const skipApply = pageAlreadyApplied || upgrading;
            const detail = upgrading
                ? `Warm-up estimated inference FPS ${est != null ? est.toFixed(1) : '?'} ` +
                    `(median ${med != null ? med.toFixed(1) : '?'} ms) has headroom above the ` +
                    `minimum target of ${minTarget} FPS. Upgrading camera profile ` +
                    `"${this.activeProfile}" → "${next}"` +
                    (skipApply ? ' (page will open / already selected — no mid-boot setQuality).' : '.')
                : `Warm-up estimated inference FPS ${est != null ? est.toFixed(1) : '?'} ` +
                    `(median ${med != null ? med.toFixed(1) : '?'} ms) is below the ` +
                    `platform minimum target of ${minTarget} FPS. Switching camera profile ` +
                    `to "${next}" before opening the webcam.`;
            if (upgrading) {
                // Drop stale FAILED marks for the tier we're recovering to.
                await this.guard.clear(next);
            }
            await this.downgradeTo(next, 'warmup_estimate', detail, {
                estimatedFps: est,
                medianInferenceMs: med,
                skipApply,
            });
        }
        else {
            this.warmupApplied = true;
            await this.guard.markPassed(this.activeProfile);
            await this.persistActive(this.activeProfile);
        }
    }
    /** Call when the WebView posts `ready`. */
    async onRuntimeReady(options) {
        // Prefer warm-up path; ready often carries the same medianMs.
        if (!this.warmupApplied && options?.medianInferenceMs != null) {
            await this.onWarmupEstimate({
                medianInferenceMs: options.medianInferenceMs,
                glRenderer: options.glRenderer,
                pageSelectedProfile: options.pageSelectedProfile,
            });
            return;
        }
        if (options?.glRenderer) {
            this.capability = (0, deviceCapability_1.scoreDeviceCapability)({ glRenderer: options.glRenderer });
            if (this.choice === 'AdaptiveChoice' &&
                isStrictlyLower(this.capability.suggestedProfile, this.activeProfile)) {
                await this.downgradeTo(this.capability.suggestedProfile, 'device_capability', 'GL renderer capability suggests a lower camera profile for stable FPS.');
                return;
            }
        }
        await this.guard.markPassed(this.activeProfile);
        await this.persistActive(this.activeProfile);
        this.settleUntilMs = Date.now() + profiles_1.QUALITY_SETTLE_MS;
        this.lowFpsStreak = 0;
        this.fpsWindow = [];
        this.onDiagnostic?.(`[posetracker] quality: guard PASSED profile=${this.activeProfile} ` +
            `(live downgrade settle ${profiles_1.QUALITY_SETTLE_MS}ms)`);
    }
    /** Feed 1 Hz WebView stats. May auto-downgrade and/or warn. */
    async onStats(sample) {
        if (!Number.isFinite(sample.fps) || sample.fps < 0)
            return;
        this.fpsWindow.push(sample.fps);
        if (this.fpsWindow.length > 10)
            this.fpsWindow.shift();
        const profile = this.getActiveProfile();
        const mean = this.meanFps();
        if (mean == null)
            return;
        const minTarget = this.getMinTargetFps();
        const critical = (0, profiles_1.getCriticalFpsThreshold)();
        const now = Date.now();
        // Pipeline FPS (rAF loop) is often well below 1000/medianMs because it
        // includes camera + bitmap. Downgrade on **inference median** only — e.g.
        // iPhone pro at fps=22 / medianMs=28 is healthy vs a 30 FPS floor (33 ms).
        const budgetMs = 1000 / minTarget;
        const med = sample.medianInferenceMs;
        const inferenceTooSlow = med != null && Number.isFinite(med) && med > budgetMs * 1.2;
        if (now < this.settleUntilMs) {
            this.lowFpsStreak = 0;
            return;
        }
        if (inferenceTooSlow) {
            this.lowFpsStreak += 1;
        }
        else {
            this.lowFpsStreak = 0;
        }
        // Warnings may still look at pipeline FPS (UX feel), but never after settle only.
        if (mean < critical || (mean < minTarget && !(0, profiles_1.nextLowerQualityProfile)(this.activeProfile))) {
            if (this.lastWarningAtMs == null || now - this.lastWarningAtMs > 30000) {
                this.lastWarningAtMs = now;
                const qualityNote = this.capturePriority === 'quality'
                    ? ' capturePriority is "quality" (sharp preview preferred over FPS) — this is expected on mid-range Android.'
                    : '';
                const event = {
                    type: 'performance_warning',
                    code: 'device_too_slow',
                    message: `This device appears unsuitable for real-time pose estimation with the ` +
                        `current configuration (mean pipeline FPS=${mean.toFixed(1)} < ` +
                        `minimum target ${minTarget} FPS` +
                        (med != null ? `, median inference ${med.toFixed(1)} ms` : '') +
                        `). User experience may be significantly impacted.` +
                        qualityNote,
                    meanFps: mean,
                    thresholdFps: minTarget,
                    activeProfile: this.activeProfile,
                    medianInferenceMs: sample.medianInferenceMs,
                    videoSize: sample.videoSize,
                    timestampMs: now,
                };
                this.onDiagnostic?.(`[posetracker] WARNING: ${event.message}`);
                this.onPerformanceWarning?.(event);
            }
        }
        if (this.capturePriority !== 'quality' &&
            this.lowFpsStreak >= profiles_1.LOW_FPS_STREAK_BEFORE_DOWNGRADE &&
            !this.downgradeInFlight) {
            const lower = (0, profiles_1.nextLowerQualityProfile)(this.activeProfile);
            if (lower) {
                await this.downgradeTo(lower, 'low_fps', `Median inference ${med != null ? med.toFixed(1) : '?'} ms stayed above the ` +
                    `budget of ${(budgetMs * 1.2).toFixed(0)} ms (min target ${minTarget} FPS) ` +
                    `for ${this.lowFpsStreak} samples on profile "${profile.id}". ` +
                    `Automatically switching to "${lower}".`, { estimatedFps: mean, medianInferenceMs: sample.medianInferenceMs });
            }
        }
        else if (this.capturePriority === 'quality' &&
            this.lowFpsStreak >= profiles_1.LOW_FPS_STREAK_BEFORE_DOWNGRADE) {
            if (this.lowFpsStreak === profiles_1.LOW_FPS_STREAK_BEFORE_DOWNGRADE) {
                this.onDiagnostic?.(`[posetracker] quality: capturePriority=quality — not downgrading from ` +
                    `"${profile.id}" despite slow median ${med != null ? med.toFixed(1) : '?'} ms`);
            }
        }
    }
    async downgradeTo(next, reason, detail, extras) {
        if (next === this.activeProfile || this.downgradeInFlight)
            return;
        this.downgradeInFlight = true;
        const previous = this.activeProfile;
        try {
            // Only crash_guard / hard capability caps poison a tier. Live low_fps
            // must NOT markFailed — that pinned iPhones on basic after a cascade.
            if (reason === 'crash_guard' || reason === 'device_capability') {
                await this.guard.markFailed(previous);
            }
            else if ((0, profiles_1.qualityLadderIndex)(next) < (0, profiles_1.qualityLadderIndex)(previous)) {
                await this.guard.clear(previous);
            }
            this.activeProfile = next;
            this.lowFpsStreak = 0;
            this.fpsWindow = [];
            this.warmupApplied = true;
            this.settleUntilMs = Date.now() + profiles_1.QUALITY_SETTLE_MS;
            await this.guard.markProbing(next);
            await this.persistActive(next);
            const profile = (0, profiles_1.getQualityProfile)(next);
            if (!extras?.skipApply) {
                this.applyProfile?.(profile);
            }
            const event = {
                type: 'quality_changed',
                previousProfile: previous,
                activeProfile: next,
                reason,
                detail,
                profile,
                estimatedFps: extras?.estimatedFps,
                medianInferenceMs: extras?.medianInferenceMs,
                timestampMs: Date.now(),
            };
            this.onDiagnostic?.(`[posetracker] quality: ${previous} → ${next} reason=${reason}` +
                (extras?.skipApply ? ' (page-applied)' : '') +
                ` — ${detail}`);
            this.onQualityChanged?.(event);
        }
        finally {
            this.downgradeInFlight = false;
        }
    }
    meanFps() {
        if (!this.fpsWindow.length)
            return null;
        const sum = this.fpsWindow.reduce((a, b) => a + b, 0);
        return sum / this.fpsWindow.length;
    }
    async persistActive(id) {
        if (!this.kv)
            return;
        try {
            await this.kv.setItem(ACTIVE_KEY, id);
        }
        catch {
            /* ignore */
        }
    }
}
exports.AdaptiveQualityController = AdaptiveQualityController;
/** True if `a` is equal or lower quality than `b`. */
function isAtMost(a, b) {
    return (0, profiles_1.qualityLadderIndex)(a) >= (0, profiles_1.qualityLadderIndex)(b) && (0, profiles_1.qualityLadderIndex)(a) >= 0;
}
function isStrictlyLower(a, b) {
    return (0, profiles_1.qualityLadderIndex)(a) > (0, profiles_1.qualityLadderIndex)(b);
}
