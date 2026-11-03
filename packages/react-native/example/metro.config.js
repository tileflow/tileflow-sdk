// Resolves @tileflow/react-native from this repository. React, React Native and MapLibre React
// Native always come from this app, so that the package's own development copies never load;
// every other module resolves as usual, including the workspace packages' own dependencies.
const {getDefaultConfig} = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const packageRoot = path.resolve(__dirname, '..');
config.watchFolders = [path.resolve(packageRoot, '../..')];
const shared = /^(?:react|react-native|@maplibre\/maplibre-react-native)(?:\/.*)?$/u;
config.resolver.resolveRequest = (context, name, platform) =>
  context.resolveRequest(
    shared.test(name) ? {...context, originModulePath: path.join(__dirname, 'index.ts')} : context,
    name,
    platform,
  );
module.exports = config;
