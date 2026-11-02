'use strict';

const transforms = require('./transforms.cjs');

// The app's own Expo, resolved from its project root: a linked package has none beside it.
function configPlugins(projectRoot) {
  for (const name of ['expo/config-plugins', '@expo/config-plugins']) {
    try {
      return require(require.resolve(name, {paths: [projectRoot]}));
    } catch {
      // Try the next name.
    }
  }
  throw new Error('@tileflow/react-native: the plugin runs only in an Expo app.');
}

/**
 * Configures an Expo app for @tileflow/react-native at prebuild: the native configuration that
 * Tileflow reads (the API origin from the props, credentials from TILEFLOW_*_CREDENTIAL
 * environment variables), optional offline background updates, and the Podfile hook that links
 * the Tileflow Swift package. Works in development and release builds; Expo Go is unsupported.
 */
function withTileflow(config, props) {
  const {
    withInfoPlist,
    withStringsXml,
    withAppDelegate,
    withPodfile,
    withPodfileProperties,
    withXcodeProject,
    withGradleProperties,
    withProjectBuildGradle,
  } = configPlugins(config._internal?.projectRoot ?? process.cwd());
  const settings = transforms.settings(props);
  config = withInfoPlist(config, (mod) => {
    mod.modResults = transforms.infoPlist(mod.modResults, settings);
    return mod;
  });
  config = withStringsXml(config, (mod) => {
    mod.modResults = transforms.stringsXml(mod.modResults, settings);
    return mod;
  });
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      if (settings.backgroundUpdates) {
        throw new Error(
          '@tileflow/react-native: offline.backgroundUpdates needs a Swift AppDelegate.',
        );
      }
      return mod;
    }
    mod.modResults.contents = transforms.appDelegate(mod.modResults.contents, settings);
    return mod;
  });
  config = withPodfile(config, (mod) => {
    mod.modResults.contents = transforms.podfile(mod.modResults.contents, settings);
    return mod;
  });
  // The Tileflow Swift SDK needs iOS 16.
  config = withPodfileProperties(config, (mod) => {
    mod.modResults = transforms.podfileProperties(mod.modResults);
    return mod;
  });
  config = withXcodeProject(config, (mod) => {
    transforms.deploymentTargets(mod.modResults.pbxXCBuildConfigurationSection());
    return mod;
  });
  config = withGradleProperties(config, (mod) => {
    mod.modResults = transforms.gradleProperties(mod.modResults, settings);
    return mod;
  });
  config = withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = transforms.projectBuildGradle(mod.modResults.contents, settings);
    return mod;
  });
  return config;
}

module.exports = withTileflow;
