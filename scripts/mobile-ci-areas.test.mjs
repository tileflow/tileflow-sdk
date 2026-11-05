import assert from 'node:assert/strict';
import test from 'node:test';
import {mobileAreas} from './mobile-ci-areas.mjs';

test('selects the mobile hosts reached by each change', () => {
  const none = {ios: false, android: false, reactNative: false};
  assert.deepEqual(mobileAreas([]), none);
  assert.deepEqual(mobileAreas(['packages/react/src/index.ts', 'docs/README.md']), none);
  assert.deepEqual(mobileAreas(['packages/react-native/src/map.tsx']), none);
  assert.deepEqual(mobileAreas(['package.json.bak', 'scripts/mobilex.mjs']), none);
  assert.deepEqual(mobileAreas(['platforms/ios/Package.swift']), {...none, ios: true});
  assert.deepEqual(mobileAreas(['platforms/android/tileflow/build.gradle.kts']), {
    ...none,
    android: true,
  });
  assert.deepEqual(mobileAreas(['platforms/native-release.json']), {...none, android: true});
  for (const fixture of ['Offline/offline-corridors.json', 'Marine/marine-credits.json'])
    assert.deepEqual(mobileAreas([`platforms/ios/Tests/TileflowTests/Fixtures/${fixture}`]), {
      ...none,
      ios: true,
      android: true,
    });
  assert.deepEqual(mobileAreas(['platforms/android/gradlew']), {
    ...none,
    android: true,
    reactNative: true,
  });
  assert.deepEqual(
    mobileAreas(['packages/react-native/android/src/main/java/dev/tileflow/reactnative/A.kt']),
    {...none, reactNative: true},
  );
  const native = {ios: true, android: true, reactNative: false};
  for (const path of [
    'packages/core/src/browser.ts',
    'scripts/native-golden-generate.mjs',
    'scripts/mobile-fixture-server.mjs',
    'pnpm-lock.yaml',
  ])
    assert.deepEqual(mobileAreas([path]), native, path);
  for (const path of ['packages/dev/src/artifacts.ts', 'packages/maps/src/index.ts'])
    assert.deepEqual(mobileAreas([path]), {...none, ios: true, android: true}, path);
  assert.deepEqual(
    mobileAreas(['platforms/ios/Tests/TileflowTests/Fixtures/Native/native-evaluators.json']),
    {...none, ios: true, android: true},
  );
  const all = {...native, reactNative: true};
  assert.deepEqual(mobileAreas(['test-support/mobile/hosted/session-sequences.json']), all);
  assert.deepEqual(mobileAreas(['platforms/map-api.json']), all);
  assert.deepEqual(mobileAreas(['.github/workflows/ci.yml']), all);
  assert.deepEqual(mobileAreas(null), all);
});
