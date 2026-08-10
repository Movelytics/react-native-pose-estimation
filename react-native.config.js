/**
 * Autolinking: Apple Vision frame-processor plugin is iOS-only.
 * Android hosts skip the native project (JS falls back to TFLite / TF.js).
 */
module.exports = {
  dependency: {
    platforms: {
      android: null,
      ios: {},
    },
  },
};
