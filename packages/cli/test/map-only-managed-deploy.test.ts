import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('managed deploy has one durable Map target', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.match(source, /--map-id <id>/u);
  assert.doesNotMatch(source, /--world-conversion|worldConversionId|worldConversion/u);
});

test('every managed World manifest declares session delivery', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const manifestEntry = source.slice(
    source.indexOf('deployedMaps[mapName] = {'),
    source.indexOf('const versionLabel', source.indexOf('deployedMaps[mapName] = {')),
  );

  assert.match(manifestEntry, /usageMode: 'session'/u);
  assert.match(manifestEntry, /worldGeneration: 'v1'/u);
});
