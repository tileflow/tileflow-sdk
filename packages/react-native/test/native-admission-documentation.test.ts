import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');

test('package documentation describes the mounted Map without claiming executed acceptance', async () => {
  const readme = await text('README.md');
  assert.match(readme, /exports a mounted `Map`/u);
  assert.match(readme, /Tileflow-only/u);
  assert.match(readme, /docs\/native-admission\.md/u);
  assert.match(readme, /docs\/native-configuration\.md/u);
  assert.ok(readme.length <= 24000);
  assert.doesNotMatch(readme, /does not export a `Map`|future renderer|publication is supported/u);
  const guide = await text('docs/native-admission.md');
  for (const term of [
    '13.2.0',
    '6.26.0',
    '0.83.10',
    '11.3.10',
    'tileflow_native_admission_post_install',
    'X-Tileflow-Native-Grant',
    '10,000',
    'six-hour',
  ]) {
    assert.ok(guide.includes(term), term);
  }
  assert.match(guide, /not a public API/u);
  assert.match(guide, /bounded Style\/TileJSON resource closure/u);
  assert.match(guide, /not evidence/u);
  assert.doesNotMatch(guide, /Full style\/TileJSON closure projection[^\n]*not implemented/u);
});

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
  const instructions = await text('harness/README.md');
  assert.match(instructions, /existing development host/u);
  assert.match(instructions, /No native acceptance result/u);
  assert.match(instructions, /mounted Tileflow `Map`/u);
});
