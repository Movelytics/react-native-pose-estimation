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
import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import type { Pose } from '../types/pose';
import type { SkeletonDefinition } from '../types/skeleton';
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
    onPose?: (pose: Pose, stats: {
        inferenceTimeMs: number;
        timestampMs: number;
    }) => void;
    children?: React.ReactNode;
}
export declare function WebViewPoseView(props: WebViewPoseViewProps): React.ReactElement;
