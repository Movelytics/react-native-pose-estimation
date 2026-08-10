/**
 * Camera component for the Apple Vision backend (iOS native builds only):
 *
 *   vision-camera frame ──detectBodyPose plugin──▶ VNDetectHumanBodyPoseRequest
 *     ──19 joints (Y-flipped)──▶ Pose
 *
 * Everything up to the throttled `runOnJS` happens on the frame-processor
 * thread. Requires a native build (NOT Expo Go) and the Vision backend
 * active (`preferredBackend: 'vision'`). For every other case use
 * {@link WebViewPoseView} — the SDK's default runtime.
 */

import React, { useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { usePoseTracker } from '../PoseTrackerProvider';
import {
  getVisionCamera,
  getWorkletsCore,
  type VisionCameraFrame,
  type VisionCameraModule,
  type WorkletsCoreModule,
} from '../support/optionalModules';
import { VisionPoseBackend } from '../backends/vision/VisionPoseBackend';
import {
  getVisionBodyPosePlugin,
  isVisionPoseCameraAvailable,
  type VisionFrameProcessorPlugin,
} from '../backends/vision/optionalVision';
import {
  poseFromVisionPluginResult,
  type VisionPluginResult,
} from '../backends/vision/mapVisionJoints';
import type { Pose } from '../types/pose';

export type PoseCameraUnavailableReason =
  /** Optional native modules not installed (Expo Go or missing deps). */
  | 'modules-missing'
  /** Active backend is not Apple Vision (use WebViewPoseView instead). */
  | 'native-backend-inactive'
  /** Backend not initialized yet — preload()/warmup() has not completed. */
  | 'backend-not-ready'
  /** vision-camera found no camera device for the requested position. */
  | 'no-camera-device';

export interface PoseCameraStats {
  /** Synchronous inference duration for this frame, in ms. */
  inferenceTimeMs: number;
  /** Wall-clock timestamp of the processed frame (host clock, ms). */
  timestampMs: number;
}

export interface PoseCameraViewProps {
  style?: StyleProp<ViewStyle>;
  /** Camera to use. Default: 'front'. */
  position?: 'front' | 'back';
  /** Stream frames when true (and the SDK is ready). Default: true. */
  isActive?: boolean;
  /** Camera fps hint passed to vision-camera (inference runs per frame). */
  targetFps?: number;
  /**
   * Throttle for the worklet → JS pose callbacks (`runOnJS`). Inference
   * still runs on every camera frame; only the JS notifications (keypoints
   * events, overlays) are capped. Default: 30.
   */
  maxPoseCallbacksPerSecond?: number;
  /** Per-pose callback (after the pose was ingested into the SDK pipeline). */
  onPose?: (pose: Pose, stats: PoseCameraStats) => void;
  /** Rendered when the native camera path cannot run. */
  renderFallback?: (reason: PoseCameraUnavailableReason) => React.ReactElement | null;
  /** Overlay content (skeleton, HUD…), rendered above the camera preview. */
  children?: React.ReactNode;
}

export function PoseCameraView(props: PoseCameraViewProps): React.ReactElement | null {
  const { client } = usePoseTracker();
  const backend = client.getBackend();

  if (!(backend instanceof VisionPoseBackend)) {
    return fallback(props, 'native-backend-inactive');
  }
  if (!isVisionPoseCameraAvailable()) {
    return fallback(props, 'modules-missing');
  }
  const plugin = backend.getFrameProcessorPlugin() ?? getVisionBodyPosePlugin();
  if (!plugin) {
    return fallback(props, 'backend-not-ready');
  }
  return (
    <VisionPoseCameraInner
      {...props}
      backend={backend}
      plugin={plugin}
      visionCamera={getVisionCamera() as VisionCameraModule}
      workletsCore={getWorkletsCore() as WorkletsCoreModule}
    />
  );
}

function fallback(
  props: PoseCameraViewProps,
  reason: PoseCameraUnavailableReason,
): React.ReactElement | null {
  if (props.renderFallback) {
    return props.renderFallback(reason);
  }
  return (
    <View style={[styles.fallback, props.style]}>
      <Text style={styles.fallbackText}>{FALLBACK_MESSAGES[reason]}</Text>
    </View>
  );
}

const FALLBACK_MESSAGES: Record<PoseCameraUnavailableReason, string> = {
  'modules-missing':
    'PoseCameraView requires an iOS native build with react-native-vision-camera + ' +
    'react-native-worklets-core. Not available in Expo Go — use WebViewPoseView.',
  'native-backend-inactive':
    "PoseCameraView requires the Apple Vision backend (preferredBackend: 'vision') — " +
    'the client is on the WebView runtime (use WebViewPoseView instead).',
  'backend-not-ready': 'PoseTracker is not ready yet — call preload() and wait for status "ready".',
  'no-camera-device': 'No camera device available for the requested position.',
};

// ---------------------------------------------------------------------------
// Apple Vision path (iOS)
// ---------------------------------------------------------------------------

interface VisionPoseCameraInnerProps extends PoseCameraViewProps {
  backend: VisionPoseBackend;
  plugin: VisionFrameProcessorPlugin;
  visionCamera: VisionCameraModule;
  workletsCore: WorkletsCoreModule;
}

function VisionPoseCameraInner(props: VisionPoseCameraInnerProps): React.ReactElement {
  const {
    backend,
    plugin,
    visionCamera,
    workletsCore,
    position = 'front',
    isActive = true,
    targetFps,
    maxPoseCallbacksPerSecond = 30,
    onPose,
    style,
    children,
  } = props;

  const { client, status } = usePoseTracker();

  const onPoseRef = useRef(onPose);
  onPoseRef.current = onPose;

  const device = visionCamera.useCameraDevice(position);
  const lastEmitMs = workletsCore.useSharedValue(0);

  const emitPose = workletsCore.useRunOnJS(
    (pose: Pose, inferenceTimeMs: number) => {
      client.ingestPose(pose);
      backend.recordInferenceTime(inferenceTimeMs);
      onPoseRef.current?.(pose, { inferenceTimeMs, timestampMs: pose.timestampMs });
    },
    [client, backend],
  );

  const minEmitIntervalMs = Math.max(0, Math.floor(1000 / Math.max(1, maxPoseCallbacksPerSecond)));

  const frameProcessor = visionCamera.useFrameProcessor(
    (frame: VisionCameraFrame) => {
      'worklet';
      const raw = plugin.call(frame) as VisionPluginResult | null;
      if (!raw || !raw.joints || raw.joints.length === 0) {
        return;
      }
      const inferenceTimeMs =
        typeof raw.inferenceTimeMs === 'number' ? raw.inferenceTimeMs : 0;
      const pose = poseFromVisionPluginResult(raw, Date.now());
      if (!pose) {
        return;
      }

      const now = Date.now();
      if (now - lastEmitMs.value >= minEmitIntervalMs) {
        lastEmitMs.value = now;
        emitPose(pose, inferenceTimeMs);
      }
    },
    [plugin, minEmitIntervalMs, emitPose, lastEmitMs],
  );

  if (!device) {
    return fallback(props, 'no-camera-device') ?? <View style={style} />;
  }

  const Camera = visionCamera.Camera;
  return (
    <View style={[styles.container, style]}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive && status === 'ready'}
        frameProcessor={frameProcessor}
        // Vision reads CMSampleBuffer / CVPixelBuffer directly — yuv is fine.
        pixelFormat="yuv"
        {...(targetFps !== undefined ? { fps: targetFps } : {})}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#111',
  },
  fallbackText: { color: '#ccc', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
