/**
 * Contract between the SDK shell and the engine (business logic: angles,
 * rep counting, form scoring, posture, progression, recommendations).
 *
 * The engine is EXCLUSIVELY distributed remotely as a versioned JS bundle
 * (signed URL in the handshake manifest, SHA-256 integrity check, sealed
 * local cache) — the npm package ships zero business logic. Without a
 * loaded engine the SDK runs in keypoints-only mode.
 */
import type { Pose } from '../types/pose';
import type { MinGrade, PoseTrackerEvent } from '../types/events';
import type { ExerciseConfig } from '../types/manifest';
/**
 * Feature flags forwarded to the engine session (WebView query-param
 * parity). The client already filters emissions by plan/flags; passing
 * them to the engine is a second gate AND lets the engine skip work.
 */
export interface EngineSessionFeatures {
    angles?: boolean;
    recommendations?: boolean;
    progression?: boolean;
}
export interface EngineSessionOptions {
    exercise: ExerciseConfig;
    /** Locale used to resolve localized hints/recommendations. */
    locale: string;
    /** Difficulty key into the movement `scale_acceptance` maps. Default: 'medium'. */
    difficulty?: string;
    /** Parsed reference-movement signature, when comparing against a reference. */
    referenceSignature?: unknown;
    /**
     * Only count reps whose form grade is at or above this letter (`A` best).
     * WebView `minGrade` parity: reps below the bar emit neither `counter`
     * nor `form_score` and are excluded from the summary.
     */
    minGrade?: MinGrade;
    /** Emission flags — engines older than 1.1.0 ignore them (client re-filters). */
    features?: EngineSessionFeatures;
}
export interface EngineSession {
    /** Feed one estimated pose; the session emits events through the sink. */
    processPose(pose: Pose): void;
    /** Finish the session; emits a final `exercise_summary` event. */
    end(): void;
}
/**
 * Custom (non-FSM) exercise shipped inside the engine bundle, e.g. the jump
 * analysis handlers (WebView `customHandlers.js` parity). Not present in the
 * Strapi movement manifest — discovered via `listCustomExercises()`.
 */
export interface CustomExerciseDescriptor {
    /** Exercise id used with `startExercise()` (e.g. 'jump_analysis'). */
    id: string;
    displayName: string;
    type: 'custom';
    description?: string;
    /** Option keys that MUST be passed to `startExercise` (e.g. 'userHeightCm'). */
    requiredParams: string[];
    optionalParams: string[];
}
/** Options for engine custom sessions (jump_analysis / air_time_jump). */
export interface CustomSessionOptions {
    exerciseId: string;
    locale: string;
    /** Athlete height in cm — required by jump_analysis (cm/pixel calibration). */
    userHeightCm?: number;
    /** Device pitch in degrees, used to compensate camera tilt. */
    devicePitchDeg?: number;
}
export type EventSink = (event: PoseTrackerEvent) => void;
export interface PoseTrackerEngine {
    readonly version: string;
    createSession(options: EngineSessionOptions, emit: EventSink): EngineSession;
    /** Engine >= 1.2.0: custom exercises shipped in the bundle (jump analysis…). */
    listCustomExercises?(): CustomExerciseDescriptor[];
    /** Engine >= 1.2.0: start a custom exercise session (placement + jump_* events). */
    createCustomSession?(options: CustomSessionOptions, emit: EventSink): EngineSession;
}
/** What an engine bundle's `module.exports` must expose. */
export interface EngineModuleExports {
    createEngine(): PoseTrackerEngine;
}
export type EngineFactory = () => PoseTrackerEngine;
