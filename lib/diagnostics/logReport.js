"use strict";
/**
 * Human-readable diagnostic dumps for Metro / adb logcat.
 * Designed so a host can paste the terminal output into a support chat.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultDiagnosticLogger = defaultDiagnosticLogger;
exports.logPlatformBanner = logPlatformBanner;
exports.logAccelerationReport = logAccelerationReport;
exports.logFrameStats = logFrameStats;
const react_native_1 = require("react-native");
const PREFIX = '[PoseTracker]';
/** Always-on console sink — shows up in `npx expo start` / Metro. */
function defaultDiagnosticLogger(message) {
    // Keep a single prefix so hosts can filter: `npx expo start | grep PoseTracker`
    console.log(PREFIX, message.startsWith('[posetracker]') ? message : message);
}
function logPlatformBanner() {
    console.log(PREFIX, `platform=${react_native_1.Platform.OS} version=${String(react_native_1.Platform.Version)} ` +
        `constants=${JSON.stringify({
            isPad: react_native_1.Platform.isPad ?? null,
            isTV: react_native_1.Platform.isTV,
        })}`);
}
/**
 * Multi-line dump of the warm-up / acceleration verdict. Call after
 * preload()/warmup() so Android CPU-fallback reasons are visible in Metro.
 */
function logAccelerationReport(diag, extra) {
    const lines = [];
    lines.push('======== ACCELERATION REPORT ========');
    lines.push(`platform: ${react_native_1.Platform.OS} ${String(react_native_1.Platform.Version)}`);
    if (!diag) {
        lines.push('diagnostics: null (warm-up not finished)');
    }
    else {
        lines.push(`state: ${diag.state}`);
        lines.push(`runtime: ${diag.runtime ?? 'webview'}`);
        lines.push(`tfjsBackend: ${diag.tfjsBackend ?? 'n/a'}`);
        if (diag.delegate) {
            lines.push(`delegate: ${diag.delegate}`);
        }
        lines.push(`medianInferenceMs: ${diag.medianInferenceMs != null ? diag.medianInferenceMs.toFixed(1) : 'n/a'}`);
        lines.push(`warmUpRunsMs: [${diag.inferenceTimesMs.map((ms) => Math.round(ms)).join(', ')}]`);
        lines.push(`maxAcceptableInferenceMs: ${diag.maxAcceptableInferenceMs}`);
        lines.push(`contextLossCount: ${diag.contextLossCount}`);
        const caps = diag.capabilities;
        if (caps) {
            lines.push(`GL.renderer: ${caps.renderer ?? 'n/a'}`);
            lines.push(`GL.vendor: ${caps.vendor ?? 'n/a'}`);
            lines.push(`GL.version: ${caps.glVersion ?? 'n/a'}`);
            lines.push(`GL.maxTextureSize: ${caps.maxTextureSize ?? 'n/a'}`);
            lines.push(`GL.extensions(shimmed=${caps.extensionQueriesShimmed}): ` +
                `float=${caps.textureFloat} halfFloat=${caps.textureHalfFloat} ` +
                `colorBufferFloat=${caps.colorBufferFloat} colorBufferHalfFloat=${caps.colorBufferHalfFloat}`);
        }
        else {
            lines.push('GL.capabilities: null (no GL context — typically means tfjs backend=cpu)');
        }
        lines.push(`tfjsFlags: ${JSON.stringify(diag.flags)}`);
        if (diag.reasons.length === 0) {
            lines.push('reasons: (none)');
        }
        else {
            lines.push('reasons:');
            for (const reason of diag.reasons) {
                lines.push(`  - ${reason}`);
            }
        }
        if (diag.state === 'gpu' && diag.runtime === 'vision') {
            lines.push('INTERPRETATION: Apple Vision (VNDetectHumanBodyPoseRequest) — Neural Engine / GPU. Up to 19 joints.');
        }
        else if (diag.runtime === 'webview' || diag.runtime === undefined) {
            lines.push('INTERPRETATION: offline WebView MoveNet Lightning (ANGLE WebGL, bundled model) — ' +
                'same stack as the PoseTracker WebView product. Expected real-time on both platforms.');
        }
        else if (diag.state === 'cpu-fallback') {
            lines.push('INTERPRETATION: non-accelerated path (cpu-fallback). Expect low FPS.');
        }
        else if (diag.state === 'gpu') {
            lines.push('INTERPRETATION: GPU path accepted by health check.');
        }
        else if (diag.state === 'unavailable') {
            lines.push('INTERPRETATION: no usable backend — model could not run.');
        }
    }
    if (extra) {
        lines.push(`extra: ${JSON.stringify(extra)}`);
    }
    lines.push('======== END ACCELERATION REPORT ========');
    for (const line of lines) {
        console.log(PREFIX, line);
    }
}
/** Throttled FPS / latency line for the camera loop (Metro-friendly). */
function logFrameStats(stats) {
    console.log(PREFIX, `FRAMESTATS fps=${stats.fps} ` +
        `medianMs=${stats.medianLatencyMs != null ? Math.round(stats.medianLatencyMs) : 'n/a'} ` +
        `backend=${stats.backend} acceleration=${stats.acceleration} ` +
        `frames=${stats.frames} kp≥0.3=${stats.keypointsAbove03}/17 ` +
        `meanScore=${stats.meanScore.toFixed(2)}`);
}
