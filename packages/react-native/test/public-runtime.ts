// The package root's runtime exports, by source module: the mounted Map, and the offline store,
// service clients and their errors over the native SDKs.
export const publicRuntimeExports: Readonly<Record<string, readonly string[]>> = {
  './map': ['Map'],
  './sdk': [
    'configuredServices',
    'TileflowElevation',
    'TileflowGeoIP',
    'TileflowOfflineStore',
    'TileflowOfflineSwitch',
    'TileflowRouting',
    'TileflowSearch',
  ],
  './services/error': ['TileflowServiceError'],
  './offline/error': ['TileflowOfflineError'],
  './sdk-modules': ['TileflowNativeModuleUnavailableError'],
};

export const publicRuntimeNames: readonly string[] = Object.values(publicRuntimeExports)
  .flat()
  .sort();

/** Modules the root loads at run time besides the Map's own, none of which reads native state on import. */
export const nativeApiModules = ['./sdk', './services/error', './offline/error', './sdk-modules'];

/** The manifest's exports: the root, the Expo config plugin and the manifest itself. */
export const publicManifestExports = ['.', './app.plugin.js', './package.json'];
