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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { usePoseTracker } from '../PoseTrackerProvider';
import { WebViewPoseBackend } from '../backends/webview/WebViewPoseBackend';
import {
  buildPoseHtml,
  DEFAULT_LOADING_TEXT,
} from '../backends/webview/poseHtml';
import type { PoseRuntimeParts } from '../runtime/RuntimeCache';
import { getMinTargetFps, type QualityProfile } from '../quality/profiles';
import { shouldShowWatermark } from '../types/features';
import type { Pose } from '../types/pose';
import type { SkeletonDefinition } from '../types/skeleton';

declare function require(name: string): unknown;

function getReactNativeWebView(): {
  WebView: React.ComponentType<Record<string, unknown>>;
} | null {
  try {
    return require('react-native-webview') as {
      WebView: React.ComponentType<Record<string, unknown>>;
    };
  } catch {
    return null;
  }
}

function injectQuality(
  webRef: React.RefObject<{ injectJavaScript?: (js: string) => void } | null>,
  profile: QualityProfile,
): void {
  const payload = JSON.stringify({
    idealWidth: profile.idealWidth,
    idealHeight: profile.idealHeight,
    idealFrameRate: profile.idealFrameRate,
    profileId: profile.id,
  });
  webRef.current?.injectJavaScript?.(
    `window.__PT_SET_QUALITY && window.__PT_SET_QUALITY(${payload}); true;`,
  );
}

export interface WebViewPoseViewProps {
  style?: StyleProp<ViewStyle>;
  /** 'front' | 'back' — mapped to getUserMedia facingMode. Default front. */
  position?: 'front' | 'back';
  /**
   * Draw the skeleton overlay inside the page. Default `true` — same as the
   * PoseTracker WebView `skeleton="true"` query param. Pass `false` for a
   * clean camera preview (e.g. when rendering your own overlay from
   * `keypoints` events).
   */
  drawSkeleton?: boolean;
  /**
   * Show a placement guide box (WebView `postureBox` parity) while the
   * active exercise reports `posture.ready === false`. Default `true`.
   * Drawn as an RN sibling overlay (reliable on iOS; Android WebView may
   * composite above it — hosts can also render from `onPosture`).
   */
  drawPlacementBox?: boolean;
  /**
   * Placement box inset as a percentage of each edge (default `10`, same
   * as the WebView / engine posture padding).
   */
  placementPaddingPercent?: number;
  /**
   * Cold-start depth for this WebView page:
   * - `full` (default): open the camera after MoveNet warm-up — use on the
   *   visible camera screen (user expects the permission prompt).
   * - `basic`: model + WebGL only — use on hidden warmers / lobby screens so
   *   preload never triggers getUserMedia unexpectedly.
   */
  coldStart?: 'basic' | 'full';
  /**
   * Boot overlay label (WebView `loading_message` query param parity).
   * Default `"AI Loading"`. Technical progress (`accessing webcam`, backend,
   * medianMs, …) is emitted as `initialization` / `diag` events — not shown
   * on the branded loading UI.
   */
  loadingText?: string;
  /**
   * Force the bottom-right PoseTracker watermark on/off. When omitted, the
   * SDK derives it from the configure manifest plan: shown for keyless /
   * `free` / non-paid; hidden for paid plans (`developer`, `enterprise`, …).
   * Always off for `coldStart: 'basic'` warmers.
   */
  showWatermark?: boolean;
  /**
   * Custom skeleton overlay (Strapi document shape). When omitted, the page
   * uses the PoseTracker API default (navy `#010A73` + gold `#FFC300`).
   * Takes precedence over {@link skeletonUuid}.
   */
  skeletonDef?: SkeletonDefinition | null;
  /**
   * Load a custom skeleton by Strapi `api_uuid` (WebView `?skeleton=<uuid>`).
   * Fetched via `GET /api/sdk/skeleton`. Ignored if `skeletonDef` is set.
   */
  skeletonUuid?: string | null;
  onPose?: (pose: Pose, stats: { inferenceTimeMs: number; timestampMs: number }) => void;
  children?: React.ReactNode;
}

export function WebViewPoseView(props: WebViewPoseViewProps): React.ReactElement {
  const { client, manifest } = usePoseTracker();
  const backend = client.getBackend();
  const webviewMod = useMemo(() => getReactNativeWebView(), []);
  const webRef = useRef<{ injectJavaScript?: (js: string) => void } | null>(null);
  /** Boot-time profile only — mid-session downgrades use injectJavaScript. */
  const [bootProfile, setBootProfile] = useState<QualityProfile | null>(null);

  /** Bundled pose-runtime parts (TF.js + MoveNet + page runtime). */
  const [runtimeParts, setRuntimeParts] = useState<PoseRuntimeParts | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const isWebViewBackend = backend instanceof WebViewPoseBackend;
  const facingMode = props.position === 'back' ? 'environment' : 'user';
  const drawSkeleton = props.drawSkeleton ?? true;
  const drawPlacementBox = props.drawPlacementBox ?? true;
  const placementPaddingPercent = props.placementPaddingPercent ?? 10;
  /** Camera screens default to full; warmers must pass `basic`. */
  const coldStart = props.coldStart ?? 'full';
  const loadingText =
    typeof props.loadingText === 'string' && props.loadingText.trim().length > 0
      ? props.loadingText.trim()
      : DEFAULT_LOADING_TEXT;
  /** Plan from configure manifest — drives watermark when prop is omitted. */
  const planType = manifest?.plan?.plan ?? client.getPlanType();
  /**
   * Plan-gated watermark (override via prop). Recomputed when configure
   * resolves a new manifest so upgrades hide the mark without remount.
   */
  const resolvedShowWatermark =
    coldStart === 'basic'
      ? false
      : (props.showWatermark ?? shouldShowWatermark(planType));
  const [showPlacementBox, setShowPlacementBox] = useState(false);
  const [resolvedSkeleton, setResolvedSkeleton] = useState<SkeletonDefinition | null>(
    props.skeletonDef ?? null,
  );

  // Resolve custom skeleton: explicit def wins; else fetch by uuid (API parity).
  useEffect(() => {
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
        if (!cancelled) setResolvedSkeleton(def);
      })
      .catch(() => {
        if (!cancelled) setResolvedSkeleton(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, props.skeletonDef, props.skeletonUuid]);

  // WebView postureBox parity: show guide while placement is not ready.
  useEffect(() => {
    if (!drawPlacementBox) {
      setShowPlacementBox(false);
      return;
    }
    return client.addEventListener((event) => {
      if (event.type === 'posture') {
        setShowPlacementBox(!event.ready);
      } else if (event.type === 'exercise_summary') {
        setShowPlacementBox(false);
      }
    });
  }, [client, drawPlacementBox]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = await client.resolveQualityProfile();
      if (cancelled) return;
      await client.beginQualitySession();
      if (cancelled) return;
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
          minStableFps: getMinTargetFps(),
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Resolve the pose-runtime payload (cache hit after preload(); otherwise
  // downloads + verifies now). Cold cache + offline = explicit error.
  useEffect(() => {
    let cancelled = false;
    client
      .getRuntimeParts()
      .then((parts) => {
        if (!cancelled) setRuntimeParts(parts);
      })
      .catch((err: unknown) => {
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
  const html = useMemo(() => {
    if (!bootProfile || !runtimeParts) return null;
    return buildPoseHtml(runtimeParts, {
      facingMode,
      idealWidth: bootProfile.idealWidth,
      idealHeight: bootProfile.idealHeight,
      idealFrameRate: bootProfile.idealFrameRate,
      profileId: bootProfile.id,
      minTargetFps: getMinTargetFps(),
      drawSkeleton,
      coldStart,
      loadingText,
      showWatermark: resolvedShowWatermark,
      // Default API skeleton is baked into the page runtime; customs are
      // injected via __PT_SET_SKELETON (avoids remounting on uuid fetch).
      skeletonDef: props.skeletonDef ?? null,
      capturePriority: client.getQualityState().capturePriority,
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
  ]);

  // Apply custom skeleton (uuid fetch or prop) without remounting the page.
  useEffect(() => {
    if (!isWebViewBackend || !html) return;
    const payload = JSON.stringify(resolvedSkeleton);
    webRef.current?.injectJavaScript?.(
      `window.__PT_SET_SKELETON && window.__PT_SET_SKELETON(${payload}); true;`,
    );
  }, [isWebViewBackend, html, resolvedSkeleton]);

  // Plan / prop watermark updates without remounting.
  useEffect(() => {
    if (!isWebViewBackend || !html) return;
    webRef.current?.injectJavaScript?.(
      `window.__PT_SET_WATERMARK && window.__PT_SET_WATERMARK(${
        resolvedShowWatermark ? 'true' : 'false'
      }); true;`,
    );
  }, [isWebViewBackend, html, resolvedShowWatermark]);

  // loadingText prop updates without remounting (html rebuild still covers
  // first paint via useMemo).
  useEffect(() => {
    if (!isWebViewBackend || !html) return;
    const payload = JSON.stringify(loadingText);
    webRef.current?.injectJavaScript?.(
      `window.__PT_SET_LOADING_TEXT && window.__PT_SET_LOADING_TEXT(${payload}); true;`,
    );
  }, [isWebViewBackend, html, loadingText]);

  useEffect(() => {
    if (!(backend instanceof WebViewPoseBackend)) {
      return;
    }
    backend.setAttached(true);
    backend.setOnPose((pose, inferenceTimeMs) => {
      client.ingestPose(pose);
      props.onPose?.(pose, { inferenceTimeMs, timestampMs: pose.timestampMs });
    });
    backend.setOpenCameraHandler(() => {
      webRef.current?.injectJavaScript?.(
        'window.__PT_OPEN_CAMERA && window.__PT_OPEN_CAMERA(); true;',
      );
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
  useEffect(() => {
    if (!isWebViewBackend) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        webRef.current?.injectJavaScript?.(
          'window.__PT_SUSPEND && window.__PT_SUSPEND(); true;',
        );
      } else if (state === 'active' && coldStart === 'full') {
        webRef.current?.injectJavaScript?.(
          'window.__PT_RESUME && window.__PT_RESUME(); true;',
        );
      }
      // 'inactive' (iOS control center / app switcher) is intentionally
      // ignored: brief overlays shouldn't tear the camera down.
    });
    return () => sub.remove();
  }, [isWebViewBackend, coldStart]);

  if (!webviewMod) {
    return (
      <View style={[styles.fill, styles.center, props.style]}>
        <Text style={styles.error}>
          react-native-webview is required for the Chromium pose backend. Run:{'\n'}
          npm install react-native-webview (or npx expo install react-native-webview)
        </Text>
      </View>
    );
  }

  if (!isWebViewBackend) {
    return (
      <View style={[styles.fill, styles.center, props.style]}>
        <Text style={styles.error}>
          WebViewPoseView requires the WebView backend (preferredBackend
          &apos;auto&apos; or &apos;webview&apos;) — the client is on Apple Vision
          (use PoseCameraView instead).
        </Text>
      </View>
    );
  }

  if (runtimeError) {
    return (
      <View style={[styles.fill, styles.center, props.style]}>
        <Text style={styles.error}>{runtimeError}</Text>
      </View>
    );
  }

  if (!html || !bootProfile) {
    return <View style={[styles.fill, props.style]} />;
  }

  const WebView = webviewMod.WebView;
  const wvBackend = backend as WebViewPoseBackend;

  return (
    <View style={[styles.fill, props.style]} collapsable={false}>
      <WebView
        ref={webRef}
        style={StyleSheet.absoluteFill}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://localhost/' }}
        allowFileAccess
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        javaScriptEnabled
        domStorageEnabled
        // Android: needed for getUserMedia in WebView
        setSupportMultipleWindows={false}
        // NOTE: never set androidLayerType — 'hardware'/'software' force the
        // WebView into an Android View layer instead of its native SurfaceView
        // path and destroy WebGL/video performance. Default ('none') is correct.
        // Skeleton is drawn inside the HTML — Android WebView often composites
        // above RN siblings, so PoseOverlay children are not visible there.
        onMessage={(event: { nativeEvent: { data: string } }) => {
          wvBackend.handleMessage(event.nativeEvent.data);
        }}
        onError={(e: { nativeEvent: { description?: string } }) => {
          wvBackend.handleMessage(
            JSON.stringify({
              type: 'error',
              message: e.nativeEvent.description ?? 'WebView error',
            }),
          );
        }}
      />
      {showPlacementBox ? (
        <View
          pointerEvents="none"
          style={[
            styles.placementBox,
            {
              top: `${placementPaddingPercent}%`,
              bottom: `${placementPaddingPercent}%`,
              left: `${placementPaddingPercent}%`,
              right: `${placementPaddingPercent}%`,
            },
          ]}
        />
      ) : null}
      {/* Optional RN overlay (works on iOS; usually hidden under Android WebView surface). */}
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
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
