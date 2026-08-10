"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuntimeGuard = void 0;
const KEY_PREFIX = 'posetracker.quality.guard.';
/** Same-process: if still probing after this, treat as failed. */
const PROBING_TIMEOUT_MS = 30000;
class RuntimeGuard {
    constructor(kv, sdkVersion) {
        this.kv = kv;
        this.sdkVersion = sdkVersion;
        this.memory = new Map();
    }
    storageKey(profileKey) {
        return `${KEY_PREFIX}${this.sdkVersion}.${profileKey}`;
    }
    async getState(profileKey) {
        const key = this.storageKey(profileKey);
        let record = this.memory.get(key) ?? null;
        if (!record && this.kv) {
            try {
                const raw = await this.kv.getItem(key);
                if (raw)
                    record = JSON.parse(raw);
            }
            catch {
                record = null;
            }
        }
        if (!record)
            return 'unknown';
        if (record.state === 'probing' &&
            Date.now() - record.updatedAt > PROBING_TIMEOUT_MS) {
            await this.write(profileKey, 'failed');
            return 'failed';
        }
        return record.state;
    }
    /**
     * If previous launch died while probing this key, mark failed and return true.
     */
    async consumeCrashIfProbing(profileKey) {
        const state = await this.getState(profileKey);
        if (state === 'probing') {
            await this.write(profileKey, 'failed');
            return true;
        }
        return false;
    }
    async markProbing(profileKey) {
        await this.write(profileKey, 'probing');
    }
    async markPassed(profileKey) {
        await this.write(profileKey, 'passed');
    }
    async markFailed(profileKey) {
        await this.write(profileKey, 'failed');
    }
    async isFailed(profileKey) {
        return (await this.getState(profileKey)) === 'failed';
    }
    /** Clear persisted/memory state for a profile (recover from stale FAILED). */
    async clear(profileKey) {
        const key = this.storageKey(profileKey);
        this.memory.delete(key);
        if (!this.kv)
            return;
        try {
            await this.kv.removeItem(key);
        }
        catch {
            /* best-effort */
        }
    }
    async write(profileKey, state) {
        const key = this.storageKey(profileKey);
        const record = {
            state,
            updatedAt: Date.now(),
            sdkVersion: this.sdkVersion,
        };
        this.memory.set(key, record);
        if (!this.kv)
            return;
        try {
            await this.kv.setItem(key, JSON.stringify(record));
        }
        catch {
            /* persistence best-effort */
        }
    }
}
exports.RuntimeGuard = RuntimeGuard;
