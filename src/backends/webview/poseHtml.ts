/**
 * WebView HTML assembler.
 *
 * Injects the bundled pose runtime (TF.js + MoveNet + pose-pipeline.wasm +
 * page runtime) from {@link getBundledRuntimeParts} into a single HTML
 * string (`source={{ html }}`). Same injection path as before — camera,
 * adaptive quality, postMessage events unchanged.
 */

import { Platform } from 'react-native';
import {
  ANDROID_INFER_FRAME_SKIP,
  ANDROID_PERF_DEBUG,
  ANDROID_PREPROCESS_PATH,
  ANDROID_SOFT_CAP_PROFILE,
  CAPTURE_CONSTRAINT_MODE,
} from '../../quality/captureMode';
import type { CapturePriority } from '../../quality/profiles';
import type { PoseRuntimeParts } from '../../runtime/RuntimeCache';
import type { SkeletonDefinition } from '../../types/skeleton';
import { POSETRACKER_LOGO_DATA_URL } from './brandAssets';

/** Bumped on every assembler-path change — appears in WebView diag logs. */
export const POSE_HTML_BUILD = '20260810-bootBrand';

/** Default boot overlay copy (WebView `loading_message` parity). */
export const DEFAULT_LOADING_TEXT = 'AI Loading';

export interface PoseHtmlOptions {
  facingMode?: 'user' | 'environment';
  /** Min keypoint score for the in-page skeleton. Default 0.25. */
  minScore?: number;
  /**
   * getUserMedia resolution hint. Defaults follow the adaptive quality
   * profile (often UltraLite on Android, Pro/Prime on iOS). Inference always
   * letterboxes down to 192×192 regardless.
   */
  idealWidth?: number;
  idealHeight?: number;
  idealFrameRate?: number;
  /** Active adaptive quality profile id (ceiling for warm-up downgrades). */
  profileId?: string;
  /**
   * Platform minimum target FPS (floor). iOS ≈ 30, Android ≈ 10 (experiment).
   * Passed from RN so the HTML page shares the same AdaptiveChoice policy.
   */
  minTargetFps?: number;
  /** Draw the skeleton overlay inside the page. Default true. */
  drawSkeleton?: boolean;
  /**
   * `performance` (default) applies Android soft-cap / warm-up floor mapping.
   * `quality` disables soft-cap and opens at prime / device-native HD.
   */
  capturePriority?: CapturePriority;
  /**
   * `basic` (default for warmers): model + WebGL zeros only — no getUserMedia.
   * `full`: open the camera after warm-up (camera screens / explicit full preload).
   */
  coldStart?: 'basic' | 'full';
  /**
   * Custom skeleton overlay (Strapi skeleton document). When omitted, the
   * page uses PoseTrackerFront `DEFAULT_SKELETON` (navy + gold).
   */
  skeletonDef?: SkeletonDefinition | null;
  /**
   * Boot overlay label (WebView `loading_message` query param parity).
   * Default {@link DEFAULT_LOADING_TEXT}. Technical progress stays on
   * `initialization` / `diag` events — never on this UI.
   */
  loadingText?: string;
  /**
   * Bottom-right “powered by” + join-logo watermark on the live camera
   * surface. Hosts typically derive this from plan (`!isPaidPlan`).
   * Ignored / forced off for `coldStart: 'basic'` warmers.
   */
  showWatermark?: boolean;
  /** Show the technical `#hud` overlay (FPS / backend). Default false. */
  debugHud?: boolean;
}

const PAGE_CSS = `
    html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
    #wrap { position:relative; width:100%; height:100%; background:#000; }
    video, canvas {
      position:absolute; inset:0; width:100%; height:100%;
      object-fit:cover; opacity:0; transition:opacity 180ms ease-out;
    }
    video { z-index:1; background:#000; }
    canvas { z-index:2; pointer-events:none; }
    #boot {
      position:absolute; inset:0; z-index:4;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      background:#0a0a0a; color:#fff;
      font:15px/1.4 -apple-system,system-ui,sans-serif;
      transition:opacity 180ms ease-out;
      gap:0;
      padding:24px;
      box-sizing:border-box;
    }
    #boot.hide { opacity:0; pointer-events:none; }
    #boot .boot-powered {
      color:rgba(255,255,255,0.55);
      font-size:11px;
      font-weight:600;
      letter-spacing:0.14em;
      text-transform:uppercase;
      margin-bottom:10px;
    }
    #boot .boot-logo {
      width:min(220px, 62vw);
      height:auto;
      margin-bottom:22px;
      display:block;
    }
    #boot .boot-spinner {
      width:28px; height:28px; margin-bottom:16px;
      border:2px solid #333; border-top-color:#ffc300; border-radius:50%;
      animation:ptspin 0.8s linear infinite;
    }
    #boot .boot-msg {
      color:#e8e8e8; font-size:14px; font-weight:500;
      text-align:center; padding:0 12px; min-height:1.2em;
    }
    #boot .boot-msg.is-error { color:#FE8370; font-size:13px; }
    @keyframes ptspin { to { transform:rotate(360deg); } }
    #wm {
      position:absolute; right:10px; bottom:10px; z-index:3;
      display:none; flex-direction:column; align-items:flex-end;
      pointer-events:none;
      text-shadow:0 1px 2px rgba(0,0,0,0.55);
    }
    #wm.show { display:flex; }
    #wm .wm-powered {
      color:rgba(255,255,255,0.7);
      font:600 11px/1.2 -apple-system,system-ui,sans-serif;
      letter-spacing:0.12em;
      text-transform:uppercase;
      margin-bottom:4px;
    }
    #wm .wm-logo {
      width:130px; height:auto; display:block;
      opacity:0.92;
      filter:drop-shadow(0 1px 2px rgba(0,0,0,0.45));
    }
    #hud {
      position:absolute; left:8px; right:8px; bottom:8px; z-index:3;
      color:#ffc300; font:12px/1.3 -apple-system,system-ui,sans-serif;
      text-shadow:0 1px 2px #000; pointer-events:none;
      display:none;
    }
    #hud.debug { display:block; }
`;

/** Escape text for safe HTML text-node content. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `</script` inside injected JS text would terminate the inline script tag. */
function escapeScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

/**
 * Assemble the pose page from the downloaded runtime parts. Pure assembly:
 * no pose logic lives here.
 */
export function buildPoseHtml(parts: PoseRuntimeParts, options?: PoseHtmlOptions): string {
  const isAndroid = Platform.OS === 'android';
  const capturePriority: CapturePriority =
    options?.capturePriority === 'quality' ? 'quality' : 'performance';
  const preferQuality = capturePriority === 'quality';
  const coldStart = options?.coldStart === 'full' ? 'full' : 'basic';
  const loadingText =
    typeof options?.loadingText === 'string' && options.loadingText.trim().length > 0
      ? options.loadingText.trim()
      : DEFAULT_LOADING_TEXT;
  // Live watermark only on full camera surfaces. Default on (keyless / free);
  // hosts pass false for paid / enterprise via WebViewPoseView.
  const watermarkOn = coldStart === 'full' && (options?.showWatermark ?? true);
  const debugHud = !!options?.debugHud;
  const config = JSON.stringify({
    facingMode: options?.facingMode ?? 'user',
    minScore: options?.minScore ?? 0.25,
    // Safe default before AdaptiveQualityController resolves: UltraLite.
    // WebViewPoseView always injects the resolved profile constraints.
    idealWidth: options?.idealWidth ?? 480,
    idealHeight: options?.idealHeight ?? 360,
    idealFrameRate: options?.idealFrameRate ?? 24,
    profileId: options?.profileId ?? 'ultralite',
    minTargetFps: options?.minTargetFps ?? 15,
    drawSkeleton: options?.drawSkeleton ?? true,
    coldStart,
    skeletonDef: options?.skeletonDef ?? null,
    loadingText,
    showWatermark: watermarkOn,
    debugHud,
    /** See src/quality/captureMode.ts — REVERT by flipping that flag. */
    captureConstraintMode: CAPTURE_CONSTRAINT_MODE,
    capturePriority,
    platform: Platform.OS,
    /**
     * Android-only knobs. iOS always gets inert defaults so behaviour stays
     * identical to the pre-experiment path. Soft-cap is off when the host
     * opts into capturePriority=quality (sharp preview over FPS).
     */
    inferFrameSkip:
      isAndroid && ANDROID_INFER_FRAME_SKIP > 0 ? ANDROID_INFER_FRAME_SKIP : 0,
    preprocessPath: isAndroid ? ANDROID_PREPROCESS_PATH : 'imagebitmap',
    softCapProfile:
      isAndroid && !preferQuality ? ANDROID_SOFT_CAP_PROFILE : null,
    perfDebug: isAndroid && ANDROID_PERF_DEBUG,
  });

  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
    '<style>', PAGE_CSS, '</style></head><body>',
    '<div id="wrap">',
    '<video id="video" playsinline muted autoplay></video>',
    '<canvas id="overlay"></canvas>',
    // Watermark visibility is toggled by pose-runtime once the camera is
    // revealed (CFG.showWatermark + coldStart=full). Start hidden.
    '<div id="wm">',
    '<div class="wm-powered">powered by</div>',
    '<img class="wm-logo" alt="PoseTracker" src="', POSETRACKER_LOGO_DATA_URL, '" />',
    '</div>',
    '<div id="boot">',
    '<div class="boot-powered">powered by</div>',
    '<img class="boot-logo" alt="PoseTracker" src="', POSETRACKER_LOGO_DATA_URL, '" />',
    '<div class="boot-spinner"></div>',
    '<div class="boot-msg">', escapeHtml(loadingText), '</div>',
    '</div>',
    '<div id="hud"', debugHud || (isAndroid && ANDROID_PERF_DEBUG) ? ' class="debug"' : '', '>',
    'booting…',
    '</div>',
    '</div>',
    '<script>', escapeScript(parts.tfjsJs), '</script>',
    '<script>window.__PT_BUILD=', JSON.stringify(`${POSE_HTML_BUILD}/${parts.version}`),
    ';window.__PT_CONFIG=', config,
    ';window.__PT_MODEL_JSON=', JSON.stringify(parts.modelJson),
    ';window.__PT_WEIGHTS_B64=', JSON.stringify(parts.weightsB64),
    ';window.__PT_WASM_B64=', JSON.stringify(parts.tfjsWasmB64),
    ';window.__PT_PIPELINE_WASM_B64=', JSON.stringify(parts.pipelineWasmB64),
    ';</script>',
    '<script>', escapeScript(parts.runtimeJs), '</script>',
    '</body></html>',
  ].join('');
}
