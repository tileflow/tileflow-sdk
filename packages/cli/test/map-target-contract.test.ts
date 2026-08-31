import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {hostedStyleDeploymentResponseSchema} from '../src/hosted-response';

test('managed deploy targets the visible mapId while keeping Project internal', async () => {
  const [index, client] = await Promise.all([
    readFile(new URL('../src/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/hosted-client.ts', import.meta.url), 'utf8'),
  ]);
  const deploy = index.match(/\.command\('deploy'\)[\s\S]*?\.command\('status'/u)?.[0];

  assert.ok(deploy, 'deploy command definition is missing');
  assert.match(deploy, /\.option\('--map-id <id>'/u);
  assert.doesNotMatch(deploy, /\.option\('--project/u);
  assert.match(client, /\/v1\/cli\/map-capabilities/u);
});

test('hosted deployment responses require one persistent managed Map ID', () => {
  const response = {
    mapId: 'map_test',
    themes: {light: {styleUrl: 'https://api.example.test/maps/map_test/light.json'}},
  };

  assert.equal(hostedStyleDeploymentResponseSchema.safeParse(response).success, false);
  assert.equal(
    hostedStyleDeploymentResponseSchema.safeParse({
      ...response,
      mapId: 'map_AbCdEfGhIjKlMnOp',
    }).success,
    true,
  );
});
