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

/** Relation keys matching engine `PUBLIC_ANGLES` / Front `computeAngles`. */
const ANGLE_RELATIONS: Record<string, string> = {
  left_knee: 'from_hip_to_ankle',
  right_knee: 'from_hip_to_ankle',
  left_hip: 'from_knee_to_shoulder',
  right_hip: 'from_knee_to_shoulder',
  left_shoulder: 'from_hip_to_elbow',
  right_shoulder: 'from_hip_to_elbow',
  left_elbow: 'from_shoulder_to_wrist',
  right_elbow: 'from_shoulder_to_wrist',
};

/**
 * Rebuild the WebView `angles.data` tree (`left_side` / `right_side`) from
 * the typed flat `AngleValue[]` list.
 */
export function anglesToClassicTree(angles: AngleValue[]): {
  left_side: Record<string, Record<string, number>>;
  right_side: Record<string, Record<string, number>>;
} {
  const data = {
    left_side: {} as Record<string, Record<string, number>>,
    right_side: {} as Record<string, Record<string, number>>,
  };
  for (const a of angles) {
    if (a.side !== 'left' && a.side !== 'right') continue;
    const side = a.side === 'left' ? data.left_side : data.right_side;
    const joint = a.id.replace(/^(left_|right_)/, '');
    const angleType = `${joint}_angle`;
    const relation = ANGLE_RELATIONS[a.id] ?? 'value';
    if (!side[angleType]) side[angleType] = {};
    side[angleType]![relation] = a.degrees;
    side[angleType]![`score_${relation}`] = a.score;
  }
  return data;
}

/**
 * Map a typed SDK event to a classic PoseTracker `sendDataToNative` payload.
 * Returns null for SDK-only events that have no classic equivalent and should
 * not be mirrored (none today — quality/performance map to error/warning).
 */
export function toClassicNativeMessage(event: PoseTrackerEvent): ClassicNativeMessage {
  switch (event.type) {
    case 'initialization':
      return {
        type: 'initialization',
        // WebView-literal parity: TrackingAppV3 emits exactly
        // "checking you plan and access" (sic) while the plan loads — hosts
        // migrating from the WebView may string-match it.
        message:
          event.step === 'configuring'
            ? 'checking you plan and access'
            : event.message ?? humanInitStep(event.step),
        ready: event.ready,
        step: event.step,
        ...(event.mode != null ? { mode: event.mode } : {}),
        ...(event.acceleration != null ? { acceleration: event.acceleration } : {}),
      };
    case 'error':
      return {
        type: 'error',
        error: event.code,
        message: event.message,
      };
    case 'warning':
      return {
        type: 'warning',
        error: event.code,
        message: event.message,
      };
    case 'keypoints':
      return {
        type: 'keypoints',
        data: event.keypoints.map((k) => ({
          name: k.name,
          x: k.x,
          y: k.y,
          ...(k.z != null ? { z: k.z } : {}),
          score: k.score,
        })),
        score: event.score,
        timestampMs: event.timestampMs,
      };
    case 'angles':
      return {
        type: 'angles',
        // WebView V3 shape: nested left_side / right_side tree (not the typed flat array).
        data: anglesToClassicTree(event.angles),
        timestampMs: event.timestampMs,
      };
    case 'counter':
      return {
        type: 'counter',
        current_count: event.count,
        // GitBook: authoritative grade for a counted rep lives on counter.form_score.
        ...(event.formScore != null
          ? {
              form_score: {
                score: event.formScore.score,
                avg_score: event.formScore.average,
                grade: event.formScore.grade,
              },
            }
          : {}),
        ...(event.referenceScore != null
          ? { reference_score: { overallScore: event.referenceScore } }
          : {}),
        timestampMs: event.timestampMs,
      };
    case 'posture':
      return {
        type: 'posture',
        message: event.hint,
        ready: event.ready,
        direction: event.direction ?? '',
        requirements: { missingKeypoints: event.missingKeypoints },
        timestampMs: event.timestampMs,
      };
    case 'progression':
      return {
        type: 'progression',
        value: event.value,
        timestampMs: event.timestampMs,
      };
    case 'recommendations':
      return {
        type: 'recommendations',
        data: event.recommendations,
        timestampMs: event.timestampMs,
      };
    case 'form_score':
      // Optional live / convenience stream — do not treat as authoritative
      // for the counted rep (prefer counter.form_score). Kept for hosts that
      // already subscribe to a standalone form_score type.
      return {
        type: 'form_score',
        score: event.score,
        avg_score: event.average,
        grade: event.grade,
        timestampMs: event.timestampMs,
      };
    case 'exercise_summary':
      return {
        type: 'exercise_summary',
        exercise: event.exercise,
        counter: event.counter,
        avg_rep_score: event.averageFormScore,
        avg_similarity: event.averageSimilarity,
        grade: event.grade,
        history: event.history,
        durationMs: event.durationMs,
        timestampMs: event.timestampMs,
      };
    // Custom jump exercises: the classic contract already uses these exact
    // type strings and camelCase field names — pass through minus timestampMs
    // restructuring (front payloads have no timestampMs, but extra fields are
    // harmless for string-matching hosts).
    case 'jump_calibration':
      return {
        type: 'jump_calibration',
        calibrated: event.calibrated,
        cmPerPixel: event.cmPerPixel,
        baselineY: event.baselineY,
        visibleHips: event.visibleHips,
        message: event.message,
        timestampMs: event.timestampMs,
      };
    case 'jump_started':
      return {
        type: 'jump_started',
        message: event.message,
        timestampMs: event.timestampMs,
      };
    case 'jump_height': {
      const { type, timestampMs, ...rest } = event;
      return { type, ...rest, timestampMs };
    }
    case 'jump_discarded':
      return {
        type: 'jump_discarded',
        reason: event.reason,
        userMessage: event.userMessage,
        timestampMs: event.timestampMs,
      };
    case 'jump_result': {
      const { type, timestampMs, ...rest } = event;
      return { type, ...rest, timestampMs };
    }
    case 'jump_summary': {
      const { type, timestampMs, ...rest } = event;
      return { type, ...rest, timestampMs };
    }
    case 'performance_warning':
      // Classic V3 uses type "error" with degradation codes for device capability.
      return {
        type: 'error',
        error: event.code,
        message: event.message,
        meanFps: event.meanFps,
        thresholdFps: event.thresholdFps,
        activeProfile: event.activeProfile,
        medianInferenceMs: event.medianInferenceMs,
        videoSize: event.videoSize,
        timestampMs: event.timestampMs,
      };
    case 'quality_changed':
      return {
        type: 'warning',
        error: 'quality_downgraded',
        message: event.detail,
        previousProfile: event.previousProfile,
        activeProfile: event.activeProfile,
        reason: event.reason,
        timestampMs: event.timestampMs,
      };
    case 'runtime_download_progress':
      // Classic contract has no download event — mirror as initialization.
      return {
        type: 'initialization',
        message: `downloading pose runtime ${event.completedParts + 1}/${event.totalParts}`,
        ready: false,
        step: 'downloading',
        part: event.part,
        completedParts: event.completedParts,
        totalParts: event.totalParts,
        timestampMs: event.timestampMs,
      };
    default: {
      const _exhaustive: never = event;
      return { type: 'unknown', event: _exhaustive };
    }
  }
}

function humanInitStep(step: string): string {
  switch (step) {
    case 'configuring':
      // Front literal (sic) — TrackingAppV3.js.
      return 'checking you plan and access';
    case 'downloading':
      return 'downloading engine';
    case 'warming':
      return 'loading pose model';
    case 'ready':
      return 'running';
    default:
      return step;
  }
}
