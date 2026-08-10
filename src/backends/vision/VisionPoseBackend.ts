/**
 * Apple Vision implementation of `PoseBackend` (iOS only).
 *
 * Uses `VNDetectHumanBodyPoseRequest` via a VisionCamera frame-processor
 * plugin shipped in this package's `ios/` folder. Up to 19 anatomical
 * joints (COCO-17 + `neck` + `root`). Primary fast path is
 * `PoseCameraView` → worklet → native plugin (CVPixelBuffer, no RGB copy).
 *
 * Never loaded in Expo Go (`isExpoGo()` guard). On Android,
 * `init()` throws {@link VisionUnavailableError} so the client can fall
 * back to TFLite / TF.js when selection is `'auto'`.
 */

import { Platform } from 'react-native';

import type { PoseBackend, PoseBackendInitOptions, PoseInputFrame } from '../PoseBackend';
import type { Pose } from '../../types/pose';
import type {
  AccelerationDiagnostics,
  AccelerationState,
  DiagnosticListener,
} from '../../types/acceleration';
import { isExpoGo } from '../../support/optionalModules';
import {
  getVisionBodyPosePlugin,
  isVisionBackendAvailable,
  type VisionFrameProcessorPlugin,
} from './optionalVision';
import {
  poseFromVisionPluginResult,
  type VisionPluginResult,
} from './mapVisionJoints';

const DEFAULT_MAX_ACCEPTABLE_INFERENCE_MS = 50;

/** Thrown when Apple Vision cannot run (wrong platform, Expo Go, missing pod). */
export class VisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VisionUnavailableError';
  }
}

export interface VisionPoseBackendOptions {
  maxAcceptableInferenceMs?: number;
  onDiagnostic?: DiagnosticListener;
  onAccelerationChange?: (state: AccelerationState) => void;
}

/**
 * Opaque frame accepted on the JS path: either a VisionCamera `Frame`
 * (preferred — passed through to the plugin) or a pre-decoded
 * {@link VisionPluginResult} (for tests / hosts that already ran Vision).
 */
export type VisionPoseInput = VisionPluginResult | { __visionCameraFrame: true };

export class VisionPoseBackend implements PoseBackend {
  readonly name = 'apple-vision';

  private plugin: VisionFrameProcessorPlugin | null = null;
  private warm = false;
  private acceleration: AccelerationState = 'unknown';
  private inferenceTimesMs: number[] = [];
  private reasons: string[] = [];

  private readonly maxAcceptableInferenceMs: number;
  private readonly onDiagnostic: DiagnosticListener | undefined;
  private readonly onAccelerationChange: ((state: AccelerationState) => void) | undefined;

  constructor(private readonly options: VisionPoseBackendOptions = {}) {
    this.maxAcceptableInferenceMs =
      options.maxAcceptableInferenceMs ?? DEFAULT_MAX_ACCEPTABLE_INFERENCE_MS;
    this.onDiagnostic = options.onDiagnostic;
    this.onAccelerationChange = options.onAccelerationChange;
  }

  async init(_options: PoseBackendInitOptions): Promise<void> {
    if (this.plugin) {
      return;
    }
    if (Platform.OS !== 'ios') {
      throw new VisionUnavailableError(
        'Apple Vision body pose is iOS-only. Use preferredBackend "tflite" or "tfjs" on Android.',
      );
    }
    if (isExpoGo()) {
      throw new VisionUnavailableError(
        'Apple Vision requires a native iOS build — not available in Expo Go.',
      );
    }
    if (!isVisionBackendAvailable()) {
      throw new VisionUnavailableError(
        'Apple Vision frame-processor plugin is not linked. Rebuild with the SDK ios/ pod ' +
          '(VisionCamera + PoseTrackerVision) and ensure react-native-vision-camera + worklets are installed.',
      );
    }
    this.plugin = getVisionBodyPosePlugin();
    if (!this.plugin) {
      throw new VisionUnavailableError('Failed to initialize detectBodyPose frame-processor plugin.');
    }
    this.onDiagnostic?.(
      '[posetracker] apple-vision backend ready (VNDetectHumanBodyPoseRequest, up to 19 joints)',
    );
  }

  /**
   * Vision has no separate model load — warm-up records the accelerator
   * verdict. Real timings come from the first camera frames via
   * {@link recordInferenceTime}.
   */
  async warmup(): Promise<void> {
    this.requirePlugin();
    if (this.warm) {
      return;
    }
    // Neural Engine / GPU path — Vision does not expose a CPU-only mode.
    this.setAcceleration('gpu');
    this.warm = true;
    this.onDiagnostic?.(
      `[posetracker] apple-vision warm-up done: acceleration=${this.acceleration} ` +
        '(per-frame ms reported from PoseCameraView)',
    );
  }

  /**
   * JS-path estimation. Accepts:
   * - a VisionCamera `Frame` (has `.width`/`.height` and is callable via plugin);
   * - a precomputed {@link VisionPluginResult} `{ joints }`.
   *
   * Prefer `PoseCameraView` (worklet) for production — this path is for
   * TensorCamera-style hosts and unit tests.
   */
  async estimatePose(frame: PoseInputFrame): Promise<Pose | null> {
    const plugin = this.requirePlugin();
    const asResult = frame as VisionPluginResult;
    if (asResult && Array.isArray(asResult.joints)) {
      return poseFromVisionPluginResult(asResult);
    }

    // VisionCamera Frame — structural duck-type (worklet Frame has width/height).
    const anyFrame = frame as { width?: number; height?: number };
    if (
      anyFrame &&
      typeof anyFrame.width === 'number' &&
      typeof anyFrame.height === 'number' &&
      typeof (plugin as VisionFrameProcessorPlugin).call === 'function'
    ) {
      const start = Date.now();
      const raw = plugin.call(frame) as VisionPluginResult | null;
      const elapsed = Date.now() - start;
      this.recordInferenceTime(elapsed);
      return poseFromVisionPluginResult(raw ?? undefined);
    }

    throw new Error(
      'VisionPoseBackend: pass a VisionCamera Frame, a { joints } plugin result, ' +
        'or use PoseCameraView (worklet path).',
    );
  }

  getAcceleration(): AccelerationDiagnostics | null {
    if (!this.plugin && this.acceleration === 'unknown') {
      return null;
    }
    return {
      state: this.acceleration,
      tfjsBackend: null,
      runtime: 'vision',
      delegate: 'apple-vision',
      medianInferenceMs: median(this.inferenceTimesMs),
      inferenceTimesMs: [...this.inferenceTimesMs],
      maxAcceptableInferenceMs: this.maxAcceptableInferenceMs,
      capabilities: null,
      flags: {},
      contextLossCount: 0,
      reasons: [...this.reasons],
    };
  }

  async dispose(): Promise<void> {
    this.plugin = null;
    this.warm = false;
    this.acceleration = 'unknown';
    this.inferenceTimesMs = [];
    this.reasons = [];
  }

  /** Plugin handle for PoseCameraView worklets. */
  getFrameProcessorPlugin(): VisionFrameProcessorPlugin | null {
    return this.plugin;
  }

  /** Feed live inference timings from the camera worklet into diagnostics. */
  recordInferenceTime(ms: number): void {
    this.inferenceTimesMs.push(ms);
    if (this.inferenceTimesMs.length > 30) {
      this.inferenceTimesMs.shift();
    }
    const med = median(this.inferenceTimesMs);
    if (med !== null && med > this.maxAcceptableInferenceMs && this.acceleration === 'gpu') {
      this.noteReason(
        `apple-vision median ${med.toFixed(0)} ms exceeds ${this.maxAcceptableInferenceMs} ms budget`,
      );
      this.setAcceleration('cpu-fallback');
    }
  }

  private setAcceleration(state: AccelerationState): void {
    if (this.acceleration !== state) {
      this.acceleration = state;
      this.onAccelerationChange?.(state);
    }
  }

  private noteReason(reason: string): void {
    this.reasons.push(reason);
    this.onDiagnostic?.(`[posetracker] ${reason}`);
  }

  private requirePlugin(): VisionFrameProcessorPlugin {
    if (!this.plugin) {
      throw new Error('VisionPoseBackend not initialized — call init() first.');
    }
    return this.plugin;
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  }
  return sorted[mid] as number;
}
