/** Opt-in remote engine channel. Default is production V3. */
export type EngineChannel = 'v3' | 'v4';
/** Movements that exist only in the V4 catalog (not in V3 FSM / Strapi). */
export declare const V4_ONLY_EXERCISE_IDS: readonly ["shoulder_roll", "shoulder_deep_breath", "chair_forward_fold"];
export declare function normalizeEngineChannel(raw?: string | null): EngineChannel;
export declare function requiresEngineV4(exerciseId: string): boolean;
