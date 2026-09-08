/**
 * Engine channel + production squat lock.
 *
 * Default handshake is V4 except unlabeled squat / face_squat (V3 FSM).
 * Explicit `engine: 'v4'` is the only way to run the V4 catalog squat.
 * Explicit `engine: 'v3'` keeps the full V3 bundle.
 * See engine/v4/catalog/SQUAT_PRODUCTION.md
 */
export type EngineChannel = 'v3' | 'v4';
/** Wellness ids with no V3 FSM. */
export declare const V4_ONLY_EXERCISE_IDS: readonly ["shoulder_roll", "shoulder_deep_breath", "chair_forward_fold", "chair_side_stretch"];
/** Existing jump handlers — not V4 JSON. */
export declare const JUMP_EXERCISE_IDS: readonly ["jump_analysis", "air_time_jump"];
export declare const PRODUCTION_SQUAT_IDS: readonly ["squat", "face_squat"];
export declare function isProductionSquatId(exerciseId?: string | null): boolean;
/** Handshake default is V4. Pass `'v3'` to force the V3 bundle. */
export declare function normalizeEngineChannel(raw?: string | null): EngineChannel;
/**
 * Session interpreter for this id. Production squat stays V3 unless `engine`
 * is explicitly `'v4'`. Other ids follow the handshake (default V4).
 */
export declare function resolveMovementEngine(opts?: {
    engine?: string | null;
    exercise?: string | null;
    userExercise?: boolean;
}): EngineChannel;
export declare function requiresEngineV4(exerciseId: string): boolean;
export declare function isJumpExercise(exerciseId: string): boolean;
