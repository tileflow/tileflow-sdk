import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeAdmissionOwner} from '../src/native-admission-owner';
import {AdmissionBridgeDouble} from './native-admission-fixture';
import {apiOrigin, createClock, credential, mapId, response, success} from './session-fixture';

test('default session factories are isolated per Map and anchored to native installation identity', async () => {
	const bridge = new AdmissionBridgeDouble();
	const sessions: string[] = [];
	const owner = createNativeAdmissionOwner({bridge});
	const input = {
		binding: {kind: 'hosted' as const, apiOrigin, credential, mapId},
		resources: [], now: createClock().now,
		fetch: async (_url: string, init: {body: string}) => {
			const body = JSON.parse(init.body);
			sessions.push(body.sessionId);
			return response(201, success({sessionId: body.sessionId, surfaceId: body.surfaceId}));
		},
	};
	const maps = await Promise.all([owner.openMap(input), owner.openMap(input)]);
	await Promise.all(maps.map((map) => map.prepare()));
	assert.equal(new Set(sessions).size, 2);
	assert.ok(sessions.every((id) => id.startsWith(`${bridge.installation}.`)));
	assert.ok(sessions.every((id) => id.length < 255));
	await owner.dispose();
});
