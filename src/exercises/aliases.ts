/**
 * V2 Strapi movement names → canonical V3 exercise keys.
 * Mirrors PoseTrackerFront/lib/v3/exercises/index.js `EXERCISE_ALIASES`.
 *
 * The RN SDK manifest still often ships legacy `face_*` ids from Strapi while
 * host apps / demos call V3 keys (`squat`, `push_up`, …).
 */

export const EXERCISE_ALIASES: Readonly<Record<string, string>> = {
  face_squat: 'squat',
  face_pushup: 'push_up',
  face_plank: 'plank',
  face_lunge: 'lunge',
  face_jumping_jack: 'jumping_jack',
  face_low_impact_jack: 'low_impact_jack',
  face_balance_leg: 'balance_leg',
  face_balance_leg_left: 'balance_leg_left',
  face_balance_leg_right: 'balance_leg_right',
  jump: 'air_time_jump',
};

/** Resolve a legacy or V3 id to the canonical V3 key. */
export function resolveExerciseName(name: string): string {
  return EXERCISE_ALIASES[name] ?? name;
}

/**
 * Pick the best matching exercise config for a requested id.
 * Tries exact id, then any legacy alias that maps to the same V3 key,
 * then any config whose id resolves to the same V3 key.
 */
export function findExerciseByIdOrAlias<T extends { id: string }>(
  exerciseId: string,
  exercises: readonly T[],
): T | undefined {
  const exact = exercises.find((e) => e.id === exerciseId);
  if (exact) return exact;

  const canonical = resolveExerciseName(exerciseId);
  const legacyIds = Object.entries(EXERCISE_ALIASES)
    .filter(([, v3]) => v3 === canonical)
    .map(([legacy]) => legacy);

  for (const legacy of legacyIds) {
    const hit = exercises.find((e) => e.id === legacy);
    if (hit) return hit;
  }

  return exercises.find((e) => resolveExerciseName(e.id) === canonical);
}
