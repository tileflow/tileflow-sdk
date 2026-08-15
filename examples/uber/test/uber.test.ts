import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyleFromProject, validateConfig} from '@tileflow/core';
import {rideScenes} from '../src/scenes';
import project from '../tileflow.config';

test('builds a valid Uber-inspired map from the Streets contract', () => {
  const validation = validateConfig(project);
  assert.deepEqual(validation.messages, []);
  assert.equal(validation.valid, true);

  const style = createStyleFromProject(project, 'uber');
  assert.equal(style.name, 'Tileflow Uber-inspired Streets');
  assert.equal(style.metadata?.['tileflow:basemap'], 'streets');
  assert.equal(style.metadata?.['tileflow:basemapVersion'], 2);
  assert.equal(style.metadata?.['tileflow:theme'], 'uber');
  assert.equal(style.layers.length > 90, true);
  assert.equal(
    style.layers.some((layer) => layer.id === 'streets-label-road-shield'),
    true,
  );
});

test('keeps the LA and NYC application scenes aligned with their route data', () => {
  assert.deepEqual(Object.keys(project.scenes).sort(), ['uber-la', 'uber-nyc']);

  for (const rideScene of rideScenes) {
    const captureScene = project.scenes[rideScene.id];
    assert.deepEqual(captureScene.camera, {
      type: 'center',
      center: rideScene.center,
      zoom: rideScene.zoom,
    });
    assert.deepEqual(captureScene.target, {
      kind: 'application',
      path: rideScene.path,
      captureId: rideScene.id,
      frame: 'viewport',
    });
    assert.equal(rideScene.route.length >= 8, true);
    assert.equal(rideScene.vehicles.length >= 5, true);
  }
});

test('workspace commands prepare the SDK before starting or reviewing the example', async () => {
  const workspacePackage = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as {scripts: Record<string, string>};

  assert.match(workspacePackage.scripts['uber:prepare'] ?? '', /@tileflow\/react/);
  assert.match(workspacePackage.scripts['uber:prepare'] ?? '', /@tileflow\/vite/);
  assert.match(workspacePackage.scripts['dev:uber'] ?? '', /^pnpm run uber:prepare/);
  assert.match(workspacePackage.scripts['capture:uber'] ?? '', /^pnpm run uber:prepare/);
});
