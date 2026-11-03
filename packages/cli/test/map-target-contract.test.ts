import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {tileflowRendererDeploymentResponseSchema} from '@tileflow/core/build';

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
  const response = (mapId: string) => ({
    kind: 'tileflow-map-deployment-result',
    schemaVersion: 3,
    changed: true,
    mapId,
    deploymentId: 'dep_test',
    version: 1,
    renderers: {
      web: {themes: {light: {styleUrl: `https://api.example.test/maps/${mapId}/light.json`}}},
      native: {
        profile: 'native-v1',
        manifestUrl: `https://api.example.test/maps/${mapId}/native/manifest.json`,
        family: {
          url: `https://api.example.test/maps/${mapId}/native/family/v1.json`,
          revision: 'a'.repeat(64),
        },
        themes: {
          light: {
            styleUrl: `https://api.example.test/maps/${mapId}/native/v1/light.json`,
            revision: 'a'.repeat(64),
          },
        },
      },
    },
  });

  assert.equal(
    tileflowRendererDeploymentResponseSchema.safeParse(response('map_test')).success,
    false,
  );
  assert.equal(
    tileflowRendererDeploymentResponseSchema.safeParse(response('map_AbCdEfGhIjKlMnOp')).success,
    true,
  );
});
