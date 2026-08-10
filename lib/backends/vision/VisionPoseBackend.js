"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionPoseBackend = exports.VisionUnavailableError = void 0;
const react_native_1 = require("react-native");
const optionalModules_1 = require("../../support/optionalModules");
const optionalVision_1 = require("./optionalVision");
const mapVisionJoints_1 = require("./mapVisionJoints");
const DEFAULT_MAX_ACCEPTABLE_INFERENCE_MS = 50;
/** Thrown when Apple Vision cannot run (wrong platform, Expo Go, missing pod). */
class VisionUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'VisionUnavailableError';
    }
}
exports.VisionUnavailableError = VisionUnavailableError;
class VisionPoseBackend {
    constructor(options = {}) {
        this.options = options;
        this.name = 'apple-vision';
        this.plugin = null;
        this.warm = false;
        this.acceleration = 'unknown';
        this.inferenceTimesMs = [];
        this.reasons = [];
        this.maxAcceptableInferenceMs =
            options.maxAcceptableInferenceMs ?? DEFAULT_MAX_ACCEPTABLE_INFERENCE_MS;
        this.onDiagnostic = options.onDiagnostic;
        this.onAccelerationChange = options.onAccelerationChange;
    }
    async init(_options) {
        if (this.plugin) {
            return;
        }
        if (react_native_1.Platform.OS !== 'ios') {
            throw new VisionUnavailableError('Apple Vision body pose is iOS-only. Use preferredBackend "tflite" or "tfjs" on Android.');
        }
        if ((0, optionalModules_1.isExpoGo)()) {
            throw new VisionUnavailableError('Apple Vision requires a native iOS build — not available in Expo Go.');
        }
        if (!(0, optionalVision_1.isVisionBackendAvailable)()) {
            throw new VisionUnavailableError('Apple Vision frame-processor plugin is not linked. Rebuild with the SDK ios/ pod ' +
                '(VisionCamera + PoseTrackerVision) and ensure react-native-vision-camera + worklets are installed.');
        }
        this.plugin = (0, optionalVision_1.getVisionBodyPosePlugin)();
        if (!this.plugin) {
            throw new VisionUnavailableError('Failed to initialize detectBodyPose frame-processor plugin.');
        }
        this.onDiagnostic?.('[posetracker] apple-vision backend ready (VNDetectHumanBodyPoseRequest, up to 19 joints)');
    }
    /**
     * Vision has no separate model load — warm-up records the accelerator
     * verdict. Real timings come from the first camera frames via
     * {@link recordInferenceTime}.
     */
    async warmup() {
        this.requirePlugin();
        if (this.warm) {
            return;
        }
        // Neural Engine / GPU path — Vision does not expose a CPU-only mode.
        this.setAcceleration('gpu');
        this.warm = true;
        this.onDiagnostic?.(`[posetracker] apple-vision warm-up done: acceleration=${this.acceleration} ` +
            '(per-frame ms reported from PoseCameraView)');
    }
    /**
     * JS-path estimation. Accepts:
     * - a VisionCamera `Frame` (has `.width`/`.height` and is callable via plugin);
     * - a precomputed {@link VisionPluginResult} `{ joints }`.
     *
     * Prefer `PoseCameraView` (worklet) for production — this path is for
     * TensorCamera-style hosts and unit tests.
     */
    async estimatePose(frame) {
        const plugin = this.requirePlugin();
        const asResult = frame;
        if (asResult && Array.isArray(asResult.joints)) {
            return (0, mapVisionJoints_1.poseFromVisionPluginResult)(asResult);
        }
        // VisionCamera Frame — structural duck-type (worklet Frame has width/height).
        const anyFrame = frame;
        if (anyFrame &&
            typeof anyFrame.width === 'number' &&
            typeof anyFrame.height === 'number' &&
            typeof plugin.call === 'function') {
            const start = Date.now();
            const raw = plugin.call(frame);
            const elapsed = Date.now() - start;
            this.recordInferenceTime(elapsed);
            return (0, mapVisionJoints_1.poseFromVisionPluginResult)(raw ?? undefined);
        }
        throw new Error('VisionPoseBackend: pass a VisionCamera Frame, a { joints } plugin result, ' +
            'or use PoseCameraView (worklet path).');
    }
    getAcceleration() {
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
    async dispose() {
        this.plugin = null;
        this.warm = false;
        this.acceleration = 'unknown';
        this.inferenceTimesMs = [];
        this.reasons = [];
    }
    /** Plugin handle for PoseCameraView worklets. */
    getFrameProcessorPlugin() {
        return this.plugin;
    }
    /** Feed live inference timings from the camera worklet into diagnostics. */
    recordInferenceTime(ms) {
        this.inferenceTimesMs.push(ms);
        if (this.inferenceTimesMs.length > 30) {
            this.inferenceTimesMs.shift();
        }
        const med = median(this.inferenceTimesMs);
        if (med !== null && med > this.maxAcceptableInferenceMs && this.acceleration === 'gpu') {
            this.noteReason(`apple-vision median ${med.toFixed(0)} ms exceeds ${this.maxAcceptableInferenceMs} ms budget`);
            this.setAcceleration('cpu-fallback');
        }
    }
    setAcceleration(state) {
        if (this.acceleration !== state) {
            this.acceleration = state;
            this.onAccelerationChange?.(state);
        }
    }
    noteReason(reason) {
        this.reasons.push(reason);
        this.onDiagnostic?.(`[posetracker] ${reason}`);
    }
    requirePlugin() {
        if (!this.plugin) {
            throw new Error('VisionPoseBackend not initialized — call init() first.');
        }
        return this.plugin;
    }
}
exports.VisionPoseBackend = VisionPoseBackend;
function median(values) {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}
