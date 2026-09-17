import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('the foreground location recipe is compile-only and excluded from package runtime', async () => {
  const [manifest, harnessConfig, example, recipe, publicIndex] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8').then((value) => JSON.parse(value)),
    readFile(new URL('harness/tsconfig.json', root), 'utf8').then((value) => JSON.parse(value)),
    readFile(new URL('harness/ForegroundLocationExample.tsx', root), 'utf8'),
    readFile(new URL('harness/foreground-location-recipe.ts', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
  ]);

  assert.deepEqual(harnessConfig.include, [
    'AdmissionHarness.tsx',
    'ForegroundLocationExample.tsx',
    'foreground-location-recipe.ts',
  ]);
  assert.equal(manifest.exports['./location'], undefined);
  assert.equal(manifest.exports['./foreground-location'], undefined);
  assert.equal(manifest.files.includes('harness'), false);
  assert.equal(manifest.files.some((value: string) => value.startsWith('harness/')), false);
  assert.doesNotMatch(publicIndex, /ForegroundLocation|LocationProvider|LocationPermission|useLocation/u);

  assert.match(example, /from '\.\.\/src\/index'/u);
  assert.match(recipe, /import type \{MapView, TileflowAnnotation\} from '\.\.\/src\/index'/u);
  for (const source of [example, recipe]) {
    assert.doesNotMatch(
      source,
      /expo-location|react-native-geolocation|@react-native-community\/geolocation|PermissionsAndroid|NativeModules/u,
    );
    assert.doesNotMatch(source, /from '\.\.\/src\/(?!index)/u);
  }
});

test('package dependencies and native metadata stay location-provider and permission free', async () => {
  const [manifest, androidManifest, podspec, nativeConfig] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8').then((value) => JSON.parse(value)),
    readFile(new URL('android/src/main/AndroidManifest.xml', root), 'utf8'),
    readFile(new URL('TileflowNativeAdmission.podspec', root), 'utf8'),
    readFile(new URL('react-native.config.cjs', root), 'utf8'),
  ]);
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    for (const name of Object.keys(manifest[group] ?? {}))
      assert.doesNotMatch(name, /(?:geo)?location/u, `${group}:${name}`);
  }
  assert.doesNotMatch(
    androidManifest,
    /android\.permission\.(?:ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION|ACCESS_BACKGROUND_LOCATION)/u,
  );
  assert.doesNotMatch(podspec, /CoreLocation|CLLocation/u);
  assert.doesNotMatch(nativeConfig, /(?:geo)?location/u);
});

test('the recipe structurally requires explicit foreground ownership and no selection presentation', async () => {
  const source = await readFile(new URL('harness/ForegroundLocationExample.tsx', root), 'utf8');
  assert.match(source, /requestPermission/u);
  assert.match(source, /setForeground/u);
  assert.match(source, /AppState\.addEventListener/u);
  assert.match(source, /recenterForegroundLocationView/u);
  assert.match(source, /annotations=\{annotations\}/u);
  assert.match(source, /view=\{view\}/u);
  assert.match(source, /onViewChange/u);
  assert.doesNotMatch(
    source,
    /renderPopup|renderTooltip|Callout|BottomSheet|Modal|background permission|GeoIP/u,
  );
});
