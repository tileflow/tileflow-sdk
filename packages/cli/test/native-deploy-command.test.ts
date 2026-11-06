import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';

function command(cwd: string, args: string[]) {
  return new Promise<{code: number | null; output: string}>((resolve, reject) => {
    const child = spawn(process.execPath, cliFixtureArguments(args), {
      cwd,
      env: {...process.env, TILEFLOW_API_KEY: '', TILEFLOW_API_URL: 'https://unused.invalid'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let overflow = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    const receive = (bytes: Buffer) => {
      if (output.length + bytes.length > 128_000) {
        overflow = true;
        child.kill('SIGKILL');
        return;
      }
      output += bytes.toString('utf8');
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (signal || overflow) reject(new Error('CLI fixture did not complete within its bounds.'));
      else resolve({code, output});
    });
  });
}
async function fixture(t: {after(callback: () => Promise<void>): void}) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-hosted-deploy-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await writeFile(join(cwd, 'tileflow.manifest.json'), 'PRESERVE_EXISTING_MANIFEST\n');
  return cwd;
}

test('deploy keeps platforms in the map configuration', async (t) => {
  const cwd = await fixture(t);
  const result = await command(cwd, ['deploy', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.output, /Deploy a map to Tileflow/u);
  assert.match(result.output, /--map-id/u);
  assert.doesNotMatch(
    result.output,
    /--with-native|mobile-client|credential-prop|native-provider/u,
  );
});

test('the retired --with-native flag is refused before executing repository configuration', async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, 'tileflow.config.ts'), "throw new Error('CONFIG_EXECUTED');\n");
  const result = await command(cwd, [
    'deploy',
    '--with-native',
    '--map-id',
    'map_0123456789abcdef',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.output, /unknown option '--with-native'/u);
  assert.doesNotMatch(result.output, /CONFIG_EXECUTED/u);
  assert.equal(
    await readFile(join(cwd, 'tileflow.manifest.json'), 'utf8'),
    'PRESERVE_EXISTING_MANIFEST\n',
  );
});

test('a theme native apps cannot draw stops the deploy before credential discovery', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main', version:1, extends:streets, platforms:['web','native'],
  glyphs: {kind:'url', url:'http://fonts.example.test/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic',
      'DINish Medium,Noto Sans Regular', 'DINish Bold,Noto Sans Regular']}
});
`,
  );
  const result = await command(cwd, ['deploy', '--map-id', 'map_0123456789abcdef']);
  assert.equal(result.code, 1);
  assert.match(result.output, /A theme cannot be prepared for native apps/u);
  assert.match(result.output, /glyphs/u);
  assert.doesNotMatch(result.output, /account session|Published|Uploaded|fetch failed/u);
  assert.equal(
    await readFile(join(cwd, 'tileflow.manifest.json'), 'utf8'),
    'PRESERVE_EXISTING_MANIFEST\n',
  );
});

test('Hosted deploy requires an HTTPS API outside the developer machine', async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, 'tileflow.config.ts'), "throw new Error('CONFIG_EXECUTED');\n");
  const result = await command(cwd, [
    'deploy',
    '--map-id',
    'map_0123456789abcdef',
    '--api-url',
    'http://api.example.test',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.output, /requires an HTTPS Tileflow API URL/u);
  assert.doesNotMatch(result.output, /CONFIG_EXECUTED/u);
});
