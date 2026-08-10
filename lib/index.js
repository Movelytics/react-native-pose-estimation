"use strict";
/**
 * @posetracker-tracker/react-native-pose-estimation — public API surface.
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDEAL_FPS_RANGE_IOS = exports.IDEAL_FPS_RANGE_ANDROID = exports.CRITICAL_FPS_THRESHOLD = exports.AdaptiveQualityController = exports.toClassicNativeMessage = exports.logPlatformBanner = exports.logFrameStats = exports.logAccelerationReport = exports.defaultDiagnosticLogger = exports.createNativeFileStore = exports.createMemoryFileStore = exports.createBlobUtilFileStore = exports.createRnfsFileStore = exports.createExpoFileStore = exports.EngineLoader = exports.isExpoGo = exports.PoseCameraView = exports.VISION_JOINT_TO_SDK = exports.poseFromVisionPluginResult = exports.VISION_BODY_POSE_PLUGIN_NAME = exports.isVisionPoseCameraAvailable = exports.isVisionBackendAvailable = exports.VisionUnavailableError = exports.VisionPoseBackend = exports.POSETRACKER_LOGO_DATA_URL = exports.POSE_HTML_BUILD = exports.DEFAULT_LOADING_TEXT = exports.buildPoseHtml = exports.WebViewPoseView = exports.isWebViewPoseBackend = exports.WebViewPoseBackend = exports.usePoseTracker = exports.PoseTrackerProvider = exports.SkeletonFetchError = exports.fetchSkeletonDefinition = exports.DEFAULT_SKELETON_DEFINITION = exports.PoseTrackerClient = exports.getBundledRuntimeVersion = exports.getBundledRuntimeParts = exports.RuntimeCache = exports.TrackError = exports.UsageTracker = exports.resolveExerciseName = exports.findExerciseByIdOrAlias = exports.EXERCISE_ALIASES = exports.SDK_VERSION = exports.SDK_NAME = exports.DEFAULT_BASE_URL = exports.ConfigureError = exports.configure = void 0;
exports.resolveFeatures = exports.shouldShowWatermark = exports.isPaidPlan = exports.freeBlockedFeatures = exports.featureNotSupportedMessage = exports.COMBINED_REFERENCE_EXERCISE_MESSAGE = exports.INVALID_TOKEN_MESSAGE = exports.FREE_PLAN_FEATURES_MESSAGE = exports.DEFAULT_FEATURES = exports.RuntimeGuard = exports.scoreDeviceCapability = exports.profileFromScore = exports.isMaliRenderer = exports.ENABLE_MALI_HARD_CAP = exports.CAPTURE_CONSTRAINT_MODE = exports.ANDROID_SOFT_CAP_PROFILE = exports.ANDROID_PREPROCESS_PATH = exports.ANDROID_PERF_DEBUG = exports.ANDROID_MIN_TARGET_FPS = exports.ANDROID_INFER_FRAME_SKIP = exports.profileFromWarmupMedianMs = exports.nextLowerQualityProfile = exports.minMedianMsForMinTarget = exports.lowerQualityProfile = exports.isQualityProfileId = exports.getQualityProfile = exports.getMinTargetFps = exports.getIdealFpsRange = exports.getCriticalFpsThreshold = exports.estimatedFpsFromMedianMs = exports.currentQualityPlatform = exports.TARGET_MEDIAN_MS = exports.TARGET_FPS = exports.QUALITY_PROFILES = exports.QUALITY_LADDER = exports.MIN_TARGET_FPS_IOS = exports.MIN_TARGET_FPS_DEFAULT = exports.MIN_TARGET_FPS_ANDROID = exports.QUALITY_SETTLE_MS = exports.LOW_FPS_STREAK_BEFORE_DOWNGRADE = void 0;
// Handshake + usage tracking
var configure_1 = require("./api/configure");
Object.defineProperty(exports, "configure", { enumerable: true, get: function () { return configure_1.configure; } });
Object.defineProperty(exports, "ConfigureError", { enumerable: true, get: function () { return configure_1.ConfigureError; } });
Object.defineProperty(exports, "DEFAULT_BASE_URL", { enumerable: true, get: function () { return configure_1.DEFAULT_BASE_URL; } });
Object.defineProperty(exports, "SDK_NAME", { enumerable: true, get: function () { return configure_1.SDK_NAME; } });
Object.defineProperty(exports, "SDK_VERSION", { enumerable: true, get: function () { return configure_1.SDK_VERSION; } });
var aliases_1 = require("./exercises/aliases");
Object.defineProperty(exports, "EXERCISE_ALIASES", { enumerable: true, get: function () { return aliases_1.EXERCISE_ALIASES; } });
Object.defineProperty(exports, "findExerciseByIdOrAlias", { enumerable: true, get: function () { return aliases_1.findExerciseByIdOrAlias; } });
Object.defineProperty(exports, "resolveExerciseName", { enumerable: true, get: function () { return aliases_1.resolveExerciseName; } });
var track_1 = require("./api/track");
Object.defineProperty(exports, "UsageTracker", { enumerable: true, get: function () { return track_1.UsageTracker; } });
Object.defineProperty(exports, "TrackError", { enumerable: true, get: function () { return track_1.TrackError; } });
// Pose-runtime (bundled + optional cache helper)
var RuntimeCache_1 = require("./runtime/RuntimeCache");
Object.defineProperty(exports, "RuntimeCache", { enumerable: true, get: function () { return RuntimeCache_1.RuntimeCache; } });
var bundledRuntime_1 = require("./backends/webview/bundledRuntime");
Object.defineProperty(exports, "getBundledRuntimeParts", { enumerable: true, get: function () { return bundledRuntime_1.getBundledRuntimeParts; } });
Object.defineProperty(exports, "getBundledRuntimeVersion", { enumerable: true, get: function () { return bundledRuntime_1.getBundledRuntimeVersion; } });
// Orchestrator + React layer
var client_1 = require("./client");
Object.defineProperty(exports, "PoseTrackerClient", { enumerable: true, get: function () { return client_1.PoseTrackerClient; } });
var skeleton_1 = require("./types/skeleton");
Object.defineProperty(exports, "DEFAULT_SKELETON_DEFINITION", { enumerable: true, get: function () { return skeleton_1.DEFAULT_SKELETON_DEFINITION; } });
var skeleton_2 = require("./api/skeleton");
Object.defineProperty(exports, "fetchSkeletonDefinition", { enumerable: true, get: function () { return skeleton_2.fetchSkeletonDefinition; } });
Object.defineProperty(exports, "SkeletonFetchError", { enumerable: true, get: function () { return skeleton_2.SkeletonFetchError; } });
var PoseTrackerProvider_1 = require("./PoseTrackerProvider");
Object.defineProperty(exports, "PoseTrackerProvider", { enumerable: true, get: function () { return PoseTrackerProvider_1.PoseTrackerProvider; } });
Object.defineProperty(exports, "usePoseTracker", { enumerable: true, get: function () { return PoseTrackerProvider_1.usePoseTracker; } });
// WebView MoveNet — the SDK's base runtime (offline, both platforms)
var WebViewPoseBackend_1 = require("./backends/webview/WebViewPoseBackend");
Object.defineProperty(exports, "WebViewPoseBackend", { enumerable: true, get: function () { return WebViewPoseBackend_1.WebViewPoseBackend; } });
Object.defineProperty(exports, "isWebViewPoseBackend", { enumerable: true, get: function () { return WebViewPoseBackend_1.isWebViewPoseBackend; } });
var WebViewPoseView_1 = require("./camera/WebViewPoseView");
Object.defineProperty(exports, "WebViewPoseView", { enumerable: true, get: function () { return WebViewPoseView_1.WebViewPoseView; } });
var poseHtml_1 = require("./backends/webview/poseHtml");
Object.defineProperty(exports, "buildPoseHtml", { enumerable: true, get: function () { return poseHtml_1.buildPoseHtml; } });
Object.defineProperty(exports, "DEFAULT_LOADING_TEXT", { enumerable: true, get: function () { return poseHtml_1.DEFAULT_LOADING_TEXT; } });
Object.defineProperty(exports, "POSE_HTML_BUILD", { enumerable: true, get: function () { return poseHtml_1.POSE_HTML_BUILD; } });
var brandAssets_1 = require("./backends/webview/brandAssets");
Object.defineProperty(exports, "POSETRACKER_LOGO_DATA_URL", { enumerable: true, get: function () { return brandAssets_1.POSETRACKER_LOGO_DATA_URL; } });
// Apple Vision (iOS native builds, opt-in via preferredBackend: 'vision')
var VisionPoseBackend_1 = require("./backends/vision/VisionPoseBackend");
Object.defineProperty(exports, "VisionPoseBackend", { enumerable: true, get: function () { return VisionPoseBackend_1.VisionPoseBackend; } });
Object.defineProperty(exports, "VisionUnavailableError", { enumerable: true, get: function () { return VisionPoseBackend_1.VisionUnavailableError; } });
var optionalVision_1 = require("./backends/vision/optionalVision");
Object.defineProperty(exports, "isVisionBackendAvailable", { enumerable: true, get: function () { return optionalVision_1.isVisionBackendAvailable; } });
Object.defineProperty(exports, "isVisionPoseCameraAvailable", { enumerable: true, get: function () { return optionalVision_1.isVisionPoseCameraAvailable; } });
Object.defineProperty(exports, "VISION_BODY_POSE_PLUGIN_NAME", { enumerable: true, get: function () { return optionalVision_1.VISION_BODY_POSE_PLUGIN_NAME; } });
var mapVisionJoints_1 = require("./backends/vision/mapVisionJoints");
Object.defineProperty(exports, "poseFromVisionPluginResult", { enumerable: true, get: function () { return mapVisionJoints_1.poseFromVisionPluginResult; } });
Object.defineProperty(exports, "VISION_JOINT_TO_SDK", { enumerable: true, get: function () { return mapVisionJoints_1.VISION_JOINT_TO_SDK; } });
var PoseCameraView_1 = require("./camera/PoseCameraView");
Object.defineProperty(exports, "PoseCameraView", { enumerable: true, get: function () { return PoseCameraView_1.PoseCameraView; } });
// Environment probes
var optionalModules_1 = require("./support/optionalModules");
Object.defineProperty(exports, "isExpoGo", { enumerable: true, get: function () { return optionalModules_1.isExpoGo; } });
// Engine
var EngineLoader_1 = require("./engine/EngineLoader");
Object.defineProperty(exports, "EngineLoader", { enumerable: true, get: function () { return EngineLoader_1.EngineLoader; } });
Object.defineProperty(exports, "createExpoFileStore", { enumerable: true, get: function () { return EngineLoader_1.createExpoFileStore; } });
Object.defineProperty(exports, "createRnfsFileStore", { enumerable: true, get: function () { return EngineLoader_1.createRnfsFileStore; } });
Object.defineProperty(exports, "createBlobUtilFileStore", { enumerable: true, get: function () { return EngineLoader_1.createBlobUtilFileStore; } });
Object.defineProperty(exports, "createMemoryFileStore", { enumerable: true, get: function () { return EngineLoader_1.createMemoryFileStore; } });
Object.defineProperty(exports, "createNativeFileStore", { enumerable: true, get: function () { return EngineLoader_1.createNativeFileStore; } });
// Metro / logcat diagnostic helpers
var logReport_1 = require("./diagnostics/logReport");
Object.defineProperty(exports, "defaultDiagnosticLogger", { enumerable: true, get: function () { return logReport_1.defaultDiagnosticLogger; } });
Object.defineProperty(exports, "logAccelerationReport", { enumerable: true, get: function () { return logReport_1.logAccelerationReport; } });
Object.defineProperty(exports, "logFrameStats", { enumerable: true, get: function () { return logReport_1.logFrameStats; } });
Object.defineProperty(exports, "logPlatformBanner", { enumerable: true, get: function () { return logReport_1.logPlatformBanner; } });
// Classic PoseTracker WebView message parity (sendDataToNative JSON)
var classicMessage_1 = require("./events/classicMessage");
Object.defineProperty(exports, "toClassicNativeMessage", { enumerable: true, get: function () { return classicMessage_1.toClassicNativeMessage; } });
// Adaptive camera quality (AdaptiveChoice + crash-loop guard + FPS downgrade)
var AdaptiveQualityController_1 = require("./quality/AdaptiveQualityController");
Object.defineProperty(exports, "AdaptiveQualityController", { enumerable: true, get: function () { return AdaptiveQualityController_1.AdaptiveQualityController; } });
var profiles_1 = require("./quality/profiles");
Object.defineProperty(exports, "CRITICAL_FPS_THRESHOLD", { enumerable: true, get: function () { return profiles_1.CRITICAL_FPS_THRESHOLD; } });
Object.defineProperty(exports, "IDEAL_FPS_RANGE_ANDROID", { enumerable: true, get: function () { return profiles_1.IDEAL_FPS_RANGE_ANDROID; } });
Object.defineProperty(exports, "IDEAL_FPS_RANGE_IOS", { enumerable: true, get: function () { return profiles_1.IDEAL_FPS_RANGE_IOS; } });
Object.defineProperty(exports, "LOW_FPS_STREAK_BEFORE_DOWNGRADE", { enumerable: true, get: function () { return profiles_1.LOW_FPS_STREAK_BEFORE_DOWNGRADE; } });
Object.defineProperty(exports, "QUALITY_SETTLE_MS", { enumerable: true, get: function () { return profiles_1.QUALITY_SETTLE_MS; } });
Object.defineProperty(exports, "MIN_TARGET_FPS_ANDROID", { enumerable: true, get: function () { return profiles_1.MIN_TARGET_FPS_ANDROID; } });
Object.defineProperty(exports, "MIN_TARGET_FPS_DEFAULT", { enumerable: true, get: function () { return profiles_1.MIN_TARGET_FPS_DEFAULT; } });
Object.defineProperty(exports, "MIN_TARGET_FPS_IOS", { enumerable: true, get: function () { return profiles_1.MIN_TARGET_FPS_IOS; } });
Object.defineProperty(exports, "QUALITY_LADDER", { enumerable: true, get: function () { return profiles_1.QUALITY_LADDER; } });
Object.defineProperty(exports, "QUALITY_PROFILES", { enumerable: true, get: function () { return profiles_1.QUALITY_PROFILES; } });
Object.defineProperty(exports, "TARGET_FPS", { enumerable: true, get: function () { return profiles_1.TARGET_FPS; } });
Object.defineProperty(exports, "TARGET_MEDIAN_MS", { enumerable: true, get: function () { return profiles_1.TARGET_MEDIAN_MS; } });
Object.defineProperty(exports, "currentQualityPlatform", { enumerable: true, get: function () { return profiles_1.currentQualityPlatform; } });
Object.defineProperty(exports, "estimatedFpsFromMedianMs", { enumerable: true, get: function () { return profiles_1.estimatedFpsFromMedianMs; } });
Object.defineProperty(exports, "getCriticalFpsThreshold", { enumerable: true, get: function () { return profiles_1.getCriticalFpsThreshold; } });
Object.defineProperty(exports, "getIdealFpsRange", { enumerable: true, get: function () { return profiles_1.getIdealFpsRange; } });
Object.defineProperty(exports, "getMinTargetFps", { enumerable: true, get: function () { return profiles_1.getMinTargetFps; } });
Object.defineProperty(exports, "getQualityProfile", { enumerable: true, get: function () { return profiles_1.getQualityProfile; } });
Object.defineProperty(exports, "isQualityProfileId", { enumerable: true, get: function () { return profiles_1.isQualityProfileId; } });
Object.defineProperty(exports, "lowerQualityProfile", { enumerable: true, get: function () { return profiles_1.lowerQualityProfile; } });
Object.defineProperty(exports, "minMedianMsForMinTarget", { enumerable: true, get: function () { return profiles_1.minMedianMsForMinTarget; } });
Object.defineProperty(exports, "nextLowerQualityProfile", { enumerable: true, get: function () { return profiles_1.nextLowerQualityProfile; } });
Object.defineProperty(exports, "profileFromWarmupMedianMs", { enumerable: true, get: function () { return profiles_1.profileFromWarmupMedianMs; } });
var captureMode_1 = require("./quality/captureMode");
Object.defineProperty(exports, "ANDROID_INFER_FRAME_SKIP", { enumerable: true, get: function () { return captureMode_1.ANDROID_INFER_FRAME_SKIP; } });
Object.defineProperty(exports, "ANDROID_MIN_TARGET_FPS", { enumerable: true, get: function () { return captureMode_1.ANDROID_MIN_TARGET_FPS; } });
Object.defineProperty(exports, "ANDROID_PERF_DEBUG", { enumerable: true, get: function () { return captureMode_1.ANDROID_PERF_DEBUG; } });
Object.defineProperty(exports, "ANDROID_PREPROCESS_PATH", { enumerable: true, get: function () { return captureMode_1.ANDROID_PREPROCESS_PATH; } });
Object.defineProperty(exports, "ANDROID_SOFT_CAP_PROFILE", { enumerable: true, get: function () { return captureMode_1.ANDROID_SOFT_CAP_PROFILE; } });
Object.defineProperty(exports, "CAPTURE_CONSTRAINT_MODE", { enumerable: true, get: function () { return captureMode_1.CAPTURE_CONSTRAINT_MODE; } });
Object.defineProperty(exports, "ENABLE_MALI_HARD_CAP", { enumerable: true, get: function () { return captureMode_1.ENABLE_MALI_HARD_CAP; } });
var deviceCapability_1 = require("./quality/deviceCapability");
Object.defineProperty(exports, "isMaliRenderer", { enumerable: true, get: function () { return deviceCapability_1.isMaliRenderer; } });
Object.defineProperty(exports, "profileFromScore", { enumerable: true, get: function () { return deviceCapability_1.profileFromScore; } });
Object.defineProperty(exports, "scoreDeviceCapability", { enumerable: true, get: function () { return deviceCapability_1.scoreDeviceCapability; } });
var RuntimeGuard_1 = require("./quality/RuntimeGuard");
Object.defineProperty(exports, "RuntimeGuard", { enumerable: true, get: function () { return RuntimeGuard_1.RuntimeGuard; } });
// Tracking features (WebView query-param parity + plan gating)
var features_1 = require("./types/features");
Object.defineProperty(exports, "DEFAULT_FEATURES", { enumerable: true, get: function () { return features_1.DEFAULT_FEATURES; } });
Object.defineProperty(exports, "FREE_PLAN_FEATURES_MESSAGE", { enumerable: true, get: function () { return features_1.FREE_PLAN_FEATURES_MESSAGE; } });
Object.defineProperty(exports, "INVALID_TOKEN_MESSAGE", { enumerable: true, get: function () { return features_1.INVALID_TOKEN_MESSAGE; } });
Object.defineProperty(exports, "COMBINED_REFERENCE_EXERCISE_MESSAGE", { enumerable: true, get: function () { return features_1.COMBINED_REFERENCE_EXERCISE_MESSAGE; } });
Object.defineProperty(exports, "featureNotSupportedMessage", { enumerable: true, get: function () { return features_1.featureNotSupportedMessage; } });
Object.defineProperty(exports, "freeBlockedFeatures", { enumerable: true, get: function () { return features_1.freeBlockedFeatures; } });
Object.defineProperty(exports, "isPaidPlan", { enumerable: true, get: function () { return features_1.isPaidPlan; } });
Object.defineProperty(exports, "shouldShowWatermark", { enumerable: true, get: function () { return features_1.shouldShowWatermark; } });
Object.defineProperty(exports, "resolveFeatures", { enumerable: true, get: function () { return features_1.resolveFeatures; } });
// Types
__exportStar(require("./types/events"), exports);
__exportStar(require("./types/manifest"), exports);
__exportStar(require("./types/pose"), exports);
