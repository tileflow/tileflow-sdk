import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('managed deploy has one durable Map target', async () => {
  const source = await readFile(new URL('../src/cli-main.ts', import.meta.url), 'utf8');

  assert.match(source, /--map-id <id>/u);
  assert.doesNotMatch(source, /--world-conversion|worldConversionId|worldConversion/u);
});
