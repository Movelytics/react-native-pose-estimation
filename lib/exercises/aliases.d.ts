/**
 * V2 Strapi movement names → canonical V3 exercise keys.
 * Mirrors PoseTrackerFront/lib/v3/exercises/index.js `EXERCISE_ALIASES`.
 *
 * The RN SDK manifest still often ships legacy `face_*` ids from Strapi while
 * host apps / demos call V3 keys (`squat`, `push_up`, …).
 */
export declare const EXERCISE_ALIASES: Readonly<Record<string, string>>;
/** Resolve a legacy or V3 id to the canonical V3 key. */
export declare function resolveExerciseName(name: string): string;
/**
 * Pick the best matching exercise config for a requested id.
 * Tries exact id, then any legacy alias that maps to the same V3 key,
 * then any config whose id resolves to the same V3 key.
 */
export declare function findExerciseByIdOrAlias<T extends {
    id: string;
}>(exerciseId: string, exercises: readonly T[]): T | undefined;
