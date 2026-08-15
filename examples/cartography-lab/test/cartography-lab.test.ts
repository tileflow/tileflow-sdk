import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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

test('workspace cartography commands prepare the packaged CLI before running it', async () => {
  const workspacePackage = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as {scripts: Record<string, string>};

  assert.equal(
    workspacePackage.scripts['cartography:prepare'],
    'turbo build --filter=@tileflow/cli',
  );

  for (const command of [
    'capture:cartography',
    'dev:cartography',
    'visual:cartography',
    'visual:cartography:update',
  ]) {
    assert.match(
      workspacePackage.scripts[command] ?? '',
      /^pnpm run cartography:prepare && node packages\/cli\/dist\/index\.js /,
      `${command} must not consume stale workspace package output`,
    );
  }
});
