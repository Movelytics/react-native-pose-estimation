// Minimal react-native surface for Node tests of the non-UI modules.
module.exports = {
  Platform: {
    OS: 'ios',
    Version: '17.0',
    select: (spec) => (spec && ('ios' in spec ? spec.ios : spec.default)),
  },
  NativeModules: {},
};
