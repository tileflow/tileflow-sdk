const path = require('node:path');

module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: path.join(__dirname, 'android'),
        packageImportPath: 'import dev.tileflow.reactnative.TileflowNativeAdmissionPackage;',
        packageInstance: 'new TileflowNativeAdmissionPackage()',
      },
      // The CLI discovers the sole podspec at the package root.
      ios: {},
    },
  },
};
