require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'PoseTrackerVision'
  s.version      = package['version']
  s.summary      = 'Apple Vision body-pose frame processor for @posetracker/pose-estimation-react-native'
  s.homepage     = 'https://posetracker.com'
  s.license      = package['license']
  s.authors      = package['author']
  s.platforms    = { :ios => '14.0' }
  s.source       = { :git => 'https://github.com/movelytics/posetracker-rn-sdk.git', :tag => "v#{s.version}" }

  s.source_files = 'ios/PoseTrackerVision/**/*.{h,m,mm,swift}'
  s.requires_arc = true
  s.swift_version = '5.0'

  s.frameworks = 'Vision', 'CoreMedia', 'CoreVideo'

  s.dependency 'React-Core'
  s.dependency 'VisionCamera'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
  }
end
