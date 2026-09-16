import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');

test('private admission documentation does not claim a public renderer or executed native acceptance', async () => {
	const readme = await text('README.md');
	assert.match(readme, /does not export a `Map` component/u);
	assert.match(readme, /docs\/native-admission\.md/u);
	assert.ok(readme.length <= 20000);
	assert.doesNotMatch(readme, /This package supplies no Swift\/Kotlin bridge|only module with a React Native value import/u);
	const guide = await text('docs/native-admission.md');
	for (const term of ['13.2.0', '6.26.0', '0.83.10', '11.3.10', 'tileflow_native_admission_post_install', 'X-Tileflow-Native-Grant', '10,000', 'six-hour']) {
		assert.ok(guide.includes(term), term);
	}
	assert.match(guide, /not a public API/u);
	assert.match(guide, /Full style\/TileJSON closure projection/u);
	assert.match(guide, /not evidence/u);
});

test('the explicit local harness mounts upstream Maps without entering the published runtime graph', async () => {
	const harness = await text('harness/AdmissionHarness.tsx');
	assert.match(harness, /if \(!__DEV__\)/u);
	assert.match(harness, /Map as MapLibreMap/u);
	assert.match(harness, /createReactNativeAdmissionTransport/u);
	assert.match(harness, /sessionFetch: transport\.fetchForContext/u);
	assert.match(harness, /await owner\.install\(\)/u);
	assert.match(harness, /discriminateForTest/u);
	assert.doesNotMatch(harness, /console\.|TransformRequestManager|addHeader\(|globalThis\.fetch/u);
	assert.doesNotMatch(await text('tsup.config.ts'), /harness/u);
	assert.doesNotMatch(await text('src/index.ts'), /harness|admission/iu);
	const instructions = await text('harness/README.md');
	assert.match(instructions, /existing development host/u);
	assert.match(instructions, /No native acceptance result/u);
});
