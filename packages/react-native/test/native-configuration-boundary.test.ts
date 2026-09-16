import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

export const configurationFiles = [
  'src/mobile-configuration.ts',
  'src/hosted-binding.ts',
  'src/native-configuration-reader.ts',
  'src/native-configuration-bridge.ts',
  'android/src/main/java/dev/tileflow/reactnative/MobileConfiguration.kt',
  'android/src/main/java/dev/tileflow/reactnative/MobileConfigurationResources.kt',
  'android/src/main/java/dev/tileflow/reactnative/TileflowNativeConfigurationModule.kt',
  'android/src/main/res/raw/tileflow_configuration_keep.xml',
  'android/src/test/java/dev/tileflow/reactnative/MobileConfigurationTest.kt',
  'android/src/test/java/dev/tileflow/reactnative/MobileConfigurationResourceTest.kt',
  'ios/TFMobileConfiguration.h',
  'ios/TFMobileConfiguration.mm',
  'ios/TileflowNativeConfiguration.mm',
  'ios/Tests/TFMobileConfigurationTests.mm',
  'ios/Tests/TFMobileConfigurationConcurrencyTests.mm',
  'docs/native-configuration.md',
];

test('configuration stays private with the exact peer matrix and inert public entry', async () => {
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
  assert.deepEqual(manifest.peerDependencies, {
    '@maplibre/maplibre-react-native': '11.3.10',
    react: '19.2.0',
    'react-native': '0.83.10',
  });
  assert.deepEqual(Object.keys(await import('../dist/index.js')), []);
  for (const file of ['dist/index.js', 'dist/index.d.ts']) {
    assert.doesNotMatch(
      await read(file),
      /MobileConfiguration|NativeConfiguration|readConfiguration|HostedNativeBindingResolver/u,
    );
  }
  for (const name of ['configuration', 'native-configuration-bridge', 'hosted-binding']) {
    await assert.rejects(import(`@tileflow/react-native/${name}`), {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
    await assert.rejects(import(`@tileflow/react-native/internal/${name}`), {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
  }
});

test('configuration code cannot import a network owner or renderer', async () => {
  for (const file of [
    'src/mobile-configuration.ts',
    'src/hosted-binding.ts',
    'src/native-configuration-reader.ts',
  ]) {
    const text = await read(file);
    const syntax = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of syntax.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (statement.importClause?.isTypeOnly) continue;
      assert.match(statement.moduleSpecifier.getText(), /^['"]\.\/mobile-configuration['"]$/u);
    }
    assert.doesNotMatch(
      text,
      /\bfetch\s*\(|NativeModules|NativeEventEmitter|\.acquire\s*\(|console\./u,
    );
  }
});

test('one native reader is autolinked without eager constants or another configuration path', async () => {
  const registration = await read(
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeAdmissionPackage.kt',
  );
  assert.match(registration, /TileflowNativeConfigurationModule\(context\)/u);
  const android = await read(
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeConfigurationModule.kt',
  );
  assert.match(android, /@ReactMethod fun readConfiguration/u);
  assert.doesNotMatch(android, /getConstants|AdmissionEngine|addLifecycleEventListener|MapLibre/u);
  const resources = await read(
    'android/src/main/java/dev/tileflow/reactnative/MobileConfigurationResources.kt',
  );
  assert.match(resources, /tileflow_mobile_configuration/u);
  assert.match(resources, /getResourcePackageName/u);
  assert.match(resources, /resourceId/u);
  const ios = await read('ios/TileflowNativeConfiguration.mm');
  assert.match(ios, /RCT_EXPORT_MODULE\(TileflowNativeConfiguration\)/u);
  assert.match(ios, /NSBundle\.mainBundle/u);
  assert.doesNotMatch(ios, /constantsToExport|NSURLSession|TFAdmissionEngine|MLN/u);
  const pod = await read('TileflowNativeAdmission.podspec');
  assert.match(pod, /ios\/\*\.\{h,mm\}/u);
  assert.match(pod, /private_header_files = 'ios\/\*\.h'/u);
});

test('private build entries, native sources and setup guide contain no credential literals', async () => {
  for (const file of configurationFiles) {
    const source = await read(file);
    assert.doesNotMatch(source, /tf_public_[0-9a-f]{48}/u, file);
    assert.doesNotMatch(source, /tf_native_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u, file);
  }
  const build = await read('tsup.config.ts');
  assert.match(build, /'internal\/hosted-binding': 'src\/hosted-binding\.ts'/u);
  assert.match(
    build,
    /'internal\/native-configuration-bridge': 'src\/native-configuration-bridge\.ts'/u,
  );
  for (const name of ['hosted-binding', 'native-configuration-bridge']) {
    assert.ok((await read(`dist/internal/${name}.js`)).length > 0);
  }
  const guide = await read('docs/native-configuration.md');
  assert.match(guide, /TileflowMobileConfiguration/u);
  assert.match(guide, /tileflow_mobile_configuration/u);
  assert.match(guide, /48 lowercase hexadecimal/u);
  assert.match(guide, /not.*end.user/su);
  assert.match(guide, /revok/iu);
});
