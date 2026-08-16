import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyleFromProject, validateConfig} from '@tileflow/core';
import project from '../tileflow.config';

test('keeps the editorial city recipe on the versioned Streets contract', () => {
  const validation = validateConfig(project);
  assert.deepEqual(validation.messages, []);
  assert.equal(validation.valid, true);

  const style = createStyleFromProject(project, 'editorial-city');
  assert.equal(style.metadata?.['tileflow:basemap'], 'streets');
  assert.equal(style.metadata?.['tileflow:basemapVersion'], 2);
  assert.deepEqual(style.metadata?.['tileflow:data'], {
    kind: 'tileflow-world',
    revision: '2026-06-07',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
  assert.equal(style.sprite, undefined);
  assert.equal(style.metadata?.['tileflow:provenance'], undefined);
  assert.equal(style.layers.length > 100, true);
});

test('covers the canonical cartographic review surfaces with standalone scenes', () => {
  assert.deepEqual(Object.keys(project.scenes).sort(), [
    'barcelona-waterfront',
    'madrid-airport',
    'madrid-center',
    'madrid-close-street',
    'madrid-mobile',
    'madrid-motorway',
    'madrid-neighborhood',
    'madrid-overview',
    'madrid-rural-edge',
    'madrid-sol-close',
    'madrid-transit',
    'madrid-tunnels',
  ]);
  assert.equal(
    Object.values(project.scenes).every(
      (scene) => scene.map === 'editorial-city' && !('target' in scene),
    ),
    true,
  );
  assert.deepEqual(project.scenes['madrid-mobile'].viewport, {
    width: 390,
    height: 844,
    dpr: 2,
  });
});

test('workspace Streets commands prepare the packaged CLI before running it', async () => {
  const workspacePackage = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as {scripts: Record<string, string>};

  assert.equal(workspacePackage.scripts['streets:prepare'], 'turbo build --filter=@tileflow/cli');

  for (const command of [
    'capture:streets',
    'dev:streets',
    'visual:streets',
    'visual:streets:update',
  ]) {
    assert.match(
      workspacePackage.scripts[command] ?? '',
      /^pnpm run streets:prepare && node packages\/cli\/dist\/index\.js /,
      `${command} must not consume stale workspace package output`,
    );
  }

  for (const sceneName of Object.keys(project.scenes)) {
    assert.match(workspacePackage.scripts['visual:streets'] ?? '', new RegExp(sceneName));
    assert.match(workspacePackage.scripts['visual:streets:update'] ?? '', new RegExp(sceneName));
  }
});
