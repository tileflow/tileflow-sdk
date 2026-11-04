import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';

const loader = `export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  const blocked = ['@tileflow/capture', '@tileflow/coordinates-runtime', '@tileflow/dev/artifacts', '@tileflow/dev/preview', '@tileflow/dev/server'];
  if (blocked.some(name => specifier === name) || result.url.includes('/packages/capture/dist/') || result.url.includes('/packages/coordinates-runtime/dist/')) {
    throw new Error('Unneeded authoring runtime loaded: ' + specifier);
  }
  return result;
}`;
const registration = `import {register} from 'node:module'; register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(loader)}`)}, import.meta.url);`;

for (const args of [['--version'], ['tileset', '--help']]) {
  test(`${args.join(' ')} runs without loading capture, rendering or coordinate execution`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(registration)}`,
        ...cliFixtureArguments(args),
      ],
      {encoding: 'utf8', maxBuffer: 1_000_000},
    );

    assert.equal(result.status, 0, result.stderr);
  });
}
