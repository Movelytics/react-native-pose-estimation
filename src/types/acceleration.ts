/**
 * GPU-acceleration status types.
 *
 * Historical context (see docs/ANDROID_GL_ACCELERATION.md): on Android the
 * previous product generation had to run TF.js inside a WebView because it
 * was the only reliable way to get a working WebGL backend. The native path
 * (tfjs-react-native over expo-gl) can silently degrade — the platform
 * adapter *shims* float-texture extension queries, so TF.js may believe the
 * GPU supports float32 render targets when it does not, and expo-gl contexts
 * die on Android when the surface is backgrounded. These types exist so the
 * SDK reports an explicit acceleration verdict instead of failing silently
 * into a 1-2 fps CPU fallback.
 */

/**
 * - 'unknown':       warm-up has not completed yet.
 * - 'gpu':           rn-webgl (expo-gl) active and the warm-up health check
 *                    produced sane outputs within the latency budget.
 * - 'cpu-fallback':  inference works but is NOT GPU-accelerated (rn-webgl
 *                    failed to initialize, produced NaN/garbage, or was
 *                    pathologically slow — i.e. software rendering).
 * - 'unavailable':   no backend could run the model at all (fatal; the
 *                    client also reports status 'error').
 */
export type AccelerationState = 'unknown' | 'gpu' | 'cpu-fallback' | 'unavailable';

/** Raw GL context facts, gathered best-effort after backend init. */
export interface GlCapabilities {
  /** e.g. "OpenGL ES 3.0 ..." */
  glVersion: string | null;
  /** e.g. "Adreno (TM) 640", "Mali-G78", "PowerVR ..." — key for triage. */
  renderer: string | null;
  vendor: string | null;
  maxTextureSize: number | null;
  /**
   * Extension presence *as reported to TF.js*. WARNING: on rn-webgl the
   * tfjs-react-native platform adapter shims `getExtension` and always
   * reports EXT_color_buffer_float (Android) / EXT_color_buffer_half_float
   * as present, so `true` here does NOT prove hardware support. That lie is
   * exactly why the SDK forces f16 textures on Android and validates real
   * outputs in the health check.
   */
  colorBufferFloat: boolean;
  colorBufferHalfFloat: boolean;
  textureFloat: boolean;
  textureHalfFloat: boolean;
  /** True when the extension answers above come from the shimmed adapter. */
  extensionQueriesShimmed: boolean;
}

/** Snapshot of the TF.js WebGL flags that matter for Android stability. */
export type TfjsFlagSnapshot = Record<string, boolean | number | string | null>;

/**
 * Inference runtime that produced the acceleration verdict:
 * - 'webview': TF.js MoveNet inside a Chromium/WKWebView (ANGLE WebGL) —
 *              the SDK's base runtime, offline, same stack as the
 *              PoseTracker WebView product.
 * - 'vision':  Apple Vision (`VNDetectHumanBodyPoseRequest`) — iOS only.
 */
export type InferenceRuntime = 'webview' | 'vision';

/** Native accelerator label (Apple Vision). */
export type VisionDelegateLabel = 'apple-vision';

export type NativeDelegateLabel = VisionDelegateLabel;

export interface AccelerationDiagnostics {
  state: AccelerationState;
  /** Active TF.js backend after init/fallbacks: 'rn-webgl' | 'cpu' | null. */
  tfjsBackend: string | null;
  /** Which runtime produced this verdict (absent = 'tfjs', pre-TFLite SDKs). */
  runtime?: InferenceRuntime;
  /** Active native accelerator; null/absent for the TF.js backend. */
  delegate?: NativeDelegateLabel | null;
  /** Median duration of the timed warm-up inferences, in ms. */
  medianInferenceMs: number | null;
  /** Individual timed warm-up runs, in ms (first run includes shader compilation). */
  inferenceTimesMs: number[];
  /** Latency budget used by the health check to accept the GPU path. */
  maxAcceptableInferenceMs: number;
  capabilities: GlCapabilities | null;
  flags: TfjsFlagSnapshot;
  /** Number of GL context losses recovered since init (Android lifecycle). */
  contextLossCount: number;
  /**
   * Human-readable trail of every downgrade / recovery decision, e.g.
   * "rn-webgl produced NaN outputs — falling back to CPU".
   */
  reasons: string[];
}

/** Callback for host apps that want SDK diagnostics in their own logger. */
export type DiagnosticListener = (message: string) => void;
