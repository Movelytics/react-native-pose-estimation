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

const KEY_PREFIX = 'posetracker.quality.guard.';
/** Same-process: if still probing after this, treat as failed. */
const PROBING_TIMEOUT_MS = 30_000;

interface GuardRecord {
  state: GuardState;
  updatedAt: number;
  sdkVersion: string;
}

export class RuntimeGuard {
  private readonly memory = new Map<string, GuardRecord>();

  constructor(
    private readonly kv: KeyValueStore | null,
    private readonly sdkVersion: string,
  ) {}

  private storageKey(profileKey: string): string {
    return `${KEY_PREFIX}${this.sdkVersion}.${profileKey}`;
  }

  async getState(profileKey: string): Promise<GuardState> {
    const key = this.storageKey(profileKey);
    let record = this.memory.get(key) ?? null;
    if (!record && this.kv) {
      try {
        const raw = await this.kv.getItem(key);
        if (raw) record = JSON.parse(raw) as GuardRecord;
      } catch {
        record = null;
      }
    }
    if (!record) return 'unknown';

    if (
      record.state === 'probing' &&
      Date.now() - record.updatedAt > PROBING_TIMEOUT_MS
    ) {
      await this.write(profileKey, 'failed');
      return 'failed';
    }
    return record.state;
  }

  /**
   * If previous launch died while probing this key, mark failed and return true.
   */
  async consumeCrashIfProbing(profileKey: string): Promise<boolean> {
    const state = await this.getState(profileKey);
    if (state === 'probing') {
      await this.write(profileKey, 'failed');
      return true;
    }
    return false;
  }

  async markProbing(profileKey: string): Promise<void> {
    await this.write(profileKey, 'probing');
  }

  async markPassed(profileKey: string): Promise<void> {
    await this.write(profileKey, 'passed');
  }

  async markFailed(profileKey: string): Promise<void> {
    await this.write(profileKey, 'failed');
  }

  async isFailed(profileKey: string): Promise<boolean> {
    return (await this.getState(profileKey)) === 'failed';
  }

  /** Clear persisted/memory state for a profile (recover from stale FAILED). */
  async clear(profileKey: string): Promise<void> {
    const key = this.storageKey(profileKey);
    this.memory.delete(key);
    if (!this.kv) return;
    try {
      await this.kv.removeItem(key);
    } catch {
      /* best-effort */
    }
  }

  private async write(profileKey: string, state: GuardState): Promise<void> {
    const key = this.storageKey(profileKey);
    const record: GuardRecord = {
      state,
      updatedAt: Date.now(),
      sdkVersion: this.sdkVersion,
    };
    this.memory.set(key, record);
    if (!this.kv) return;
    try {
      await this.kv.setItem(key, JSON.stringify(record));
    } catch {
      /* persistence best-effort */
    }
  }
}
