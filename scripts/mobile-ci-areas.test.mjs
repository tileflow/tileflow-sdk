import assert from 'node:assert/strict';
import test from 'node:test';
import {mobileAreas} from './mobile-ci-areas.mjs';

test('selects mobile jobs from the paths that reach the runtime or a native host', () => {
  const none = {runtime: false, ios: false, android: false, reactNative: false};
  assert.deepEqual(mobileAreas([]), none);
  assert.deepEqual(mobileAreas(['packages/react/src/index.ts', 'docs/README.md']), none);
  assert.deepEqual(mobileAreas(['packages/react-native/src/map.tsx']), none);
  assert.deepEqual(mobileAreas(['package.json.bak', 'scripts/mobilex.mjs']), none);
  assert.deepEqual(mobileAreas(['platforms/ios/Package.swift']), {...none, ios: true});
  assert.deepEqual(mobileAreas(['platforms/android/tileflow/build.gradle.kts']), {
    ...none,
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
  const embedded = {runtime: true, ios: true, android: true, reactNative: false};
  for (const path of [
    'packages/core/src/browser.ts',
    'packages/mobile-runtime/src/map-runtime.ts',
    'scripts/mobile-fixture-server.mjs',
    'pnpm-lock.yaml',
  ])
    assert.deepEqual(mobileAreas([path]), embedded, path);
  const all = {...embedded, reactNative: true};
  assert.deepEqual(mobileAreas(['.github/workflows/ci.yml']), all);
  assert.deepEqual(mobileAreas(null), all);
});
