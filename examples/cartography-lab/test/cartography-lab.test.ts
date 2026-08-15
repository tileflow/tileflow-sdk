import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyleFromProject, validateConfig} from '@tileflow/core';
import project from '../tileflow.config';

test('keeps the editorial city recipe on the rich versioned renderer contract', () => {
  const validation = validateConfig(project);
  assert.deepEqual(validation.messages, []);
  assert.equal(validation.valid, true);

  const style = createStyleFromProject(project, 'editorial-city');
  assert.equal(style.metadata?.['tileflow:renderer'], 'osm-bright');
  assert.equal(style.metadata?.['tileflow:rendererPreference'], 'osm-bright');
  assert.equal(style.metadata?.['tileflow:tilesetVersion'], '2026-06-07');
  const typography = style.metadata?.['tileflow:typography'] as {font?: unknown} | undefined;
  assert.equal(typography?.font, 'Noto Sans');
  assert.equal(style.layers.length > 100, true);
});

test('covers the canonical cartographic review surfaces with standalone scenes', () => {
  assert.deepEqual(Object.keys(project.scenes).sort(), [
    'barcelona-waterfront',
    'madrid-mobile',
    'madrid-neighborhood',
    'madrid-overview',
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
