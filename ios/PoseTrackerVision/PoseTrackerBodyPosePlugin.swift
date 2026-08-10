/**
 * VisionCamera frame-processor plugin: Apple Vision body pose.
 *
 * Runs `VNDetectHumanBodyPoseRequest` on the camera `CMSampleBuffer`
 * (zero RGB copy). Returns up to 19 joints with normalized coords in
 * top-left origin [0,1] (Vision's bottom-left Y is flipped here) and
 * confidence scores in [0,1].
 *
 * Registered as JS plugin name `detectBodyPose`.
 */

import Foundation
import Vision
import CoreMedia
import VisionCamera

@objc(PoseTrackerBodyPosePlugin)
public class PoseTrackerBodyPosePlugin: FrameProcessorPlugin {
  private let request = VNDetectHumanBodyPoseRequest()

  private static let jointSpecs: [(VNHumanBodyPoseObservation.JointName, String)] = [
    (.nose, "nose"),
    (.leftEye, "leftEye"),
    (.rightEye, "rightEye"),
    (.leftEar, "leftEar"),
    (.rightEar, "rightEar"),
    (.leftShoulder, "leftShoulder"),
    (.rightShoulder, "rightShoulder"),
    (.leftElbow, "leftElbow"),
    (.rightElbow, "rightElbow"),
    (.leftWrist, "leftWrist"),
    (.rightWrist, "rightWrist"),
    (.leftHip, "leftHip"),
    (.rightHip, "rightHip"),
    (.leftKnee, "leftKnee"),
    (.rightKnee, "rightKnee"),
    (.leftAnkle, "leftAnkle"),
    (.rightAnkle, "rightAnkle"),
    (.neck, "neck"),
    (.root, "root"),
  ]

  public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
    super.init(proxy: proxy, options: options)
  }

  public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
    let buffer = frame.buffer
    let orientation = Self.cgOrientation(from: frame.orientation)

    let start = CFAbsoluteTimeGetCurrent()
    let handler = VNImageRequestHandler(
      cmSampleBuffer: buffer,
      orientation: orientation,
      options: [:]
    )

    do {
      try handler.perform([request])
    } catch {
      return nil
    }

    guard let observation = request.results?.first as? VNHumanBodyPoseObservation else {
      return [
        "joints": [] as [[String: Any]],
        "inferenceTimeMs": (CFAbsoluteTimeGetCurrent() - start) * 1000.0,
      ]
    }

    var joints: [[String: Any]] = []
    joints.reserveCapacity(Self.jointSpecs.count)

    for (jointName, jsName) in Self.jointSpecs {
      guard let point = try? observation.recognizedPoint(jointName) else {
        continue
      }
      // Vision uses bottom-left origin; SDK / MoveNet use top-left.
      joints.append([
        "name": jsName,
        "x": Double(point.location.x),
        "y": 1.0 - Double(point.location.y),
        "score": Double(point.confidence),
      ])
    }

    let elapsedMs = (CFAbsoluteTimeGetCurrent() - start) * 1000.0
    return [
      "joints": joints,
      "inferenceTimeMs": elapsedMs,
    ]
  }

  private static func cgOrientation(from orientation: Orientation) -> CGImagePropertyOrientation {
    switch orientation {
    case .portrait:
      return .right
    case .portraitUpsideDown:
      return .left
    case .landscapeLeft:
      return .up
    case .landscapeRight:
      return .down
    @unknown default:
      return .right
    }
  }
}
