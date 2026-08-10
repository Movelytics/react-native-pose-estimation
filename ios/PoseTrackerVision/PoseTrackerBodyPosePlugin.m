/**
 * Registers PoseTrackerBodyPosePlugin with VisionCamera's frame-processor
 * registry under the JS name `detectBodyPose`.
 */

#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>

#if __has_include(<PoseTrackerVision/PoseTrackerVision-Swift.h>)
#import <PoseTrackerVision/PoseTrackerVision-Swift.h>
#elif __has_include("PoseTrackerVision-Swift.h")
#import "PoseTrackerVision-Swift.h"
#else
// Autolinking / use_frameworks! variants — generated Swift header name.
#import "PoseTrackerVision-Swift.h"
#endif

VISION_EXPORT_SWIFT_FRAME_PROCESSOR(PoseTrackerBodyPosePlugin, detectBodyPose)
