import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {runMobileSmokePlan} from './mobile-packed-smoke.mjs';
import {bareGeneratorArguments, expoAutolinkingArguments} from './mobile-smoke-consumers.mjs';
import {
  addIosPostInstallHooks,
  assertArchiveListing,
  assertAutolinking,
  assertHermesBytecode,
  assertMobilePlatform,
  assertPackedAndroidConfig,
  assertPackedManifest,
  assertTemplateManifest,
  createConsumerManifest,
  mobileAppSource,
  mobilePackages,
  MobileSmokeError,
  mobileVersions,
  parseMobileArguments,
  pnpmPackArguments,
  projectMobileFailure,
  selectPnpm,
  stageMobileManifest,
} from './mobile-smoke-contract.mjs';
import {
  androidReleaseArguments,
  checkMobilePrerequisites,
  iosReleaseArguments,
} from './mobile-smoke-native.mjs';

const androidConfig = {
  sourceDir: 'android',
  packageImportPath: 'import dev.tileflow.reactnative.TileflowNativeAdmissionPackage;',
  packageInstance: 'new TileflowNativeAdmissionPackage()',
};
const source = {
  name: '@tileflow/react-native',
  version: '0.0.0-development',
  private: true,
  dependencies: {
    '@tileflow/core': 'workspace:>=0.1.0-alpha.16 <0.1.0-beta.0',
    '@tileflow/interactions': 'workspace:*',
  },
};
const template = {
  name: 'HelloWorld',
  dependencies: {react: '19.2.0', 'react-native': '0.83.10'},
  devDependencies: {
    '@react-native-community/cli': '20.0.0',
    '@react-native-community/cli-platform-android': '20.0.0',
    '@react-native-community/cli-platform-ios': '20.0.0',
    typescript: '^5.8.3',
  },
};
const codeIs = (code) => (error) => error instanceof MobileSmokeError && error.code === code;

test('staging materializes alpha versions and ranges without mutating development manifests', () => {
  const original = structuredClone(source);
  const staged = stageMobileManifest(source);
  assert.deepEqual(source, original);
  assert.equal(staged.version, '0.1.0-alpha.16');
  assert.equal(staged.private, true);
  assert.equal(staged.dependencies['@tileflow/core'], '>=0.1.0-alpha.16 <0.1.0-beta.0');
  assert.equal(staged.dependencies['@tileflow/interactions'], '0.1.0-alpha.16');
  assert.throws(
    () => stageMobileManifest({...source, dependencies: {'@tileflow/other': 'workspace:*'}}),
    codeIs('STAGING_INVALID'),
  );
  assert.throws(
    () => stageMobileManifest({...source, version: '1.0.0'}),
    codeIs('STAGING_INVALID'),
  );
  assert.throws(
    () => stageMobileManifest({...source, dependencies: {'@tileflow/core': 'workspace:>=2'}}),
    codeIs('STAGING_INVALID'),
  );
});

test('workspace packing selects official pnpm, never npm pack', () => {
  assert.deepEqual(selectPnpm({npm_execpath: '/tools/pnpm.cjs'}, '/node'), {
    command: '/node',
    prefix: ['/tools/pnpm.cjs'],
  });
  assert.deepEqual(selectPnpm({npm_execpath: '/tools/npm-cli.js'}), {command: 'pnpm', prefix: []});
  assert.deepEqual(pnpmPackArguments('/owned/packs'), [
    'pack',
    '--pack-destination',
    '/owned/packs',
    '--json',
  ]);
  assert.deepEqual(mobilePackages, ['core', 'interactions', 'react-native']);
});

test('consumer matrix distinguishes the generator from the CLI pinned by the bare template', () => {
  assert.equal(mobileVersions.expo, '55.0.31');
  assert.equal(mobileVersions.expoTemplate, '55.0.43');
  assert.equal(mobileVersions.reactNative, '0.83.10');
  assert.equal(mobileVersions.react, '19.2.0');
  assert.equal(mobileVersions.maplibre, '11.3.10');
  assert.equal(mobileVersions.generatorCli, '20.2.0');
  assert.equal(mobileVersions.consumerCli, '20.0.0');
  assertTemplateManifest('bare', template);
  assert.throws(
    () =>
      assertTemplateManifest('bare', {
        ...template,
        devDependencies: {...template.devDependencies, '@react-native-community/cli': '20.2.0'},
      }),
    codeIs('TEMPLATE_INVALID'),
  );
  const tarballs = mobilePackages.map((name) => ({
    name: `@tileflow/${name}`,
    path: `/owned/packs/${name}.tgz`,
  }));
  const consumer = createConsumerManifest('bare', template, tarballs, '/owned/consumers/bare');
  assert.equal(consumer.dependencies['@tileflow/core'], 'file:../../packs/core.tgz');
  assert.equal(consumer.dependencies['@maplibre/maplibre-react-native'], '11.3.10');
  assert.equal(consumer.devDependencies['@react-native-community/cli'], '20.0.0');
  assert.equal(consumer.devDependencies.typescript, '6.0.3');
  assert.equal(template.devDependencies.typescript, '^5.8.3');
  assert.ok(
    bareGeneratorArguments('/owned/template.tgz', '/owned/bare').includes('--skip-install'),
  );
  assert.ok(
    bareGeneratorArguments('/owned/template.tgz', '/owned/bare').includes(
      'file:/owned/template.tgz',
    ),
  );
  assert.ok(expoAutolinkingArguments('ios').includes('react-native-config'));
  assert.match(mobileAppSource, /import \{Map\} from '@tileflow\/react-native'/u);
  assert.match(
    mobileAppSource,
    /manifestUrl: 'https:\/\/example.invalid\/tileflow\/native\/manifest.json'/u,
  );
  assert.doesNotMatch(mobileAppSource, /credential|session|Provider|\/src\//u);
});

test('packed contents reject missing declarations, workspace ranges and unsafe archive entries', () => {
  const manifest = {
    name: '@tileflow/core',
    version: mobileVersions.package,
    exports: {'.': {types: './dist/index.d.ts', default: './dist/index.js'}},
  };
  const files = ['package.json', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];
  assertPackedManifest(manifest, files);
  assert.throws(() => assertPackedManifest(manifest, files.slice(0, -1)), codeIs('PACK_INVALID'));
  assert.throws(
    () => assertPackedManifest({...manifest, dependencies: {x: 'workspace:*'}}, files),
    codeIs('PACK_INVALID'),
  );
  assert.throws(
    () => assertPackedManifest(manifest, [...files, 'harness/App.tsx']),
    codeIs('PACK_INVALID'),
  );
  assert.deepEqual(
    assertArchiveListing('package/package.json\n', '-rw-r--r-- package/package.json\n'),
    ['package.json'],
  );
  for (const path of [
    '../outside',
    '/package/file',
    'package/../outside',
    'package/C:\\outside',
    'package//file',
  ]) {
    assert.throws(
      () => assertArchiveListing(`${path}\n`, '-rw-r--r-- file\n'),
      codeIs('PACK_INVALID'),
    );
  }
  for (const type of ['l', 'h', 'b', 'c', 'p'])
    assert.throws(
      () => assertArchiveListing('package/file\n', `${type} file\n`),
      codeIs('PACK_INVALID'),
    );
});

test('absolute packed Android sourceDir and missing Community CLI discovery are independent regressions', () => {
  assertPackedAndroidConfig({dependency: {platforms: {android: androidConfig}}});
  for (const sourceDir of ['/tmp/package/android', 'C:\\package\\android', '../android']) {
    assert.throws(
      () =>
        assertPackedAndroidConfig({
          dependency: {platforms: {android: {...androidConfig, sourceDir}}},
        }),
      codeIs('AUTOLINK_INVALID'),
    );
  }
  const root = '/owned/bare/node_modules/@tileflow/react-native';
  const document = {
    dependencies: {
      '@tileflow/react-native': {
        root,
        platforms: {
          android: {...androidConfig, sourceDir: `${root}/android`},
          ios: {podspecPath: `${root}/TileflowNativeAdmission.podspec`},
        },
      },
      '@maplibre/maplibre-react-native': {platforms: {android: {}, ios: {}}},
    },
  };
  for (const kind of ['expo', 'bare'])
    for (const platform of ['android', 'ios']) assertAutolinking(document, platform, root, kind);
  document.dependencies['@tileflow/react-native'].platforms.android = null;
  assert.throws(
    () => assertAutolinking(document, 'android', root, 'bare'),
    codeIs('AUTOLINK_INVALID'),
  );
  assert.throws(
    () => assertAutolinking({dependencies: {}}, 'ios', root, 'expo'),
    codeIs('AUTOLINK_INVALID'),
  );
});

test('only the documented post-install hooks and Release build entry points are selected', () => {
  const podfile =
    'post_install do |installer|\n  react_native_post_install(\n    installer,\n    config[:reactNativePath]\n  )\nend\n';
  const patched = addIosPostInstallHooks(podfile);
  assert.match(
    patched,
    /\)\n[ ]{4}\$MLRN.post_install\(installer\)\n[ ]{4}tileflow_native_admission_post_install\(installer\)/u,
  );
  assert.throws(() => addIosPostInstallHooks(patched), codeIs('TEMPLATE_INVALID'));
  assert.ok(androidReleaseArguments().includes(':app:assembleRelease'));
  assert.ok(androidReleaseArguments().includes('--no-daemon'));
  assert.ok(androidReleaseArguments().includes('-PhermesEnabled=true'));
  const args = iosReleaseArguments(
    {directory: '/owned/bare', scheme: 'TileflowBareSmoke'},
    '/owned/derived',
    '/owned/spm',
  );
  for (const value of [
    'Release',
    'iphonesimulator',
    'generic/platform=iOS Simulator',
    'CODE_SIGNING_ALLOWED=NO',
    '-derivedDataPath',
  ])
    assert.ok(args.includes(value));
  const bytes = Buffer.alloc(64);
  bytes.writeBigUInt64LE(0x1f1903c103bc1fc6n, 0);
  bytes.writeUInt32LE(96, 8);
  bytes.writeUInt32LE(bytes.length, 32);
  assert.deepEqual(assertHermesBytecode(bytes), {format: 'hermes-bytecode', version: 96});
  assert.throws(() => assertHermesBytecode(bytes.subarray(0, 40)), codeIs('BINARY_INVALID'));
  bytes.writeUInt32LE(95, 8);
  assert.throws(() => assertHermesBytecode(bytes), codeIs('BINARY_INVALID'));
  assert.throws(
    () => assertHermesBytecode(Buffer.from('plain JavaScript is not Hermes')),
    codeIs('BINARY_INVALID'),
  );
});

test('platform-inapplicable or missing prerequisites fail rather than skip', async () => {
  assert.throws(() => assertMobilePlatform('ios', 'linux'), codeIs('PLATFORM_UNAVAILABLE'));
  assert.throws(() => assertMobilePlatform('packed', 'win32'), codeIs('PLATFORM_UNAVAILABLE'));
  const calls = [];
  const context = {
    env: {},
    run: async (command) => {
      calls.push(command);
      return {
        stdout: Buffer.from(command === 'pnpm' ? '11.13.1' : command === 'npm' ? '11.0.0' : 'tar'),
        stderr: Buffer.alloc(0),
      };
    },
  };
  await assert.rejects(
    checkMobilePrerequisites(
      context,
      'ios',
      'pnpm@11.13.1',
      {command: 'pnpm', prefix: []},
      'linux',
    ),
    codeIs('PLATFORM_UNAVAILABLE'),
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    checkMobilePrerequisites(
      context,
      'android',
      'pnpm@11.13.1',
      {command: 'pnpm', prefix: []},
      'linux',
    ),
    codeIs('PREREQUISITE_MISSING'),
  );
  assert.deepEqual(calls, ['pnpm', 'npm', 'tar']);
});

for (const mode of ['packed', 'android', 'ios']) {
  test(`${mode} includes both clean consumers and records only the requested native compilation`, async () => {
    const calls = [];
    const operations = {
      prerequisites: async () => {
        calls.push('prerequisites');
        return {};
      },
      pack: async () => {
        calls.push('pack');
        return {tarballs: []};
      },
      templates: async () => {
        calls.push('templates');
        return {expo: {}, bare: {}};
      },
      consumer: async (kind) => {
        calls.push(kind);
        return {kind, receipt: {consumer: kind}};
      },
      native: async (platform, consumer) => {
        calls.push(`${platform}-${consumer.kind}`);
        return {
          consumer: consumer.kind,
          platform,
          configuration: 'Release',
          files: [{sha256: 'a'.repeat(64)}],
        };
      },
    };
    const result = await runMobileSmokePlan(mode, operations);
    assert.deepEqual(calls, [
      'prerequisites',
      'pack',
      'templates',
      'expo',
      'bare',
      ...(mode === 'packed' ? [] : [`${mode}-expo`, `${mode}-bare`]),
    ]);
    assert.equal(result.outputs.length, mode === 'packed' ? 0 : 2);
    assert.equal(result.qualification.render, false);
    assert.equal(result.qualification.hosted, false);
    if (mode !== 'packed')
      await assert.rejects(
        runMobileSmokePlan(mode, {...operations, native: async () => undefined}),
        codeIs('BINARY_INVALID'),
      );
    calls.length = 0;
    await assert.rejects(
      runMobileSmokePlan(mode, {
        ...operations,
        prerequisites: async () => {
          throw new MobileSmokeError('PREREQUISITE_MISSING');
        },
      }),
      codeIs('PREREQUISITE_MISSING'),
    );
    assert.deepEqual(calls, []);
  });
}

test('bounded failure projection never exposes process output, temporary paths or credentials', () => {
  const error = Object.assign(new MobileSmokeError('COMMAND_FAILED', 'bare'), {
    stdout: '/tmp/private',
    stderr: 'tf_secret_never_print',
    cause: new Error('secret'),
  });
  const projected = JSON.stringify(projectMobileFailure(error));
  assert.doesNotMatch(projected, /private|tf_secret|cause/u);
  assert.ok(projected.length < 400);
  assert.equal(projectMobileFailure(new Error('/tmp/private tf_secret')).code, 'INTERNAL_ERROR');
  assert.throws(
    () => parseMobileArguments(['packed', '--outside', '/']),
    codeIs('INVALID_ARGUMENTS'),
  );
  assert.deepEqual(parseMobileArguments(['android', '--keep']), {mode: 'android', keep: true});
});

test('root smoke commands remain opt-in and do not enter ordinary validation or publication', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const mode of ['packed', 'android', 'ios'])
    assert.equal(
      root.scripts[`smoke:mobile:${mode}`],
      `node scripts/mobile-packed-smoke.mjs ${mode}`,
    );
  for (const name of ['check', 'verify', 'publish:alpha:dry-run'])
    assert.doesNotMatch(root.scripts[name], /mobile/u);
  for (const directory of mobilePackages) {
    const manifest = JSON.parse(
      await readFile(
        new URL(join('../packages', directory, 'package.json'), import.meta.url),
        'utf8',
      ),
    );
    assert.equal(manifest.version, '0.0.0-development');
  }
});
