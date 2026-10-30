import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');

test('the source-checkout harness mounts the public Tileflow Map without exposing private admission controls', async () => {
  const harness = await text('harness/AdmissionHarness.tsx');
  assert.match(harness, /if \(!__DEV__\)/u);
  assert.match(harness, /Map as TileflowMap/u);
  assert.match(harness, /from ['"]\.\.\/src\/index['"]/u);
  assert.match(harness, /StrictMode/u);
  assert.match(harness, /replaceFirstSource/u);
  assert.match(harness, /setFirstTheme/u);
  assert.doesNotMatch(
    harness,
    /createReactNativeAdmissionTransport|createNativeAdmissionOwner|HostedNativeSessionBinding|discriminateForTest|X-Tileflow/u,
  );
  assert.doesNotMatch(harness, /console\.|TransformRequestManager|addHeader\(|globalThis\.fetch/u);
  assert.doesNotMatch(await text('tsup.config.ts'), /harness/u);
  assert.doesNotMatch(await text('src/index.ts'), /harness|admission/iu);
});
