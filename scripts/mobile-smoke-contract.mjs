import {isAbsolute, relative, resolve, sep, win32} from 'node:path';
import semver from 'semver';

export const mobileVersions = Object.freeze({
  package: '0.1.0-alpha.16',
  expo: '55.0.31',
  expoTemplate: '55.0.43',
  reactNative: '0.83.10',
  communityTemplate: '0.83.10',
  generatorCli: '20.2.0',
  // The 0.83.10 template pins these independently of the init executable.
  consumerCli: '20.0.0',
  react: '19.2.0',
  maplibre: '11.3.10',
  typescript: '6.0.3',
  reactTypes: '19.2.17',
  gradle: '9.0.0',
  compileSdk: '36',
  buildTools: '36.0.0',
  ndk: '27.1.12297006',
  hermesBytecode: 96,
});
export const mobilePackages = Object.freeze(['core', 'interactions', 'react-native']);
export const mobileConsumers = Object.freeze(['expo', 'bare']);
const packageNames = new Set(mobilePackages.map((name) => `@tileflow/${name}`));
const dependencyGroups = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const prerequisites = new Set([
  'node',
  'pnpm',
  'npm',
  'tar',
  'java-21',
  'android-sdk-36',
  'android-build-tools-36.0.0',
  'android-ndk-27.1.12297006',
  'android-sdk-licenses',
  'unzip',
  'xcode',
  'ios-simulator-sdk',
  'cocoapods',
]);
const messages = Object.freeze({
  INVALID_ARGUMENTS: 'Expected packed, android or ios, optionally followed by --keep.',
  PLATFORM_UNAVAILABLE: 'Use Linux or macOS for packed/Android checks, and macOS for iOS checks.',
  PREREQUISITE_MISSING:
    'A required tool or SDK input is absent. See the mobile smoke prerequisites in CONTRIBUTING.md.',
  TOOLCHAIN_MISMATCH: 'The selected toolchain does not match the mobile smoke prerequisites.',
  COMMAND_FAILED:
    'A mobile smoke command failed. Retry with --keep to inspect the bounded command logs.',
  COMMAND_TIMEOUT:
    'A mobile smoke command exceeded its time limit. Retry with --keep to inspect its log.',
  COMMAND_CANCELLED: 'The mobile smoke was cancelled; no successful qualification is recorded.',
  COMMAND_OUTPUT_LIMIT:
    'A mobile smoke command exceeded its output limit. Inspect the preserved bounded log.',
  WORKSPACE_UNSAFE:
    'An input or output escapes the owned workspace or contains an unsupported file type.',
  STAGING_INVALID:
    'Package staging no longer matches the three-package development/release contract.',
  PACK_INVALID: 'A packed package has invalid identity, files, exports or workspace dependencies.',
  TEMPLATE_INVALID: 'The pinned template metadata or native integration anchors changed.',
  INSTALL_INVALID:
    'A consumer did not install the exact packed packages and selected direct dependencies.',
  AUTOLINK_INVALID:
    'Tileflow or MapLibre was not discovered at the expected installed native package path.',
  BINARY_INVALID: 'A Release output or its expected Hermes bytecode could not be verified.',
  CLEANUP_FAILED:
    'The owned workspace could not be safely removed. No successful result is recorded.',
  INTERNAL_ERROR:
    'The mobile smoke could not complete. Retry with --keep and review the implementation.',
});
const steps = new Set([
  'arguments',
  'prerequisites',
  'stage',
  'pack',
  'templates',
  'expo',
  'bare',
  'android-expo',
  'android-bare',
  'ios-expo',
  'ios-bare',
  'cleanup',
  'command',
]);

export class MobileSmokeError extends Error {
  constructor(code, step = 'command', prerequisite) {
    super(messages[code] ?? messages.INTERNAL_ERROR);
    this.name = 'MobileSmokeError';
    this.code = Object.hasOwn(messages, code) ? code : 'INTERNAL_ERROR';
    this.step = steps.has(step) ? step : 'command';
    if (prerequisites.has(prerequisite)) this.prerequisite = prerequisite;
  }
}
export function requireMobile(condition, code, step) {
  if (!condition) throw new MobileSmokeError(code, step);
}
export function projectMobileFailure(error) {
  const safe = error instanceof MobileSmokeError ? error : new MobileSmokeError('INTERNAL_ERROR');
  return {
    code: safe.code,
    step: safe.step,
    message: messages[safe.code],
    ...(prerequisites.has(safe.prerequisite) ? {prerequisite: safe.prerequisite} : {}),
  };
}
export function parseMobileArguments(args) {
  requireMobile(
    args.length >= 1 &&
      args.length <= 2 &&
      ['packed', 'android', 'ios'].includes(args[0]) &&
      (args.length === 1 || args[1] === '--keep'),
    'INVALID_ARGUMENTS',
    'arguments',
  );
  return {mode: args[0], keep: args[1] === '--keep'};
}
export function assertMobilePlatform(mode, platform) {
  requireMobile(['packed', 'android', 'ios'].includes(mode), 'INVALID_ARGUMENTS', 'arguments');
  requireMobile(
    ['linux', 'darwin'].includes(platform) && (mode !== 'ios' || platform === 'darwin'),
    'PLATFORM_UNAVAILABLE',
    'prerequisites',
  );
}
export function isWithin(root, path) {
  const suffix = relative(resolve(root), resolve(path));
  return (
    suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
  );
}
export function localTarballSpec(consumer, tarball) {
  return `file:${relative(consumer, tarball).split(sep).join('/')}`;
}
export function selectPnpm(environment = process.env, node = process.execPath) {
  const entry = environment.npm_execpath;
  return entry && /(?:^|[/\\])pnpm\.(?:c?js|mjs)$/u.test(entry)
    ? {command: node, prefix: [entry]}
    : {command: 'pnpm', prefix: []};
}
export function pnpmPackArguments(directory) {
  return ['pack', '--pack-destination', directory, '--json'];
}

/** Only staged copies are passed here. Source manifests are never rewritten. */
export function stageMobileManifest(source) {
  requireMobile(
    packageNames.has(source.name) && source.version === '0.0.0-development',
    'STAGING_INVALID',
    'stage',
  );
  const manifest = structuredClone(source);
  manifest.version = mobileVersions.package;
  for (const group of dependencyGroups) {
    for (const [name, value] of Object.entries(manifest[group] ?? {})) {
      requireMobile(typeof value === 'string', 'STAGING_INVALID', 'stage');
      if (!value.startsWith('workspace:')) continue;
      requireMobile(packageNames.has(name), 'STAGING_INVALID', 'stage');
      const range = value.slice('workspace:'.length);
      const materialized =
        range === '*'
          ? mobileVersions.package
          : ['^', '~'].includes(range)
            ? `${range}${mobileVersions.package}`
            : range;
      requireMobile(
        semver.validRange(materialized) && semver.satisfies(mobileVersions.package, materialized),
        'STAGING_INVALID',
        'stage',
      );
      manifest[group][name] = materialized;
    }
  }
  return manifest;
}

export function assertTemplateManifest(kind, manifest) {
  requireMobile(
    manifest.dependencies?.react === mobileVersions.react &&
      manifest.dependencies?.['react-native'] === mobileVersions.reactNative,
    'TEMPLATE_INVALID',
    'templates',
  );
  if (kind === 'expo') {
    requireMobile(
      manifest.name === 'expo-template-bare-minimum' &&
        manifest.version === mobileVersions.expoTemplate &&
        manifest.dependencies.expo === `~${mobileVersions.expo}`,
      'TEMPLATE_INVALID',
      'templates',
    );
  } else {
    for (const name of ['cli', 'cli-platform-android', 'cli-platform-ios']) {
      requireMobile(
        manifest.devDependencies?.[`@react-native-community/${name}`] ===
          mobileVersions.consumerCli,
        'TEMPLATE_INVALID',
        'templates',
      );
    }
  }
}

/** Freeze every direct template range at its declared minimum; never select a registry tag. */
export function createConsumerManifest(kind, template, tarballs, directory) {
  const manifest = structuredClone(template);
  manifest.name = `tileflow-mobile-smoke-${kind}`;
  manifest.version = '0.0.0';
  manifest.private = true;
  for (const group of ['dependencies', 'devDependencies']) {
    manifest[group] ??= {};
    for (const [name, range] of Object.entries(manifest[group])) {
      requireMobile(
        typeof range === 'string' && semver.validRange(range),
        'TEMPLATE_INVALID',
        'templates',
      );
      const version = semver.minVersion(range)?.version;
      requireMobile(
        version && semver.satisfies(version, range) && !semver.prerelease(version),
        'TEMPLATE_INVALID',
        'templates',
      );
      manifest[group][name] = version;
    }
  }
  Object.assign(manifest.dependencies, {
    react: mobileVersions.react,
    'react-native': mobileVersions.reactNative,
    '@maplibre/maplibre-react-native': mobileVersions.maplibre,
    ...(kind === 'expo' ? {expo: mobileVersions.expo} : {}),
  });
  Object.assign(manifest.devDependencies, {
    typescript: mobileVersions.typescript,
    '@types/react': mobileVersions.reactTypes,
  });
  for (const name of packageNames) {
    const tarball = tarballs.find((entry) => entry.name === name);
    requireMobile(tarball, 'PACK_INVALID', 'pack');
    manifest.dependencies[name] = localTarballSpec(directory, tarball.path);
  }
  return manifest;
}

export function assertArchiveListing(namesText, verboseText) {
  const names = namesText.trimEnd().split('\n');
  const verbose = verboseText.trimEnd().split('\n');
  requireMobile(
    names.length > 0 && names.length <= 20000 && verbose.length === names.length,
    'PACK_INVALID',
    'pack',
  );
  const seen = new Set();
  for (const name of names) {
    const normalized = name.replace(/\/$/u, '');
    const parts = normalized.split('/');
    const safeCharacters = [...name].every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 31 && codePoint !== 127;
    });
    requireMobile(
      parts[0] === 'package' &&
        parts.every((part) => part && part !== '.' && part !== '..') &&
        !/[\\:]/u.test(name) &&
        safeCharacters &&
        !seen.has(normalized),
      'PACK_INVALID',
      'pack',
    );
    seen.add(normalized);
  }
  requireMobile(
    verbose.every((line) => /^[-d]/u.test(line)),
    'PACK_INVALID',
    'pack',
  );
  return names.filter((name) => !name.endsWith('/')).map((name) => name.slice('package/'.length));
}
export function assertPackedManifest(manifest, files) {
  requireMobile(
    packageNames.has(manifest.name) && manifest.version === mobileVersions.package,
    'PACK_INVALID',
    'pack',
  );
  for (const group of dependencyGroups) {
    requireMobile(
      Object.values(manifest[group] ?? {}).every(
        (range) => typeof range === 'string' && !/^(?:workspace|file|link):/u.test(range),
      ),
      'PACK_INVALID',
      'pack',
    );
  }
  const required = ['package.json', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];
  if (manifest.name === '@tileflow/react-native') {
    required.push(
      'react-native.config.cjs',
      'android/build.gradle',
      'TileflowNativeAdmission.podspec',
      'ios/tileflow_native_admission.rb',
    );
    requireMobile(
      files.some((name) => name.startsWith('android/src/') && name.endsWith('.kt')) &&
        files.some((name) => name.startsWith('ios/') && name.endsWith('.mm')),
      'PACK_INVALID',
      'pack',
    );
  }
  requireMobile(
    required.every((name) => files.includes(name)) &&
      files.every((name) => !/^(?:src|test|harness|node_modules)\//u.test(name)),
    'PACK_INVALID',
    'pack',
  );
  function visit(value) {
    if (typeof value === 'string')
      requireMobile(
        value.startsWith('./') && files.includes(value.slice(2)),
        'PACK_INVALID',
        'pack',
      );
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(manifest.exports);
}
export function assertPackedAndroidConfig(config) {
  const android = config?.dependency?.platforms?.android;
  requireMobile(
    android?.sourceDir === 'android' &&
      !isAbsolute(android.sourceDir) &&
      !win32.isAbsolute(android.sourceDir),
    'AUTOLINK_INVALID',
    'pack',
  );
  requireMobile(
    android.packageImportPath ===
      'import dev.tileflow.reactnative.TileflowNativeAdmissionPackage;' &&
      android.packageInstance === 'new TileflowNativeAdmissionPackage()',
    'AUTOLINK_INVALID',
    'pack',
  );
}
export function assertAutolinking(document, platform, installedRoot, kind) {
  const dependency = document.dependencies?.['@tileflow/react-native'];
  const native = dependency?.platforms?.[platform];
  requireMobile(
    dependency?.root && resolve(dependency.root) === resolve(installedRoot) && native,
    'AUTOLINK_INVALID',
    kind,
  );
  if (platform === 'android') {
    requireMobile(
      native.sourceDir &&
        resolve(native.sourceDir) === resolve(installedRoot, 'android') &&
        native.packageInstance === 'new TileflowNativeAdmissionPackage()',
      'AUTOLINK_INVALID',
      kind,
    );
  } else {
    requireMobile(
      native.podspecPath &&
        resolve(native.podspecPath) === resolve(installedRoot, 'TileflowNativeAdmission.podspec'),
      'AUTOLINK_INVALID',
      kind,
    );
  }
  requireMobile(
    document.dependencies?.['@maplibre/maplibre-react-native']?.platforms?.[platform],
    'AUTOLINK_INVALID',
    kind,
  );
}
export function addIosPostInstallHooks(podfile) {
  const anchor = /(\n[ \t]*react_native_post_install\([\s\S]*?\n[ \t]*\))/gu;
  requireMobile(
    [...podfile.matchAll(anchor)].length === 1 &&
      !podfile.includes('tileflow_native_admission_post_install') &&
      !podfile.includes('$MLRN.post_install'),
    'TEMPLATE_INVALID',
    'templates',
  );
  return podfile.replace(
    anchor,
    '$1\n    $MLRN.post_install(installer)\n    tileflow_native_admission_post_install(installer)',
  );
}
export function assertHermesBytecode(bytes) {
  // Hermes BytecodeFileHeader: uint64 magic, uint32 version, 20-byte source hash, uint32 length.
  requireMobile(
    bytes.length >= 36 &&
      bytes.readBigUInt64LE(0) === 0x1f1903c103bc1fc6n &&
      bytes.readUInt32LE(8) === mobileVersions.hermesBytecode &&
      bytes.readUInt32LE(32) === bytes.length,
    'BINARY_INVALID',
  );
  return {format: 'hermes-bytecode', version: bytes.readUInt32LE(8)};
}
export const mobileAppSource = `import {Map} from '@tileflow/react-native';

export default function App() {
	return <Map source={{map: 'smoke', manifestUrl: 'https://example.invalid/tileflow/native/manifest.json'}} theme="light" style={{flex: 1}} />;
}
`;
