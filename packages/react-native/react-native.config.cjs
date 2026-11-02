module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: 'android',
        packageImportPath: 'import dev.tileflow.reactnative.TileflowReactNativePackage;',
        packageInstance: 'new TileflowReactNativePackage()',
      },
      // The CLI discovers the sole podspec at the package root.
      ios: {},
    },
  },
};
