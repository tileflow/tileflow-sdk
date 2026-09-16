import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFile(new URL(path, root), 'utf8');

test('native document modules carry no grant or application-configuration input', async () => {
  for (const path of [
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeDocumentsModule.kt',
    'ios/TileflowNativeDocuments.mm',
    'src/native-document-contract.ts',
    'src/native-document-bridge.ts',
  ]) {
    const source = await read(path);
    assert.doesNotMatch(
      source,
      /tf_public_[0-9a-f]{48}|tf_native_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
    );
    assert.doesNotMatch(
      source,
      /X-Tileflow-Native-Grant|X-Tileflow-Mobile-Client|MobileConfiguration|HostedNativeSessionAuthority/u,
    );
    assert.doesNotMatch(
      source,
      /\bconsole\.|\bNSLog\s*\(|\bLog\.|\bTimber\.|HttpLoggingInterceptor/u,
    );
  }
});

test('native document and catalog sources use the existing package globs and installation package', async () => {
  const android = await read(
    'android/src/main/java/dev/tileflow/reactnative/TileflowNativeAdmissionPackage.kt',
  );
  assert.match(android, /TileflowNativeDocumentsModule\(context\)/u);
  const pod = await read('TileflowNativeAdmission.podspec');
  assert.match(pod, /source_files\s*=\s*'ios\/\*\.\{h,mm\}'/u);
  assert.match(pod, /private_header_files\s*=\s*'ios\/\*\.h'/u);
  const module = await read('ios/TileflowNativeDocuments.mm');
  assert.match(module, /RCT_EXPORT_MODULE\(TileflowNativeDocuments\)/u);
  assert.doesNotMatch(module, /registerClass|didReceiveResponse/u);
  const contract = await read('src/native-document-contract.ts');
  assert.match(contract, /chunkBytes: 65_536/u);
  assert.match(contract, /operations: 16/u);
  const manifest = JSON.parse(await read('package.json'));
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
  assert.deepEqual(manifest.peerDependencies, {
    '@maplibre/maplibre-react-native': '11.3.10',
    react: '19.2.0',
    'react-native': '0.83.10',
  });
});
