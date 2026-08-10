/**
 * Usage tracking client — `POST /api/sdk/track`.
 *
 * One call per real usage: when the camera starts with the model ready
 * (`camera_start`), NOT on handshake and NOT on preload. Server-side, a
 * valid API key increments the same usage counters as the WebView API
 * (quota-checked) and inserts a `sdk-usage-event` row with the params;
 * keyless calls insert an anonymous row.
 *
 * Delivery rules (see ARCHITECTURE.md §Offline):
 * - metered (with API key): the track call MUST succeed online — offline
 *   metered sessions are refused because usage cannot be counted;
 * - anonymous (no key): fire-and-forget with a local retry queue, flushed
 *   on the next connection.
 */
import { type KeyValueStore } from '../engine/EngineLoader';
export declare class TrackError extends Error {
    readonly code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal';
    constructor(code: 'invalid_token' | 'quota_exceeded' | 'network' | 'internal', message: string);
}
export interface TrackRequest {
    event?: string;
    apiToken?: string | null;
    params?: Record<string, unknown>;
}
export interface TrackResponse {
    tracked: boolean;
    anonymous?: boolean;
    monthly_usage_counter?: number;
    remainingCalls?: number;
    type?: string;
}
export interface UsageTrackerOptions {
    baseUrl?: string;
    keyValueStore?: KeyValueStore | null;
    fetchFn?: typeof fetch;
}
export declare class UsageTracker {
    private readonly baseUrl;
    private readonly kv;
    private readonly fetchFn;
    constructor(options?: UsageTrackerOptions);
    /**
     * Metered track (API key): throws on failure — the caller refuses to start
     * a metered session it cannot count.
     */
    trackMetered(request: TrackRequest & {
        apiToken: string;
    }): Promise<TrackResponse>;
    /**
     * Anonymous track (no key): never throws. Failed sends are queued locally
     * and flushed on the next connection.
     */
    trackAnonymous(request?: TrackRequest): Promise<void>;
    /** Send queued anonymous events (called on preload and after online sends). */
    flushQueue(): Promise<void>;
    private post;
    private readQueue;
    private writeQueue;
    private enqueue;
}
