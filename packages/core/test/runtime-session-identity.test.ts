import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowSessionController} from '../src/runtime';

test('allocates one identity per generation and reuses it until a map binding changes', async () => {
  let identities = 0;
  const requests: string[] = [];
  const controller = createTileflowSessionController({
    source: 'test',
    sessionIdFactory: () => `ses_fixture_${++identities}`,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {sessionId: string};
      requests.push(body.sessionId);
      return Response.json({ok: true, sessionId: body.sessionId, billingEnabled: false});
    },
  });
  assert.equal(identities, 1);
  assert.equal(controller.sessionId, 'ses_fixture_1');
  const apiUrl = 'https://api.example.test';
  for (const mapId of ['map_one', 'map_one', 'map_two']) {
    await controller.resolveRequestUrl(`${apiUrl}/maps/${mapId}/style.json`, {apiUrl, mapId});
  }
  assert.equal(identities, 2);
  assert.equal(controller.sessionId, 'ses_fixture_2');
  assert.deepEqual(requests, ['ses_fixture_1', 'ses_fixture_2']);
});
