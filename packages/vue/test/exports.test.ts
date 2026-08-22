import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('publishes one ESM entry with matching default and named components', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: {'.': {default: string; import: string; types: string}};
    files: string[];
    main: string;
    sideEffects: boolean;
    types: string;
  };
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');

  assert.deepEqual(packageJson.files, ['dist']);
  assert.equal(packageJson.main, packageJson.exports['.'].import);
  assert.equal(packageJson.types, packageJson.exports['.'].types);
  assert.equal(packageJson.exports['.'].default, packageJson.exports['.'].import);
  assert.equal(packageJson.sideEffects, false);
  assert.match(source, /export const TileflowMap/u);
  assert.match(source, /export default TileflowMap/u);
});
