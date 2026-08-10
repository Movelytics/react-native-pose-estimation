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
 *   `runInWorker` are NOT part of this SDK (MoveNet Lightning only) and are
 *   rejected with a clear error.
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
export const DEFAULT_FEATURES: ResolvedFeatures = {
  angles: false,
  recommendations: false,
  progression: false,
  keypoints: false,
  minGrade: null,
};

const KNOWN_FEATURE_KEYS = new Set<string>([
  'angles',
  'recommendations',
  'progression',
  'keypoints',
  'minGrade',
]);

/**
 * WebView params that this SDK deliberately does NOT ship (one SDK, one
 * model: MoveNet Lightning). Passing them (possible from untyped JS hosts)
 * produces a clear `feature_not_supported` error.
 */
const UNSUPPORTED_FEATURE_HINTS: Record<string, string> = {
  blazepose: 'BlazePose',
  poseEngine: 'pose engine selection (MediaPipe/PoseLandmarker)',
  mediapipeModel: 'MediaPipe model selection',
  poseBackend: 'pose backend selection',
  runInWorker: 'worker thread selection',
};

// ---------------------------------------------------------------------------
// Error messages — EXACT copies of PoseTrackerFront/components/v3/TrackingAppV3.js
// so hosts migrating from the WebView see identical strings.
// ---------------------------------------------------------------------------

/** Free plan requested developer features (angles/recommendations/progression/keypoints+exercise). */
export const FREE_PLAN_FEATURES_MESSAGE =
  'You cannot use developer features. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)';

/** Missing/invalid API token when key-gated features are requested. */
export const INVALID_TOKEN_MESSAGE =
  'Invalid params. Please refer to the documentation and set token=YOUR API_KEY et exercise=A correct exercise. (visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)';

/** Reference movement and exercise are mutually exclusive (Phase 2 surface). */
export const COMBINED_REFERENCE_EXERCISE_MESSAGE =
  'You cannot combine reference & exercise. Please check the documentation.';

/** SDK-specific: the requested WebView feature does not exist in this SDK. */
export function featureNotSupportedMessage(key: string): string {
  const hint = UNSUPPORTED_FEATURE_HINTS[key] ?? `'${key}'`;
  return (
    `The '${key}' option (${hint}) is not available in this SDK. ` +
    'This SDK ships MoveNet Lightning only — pose engine and model cannot be changed. ' +
    'Remove the option, or use the PoseTracker WebView product if you need it. ' +
    '(visit: https://posetracker.gitbook.io/posetracker-api/tracking-endpoint)'
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply WebView-parity defaults and detect unsupported keys passed by
 * untyped JS hosts (e.g. `{ blazepose: true }`).
 */
export function resolveFeatures(input: PoseTrackerFeatures | undefined): {
  features: ResolvedFeatures;
  unsupportedKeys: string[];
} {
  if (!input) {
    return { features: { ...DEFAULT_FEATURES }, unsupportedKeys: [] };
  }
  const unsupportedKeys = Object.keys(input).filter((k) => !KNOWN_FEATURE_KEYS.has(k));
  return {
    features: {
      angles: input.angles === true,
      recommendations: input.recommendations === true,
      progression: input.progression === true,
      keypoints: input.keypoints === true,
      minGrade: input.minGrade ?? null,
    },
    unsupportedKeys,
  };
}

/**
 * Which requested features a `free` plan is NOT allowed to use — exact port
 * of the TrackingAppV3 condition (keypoints only blocked when an exercise
 * is involved; pose-only keypoints stay free).
 */
export function freeBlockedFeatures(
  features: ResolvedFeatures,
  options: { withExercise: boolean },
): string[] {
  const blocked: string[] = [];
  if (features.angles) blocked.push('angles');
  if (features.recommendations) blocked.push('recommendations');
  if (features.progression) blocked.push('progression');
  if (features.keypoints && options.withExercise) blocked.push('keypoints');
  return blocked;
}

/** True for every plan type except `free` (developer / company / custom). */
export function isPaidPlan(planType: string | null | undefined): boolean {
  return typeof planType === 'string' && planType.length > 0 && planType !== 'free';
}

/**
 * Whether the live camera overlay should show the PoseTracker watermark.
 * Shown for keyless (null), `free`, and any non-paid plan. Hidden for paid
 * plans (`developer`, `company`, `enterprise`, custom, …) — same rule as
 * {@link isPaidPlan}.
 */
export function shouldShowWatermark(planType: string | null | undefined): boolean {
  return !isPaidPlan(planType);
}
