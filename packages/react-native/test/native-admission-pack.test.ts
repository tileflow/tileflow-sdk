import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const root = new URL('../', import.meta.url);
const exec = promisify(execFile);

async function files(path: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(new URL(`${path}/`, root), {withFileTypes: true})) {
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await files(name)));
    else if (entry.isFile()) result.push(name);
    else assert.fail(`Unexpected non-file package entry: ${name}`);
  }
  return result.sort();
}

test('the actual private archive contains the mounted native sources and one public Map root', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-native-pack-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const archive = join(directory, 'native.tgz');
  // Packing is not publication.
  await exec('pnpm', ['pack', '--out', archive], {cwd: fileURLToPath(root), timeout: 120000});
  const {stdout} = await exec('tar', ['-tzf', archive], {maxBuffer: 4 * 1024 * 1024});
  const actual = stdout
    .trim()
    .split('\n')
    .filter((path) => !path.endsWith('/'))
    .sort();
  const ios = (await files('ios')).filter(
    (path) => /^ios\/[^/]+\.(?:h|mm|rb)$/u.test(path) || /^ios\/Tests\/[^/]+\.mm$/u.test(path),
  );
  const native = [
    ...(await files('android/src')),
    ...ios,
    'android/build.gradle',
    'TileflowNativeAdmission.podspec',
    'react-native.config.cjs',
  ];
  const documentation = ['README.md', ...(await files('docs'))];
  const expected = [
    ...native,
    ...documentation,
    ...(await files('dist')),
    'LICENSE',
    'package.json',
  ]
    .map((path) => `package/${path}`)
    .sort();
  assert.deepEqual(actual, expected);
  for (const required of [
    'android/src/main/java/dev/tileflow/reactnative/AdmissionProviderLease.kt',
    'android/src/main/java/dev/tileflow/reactnative/AdmissionBootstrap.kt',
    'android/src/main/java/dev/tileflow/reactnative/MobileConfiguration.kt',
    'android/src/main/java/dev/tileflow/reactnative/MobileConfigurationResources.kt',
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeConfigurationModule.kt',
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeSurfaceModule.kt',
    'android/src/main/res/raw/tileflow_configuration_keep.xml',
    'ios/TFAdmissionBootstrap.mm',
    'ios/TFAdmissionInstallation.mm',
    'ios/TileflowNativeSurface.mm',
    'ios/Tests/TFAdmissionRollbackTests.mm',
    'ios/TFMobileConfiguration.h',
    'ios/TFMobileConfiguration.mm',
    'ios/TileflowNativeConfiguration.mm',
    'ios/Tests/TFMobileConfigurationTests.mm',
    'dist/internal/hosted-binding.js',
    'dist/internal/native-configuration-bridge.js',
    'docs/native-admission.md',
    'docs/native-configuration.md',
  ])
    assert.ok(actual.includes(`package/${required}`), required);
  assert.equal(
    actual.some((path) => path.startsWith('package/harness/')),
    false,
  );
  for (const path of [...native, ...documentation]) {
    const {stdout: packed} = await exec('tar', ['-xOzf', archive, `package/${path}`], {
      maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(packed, await readFile(new URL(path, root), 'utf8'), path);
  }
  const {stdout: manifestText} = await exec('tar', ['-xOzf', archive, 'package/package.json']);
  assert.doesNotMatch(manifestText, /tf_public_[0-9a-f]{48}/u);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
  const {stdout: runtime} = await exec('tar', ['-xOzf', archive, 'package/dist/index.js']);
  assert.match(runtime, /@maplibre\/maplibre-react-native/u);
  assert.match(runtime, /react-native/u);
  assert.doesNotMatch(runtime, /tf_public_[0-9a-f]{48}|tf_native_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u);
  const {stdout: declarations} = await exec('tar', ['-xOzf', archive, 'package/dist/index.d.ts']);
  assert.match(declarations, /\bMap\b/u);
  assert.doesNotMatch(
    declarations,
    /MobileConfiguration|NativeConfiguration|HostedNativeBindingResolver|NativeAdmission|NativeSurface|HostedNativeSession/u,
  );
});
