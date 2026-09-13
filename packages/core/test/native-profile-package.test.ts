import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const packageRoot = new URL('../', import.meta.url);

test('publishes a build-only profile entry without widening the root or native URL entry', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
  assert.deepEqual(manifest.exports['./native-profile'], {
    types: './dist/native-profile.d.ts',
    import: './dist/native-profile.js',
    default: './dist/native-profile.js',
  });
  assert.equal(manifest.dependencies['@maplibre/maplibre-gl-style-spec'], '24.8.5');
  assert.deepEqual(manifest.files, ['dist', 'docs', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
  const declarations = await readFile(new URL('dist/native-profile.d.ts', packageRoot), 'utf8');
  for (const name of [
    'tileflowNativeProfileSchema',
    'validateTileflowNativeStyle',
    'tileflowNativeBuildRecordSchema',
  ]) {
    assert.match(declarations, new RegExp(name, 'u'));
  }

  const built = await readFile(new URL('dist/native-profile.js', packageRoot), 'utf8');
  assert.doesNotMatch(built, /node:module/u);
  assert.doesNotMatch(built, /maplibre-gl-style-spec\/dist\/latest\.json/u);

  const script = `
    for (const name of ['window', 'document', 'navigator', 'fetch', 'FontFace']) {
      Object.defineProperty(globalThis, name, {configurable:true, get() { throw new Error('Unexpected browser access.'); }});
    }
    const profile = await import('@tileflow/core/native-profile');
    const native = await import('@tileflow/core/native');
    const root = await import('@tileflow/core');
    if ('validateTileflowNativeStyle' in native || 'validateTileflowNativeStyle' in root) process.exit(2);
    const issues = profile.validateTileflowNativeStyle({version:8,sources:{},layers:[]});
    if (issues.length) throw new Error(JSON.stringify(issues));
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(packageRoot),
    timeout: 10_000,
  });
});
