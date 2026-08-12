"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebViewPoseView = WebViewPoseView;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * Camera + inference surface for {@link WebViewPoseBackend} — the SDK's
 * default runtime on BOTH platforms.
 *
 * Renders a Chromium/WKWebView that owns getUserMedia + MoveNet Lightning
 * (TF.js WebGL, fully offline — runtime and model are bundled in the
 * package) and draws the skeleton inside the page.
 *
 * Camera capture resolution is driven by {@link AdaptiveQualityController}
 * (AdaptiveChoice + crash-loop guard + live FPS downgrades).
 *
 * Requires peer `react-native-webview` (included in Expo Go).
 */
const react_1 = require("react");
const react_native_1 = require("react-native");
const PoseTrackerProvider_1 = require("../PoseTrackerProvider");
const WebViewPoseBackend_1 = require("../backends/webview/WebViewPoseBackend");
const poseHtml_1 = require("../backends/webview/poseHtml");
const profiles_1 = require("../quality/profiles");
const features_1 = require("../types/features");
function getReactNativeWebView() {
    try {
        return require('react-native-webview');
    }
    catch {
        return null;
    }
}
function injectQuality(webRef, profile) {
    const payload = JSON.stringify({
        idealWidth: profile.idealWidth,
        idealHeight: profile.idealHeight,
        idealFrameRate: profile.idealFrameRate,
        profileId: profile.id,
    });
    webRef.current?.injectJavaScript?.(`window.__PT_SET_QUALITY && window.__PT_SET_QUALITY(${payload}); true;`);
}
function WebViewPoseView(props) {
    const { client, manifest } = (0, PoseTrackerProvider_1.usePoseTracker)();
    const backend = client.getBackend();
    const webviewMod = (0, react_1.useMemo)(() => getReactNativeWebView(), []);
    const webRef = (0, react_1.useRef)(null);
    /** Boot-time profile only — mid-session downgrades use injectJavaScript. */
    const [bootProfile, setBootProfile] = (0, react_1.useState)(null);
    /** Bundled pose-runtime parts (TF.js + MoveNet + page runtime). */
    const [runtimeParts, setRuntimeParts] = (0, react_1.useState)(null);
    const [runtimeError, setRuntimeError] = (0, react_1.useState)(null);
    const isWebViewBackend = backend instanceof WebViewPoseBackend_1.WebViewPoseBackend;
    const facingMode = props.position === 'back' ? 'environment' : 'user';
    const drawSkeleton = props.drawSkeleton ?? true;
    const drawPlacementBox = props.drawPlacementBox ?? true;
    const placementPaddingPercent = props.placementPaddingPercent ?? 10;
    /** Camera screens default to full; warmers must pass `basic`. */
    const coldStart = props.coldStart ?? 'full';
    const loadingText = typeof props.loadingText === 'string' && props.loadingText.trim().length > 0
        ? props.loadingText.trim()
        : poseHtml_1.DEFAULT_LOADING_TEXT;
    /** Plan from configure manifest — drives watermark when prop is omitted. */
    const planType = manifest?.plan?.plan ?? client.getPlanType();
    /**
     * Plan-gated watermark (override via prop). Recomputed when configure
     * resolves a new manifest so upgrades hide the mark without remount.
     */
    const resolvedShowWatermark = coldStart === 'basic'
        ? false
        : (props.showWatermark ?? (0, features_1.shouldShowWatermark)(planType));
    const [showPlacementBox, setShowPlacementBox] = (0, react_1.useState)(false);
    const [resolvedSkeleton, setResolvedSkeleton] = (0, react_1.useState)(props.skeletonDef ?? null);
    // Resolve custom skeleton: explicit def wins; else fetch by uuid (API parity).
    (0, react_1.useEffect)(() => {
        if (props.skeletonDef) {
            setResolvedSkeleton(props.skeletonDef);
            return;
        }
        const uuid = props.skeletonUuid?.trim();
        if (!uuid || uuid === 'true' || uuid === 'false') {
            setResolvedSkeleton(null);
            return;
        }
        let cancelled = false;
        client
            .fetchSkeleton(uuid)
            .then((def) => {
            if (!cancelled)
                setResolvedSkeleton(def);
        })
            .catch(() => {
            if (!cancelled)
                setResolvedSkeleton(null);
        });
        return () => {
            cancelled = true;
        };
    }, [client, props.skeletonDef, props.skeletonUuid]);
    // WebView postureBox parity: show guide while placement is not ready.
    (0, react_1.useEffect)(() => {
        if (!drawPlacementBox) {
            setShowPlacementBox(false);
            return;
        }
        return client.addEventListener((event) => {
            if (event.type === 'posture') {
                setShowPlacementBox(!event.ready);
            }
            else if (event.type === 'exercise_summary') {
                setShowPlacementBox(false);
            }
        });
    }, [client, drawPlacementBox]);
    (0, react_1.useEffect)(() => {
        let cancelled = false;
        (async () => {
            const resolved = await client.resolveQualityProfile();
            if (cancelled)
                return;
            await client.beginQualitySession();
            if (cancelled)
                return;
            setBootProfile(resolved);
        })().catch(() => {
            // Fall back to UltraLite constraints embedded in buildPoseHtml defaults.
            if (!cancelled) {
                setBootProfile({
                    id: 'ultralite',
                    label: 'UltraLite (fallback)',
                    idealWidth: 480,
                    idealHeight: 360,
                    idealFrameRate: 24,
                    minStableFps: (0, profiles_1.getMinTargetFps)(),
                });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [client]);
    // Resolve the pose-runtime payload (cache hit after preload(); otherwise
    // downloads + verifies now). Cold cache + offline = explicit error.
    (0, react_1.useEffect)(() => {
        let cancelled = false;
        client
            .getRuntimeParts()
            .then((parts) => {
            if (!cancelled)
                setRuntimeParts(parts);
        })
            .catch((err) => {
            if (!cancelled) {
                setRuntimeError(err instanceof Error ? err.message : String(err));
            }
        });
        return () => {
            cancelled = true;
        };
    }, [client]);
    // Watermark plan upgrades inject `__PT_SET_WATERMARK` (no remount); snapshot
    // `resolvedShowWatermark` into the initial HTML only.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- watermark via inject
    const html = (0, react_1.useMemo)(() => {
        if (!bootProfile || !runtimeParts)
            return null;
        return (0, poseHtml_1.buildPoseHtml)(runtimeParts, {
            facingMode,
            idealWidth: bootProfile.idealWidth,
            idealHeight: bootProfile.idealHeight,
            idealFrameRate: bootProfile.idealFrameRate,
            profileId: bootProfile.id,
            minTargetFps: (0, profiles_1.getMinTargetFps)(),
            drawSkeleton,
            coldStart,
            loadingText,
            showWatermark: resolvedShowWatermark,
            // Default API skeleton is baked into the page runtime; customs are
            // injected via __PT_SET_SKELETON (avoids remounting on uuid fetch).
            skeletonDef: props.skeletonDef ?? null,
            capturePriority: client.getQualityState().capturePriority,
            sourceType: props.source ?? 'camera',
            sourceUrl: props.sourceUri,
        });
    }, [
        facingMode,
        bootProfile,
        runtimeParts,
        client,
        drawSkeleton,
        coldStart,
        loadingText,
        props.skeletonDef,
        props.source,
        props.sourceUri,
    ]);
    // Apply custom skeleton (uuid fetch or prop) without remounting the page.
    (0, react_1.useEffect)(() => {
        if (!isWebViewBackend || !html)
            return;
        const payload = JSON.stringify(resolvedSkeleton);
        webRef.current?.injectJavaScript?.(`window.__PT_SET_SKELETON && window.__PT_SET_SKELETON(${payload}); true;`);
    }, [isWebViewBackend, html, resolvedSkeleton]);
    // Plan / prop watermark updates without remounting.
    (0, react_1.useEffect)(() => {
        if (!isWebViewBackend || !html)
            return;
        webRef.current?.injectJavaScript?.(`window.__PT_SET_WATERMARK && window.__PT_SET_WATERMARK(${resolvedShowWatermark ? 'true' : 'false'}); true;`);
    }, [isWebViewBackend, html, resolvedShowWatermark]);
    // loadingText prop updates without remounting (html rebuild still covers
    // first paint via useMemo).
    (0, react_1.useEffect)(() => {
        if (!isWebViewBackend || !html)
            return;
        const payload = JSON.stringify(loadingText);
        webRef.current?.injectJavaScript?.(`window.__PT_SET_LOADING_TEXT && window.__PT_SET_LOADING_TEXT(${payload}); true;`);
    }, [isWebViewBackend, html, loadingText]);
    // Live source switches after first HTML boot (CFG already has initial source).
    const lastSourceHtmlRef = (0, react_1.useRef)(null);
    (0, react_1.useEffect)(() => {
        if (!isWebViewBackend || !html)
            return;
        if (lastSourceHtmlRef.current !== html) {
            lastSourceHtmlRef.current = html;
            return;
        }
        const type = props.source ?? 'camera';
        const payload = JSON.stringify({
            type,
            url: props.sourceUri ?? null,
            base64: props.sourceBase64 ?? null,
            mime: props.sourceMime ?? null,
        });
        webRef.current?.injectJavaScript?.(`window.__PT_SET_SOURCE && window.__PT_SET_SOURCE(${payload}); true;`);
    }, [
        isWebViewBackend,
        html,
        props.source,
        props.sourceUri,
        props.sourceBase64,
        props.sourceMime,
    ]);
    (0, react_1.useEffect)(() => {
        if (!(backend instanceof WebViewPoseBackend_1.WebViewPoseBackend)) {
            return;
        }
        backend.setAttached(true);
        backend.setOnPose((pose, inferenceTimeMs) => {
            client.ingestPose(pose);
            props.onPose?.(pose, { inferenceTimeMs, timestampMs: pose.timestampMs });
        });
        backend.setOpenCameraHandler(() => {
            webRef.current?.injectJavaScript?.('window.__PT_OPEN_CAMERA && window.__PT_OPEN_CAMERA(); true;');
        });
        // Live downgrades restart getUserMedia without remounting the WebView.
        client.setQualityApplyHandler((next) => {
            injectQuality(webRef, next);
        });
        return () => {
            backend.setOnPose(undefined);
            backend.setOpenCameraHandler(undefined);
            backend.setAttached(false);
            client.setQualityApplyHandler(undefined);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- attach once per backend identity
    }, [backend, client]);
    // Battery / thermal safety: release the in-page camera and halt the
    // inference loop while the app is backgrounded, reacquire on foreground.
    // Skip resume injection for basic (model-only) pages — no camera to reopen.
    (0, react_1.useEffect)(() => {
        if (!isWebViewBackend)
            return;
        const sub = react_native_1.AppState.addEventListener('change', (state) => {
            if (state === 'background') {
                webRef.current?.injectJavaScript?.('window.__PT_SUSPEND && window.__PT_SUSPEND(); true;');
            }
            else if (state === 'active' && coldStart === 'full') {
                webRef.current?.injectJavaScript?.('window.__PT_RESUME && window.__PT_RESUME(); true;');
            }
            // 'inactive' (iOS control center / app switcher) is intentionally
            // ignored: brief overlays shouldn't tear the camera down.
        });
        return () => sub.remove();
    }, [isWebViewBackend, coldStart]);
    if (!webviewMod) {
        return ((0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.fill, styles.center, props.style], children: (0, jsx_runtime_1.jsxs)(react_native_1.Text, { style: styles.error, children: ["react-native-webview is required for the Chromium pose backend. Run:", '\n', "npm install react-native-webview (or npx expo install react-native-webview)"] }) }));
    }
    if (!isWebViewBackend) {
        return ((0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.fill, styles.center, props.style], children: (0, jsx_runtime_1.jsx)(react_native_1.Text, { style: styles.error, children: "WebViewPoseView requires the WebView backend (preferredBackend 'auto' or 'webview') \u2014 the client is on Apple Vision (use PoseCameraView instead)." }) }));
    }
    if (runtimeError) {
        return ((0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.fill, styles.center, props.style], children: (0, jsx_runtime_1.jsx)(react_native_1.Text, { style: styles.error, children: runtimeError }) }));
    }
    if (!html || !bootProfile) {
        return (0, jsx_runtime_1.jsx)(react_native_1.View, { style: [styles.fill, props.style] });
    }
    const WebView = webviewMod.WebView;
    const wvBackend = backend;
    return ((0, jsx_runtime_1.jsxs)(react_native_1.View, { style: [styles.fill, props.style], collapsable: false, children: [(0, jsx_runtime_1.jsx)(WebView, { ref: webRef, style: react_native_1.StyleSheet.absoluteFill, originWhitelist: ['*'], source: { html, baseUrl: 'https://localhost/' }, allowFileAccess: true, mediaPlaybackRequiresUserAction: false, mediaCapturePermissionGrantType: "grant", allowsInlineMediaPlayback: true, javaScriptEnabled: true, domStorageEnabled: true, 
                // Android: needed for getUserMedia in WebView
                setSupportMultipleWindows: false, 
                // NOTE: never set androidLayerType — 'hardware'/'software' force the
                // WebView into an Android View layer instead of its native SurfaceView
                // path and destroy WebGL/video performance. Default ('none') is correct.
                // Skeleton is drawn inside the HTML — Android WebView often composites
                // above RN siblings, so PoseOverlay children are not visible there.
                onMessage: (event) => {
                    wvBackend.handleMessage(event.nativeEvent.data);
                }, onError: (e) => {
                    wvBackend.handleMessage(JSON.stringify({
                        type: 'error',
                        message: e.nativeEvent.description ?? 'WebView error',
                    }));
                } }), showPlacementBox ? ((0, jsx_runtime_1.jsx)(react_native_1.View, { pointerEvents: "none", style: [
                    styles.placementBox,
                    {
                        top: `${placementPaddingPercent}%`,
                        bottom: `${placementPaddingPercent}%`,
                        left: `${placementPaddingPercent}%`,
                        right: `${placementPaddingPercent}%`,
                    },
                ] })) : null, props.children] }));
}
const styles = react_native_1.StyleSheet.create({
    fill: { flex: 1, backgroundColor: '#000' },
    center: { alignItems: 'center', justifyContent: 'center', padding: 16 },
    error: { color: '#FE8370', textAlign: 'center', fontSize: 13 },
    /** Front drawPostureBox stroke `#FE8370`. */
    placementBox: {
        position: 'absolute',
        borderWidth: 3,
        borderColor: '#FE8370',
        borderRadius: 8,
        backgroundColor: 'transparent',
    },
});
