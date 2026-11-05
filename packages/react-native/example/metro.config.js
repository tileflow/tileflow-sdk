// Resolve the native framework peers from this app when the SDK package is linked.
const {getDefaultConfig} = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const packageRoot = path.resolve(__dirname, '..');
config.watchFolders = [path.resolve(packageRoot, '../..')];
const shared = /^(?:react|react-native)(?:\/.*)?$/u;
config.resolver.resolveRequest = (context, name, platform) =>
  context.resolveRequest(
    shared.test(name) ? {...context, originModulePath: path.join(__dirname, 'index.ts')} : context,
    name,
    platform,
  );
module.exports = config;
