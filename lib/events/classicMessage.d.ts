/**
 * Classic PoseTracker WebView → native message parity.
 *
 * Host apps that already parse `sendDataToNative` JSON
 * (`PoseTrackerFront/lib/v3/sendDataToNativeContract.js`) can subscribe via
 * `addMessageListener` / `usePoseTracker({ onMessage })` and keep the same
 * `type` + payload field names (`data`, `current_count`, `message`, …).
 *
 * Typed {@link PoseTrackerEvent} remains the preferred API for new apps.
 */
import type { AngleValue, PoseTrackerEvent } from '../types/events';
/** Loose JSON envelope matching the frozen WebView → native contract. */
export type ClassicNativeMessage = {
    type: string;
    [key: string]: unknown;
};
export type ClassicMessageListener = (message: ClassicNativeMessage) => void;
/**
 * Rebuild the WebView `angles.data` tree (`left_side` / `right_side`) from
 * the typed flat `AngleValue[]` list.
 */
export declare function anglesToClassicTree(angles: AngleValue[]): {
    left_side: Record<string, Record<string, number>>;
    right_side: Record<string, Record<string, number>>;
};
/**
 * Map a typed SDK event to a classic PoseTracker `sendDataToNative` payload.
 * Returns null for SDK-only events that have no classic equivalent and should
 * not be mirrored (e.g. `engine_debug` QA snapshots).
 */
export declare function toClassicNativeMessage(event: PoseTrackerEvent): ClassicNativeMessage | null;
