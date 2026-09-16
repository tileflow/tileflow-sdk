import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowSessionController} from '../src/runtime';

test('commercial session preflight preserves the explicit analytics source override', async () => {
	for (const source of [undefined, 'embedded-map']) {
		let payload: Record<string, unknown> | undefined;
		const controller = createTileflowSessionController({
			source: 'react',
			sessionIdFactory: () => 'ses_source_fixture',
			fetch: async (_url, init) => {
				payload = JSON.parse(String(init?.body));
				return new Response(JSON.stringify({ok: true, sessionId: 'ses_source_fixture', billingEnabled: false}), {status: 200});
			},
		});
		await controller.resolveRequestUrl('https://api.example.test/maps/map_1/style.json', {
			apiUrl: 'https://api.example.test', mapId: 'map_1', source,
		});
		assert.equal(payload?.source, source ?? 'react');
	}
});
