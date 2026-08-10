"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoseTrackerProvider = PoseTrackerProvider;
exports.usePoseTracker = usePoseTracker;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * React layer: `PoseTrackerProvider` owns a `PoseTrackerClient`, and
 * `usePoseTracker` gives screens access to the pipeline plus typed event
 * callbacks.
 *
 * Recommended usage:
 * - Mount the provider near the app root — with or without an API token
 *   (without token, the SDK runs in keypoints-only mode).
 * - **Mounting the provider does not load MoveNet** unless `autoPreload` is
 *   true. On the screen *before* the camera (e.g. home), call `preload()` /
 *   `warmup()` (default **basic** = model only, no camera permission). For
 *   WebView, mount a 1×1 `<WebViewPoseView coldStart="basic" />` warmer so
 *   MoveNet can load — see docs/PRELOAD.md.
 * - Call `configure(apiToken)` at any time to upgrade keypoints-only →
 *   full-engine without restarting the camera pipeline.
 */
const react_1 = require("react");
const client_1 = require("./client");
const PoseTrackerContext = (0, react_1.createContext)(null);
function PoseTrackerProvider({ apiToken, options, autoPreload = false, children, }) {
    const clientRef = (0, react_1.useRef)(null);
    if (!clientRef.current) {
        clientRef.current = new client_1.PoseTrackerClient(apiToken, options);
    }
    const client = clientRef.current;
    const [status, setStatus] = (0, react_1.useState)(client.getStatus());
    const [mode, setMode] = (0, react_1.useState)(client.getMode());
    const [error, setError] = (0, react_1.useState)(null);
    const [manifest, setManifest] = (0, react_1.useState)(null);
    const [exercises, setExercises] = (0, react_1.useState)([]);
    const [acceleration, setAcceleration] = (0, react_1.useState)(client.getAcceleration());
    const [accelerationDiagnostics, setAccelerationDiagnostics] = (0, react_1.useState)(client.getAccelerationDiagnostics());
    const [quality, setQuality] = (0, react_1.useState)(client.getQualityState());
    (0, react_1.useEffect)(() => {
        const offState = client.onStateChange(() => {
            setStatus(client.getStatus());
            setMode(client.getMode());
            setError(client.getError());
            setManifest(client.getManifest());
            setExercises(client.getAvailableExercises());
            setAcceleration(client.getAcceleration());
            setAccelerationDiagnostics(client.getAccelerationDiagnostics());
            setQuality(client.getQualityState());
        });
        if (autoPreload) {
            client.preload().catch(() => {
                // Error is surfaced through status/error state and the error event.
            });
        }
        return () => {
            offState();
        };
    }, [client, autoPreload]);
    (0, react_1.useEffect)(() => {
        return () => {
            client.dispose().catch(() => { });
        };
    }, [client]);
    const preload = (0, react_1.useCallback)((options) => client.preload(options), [client]);
    const configureFn = (0, react_1.useCallback)((token) => client.configure(token), [client]);
    const startExercise = (0, react_1.useCallback)((id, exerciseOptions) => client.startExercise(id, exerciseOptions), [client]);
    const stopExercise = (0, react_1.useCallback)(() => client.stopExercise(), [client]);
    const estimatePose = (0, react_1.useCallback)((frame) => client.estimatePose(frame), [client]);
    const processFrame = (0, react_1.useCallback)((frame) => client.processFrame(frame), [client]);
    const addEventListener = (0, react_1.useCallback)((listener) => client.addEventListener(listener), [client]);
    const addMessageListener = (0, react_1.useCallback)((listener) => client.addMessageListener(listener), [client]);
    const value = (0, react_1.useMemo)(() => ({
        client,
        status,
        mode,
        acceleration,
        accelerationDiagnostics,
        quality,
        error,
        manifest,
        exercises,
        preload,
        warmup: preload,
        configure: configureFn,
        startExercise,
        stopExercise,
        estimatePose,
        processFrame,
        addEventListener,
        addMessageListener,
    }), [
        client,
        status,
        mode,
        acceleration,
        accelerationDiagnostics,
        quality,
        error,
        manifest,
        exercises,
        preload,
        configureFn,
        startExercise,
        stopExercise,
        estimatePose,
        processFrame,
        addEventListener,
        addMessageListener,
    ]);
    return (0, jsx_runtime_1.jsx)(PoseTrackerContext.Provider, { value: value, children: children });
}
/**
 * Access the PoseTracker pipeline and subscribe to typed events.
 *
 * ```tsx
 * const { status, mode, processFrame, configure } = usePoseTracker({
 *   onKeypoints: (e) => drawSkeleton(e.keypoints),   // both modes
 *   onCounter: (e) => setReps(e.count),              // full-engine only
 * });
 * ```
 */
function usePoseTracker(callbacks = {}) {
    const context = (0, react_1.useContext)(PoseTrackerContext);
    if (!context) {
        throw new Error('usePoseTracker must be used within a <PoseTrackerProvider>.');
    }
    const callbacksRef = (0, react_1.useRef)(callbacks);
    callbacksRef.current = callbacks;
    (0, react_1.useEffect)(() => {
        const offEvents = context.addEventListener((event) => {
            const cb = callbacksRef.current;
            switch (event.type) {
                case 'initialization':
                    cb.onInitialization?.(event);
                    break;
                case 'error':
                    cb.onError?.(event);
                    break;
                case 'warning':
                    cb.onWarning?.(event);
                    break;
                case 'keypoints':
                    cb.onKeypoints?.(event);
                    break;
                case 'angles':
                    cb.onAngles?.(event);
                    break;
                case 'counter':
                    cb.onCounter?.(event);
                    break;
                case 'posture':
                    cb.onPosture?.(event);
                    break;
                case 'progression':
                    cb.onProgression?.(event);
                    break;
                case 'recommendations':
                    cb.onRecommendations?.(event);
                    break;
                case 'form_score':
                    cb.onFormScore?.(event);
                    break;
                case 'exercise_summary':
                    cb.onExerciseSummary?.(event);
                    break;
                case 'jump_calibration':
                    cb.onJumpCalibration?.(event);
                    break;
                case 'jump_started':
                    cb.onJumpStarted?.(event);
                    break;
                case 'jump_height':
                    cb.onJumpHeight?.(event);
                    break;
                case 'jump_discarded':
                    cb.onJumpDiscarded?.(event);
                    break;
                case 'jump_result':
                    cb.onJumpResult?.(event);
                    break;
                case 'jump_summary':
                    cb.onJumpSummary?.(event);
                    break;
                case 'quality_changed':
                    cb.onQualityChanged?.(event);
                    break;
                case 'performance_warning':
                    cb.onPerformanceWarning?.(event);
                    break;
                case 'runtime_download_progress':
                    cb.onRuntimeDownloadProgress?.(event);
                    break;
            }
        });
        const offMessages = context.addMessageListener((message) => {
            callbacksRef.current.onMessage?.(message);
        });
        return () => {
            offEvents();
            offMessages();
        };
    }, [context]);
    return context;
}
