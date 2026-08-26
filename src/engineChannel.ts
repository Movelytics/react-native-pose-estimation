/** Opt-in remote engine channel. Default is production V3. */
export type EngineChannel = 'v3' | 'v4';

/** Movements that exist only in the V4 catalog (not in V3 FSM / Strapi). */
export const V4_ONLY_EXERCISE_IDS = [
  'shoulder_roll',
  'shoulder_deep_breath',
  'chair_forward_fold',
] as const;

export function normalizeEngineChannel(raw?: string | null): EngineChannel {
  return raw === 'v4' ? 'v4' : 'v3';
}

export function requiresEngineV4(exerciseId: string): boolean {
  return (V4_ONLY_EXERCISE_IDS as readonly string[]).includes(exerciseId);
}
