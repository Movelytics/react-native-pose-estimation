"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageTracker = exports.TrackError = void 0;
const react_native_1 = require("react-native");
const configure_1 = require("./configure");
const EngineLoader_1 = require("../engine/EngineLoader");
const QUEUE_KEY = 'posetracker.track.queue';
const QUEUE_LIMIT = 100;
class TrackError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TrackError';
    }
}
exports.TrackError = TrackError;
class UsageTracker {
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl ?? configure_1.DEFAULT_BASE_URL).replace(/\/$/, '');
        this.kv =
            options.keyValueStore !== undefined ? options.keyValueStore : (0, EngineLoader_1.createAsyncKeyValueStore)();
        this.fetchFn = options.fetchFn ?? fetch;
    }
    /**
     * Metered track (API key): throws on failure — the caller refuses to start
     * a metered session it cannot count.
     */
    async trackMetered(request) {
        return this.post({
            event: request.event ?? 'camera_start',
            apiToken: request.apiToken,
            platform: react_native_1.Platform.OS,
            sdkVersion: configure_1.SDK_VERSION,
            params: request.params,
        });
    }
    /**
     * Anonymous track (no key): never throws. Failed sends are queued locally
     * and flushed on the next connection.
     */
    async trackAnonymous(request = {}) {
        const payload = {
            event: request.event ?? 'camera_start',
            platform: react_native_1.Platform.OS,
            sdkVersion: configure_1.SDK_VERSION,
            params: request.params,
            queuedAtMs: Date.now(),
        };
        try {
            await this.post({ ...payload });
            // A send just worked: opportunistically drain older queued events.
            void this.flushQueue();
        }
        catch {
            await this.enqueue(payload);
        }
    }
    /** Send queued anonymous events (called on preload and after online sends). */
    async flushQueue() {
        const queue = await this.readQueue();
        if (queue.length === 0) {
            return;
        }
        const remaining = [];
        for (const item of queue) {
            try {
                await this.post({ ...item, params: { ...(item.params ?? {}), queuedAtMs: item.queuedAtMs } });
            }
            catch {
                remaining.push(item);
            }
        }
        await this.writeQueue(remaining);
    }
    // -------------------------------------------------------------------------
    async post(body) {
        let response;
        try {
            response = await this.fetchFn(`${this.baseUrl}/api/sdk/track`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }
        catch (err) {
            throw new TrackError('network', `Usage tracking request failed: ${String(err)}`);
        }
        if (response.status === 401 || response.status === 403) {
            throw new TrackError('invalid_token', 'Invalid, revoked or unauthorized API token.');
        }
        if (response.status === 429) {
            throw new TrackError('quota_exceeded', 'API call quota exceeded for the current plan.');
        }
        if (!response.ok) {
            throw new TrackError('internal', `Usage tracking failed with HTTP ${response.status}.`);
        }
        return (await response.json());
    }
    async readQueue() {
        try {
            const raw = await this.kv?.getItem(QUEUE_KEY);
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    async writeQueue(queue) {
        try {
            if (queue.length === 0) {
                await this.kv?.removeItem(QUEUE_KEY);
            }
            else {
                await this.kv?.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-QUEUE_LIMIT)));
            }
        }
        catch {
            // Queue persistence is best-effort.
        }
    }
    async enqueue(item) {
        const queue = await this.readQueue();
        queue.push(item);
        await this.writeQueue(queue);
    }
}
exports.UsageTracker = UsageTracker;
