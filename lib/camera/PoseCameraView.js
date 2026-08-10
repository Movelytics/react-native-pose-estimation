"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoseCameraView = PoseCameraView;
const jsx_runtime_1 = require("react/jsx-runtime");
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
const react_1 = require("react");
const react_native_1 = require("react-native");
const PoseTrackerProvider_1 = require("../PoseTrackerProvider");
const optionalModules_1 = require("../support/optionalModules");
const VisionPoseBackend_1 = require("../backends/vision/VisionPoseBackend");
const optionalVision_1 = require("../backends/vision/optionalVision");
const mapVisionJoints_1 = require("../backends/vision/mapVisionJoints");
function PoseCameraView(props) {
    const { client } = (0, PoseTrackerProvider_1.usePoseTracker)();
    const backend = client.getBackend();
    if (!(backend instanceof VisionPoseBackend_1.VisionPoseBackend)) {
        return fallback(props, 'native-backend-inactive');
    }
    if (!(0, optionalVision_1.isVisionPoseCameraAvailable)()) {
        return fallback(props, 'modules-missing');
    }
    const plugin = backend.getFrameProcessorPlugin() ?? (0, optionalVision_1.getVisionBodyPosePlugin)();
    if (!plugin) {
        return fallback(props, 'backend-not-ready');
    }
    return ((0, jsx_runtime_1.jsx)(VisionPoseCameraInner, { ...props, backend: backend, plugin: plugin, visionCamera: (0, optionalModules_1.getVisionCamera)(), workletsCore: (0, optionalModules_1.getWorkletsCore)() }));
}
function fallback(props, reason) {
    if (props.renderFallback) {
        return props.renderFallback(reason);
    }
    return ((0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.fallback, props.style], children: (0, jsx_runtime_1.jsx)(react_native_1.Text, { style: styles.fallbackText, children: FALLBACK_MESSAGES[reason] }) }));
}
const FALLBACK_MESSAGES = {
    'modules-missing': 'PoseCameraView requires an iOS native build with react-native-vision-camera + ' +
        'react-native-worklets-core. Not available in Expo Go — use WebViewPoseView.',
    'native-backend-inactive': "PoseCameraView requires the Apple Vision backend (preferredBackend: 'vision') — " +
        'the client is on the WebView runtime (use WebViewPoseView instead).',
    'backend-not-ready': 'PoseTracker is not ready yet — call preload() and wait for status "ready".',
    'no-camera-device': 'No camera device available for the requested position.',
};
function VisionPoseCameraInner(props) {
    const { backend, plugin, visionCamera, workletsCore, position = 'front', isActive = true, targetFps, maxPoseCallbacksPerSecond = 30, onPose, style, children, } = props;
    const { client, status } = (0, PoseTrackerProvider_1.usePoseTracker)();
    const onPoseRef = (0, react_1.useRef)(onPose);
    onPoseRef.current = onPose;
    const device = visionCamera.useCameraDevice(position);
    const lastEmitMs = workletsCore.useSharedValue(0);
    const emitPose = workletsCore.useRunOnJS((pose, inferenceTimeMs) => {
        client.ingestPose(pose);
        backend.recordInferenceTime(inferenceTimeMs);
        onPoseRef.current?.(pose, { inferenceTimeMs, timestampMs: pose.timestampMs });
    }, [client, backend]);
    const minEmitIntervalMs = Math.max(0, Math.floor(1000 / Math.max(1, maxPoseCallbacksPerSecond)));
    const frameProcessor = visionCamera.useFrameProcessor((frame) => {
        'worklet';
        const raw = plugin.call(frame);
        if (!raw || !raw.joints || raw.joints.length === 0) {
            return;
        }
        const inferenceTimeMs = typeof raw.inferenceTimeMs === 'number' ? raw.inferenceTimeMs : 0;
        const pose = (0, mapVisionJoints_1.poseFromVisionPluginResult)(raw, Date.now());
        if (!pose) {
            return;
        }
        const now = Date.now();
        if (now - lastEmitMs.value >= minEmitIntervalMs) {
            lastEmitMs.value = now;
            emitPose(pose, inferenceTimeMs);
        }
    }, [plugin, minEmitIntervalMs, emitPose, lastEmitMs]);
    if (!device) {
        return fallback(props, 'no-camera-device') ?? (0, jsx_runtime_1.jsx)(react_native_1.View, { style: style });
    }
    const Camera = visionCamera.Camera;
    return ((0, jsx_runtime_1.jsxs)(react_native_1.View, { style: [styles.container, style], children: [(0, jsx_runtime_1.jsx)(Camera, { style: react_native_1.StyleSheet.absoluteFill, device: device, isActive: isActive && status === 'ready', frameProcessor: frameProcessor, 
                // Vision reads CMSampleBuffer / CVPixelBuffer directly — yuv is fine.
                pixelFormat: "yuv", ...(targetFps !== undefined ? { fps: targetFps } : {}) }), children] }));
}
const styles = react_native_1.StyleSheet.create({
    container: { overflow: 'hidden' },
    fallback: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#111',
    },
    fallbackText: { color: '#ccc', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
