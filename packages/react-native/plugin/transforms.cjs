'use strict';

// Pure changes the Expo config plugin makes to native project files. Each takes the current file
// contents or object and returns the new one; running it twice changes nothing more.

const CREDENTIALS = [
  // [environment variable, Info.plist key, Android string resource]
  ['TILEFLOW_MAP_CREDENTIAL', 'TileflowMapCredential', 'tileflow_map_credential'],
  ['TILEFLOW_SERVICES_CREDENTIAL', 'TileflowServicesCredential', 'tileflow_services_credential'],
  ['TILEFLOW_SEARCH_CREDENTIAL', 'TileflowSearchCredential', 'tileflow_search_credential'],
  ['TILEFLOW_ROUTING_CREDENTIAL', 'TileflowRoutingCredential', 'tileflow_routing_credential'],
  ['TILEFLOW_ELEVATION_CREDENTIAL', 'TileflowElevationCredential', 'tileflow_elevation_credential'],
];
const API_ORIGIN = ['TileflowAPIOrigin', 'tileflow_api_origin'];
const DEFAULT_API_ORIGIN = 'https://api.tileflow.dev';
const BACKGROUND_TASK = 'dev.tileflow.offline.update';
const PROPS = new Set(['apiOrigin', 'offline', 'ios', 'android']);
const MARK = '// @tileflow/react-native';

/**
 * Reads and checks the plugin's props and the credentials of the environment. Credentials are
 * never props: Expo embeds the app config, plugin props included, where JavaScript can read it.
 */
function checkedProps(props, allowed, section = '') {
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    throw new Error(`@tileflow/react-native: ${section || 'plugin props'} must be an object.`);
  }
  for (const [key, value] of Object.entries(props)) {
    if (
      /credential|token|key|secret/iu.test(key) ||
      (typeof value === 'string' && /tf_(?:public|native|live)_/u.test(value))
    ) {
      throw new Error(
        '@tileflow/react-native: set credentials in TILEFLOW_*_CREDENTIAL environment variables; ' +
          'Expo exposes plugin props to JavaScript.',
      );
    }
    if (!allowed.has(key))
      throw new Error(
        `@tileflow/react-native: unknown plugin prop "${section ? section + '.' : ''}${key}".`,
      );
  }
  return props;
}

function settings(props = {}, env = process.env) {
  checkedProps(props, PROPS);
  const offline = checkedProps(props.offline ?? {}, new Set(['backgroundUpdates']), 'offline');
  const ios = checkedProps(props.ios ?? {}, new Set(['swiftPackagePath']), 'ios');
  const android = checkedProps(
    props.android ?? {},
    new Set(['mavenRepository', 'nativeVersion']),
    'android',
  );
  if (offline.backgroundUpdates !== undefined && typeof offline.backgroundUpdates !== 'boolean')
    throw new Error('@tileflow/react-native: offline.backgroundUpdates must be a boolean.');
  for (const [key, value] of Object.entries({...ios, ...android})) {
    if (value !== undefined && (typeof value !== 'string' || !value.trim()))
      throw new Error(`@tileflow/react-native: ${key} must be a non-empty string.`);
  }
  const apiOrigin = props.apiOrigin ?? DEFAULT_API_ORIGIN;
  let origin;
  try {
    origin = new URL(apiOrigin);
  } catch {
    origin = undefined;
  }
  if (
    !origin ||
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    !['', '/'].includes(origin.pathname)
  ) {
    throw new Error(
      '@tileflow/react-native: apiOrigin must be an origin such as https://api.tileflow.dev.',
    );
  }
  const credentials = [];
  for (const [variable, plist, resource] of CREDENTIALS) {
    const value = env[variable]?.trim();
    if (!value) continue;
    if (!/^tf_public_[0-9a-f]{48}$/u.test(value)) {
      throw new Error(
        `@tileflow/react-native: ${variable} is not a publishable tf_public_ credential.`,
      );
    }
    credentials.push({variable, plist, resource, value});
  }
  return {
    apiOrigin: origin.origin,
    credentials,
    backgroundUpdates: offline.backgroundUpdates === true,
    swiftPackagePath: ios.swiftPackagePath,
    mavenRepository: android.mavenRepository,
    nativeVersion: android.nativeVersion,
  };
}

function infoPlist(plist, config) {
  const next = {...plist, [API_ORIGIN[0]]: config.apiOrigin};
  for (const [, key] of CREDENTIALS) delete next[key];
  for (const credential of config.credentials) next[credential.plist] = credential.value;
  delete next.TileflowMobileConfiguration;
  if (config.backgroundUpdates) {
    const tasks = new Set(next.BGTaskSchedulerPermittedIdentifiers ?? []);
    tasks.add(BACKGROUND_TASK);
    next.BGTaskSchedulerPermittedIdentifiers = [...tasks];
    const modes = new Set(next.UIBackgroundModes ?? []);
    modes.add('fetch');
    next.UIBackgroundModes = [...modes];
  }
  return next;
}

/** Android string resources, as Expo's `withStringsXml` represents `strings.xml`. */
function stringsXml(xml, config) {
  const names = new Set([API_ORIGIN[1], ...CREDENTIALS.map(([, , resource]) => resource)]);
  const resources = xml.resources ?? {};
  const strings = (resources.string ?? []).filter((item) => !names.has(item.$?.name));
  const entry = (name, value) => ({$: {name, translatable: 'false'}, _: value});
  strings.push(entry(API_ORIGIN[1], config.apiOrigin));
  for (const credential of config.credentials)
    strings.push(entry(credential.resource, credential.value));
  const arrays = (resources['string-array'] ?? []).filter(
    (item) => item.$?.name !== 'tileflow_mobile_configuration',
  );
  const next = {...resources, string: strings};
  if (arrays.length > 0) next['string-array'] = arrays;
  else delete next['string-array'];
  return {...xml, resources: next};
}

/** Adds the offline background hooks to a Swift `AppDelegate`. */
function appDelegate(source, config) {
  if (!config.backgroundUpdates || source.includes(MARK)) return source;
  const launch =
    /(func application\(\s*_ application: UIApplication,\s*didFinishLaunchingWithOptions[^{]*\{\n)/u;
  if (!launch.test(source)) {
    throw new Error(
      '@tileflow/react-native: the AppDelegate has no didFinishLaunchingWithOptions; add the ' +
        'offline background hooks by hand (see the package README).',
    );
  }
  let next = source.replace(
    launch,
    `$1    ${MARK}: offline updates run as a background task.\n    TileflowReactNativeApp.registerBackgroundTasks()\n`,
  );
  if (!next.includes('import TileflowReactNative')) {
    next = next.replace(/^(import [^\n]+\n)/mu, '$1import TileflowReactNative\n');
  }
  const hook = `
  ${MARK}: offline downloads continue in the background.
  public override func application(
    _ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if TileflowReactNativeApp.handleEventsForBackgroundURLSession(identifier, completionHandler: completionHandler) {
      return
    }
    super.application(application, handleEventsForBackgroundURLSession: identifier, completionHandler: completionHandler)
  }
`;
  const close = next.search(/\n\}\s*\n(?:\s*(?:public |final |@\w+ )*class |\s*$)/u);
  if (close < 0) throw new Error('@tileflow/react-native: the AppDelegate class has no end.');
  return `${next.slice(0, close)}\n${hook}${next.slice(close)}`;
}

/** Links the native Tileflow products after React Native's Podfile setup. */
function podfile(source, config) {
  let next = source.replace(/^[ \t]*\$MLRN\.post_install\(installer\)[ \t]*\r?\n/gmu, '');
  if (!next.includes('tileflow_post_install(installer)')) {
    const reactNative = /^([ \t]*)react_native_post_install\([\s\S]*?\n[ \t]*\)\n/mu;
    if (!reactNative.test(next)) {
      throw new Error('@tileflow/react-native: the Podfile has no react_native_post_install call.');
    }
    next = next.replace(
      reactNative,
      (block, indent) => `${block}${indent}tileflow_post_install(installer)\n`,
    );
  }
  const line = /^ENV\['TILEFLOW_SWIFT_PACKAGE_PATH'\] \|\|= .*\n/mu;
  next = next.replace(line, '');
  if (config.swiftPackagePath) {
    next = `ENV['TILEFLOW_SWIFT_PACKAGE_PATH'] ||= ${JSON.stringify(config.swiftPackagePath)}\n${next}`;
  }
  return next;
}

const MINIMUM_IOS = '16.0';

function newer(version, minimum = MINIMUM_IOS) {
  const parts = (text) => String(text).split('.').map(Number);
  const [a, b] = [parts(version), parts(minimum)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return true;
}

/** Raises `ios.deploymentTarget` of Podfile.properties.json to the SDK's iOS 16. */
function podfileProperties(properties) {
  const current = properties['ios.deploymentTarget'];
  return current && newer(current)
    ? properties
    : {...properties, 'ios.deploymentTarget': MINIMUM_IOS};
}

/** Raises every build configuration's IPHONEOS_DEPLOYMENT_TARGET to iOS 16. */
function deploymentTargets(configurations) {
  for (const configuration of Object.values(configurations)) {
    const settings = configuration?.buildSettings;
    if (!settings?.IPHONEOS_DEPLOYMENT_TARGET) continue;
    const current = String(settings.IPHONEOS_DEPLOYMENT_TARGET).replaceAll('"', '');
    if (!newer(current)) settings.IPHONEOS_DEPLOYMENT_TARGET = MINIMUM_IOS;
  }
  return configurations;
}

const MINIMUM_ANDROID = 26;

/**
 * Raises Expo's `android.minSdkVersion` to the SDK's API 26, and points Gradle at a local Maven
 * repository and native version, for native candidates.
 */
function gradleProperties(properties, config) {
  const keys = new Set(['tileflowMavenRepository', 'tileflowNativeVersion']);
  const next = properties.filter((item) => item.type !== 'property' || !keys.has(item.key));
  const minimum = next.find(
    (item) => item.type === 'property' && item.key === 'android.minSdkVersion',
  );
  if (!minimum) {
    next.push({type: 'property', key: 'android.minSdkVersion', value: String(MINIMUM_ANDROID)});
  } else if (!(Number(minimum.value) >= MINIMUM_ANDROID)) {
    minimum.value = String(MINIMUM_ANDROID);
  }
  if (config.mavenRepository) {
    next.push({type: 'property', key: 'tileflowMavenRepository', value: config.mavenRepository});
  }
  if (config.nativeVersion) {
    next.push({type: 'property', key: 'tileflowNativeVersion', value: config.nativeVersion});
  }
  return next;
}

/** Adds a native candidate's local Maven repository to every project of the app's Gradle build. */
function projectBuildGradle(source, config) {
  const line = /^[ \t]*maven \{ url = uri\(.*\) \} \/\/ Tileflow native candidate\n/mu;
  let next = source.replace(line, '');
  if (!config.mavenRepository) return next;
  const repositories = /(allprojects\s*\{\s*\n\s*repositories\s*\{\s*\n)/u;
  if (!repositories.test(next)) {
    throw new Error(
      '@tileflow/react-native: android/build.gradle has no allprojects repositories.',
    );
  }
  return next.replace(
    repositories,
    `$1    maven { url = uri(${JSON.stringify(config.mavenRepository)}) } // Tileflow native candidate\n`,
  );
}

module.exports = {
  projectBuildGradle,
  settings,
  infoPlist,
  stringsXml,
  appDelegate,
  podfile,
  gradleProperties,
  podfileProperties,
  deploymentTargets,
  BACKGROUND_TASK,
  MINIMUM_IOS,
  MINIMUM_ANDROID,
};
