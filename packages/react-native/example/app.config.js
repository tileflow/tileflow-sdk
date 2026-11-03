// Development settings come from the environment, so that nothing local is committed:
//   TILEFLOW_API_ORIGIN           the API origin, such as http://127.0.0.1:5655 for the fixture
//   TILEFLOW_SWIFT_PACKAGE_PATH   a local Tileflow Swift package (this repository's platforms/ios
//                                 or a native candidate's swift directory)
//   TILEFLOW_MAVEN_REPOSITORY     a native candidate's maven directory
//   TILEFLOW_NATIVE_VERSION       that candidate's version
// Credentials are read by the Tileflow plugin from TILEFLOW_*_CREDENTIAL at prebuild.
const {withAndroidManifest} = require('expo/config-plugins');

// A development API on plain HTTP, such as the fixture server, needs cleartext traffic on Android.
const withDevelopmentCleartext = (config) =>
  withAndroidManifest(config, (mod) => {
    if (process.env.TILEFLOW_API_ORIGIN?.startsWith('http://')) {
      mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'true';
    }
    return mod;
  });

module.exports = ({config}) => ({
  ...config,
  name: 'Tileflow Example',
  slug: 'tileflow-react-native-example',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {bundleIdentifier: 'dev.tileflow.examples.reactnative'},
  android: {package: 'dev.tileflow.examples.reactnative'},
  plugins: [
    withDevelopmentCleartext,
    [
      '@tileflow/react-native',
      {
        ...(process.env.TILEFLOW_API_ORIGIN ? {apiOrigin: process.env.TILEFLOW_API_ORIGIN} : {}),
        offline: {backgroundUpdates: true},
        ios: {swiftPackagePath: process.env.TILEFLOW_SWIFT_PACKAGE_PATH},
        android: {
          mavenRepository: process.env.TILEFLOW_MAVEN_REPOSITORY,
          nativeVersion: process.env.TILEFLOW_NATIVE_VERSION,
        },
      },
    ],
  ],
});
