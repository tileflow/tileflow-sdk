import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

for (const entry of ['index.js', 'static.js']) {
  test(`preserves the client boundary in dist/${entry}`, async () => {
    const output = await readFile(new URL(`../dist/${entry}`, import.meta.url), 'utf8');
    assert.match(output, /^['"]use client['"];?/);
  });

  test(`includes the framework-neutral readiness contract in dist/${entry}`, async () => {
    const output = await readFile(new URL(`../dist/${entry}`, import.meta.url), 'utf8');
    assert.match(output, /data-tileflow-state/);
    assert.match(output, /data-tileflow-map/);
    assert.match(output, /data-tileflow-capture-id/);
    assert.match(output, /idle/);
    assert.match(output, /loading/);
    assert.match(output, /error/);
  });
}
