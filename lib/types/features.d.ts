/**
 * Host-selectable tracking features — SDK port of the PoseTracker WebView
 * query params (`/pose_tracker/tracking?angles=true&…`) with the SAME plan
 * gating and the SAME error messages as `TrackingAppV3`.
 *
 * Rules (mirroring the WebView product):
 * - Without an API key the SDK always runs keypoints-only (offline, free,
 *   no gating) — pose-only mode streams `keypoints` unconditionally.
 * - `angles`, `recommendations`, `progression` require a PAID plan
 *   (anything but `free`).
 * - `keypoints` DURING an exercise session requires a paid plan too
 *   (free may stream keypoints only in pose-only mode, i.e. no exercise).
 * - `blazepose` / `poseEngine` / `mediapipeModel` / `poseBackend` /
 *   `runInWorker` are NOT feature flags here — select BlazePose with
 *   `options.model = 'blazepose'` instead of `{ features: { blazepose: true } }`.
 */
import type { MinGrade } from './events';
export interface PoseTrackerFeatures {
    /**
     * Stream `angles` events during an exercise session. Default `false`
     * (WebView parity: `angles="false"`). Paid plans only.
     */
    angles?: boolean;
    /**
     * Stream `recommendations` events (form advice) during an exercise
     * session. Default `false`. Paid plans only.
     */
    recommendations?: boolean;
    /**
     * Stream `progression` events (0–100 within the rep) during an exercise
     * session. Default `false`. Paid plans only.
     */
    progression?: boolean;
    /**
     * Stream raw `keypoints` events DURING an exercise session. Default
     * `false` (WebView parity: free plans cannot combine keypoints with an
     * exercise). Outside a session (pose-only mode) keypoints always stream —
     * that is the SDK's free offline base and is never gated.
     */
    keypoints?: boolean;
    /**
     * Only count reps whose form grade is at or above this letter (`A` best).
     * WebView parity: `minGrade` query param (`A`…`D` only). Works on all
     * plans that can run the exercise.
     */
    minGrade?: MinGrade;
}
/** Feature keys after defaults are applied. */
export interface ResolvedFeatures {
    angles: boolean;
    recommendations: boolean;
    progression: boolean;
    keypoints: boolean;
    minGrade: MinGrade | null;
}
/** WebView-parity defaults: everything opt-in, like the query params. */
export declare const DEFAULT_FEATURES: ResolvedFeatures;
/** Free plan requested developer features (angles/recommendations/progression/keypoints+exercise). */
export declare const FREE_PLAN_FEATURES_MESSAGE = "You cannot use developer features. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)";
/** Missing/invalid API token when key-gated features are requested. */
export declare const INVALID_TOKEN_MESSAGE = "Invalid params. Please refer to the documentation and set token=YOUR API_KEY et exercise=A correct exercise. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)";
/** Reference movement and exercise are mutually exclusive (Phase 2 surface). */
export declare const COMBINED_REFERENCE_EXERCISE_MESSAGE = "You cannot combine reference & exercise. Please check the documentation.";
/** SDK-specific: the requested WebView feature does not exist in this SDK. */
export declare function featureNotSupportedMessage(key: string): string;
/**
 * Apply WebView-parity defaults and detect unsupported keys passed by
 * untyped JS hosts (e.g. `{ blazepose: true }`).
 */
export declare function resolveFeatures(input: PoseTrackerFeatures | undefined): {
    features: ResolvedFeatures;
    unsupportedKeys: string[];
};
/**
 * Which requested features a `free` plan is NOT allowed to use — exact port
 * of the TrackingAppV3 condition (keypoints only blocked when an exercise
 * is involved; pose-only keypoints stay free).
 */
export declare function freeBlockedFeatures(features: ResolvedFeatures, options: {
    withExercise: boolean;
}): string[];
/** True for every plan type except `free` (developer / company / custom). */
export declare function isPaidPlan(planType: string | null | undefined): boolean;
/**
 * Whether the live camera overlay should show the PoseTracker watermark.
 * Shown for keyless (null), `free`, and any non-paid plan. Hidden for paid
 * plans (`developer`, `company`, `enterprise`, custom, …) — same rule as
 * {@link isPaidPlan}.
 */
export declare function shouldShowWatermark(planType: string | null | undefined): boolean;
