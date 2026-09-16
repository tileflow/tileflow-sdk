import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const implementation = [
  'src/mobile-configuration.ts',
  'src/hosted-binding.ts',
  'src/native-configuration-reader.ts',
  'src/native-configuration-bridge.ts',
  'android/src/main/java/dev/tileflow/reactnative/MobileConfiguration.kt',
  'android/src/main/java/dev/tileflow/reactnative/MobileConfigurationResources.kt',
  'android/src/main/java/dev/tileflow/reactnative/TileflowNativeConfigurationModule.kt',
  'ios/TFMobileConfiguration.mm',
  'ios/TileflowNativeConfiguration.mm',
];

test('application configuration has no logger, event emitter or embedded credential value', async () => {
  for (const path of implementation) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /\bconsole\.|\bLog\.|\bTimber\.|\bprintln\s*\(|\bNSLog\s*\(|\bos_log\s*\(/u,
      path,
    );
    assert.doesNotMatch(source, /NativeEventEmitter|sendEventWithName|RCTEventEmitter/u, path);
    assert.doesNotMatch(source, /tf_public_[0-9a-f]{48}/u, path);
    assert.doesNotMatch(source, /tf_native_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u, path);
  }
});
