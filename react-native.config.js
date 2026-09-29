/**
 * Autolinking for the Apple Vision frame-processor plugin.
 *
 * Android has no native project. On iOS the plugin compiles against the
 * VisionCamera pod, so it is linked only when the host app installed
 * react-native-vision-camera. Apps that only use the WebView camera must
 * not fail `pod install` looking for a pod they never added.
 */
const fs = require('fs');
const path = require('path');

function directoryHasVisionCamera(dir) {
  return fs.existsSync(path.join(dir, 'node_modules', 'react-native-vision-camera', 'package.json'));
}

function hostHasVisionCamera() {
  const cwd = process.cwd();
  const candidates = [cwd];
  const base = path.basename(cwd);
  if (base === 'ios' || base === 'android') {
    candidates.push(path.dirname(cwd));
  }
  return candidates.some(directoryHasVisionCamera);
}

module.exports = {
  dependency: {
    platforms: {
      android: null,
      ios: hostHasVisionCamera() ? {} : null,
    },
  },
};
