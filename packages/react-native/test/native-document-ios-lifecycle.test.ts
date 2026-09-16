import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('iOS preparation retires protected documents without closing independent acquisition', async () => {
	const module = await read('ios/TileflowNativeDocuments.mm');
	assert.match(module, /RCT_EXPORT_MODULE\(TileflowNativeDocuments\)/u);
	for (const method of ['openDocument', 'documentResponse', 'documentChunk', 'cancelDocument']) {
		assert.match(module, new RegExp(`RCT_REMAP_METHOD\\(${method}`, 'u'));
	}
	assert.match(module, /protocolClasses\s*=\s*@\[\]/u);
	assert.match(module, /followsRedirects:NO/u);
	assert.match(module, /responseByteLimit:8388608/u);
	assert.match(module, /maximumBytes > 65536/u);
	assert.match(module, /retireProtected/u);
	assert.doesNotMatch(module, /didReceiveResponse|registerClass|MobileConfiguration|grant|credential/iu);
	const owner = await read('ios/TileflowNativeAdmission.mm');
	assert.match(owner, /TFCreateAdmissionDocumentScope/u);
	assert.match(owner, /extendContext/u);
	assert.match(owner, /retireNativeContext/u);
	assert.match(owner, /retireProtectedDocuments/u);
});
