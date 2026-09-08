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
export const V4_ONLY_EXERCISE_IDS = [
  'shoulder_roll',
  'shoulder_deep_breath',
  'chair_forward_fold',
  'chair_side_stretch',
] as const;

/** Existing jump handlers — not V4 JSON. */
export const JUMP_EXERCISE_IDS = ['jump_analysis', 'air_time_jump'] as const;

export const PRODUCTION_SQUAT_IDS = ['squat', 'face_squat'] as const;

export function isProductionSquatId(exerciseId?: string | null): boolean {
  const id = String(exerciseId || '')
    .trim()
    .toLowerCase();
  return id === 'squat' || id === 'face_squat';
}

/** Handshake default is V4. Pass `'v3'` to force the V3 bundle. */
export function normalizeEngineChannel(raw?: string | null): EngineChannel {
  return raw === 'v3' ? 'v3' : 'v4';
}

/**
 * Session interpreter for this id. Production squat stays V3 unless `engine`
 * is explicitly `'v4'`. Other ids follow the handshake (default V4).
 */
export function resolveMovementEngine(opts: {
  engine?: string | null;
  exercise?: string | null;
  userExercise?: boolean;
} = {}): EngineChannel {
  if (opts.userExercise) return 'v4';
  const requested = String(opts.engine || '')
    .trim()
    .toLowerCase();
  if (isProductionSquatId(opts.exercise) && requested !== 'v4') return 'v3';
  return normalizeEngineChannel(opts.engine);
}

export function requiresEngineV4(exerciseId: string): boolean {
  return (V4_ONLY_EXERCISE_IDS as readonly string[]).includes(exerciseId);
}

export function isJumpExercise(exerciseId: string): boolean {
  return (JUMP_EXERCISE_IDS as readonly string[]).includes(exerciseId);
}
