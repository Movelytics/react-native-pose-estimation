/**
 * @pose-tracker/react-native-pose-estimation — public API surface.
 *
 * Pose runtime (TF.js + MoveNet + pipeline wasm + page runtime) is **bundled**
 * in the package for instant offline cold start. The movement engine is
 * downloaded from the PoseTracker API after an authenticated handshake.
 *
 * Runtime model:
 * - Default (both platforms, incl. Expo Go): MoveNet SinglePose Lightning
 *   (17 keypoints, 192×192) inside a Chromium/WKWebView — TF.js WebGL.
 *   Mount {@link WebViewPoseView}.
 * - Opt-in (`preferredBackend: 'vision'`, iOS native builds): Apple Vision
 *   `VNDetectHumanBodyPoseRequest` via {@link PoseCameraView}.
 */

// Handshake + usage tracking
export { configure, ConfigureError, DEFAULT_BASE_URL, SDK_NAME, SDK_VERSION } from './api/configure';
export type { ConfigureOptions } from './api/configure';
export {
  EXERCISE_ALIASES,
  findExerciseByIdOrAlias,
  resolveExerciseName,
} from './exercises/aliases';
export { UsageTracker, TrackError } from './api/track';
export type { TrackRequest, TrackResponse, UsageTrackerOptions } from './api/track';

// Pose-runtime (bundled + optional cache helper)
export { RuntimeCache } from './runtime/RuntimeCache';
export type {
  PoseRuntimeParts,
  RuntimeCacheOptions,
  RuntimeCacheProgress,
} from './runtime/RuntimeCache';
export {
  getBundledRuntimeParts,
  getBundledRuntimeVersion,
} from './backends/webview/bundledRuntime';

// Orchestrator + React layer
export { PoseTrackerClient } from './client';
export type { PoseTrackerClientOptions, PreferredBackend, StartExerciseOptions } from './client';
export type { ColdStartMode, PreloadOptions } from './types/preload';
export type {
  SkeletonAnglesStyle,
  SkeletonCirclesStyle,
  SkeletonDefinition,
  SkeletonLinesStyle,
} from './types/skeleton';
export { DEFAULT_SKELETON_DEFINITION } from './types/skeleton';
export { fetchSkeletonDefinition, SkeletonFetchError } from './api/skeleton';
export type { FetchSkeletonOptions } from './api/skeleton';
export { PoseTrackerProvider, usePoseTracker } from './PoseTrackerProvider';
export type { PoseTrackerContextValue, PoseTrackerProviderProps } from './PoseTrackerProvider';

// Inference backends
export type { PoseBackend, PoseBackendInitOptions, PoseInputFrame } from './backends/PoseBackend';

// WebView MoveNet — the SDK's base runtime (offline, both platforms)
export { WebViewPoseBackend, isWebViewPoseBackend } from './backends/webview/WebViewPoseBackend';
export type { WebViewPoseBackendOptions, WebViewPoseMessage } from './backends/webview/WebViewPoseBackend';
export { WebViewPoseView } from './camera/WebViewPoseView';
export type { WebViewPoseViewProps } from './camera/WebViewPoseView';
export {
  buildPoseHtml,
  DEFAULT_LOADING_TEXT,
  POSE_HTML_BUILD,
} from './backends/webview/poseHtml';
export type { PoseHtmlOptions } from './backends/webview/poseHtml';
export { POSETRACKER_LOGO_DATA_URL } from './backends/webview/brandAssets';

// Apple Vision (iOS native builds, opt-in via preferredBackend: 'vision')
export { VisionPoseBackend, VisionUnavailableError } from './backends/vision/VisionPoseBackend';
export type { VisionPoseBackendOptions } from './backends/vision/VisionPoseBackend';
export {
  isVisionBackendAvailable,
  isVisionPoseCameraAvailable,
  VISION_BODY_POSE_PLUGIN_NAME,
} from './backends/vision/optionalVision';
export {
  poseFromVisionPluginResult,
  VISION_JOINT_TO_SDK,
} from './backends/vision/mapVisionJoints';
export type { VisionPluginJoint, VisionPluginResult } from './backends/vision/mapVisionJoints';
export { PoseCameraView } from './camera/PoseCameraView';
export type {
  PoseCameraStats,
  PoseCameraUnavailableReason,
  PoseCameraViewProps,
} from './camera/PoseCameraView';

// Environment probes
export { isExpoGo } from './support/optionalModules';

// Acceleration / diagnostics types
export type {
  AccelerationDiagnostics,
  AccelerationState,
  DiagnosticListener,
  GlCapabilities,
  InferenceRuntime,
  NativeDelegateLabel,
  TfjsFlagSnapshot,
  VisionDelegateLabel,
} from './types/acceleration';

// Engine
export {
  EngineLoader,
  createExpoFileStore,
  createRnfsFileStore,
  createBlobUtilFileStore,
  createMemoryFileStore,
  createNativeFileStore,
} from './engine/EngineLoader';
export type { EngineLoadResult, EngineLoaderOptions, FileStore, KeyValueStore } from './engine/EngineLoader';
export type {
  CustomExerciseDescriptor,
  CustomSessionOptions,
  EngineModuleExports,
  EngineSession,
  EngineSessionFeatures,
  EngineSessionOptions,
  EventSink,
  PoseTrackerEngine,
} from './engine/types';

// Metro / logcat diagnostic helpers
export {
  defaultDiagnosticLogger,
  logAccelerationReport,
  logFrameStats,
  logPlatformBanner,
} from './diagnostics/logReport';

// Classic PoseTracker WebView message parity (sendDataToNative JSON)
export {
  toClassicNativeMessage,
} from './events/classicMessage';
export type {
  ClassicMessageListener,
  ClassicNativeMessage,
} from './events/classicMessage';

// Adaptive camera quality (AdaptiveChoice + crash-loop guard + FPS downgrade)
export {
  AdaptiveQualityController,
} from './quality/AdaptiveQualityController';
export type {
  AdaptiveQualityControllerOptions,
  QualityState,
  QualityStatsSample,
} from './quality/AdaptiveQualityController';
export {
  CRITICAL_FPS_THRESHOLD,
  IDEAL_FPS_RANGE_ANDROID,
  IDEAL_FPS_RANGE_IOS,
  LOW_FPS_STREAK_BEFORE_DOWNGRADE,
  QUALITY_SETTLE_MS,
  MIN_TARGET_FPS_ANDROID,
  MIN_TARGET_FPS_DEFAULT,
  MIN_TARGET_FPS_IOS,
  QUALITY_LADDER,
  QUALITY_PROFILES,
  TARGET_FPS,
  TARGET_MEDIAN_MS,
  currentQualityPlatform,
  estimatedFpsFromMedianMs,
  getCriticalFpsThreshold,
  getIdealFpsRange,
  getMinTargetFps,
  getQualityProfile,
  isQualityProfileId,
  lowerQualityProfile,
  minMedianMsForMinTarget,
  nextLowerQualityProfile,
  profileFromWarmupMedianMs,
} from './quality/profiles';
export {
  ANDROID_INFER_FRAME_SKIP,
  ANDROID_MIN_TARGET_FPS,
  ANDROID_PERF_DEBUG,
  ANDROID_PREPROCESS_PATH,
  ANDROID_SOFT_CAP_PROFILE,
  CAPTURE_CONSTRAINT_MODE,
  ENABLE_MALI_HARD_CAP,
} from './quality/captureMode';
export type {
  AndroidPreprocessPath,
  AndroidSoftCapProfile,
  CaptureConstraintMode,
} from './quality/captureMode';
export type {
  FpsRange,
  CapturePriority,
  QualityChoice,
  QualityPlatform,
  QualityProfile,
  QualityProfileId,
} from './quality/profiles';
export {
  isMaliRenderer,
  profileFromScore,
  scoreDeviceCapability,
} from './quality/deviceCapability';
export type { DeviceCapabilitySnapshot } from './quality/deviceCapability';
export { RuntimeGuard } from './quality/RuntimeGuard';
export type { GuardState } from './quality/RuntimeGuard';

// Tracking features (WebView query-param parity + plan gating)
export {
  DEFAULT_FEATURES,
  FREE_PLAN_FEATURES_MESSAGE,
  INVALID_TOKEN_MESSAGE,
  COMBINED_REFERENCE_EXERCISE_MESSAGE,
  featureNotSupportedMessage,
  freeBlockedFeatures,
  isPaidPlan,
  shouldShowWatermark,
  resolveFeatures,
} from './types/features';
export type { PoseTrackerFeatures, ResolvedFeatures } from './types/features';

// Types
export * from './types/events';
export * from './types/manifest';
export * from './types/pose';
