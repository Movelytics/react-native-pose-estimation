/**
 * WebView inference backend — the SDK's base runtime on BOTH platforms.
 *
 * Runs MoveNet SinglePose Lightning (17 keypoints, 192×192) inside a real
 * browser WebGL context (Chromium ANGLE on Android, WKWebView on iOS) — the
 * same approach the PoseTracker WebView product uses in production, and the
 * only one real-time across the whole Android park in Expo Go. Fully
 * offline: TF.js and the model ship inside the npm package (poseHtml.ts).
 *
 * The WebView owns the camera (`getUserMedia`). Frames are NOT pushed from
 * React Native — `estimatePose()` returns the latest pose posted by the page.
 * Mount {@link WebViewPoseView} (or a 1×1 warmer) to attach the runtime.
 */

import type { PoseBackend, PoseBackendInitOptions, PoseInputFrame } from '../PoseBackend';
import type { KeypointName, Pose } from '../../types/pose';
import type {
  AccelerationDiagnostics,
  AccelerationState,
  DiagnosticListener,
} from '../../types/acceleration';
import type { PoseTrackerEvent } from '../../types/events';

export type WebViewPoseMessage =
  | {
      type: 'ready';
      backend: string;
      medianInferenceMs: number | null;
      warmUpRunsMs: number[];
      estimatedFps?: number | null;
      profileId?: string;
      /** false after basic (model-only) cold-start; true once getUserMedia ran. */
      cameraOpened?: boolean;
      coldStart?: 'basic' | 'full';
      gl: { renderer: string | null; vendor: string | null; version: string | null } | null;
      note?: string | null;
    }
  | {
      type: 'warmup_estimate';
      medianInferenceMs: number | null;
      estimatedFps: number | null;
      /** Platform floor (iOS 30 / Android 15). */
      minTargetFps: number;
      /** @deprecated Use {@link minTargetFps}. */
      targetFps?: number;
      profileId: string;
      previousProfileId?: string;
      idealWidth?: number;
      idealHeight?: number;
      gl?: { renderer: string | null; vendor: string | null; version: string | null } | null;
    }
  | {
      type: 'pose';
      keypoints: Array<{ name: string; x: number; y: number; score: number }>;
      score: number;
      inferenceTimeMs: number;
      timestampMs: number;
    }
  | {
      type: 'stats';
      fps: number;
      medianInferenceMs: number | null;
      estimatedFpsFromMedian?: number | null;
      frames: number;
      backend: string;
      breakdown?: {
        drawMs: number | null;
        fromPixelsMs: number | null;
        executeMs: number | null;
        totalPipelineMs?: number | null;
      };
      windowCounts?: { inferred: number; skipped: number };
      experiments?: Record<string, unknown>;
      leverHints?: {
        dominantStage?: string;
        dominantMs?: number;
        bitmapShare?: number;
        fromPixelsShare?: number;
        executeShare?: number;
        hints?: string[];
      } | null;
      videoSize?: string;
      mode?: string;
    }
  | {
      type: 'initialization';
      message: string;
      ready?: boolean;
      step?: 'accessing_webcam' | 'loading_pose_model' | 'ready';
    }
  | { type: 'warning'; message: string; code?: string }
  | { type: 'diag'; message: string }
  | { type: 'error'; message: string; code?: string };

export interface WebViewPoseStats {
  fps: number;
  medianInferenceMs: number | null;
  estimatedFpsFromMedian?: number | null;
  frames: number;
  backend: string;
  videoSize?: string;
  mode?: string;
  breakdown?: {
    drawMs: number | null;
    fromPixelsMs: number | null;
    executeMs: number | null;
    totalPipelineMs?: number | null;
  };
  windowCounts?: { inferred: number; skipped: number };
  experiments?: Record<string, unknown>;
  leverHints?: {
    dominantStage?: string;
    dominantMs?: number;
    bitmapShare?: number;
    fromPixelsShare?: number;
    executeShare?: number;
    hints?: string[];
  } | null;
}

export interface WebViewPoseBackendOptions {
  onDiagnostic?: DiagnosticListener;
  onAccelerationChange?: (state: AccelerationState) => void;
  /** Fired on every pose from the WebView (used by WebViewPoseView / ingest). */
  onPose?: (pose: Pose, inferenceTimeMs: number) => void;
  /** Fired when the Chromium page reports ready (model + backend warmed). */
  onReady?: (info: {
    backend: string;
    medianInferenceMs: number | null;
    estimatedFps?: number | null;
    profileId?: string | null;
    glRenderer: string | null;
  }) => void;
  /**
   * Fired after zeros warm-up, typically *before* getUserMedia — used to pick
   * a capture profile targeting ≥15 FPS.
   */
  onWarmupEstimate?: (info: {
    medianInferenceMs: number | null;
    estimatedFps: number | null;
    profileId: string;
    glRenderer: string | null;
  }) => void;
  /** Fired ~1 Hz with inference FPS / breakdown (adaptive quality input). */
  onStats?: (stats: WebViewPoseStats) => void;
  /**
   * Promotes page-level init / warning / error into typed {@link PoseTrackerEvent}s
   * so the host can listen the same way as the classic PoseTracker WebView.
   */
  onTrackerEvent?: (event: PoseTrackerEvent) => void;
}

type ReadyResolver = {
  resolve: () => void;
  reject: (err: Error) => void;
};

export class WebViewPoseBackend implements PoseBackend {
  readonly name = 'webview-movenet';

  private acceleration: AccelerationState = 'unknown';
  private attached = false;
  private ready = false;
  private warm = false;
  /** True after the page successfully opened getUserMedia. */
  private cameraOpened = false;
  private openCameraHandler: (() => void) | undefined;
  private lastPose: Pose | null = null;
  private inferenceTimesMs: number[] = [];
  private medianInferenceMs: number | null = null;
  private glRenderer: string | null = null;
  private glVendor: string | null = null;
  private glVersion: string | null = null;
  private tfjsBackend: string | null = null;
  private reasons: string[] = [];
  private readyWaiters: ReadyResolver[] = [];
  private cameraWaiters: ReadyResolver[] = [];
  private readonly onDiagnostic: DiagnosticListener | undefined;
  private readonly onAccelerationChange: ((state: AccelerationState) => void) | undefined;
  private onPose: ((pose: Pose, inferenceTimeMs: number) => void) | undefined;
  private onReady: WebViewPoseBackendOptions['onReady'];
  private onWarmupEstimate: WebViewPoseBackendOptions['onWarmupEstimate'];
  private onStats: WebViewPoseBackendOptions['onStats'];
  private onTrackerEvent: WebViewPoseBackendOptions['onTrackerEvent'];

  constructor(options: WebViewPoseBackendOptions = {}) {
    this.onDiagnostic = options.onDiagnostic;
    this.onAccelerationChange = options.onAccelerationChange;
    this.onPose = options.onPose;
    this.onReady = options.onReady;
    this.onWarmupEstimate = options.onWarmupEstimate;
    this.onStats = options.onStats;
    this.onTrackerEvent = options.onTrackerEvent;
  }

  /** Host view calls this when the WebView mounts / unmounts. */
  setAttached(attached: boolean): void {
    this.attached = attached;
    this.onDiagnostic?.(
      `[posetracker] WebViewPoseBackend attached=${attached} ready=${this.ready}`,
    );
    if (!attached) {
      this.ready = false;
      this.warm = false;
      this.cameraOpened = false;
      this.openCameraHandler = undefined;
    }
  }

  setOnPose(handler: ((pose: Pose, inferenceTimeMs: number) => void) | undefined): void {
    this.onPose = handler;
  }

  setOnReady(handler: WebViewPoseBackendOptions['onReady']): void {
    this.onReady = handler;
  }

  setOnStats(handler: WebViewPoseBackendOptions['onStats']): void {
    this.onStats = handler;
  }

  /** Feed a message from the WebView `onMessage` handler. */
  handleMessage(raw: string): void {
    let msg: WebViewPoseMessage;
    try {
      msg = JSON.parse(raw) as WebViewPoseMessage;
    } catch {
      return;
    }

    if (msg.type === 'warmup_estimate') {
      this.glRenderer = msg.gl?.renderer ?? this.glRenderer;
      this.medianInferenceMs = msg.medianInferenceMs;
      const minTarget = msg.minTargetFps ?? msg.targetFps;
      this.onDiagnostic?.(
        `[posetracker] WebView warmup_estimate fps=${
          msg.estimatedFps != null ? msg.estimatedFps.toFixed(1) : '?'
        } medianMs=${msg.medianInferenceMs != null ? msg.medianInferenceMs.toFixed(1) : '?'} ` +
          `profile=${msg.profileId} minTarget=${minTarget}`,
      );
      this.onWarmupEstimate?.({
        medianInferenceMs: msg.medianInferenceMs,
        estimatedFps: msg.estimatedFps,
        profileId: msg.profileId,
        glRenderer: this.glRenderer,
      });
      return;
    }

    if (msg.type === 'ready') {
      this.ready = true;
      this.warm = true;
      if (msg.cameraOpened === true) {
        this.cameraOpened = true;
        this.flushCameraWaiters();
      }
      this.tfjsBackend = msg.backend;
      this.medianInferenceMs = msg.medianInferenceMs;
      this.inferenceTimesMs = msg.warmUpRunsMs ?? [];
      this.glRenderer = msg.gl?.renderer ?? null;
      this.glVendor = msg.gl?.vendor ?? null;
      this.glVersion = msg.gl?.version ?? null;
      const med = msg.medianInferenceMs;
      // Chromium WebGL on Android mid-range is typically 15–80 ms — treat as GPU.
      this.setAcceleration(med != null && med > 200 ? 'cpu-fallback' : 'gpu');
      this.onDiagnostic?.(
        `[posetracker] WebView Chromium ready backend=${msg.backend} ` +
          `medianMs=${med != null ? med.toFixed(1) : 'n/a'} ` +
          `estFps=${msg.estimatedFps != null ? msg.estimatedFps.toFixed(1) : 'n/a'} ` +
          `profile=${msg.profileId ?? 'n/a'} coldStart=${msg.coldStart ?? '?'} ` +
          `camera=${msg.cameraOpened === true ? 'on' : 'deferred'} ` +
          `renderer=${this.glRenderer ?? 'n/a'}` +
          (msg.note ? ` note=${msg.note}` : ''),
      );
      this.onReady?.({
        backend: msg.backend,
        medianInferenceMs: med,
        estimatedFps: msg.estimatedFps,
        profileId: msg.profileId,
        glRenderer: this.glRenderer,
      });
      this.onTrackerEvent?.({
        type: 'initialization',
        step: 'ready',
        message: 'running',
        ready: true,
      });
      this.flushReadyWaiters();
      return;
    }

    if (msg.type === 'initialization') {
      const step = msg.step ?? (msg.ready ? 'ready' : 'loading_pose_model');
      this.onDiagnostic?.(
        `[posetracker] WebView init: ${msg.message} ready=${Boolean(msg.ready)}`,
      );
      this.onTrackerEvent?.({
        type: 'initialization',
        step,
        message: msg.message,
        ready: Boolean(msg.ready),
      });
      return;
    }

    if (msg.type === 'warning') {
      this.onDiagnostic?.(`[posetracker] WebView warning: ${msg.message}`);
      this.onTrackerEvent?.({
        type: 'warning',
        code: 'webview',
        message: msg.message,
        timestampMs: Date.now(),
      });
      return;
    }

    if (msg.type === 'error') {
      // Mid-boot quality swaps abort getUserMedia; ignore so warmup can finish.
      if (/abort/i.test(msg.message)) {
        this.onDiagnostic?.(
          `[posetracker] WebView pose error ignored (abort during quality swap): ${msg.message}`,
        );
        return;
      }
      this.reasons.push(msg.message);
      this.onDiagnostic?.(`[posetracker] WebView pose error: ${msg.message}`);
      this.onTrackerEvent?.({
        type: 'error',
        code: 'webview_error',
        message: msg.message,
      });
      const err = new Error(msg.message);
      for (const w of this.readyWaiters) w.reject(err);
      this.readyWaiters = [];
      return;
    }

    if (msg.type === 'diag') {
      this.onDiagnostic?.(`[posetracker] WebView diag: ${msg.message}`);
      return;
    }

    if (msg.type === 'stats') {
      this.medianInferenceMs = msg.medianInferenceMs;
      this.tfjsBackend = msg.backend;
      const b = msg.breakdown;
      const fmt = (v: number | null | undefined) => (v != null ? v.toFixed(1) : 'n/a');
      const wc = msg.windowCounts;
      const lh = msg.leverHints;
      this.onDiagnostic?.(
        `[posetracker] WebView stats fps=${msg.fps} medianMs=${
          msg.medianInferenceMs != null ? Math.round(msg.medianInferenceMs) : 'n/a'
        }` +
          (msg.estimatedFpsFromMedian != null
            ? ` estFps=${msg.estimatedFpsFromMedian.toFixed(1)}`
            : '') +
          ` backend=${msg.backend}` +
          (msg.mode ? ` mode=${msg.mode}` : '') +
          (msg.videoSize ? ` video=${msg.videoSize}` : '') +
          (b
            ? ` bitmap=${fmt(b.drawMs)} fromPixels=${fmt(b.fromPixelsMs)} execute=${fmt(b.executeMs)}` +
              (b.totalPipelineMs != null ? ` total=${fmt(b.totalPipelineMs)}` : '')
            : '') +
          (wc ? ` inferred/skipped=${wc.inferred}/${wc.skipped}` : ''),
      );
      if (lh?.hints?.length) {
        this.onDiagnostic?.(
          `[posetracker] WebView leverHints dominant=${lh.dominantStage ?? '?'} ` +
            `shares bmp=${lh.bitmapShare ?? '?'} px=${lh.fromPixelsShare ?? '?'} ex=${lh.executeShare ?? '?'} ` +
            `→ ${lh.hints.join(' | ')}`,
        );
      }
      this.onStats?.({
        fps: msg.fps,
        medianInferenceMs: msg.medianInferenceMs,
        estimatedFpsFromMedian: msg.estimatedFpsFromMedian,
        frames: msg.frames,
        backend: msg.backend,
        videoSize: msg.videoSize,
        mode: msg.mode,
        breakdown: msg.breakdown,
        windowCounts: msg.windowCounts,
        experiments: msg.experiments,
        leverHints: msg.leverHints,
      });
      return;
    }

    if (msg.type === 'pose') {
      const pose: Pose = {
        keypoints: msg.keypoints.map((k) => ({
          name: k.name as KeypointName,
          x: k.x,
          y: k.y,
          score: k.score,
        })),
        score: msg.score,
        timestampMs: msg.timestampMs,
      };
      this.lastPose = pose;
      this.onPose?.(pose, msg.inferenceTimeMs);
    }
  }

  async init(_options: PoseBackendInitOptions): Promise<void> {
    this.onDiagnostic?.(
      '[posetracker] WebViewPoseBackend.init — waiting for Chromium WebView to mount (WebViewPoseView)',
    );
    // Actual model load happens inside the HTML page once the view attaches.
  }

  async warmup(): Promise<void> {
    if (this.warm) return;
    this.onDiagnostic?.(
      '[posetracker] WebViewPoseBackend.warmup — awaiting page ready (model cold-start)…',
    );
    await this.waitUntilReady(60_000);
  }

  /** Whether getUserMedia has already run in the attached page. */
  isCameraOpened(): boolean {
    return this.cameraOpened;
  }

  /**
   * Host injects `__PT_OPEN_CAMERA` via {@link setOpenCameraHandler}.
   * Used when upgrading basic → full cold-start without remounting the page.
   */
  setOpenCameraHandler(handler: (() => void) | undefined): void {
    this.openCameraHandler = handler;
  }

  /**
   * Open getUserMedia after a basic (model-only) ready. No-op if the page
   * already opened the camera (coldStart=full boot).
   */
  async openCamera(): Promise<void> {
    if (this.cameraOpened) return;
    if (!this.ready) {
      await this.waitUntilReady(60_000);
    }
    if (this.cameraOpened) return;
    if (!this.openCameraHandler) {
      throw new Error(
        'WebViewPoseBackend.openCamera: no WebViewPoseView attached to inject __PT_OPEN_CAMERA.',
      );
    }
    this.onDiagnostic?.('[posetracker] WebViewPoseBackend.openCamera — requesting getUserMedia…');
    this.openCameraHandler();
    await this.waitUntilCameraOpened(30_000);
  }

  async estimatePose(_frame: PoseInputFrame): Promise<Pose | null> {
    // Camera lives inside the WebView; return last pose for API compatibility.
    return this.lastPose;
  }

  getAcceleration(): AccelerationDiagnostics | null {
    if (this.acceleration === 'unknown' && !this.ready) {
      return null;
    }
    return {
      state: this.acceleration,
      tfjsBackend: this.tfjsBackend,
      runtime: 'webview',
      medianInferenceMs: this.medianInferenceMs,
      inferenceTimesMs: [...this.inferenceTimesMs],
      maxAcceptableInferenceMs: 200,
      capabilities: this.glRenderer
        ? {
            glVersion: this.glVersion,
            renderer: this.glRenderer,
            vendor: this.glVendor,
            maxTextureSize: null,
            colorBufferFloat: true,
            colorBufferHalfFloat: true,
            textureFloat: true,
            textureHalfFloat: true,
            extensionQueriesShimmed: false,
          }
        : null,
      flags: {
        WEBVIEW_CHROMIUM: true,
        note:
          this.tfjsBackend === 'wasm'
            ? 'Inference runs in WebView WASM (slow fallback)'
            : 'Inference runs in WebView main-thread WebGL MoveNet (camera capped, createImageBitmap 192)',
      },
      contextLossCount: 0,
      reasons: [
        ...this.reasons,
        'backend=webview-movenet (Chromium getUserMedia + TF.js WebGL MoveNet Lightning)',
      ],
    };
  }

  async dispose(): Promise<void> {
    this.ready = false;
    this.warm = false;
    this.cameraOpened = false;
    this.attached = false;
    this.openCameraHandler = undefined;
    this.lastPose = null;
    this.acceleration = 'unknown';
    this.readyWaiters = [];
    this.cameraWaiters = [];
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            'WebViewPoseBackend: timed out waiting for Chromium page ready. ' +
              'Mount <WebViewPoseView coldStart="basic" /> (or full) so MoveNet can warm up.',
          ),
        );
      }, timeoutMs);
      this.readyWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private waitUntilCameraOpened(timeoutMs: number): Promise<void> {
    if (this.cameraOpened) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            'WebViewPoseBackend: timed out waiting for getUserMedia. ' +
              'Ensure the user grants camera permission when prompted.',
          ),
        );
      }, timeoutMs);
      this.cameraWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private flushReadyWaiters(): void {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const w of waiters) w.resolve();
  }

  private flushCameraWaiters(): void {
    const waiters = this.cameraWaiters;
    this.cameraWaiters = [];
    for (const w of waiters) w.resolve();
  }

  private setAcceleration(state: AccelerationState): void {
    if (this.acceleration !== state) {
      this.acceleration = state;
      this.onAccelerationChange?.(state);
    }
  }
}

export function isWebViewPoseBackend(backend: PoseBackend): backend is WebViewPoseBackend {
  return backend.name === 'webview-movenet';
}
