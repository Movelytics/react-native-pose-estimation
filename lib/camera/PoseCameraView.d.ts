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
import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import type { Pose } from '../types/pose';
export type PoseCameraUnavailableReason = 
/** Optional native modules not installed (Expo Go or missing deps). */
'modules-missing'
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
export declare function PoseCameraView(props: PoseCameraViewProps): React.ReactElement | null;
