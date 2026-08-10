/**
 * Crash-loop guard for quality / runtime profiles.
 *
 * Analog of Sency's `TfliteRuntimeGuard` (PROBING → PASSED | FAILED):
 *   1. Before activating a profile, `markProbing(key)`.
 *   2. After a healthy ready signal, `markPassed(key)`.
 *   3. If the app is killed/crashes while still PROBING, the next launch
 *      sees PROBING → treats it as FAILED → caller must pick a lower profile.
 *
 * Persisted via {@link KeyValueStore} (AsyncStorage when available). Without
 * a store the guard is in-memory only (still useful within one process for
 * the 30s same-process timeout).
 */
import type { KeyValueStore } from '../engine/EngineLoader';
export type GuardState = 'unknown' | 'probing' | 'passed' | 'failed';
export declare class RuntimeGuard {
    private readonly kv;
    private readonly sdkVersion;
    private readonly memory;
    constructor(kv: KeyValueStore | null, sdkVersion: string);
    private storageKey;
    getState(profileKey: string): Promise<GuardState>;
    /**
     * If previous launch died while probing this key, mark failed and return true.
     */
    consumeCrashIfProbing(profileKey: string): Promise<boolean>;
    markProbing(profileKey: string): Promise<void>;
    markPassed(profileKey: string): Promise<void>;
    markFailed(profileKey: string): Promise<void>;
    isFailed(profileKey: string): Promise<boolean>;
    /** Clear persisted/memory state for a profile (recover from stale FAILED). */
    clear(profileKey: string): Promise<void>;
    private write;
}
