import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {AdmissionBridgeDouble} from './native-admission-fixture';

test('native lifecycle is observable privately without retiring or identifying Map contexts', async () => {
	const bridge = new AdmissionBridgeDouble();
	const lifecycle: boolean[] = [];
	const owner = createNativeAdmissionOwner({
		bridge,
		onLifecycle(foreground) { lifecycle.push(foreground); },
	});
	await owner.install();
	bridge.listener({kind: 'lifecycle', installation: bridge.installation, foreground: false});
	bridge.listener({kind: 'lifecycle', installation: bridge.installation, foreground: true});
	assert.deepEqual(lifecycle, [false, true]);
	assert.equal(JSON.stringify(lifecycle).includes('context'), false);
	await owner.dispose();
	bridge.listener({kind: 'lifecycle', installation: bridge.installation, foreground: false});
	assert.deepEqual(lifecycle, [false, true]);
});
