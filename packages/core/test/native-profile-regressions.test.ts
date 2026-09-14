import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {isBoundedNativeJson, tileflowNativeProfileLimits} from '../src/native-profile-helpers';
import {validateTileflowNativeStyle} from '../src/native-profile';

const execFileAsync = promisify(execFile);
const packageRoot = new URL('../', import.meta.url);

function background() {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {'background-color': '#ffffff'},
      },
    ],
  };
}

test('imports the packaged native-profile ESM entry under Node without JSON import attributes', async () => {
  const script = `
    const profile = await import('@tileflow/core/native-profile');
    const issues = profile.validateTileflowNativeStyle({version: 8, sources: {}, layers: []});
    if (issues.length !== 0) throw new Error(JSON.stringify(issues));
  `;
  const result = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(packageRoot),
    timeout: 10_000,
  });
  assert.equal(result.stderr, '');
});

test('rejects pitch 86 at the exact native root pointer while accepting 85', () => {
  assert.deepEqual(validateTileflowNativeStyle({...background(), pitch: 85}), []);
  const issues = validateTileflowNativeStyle({...background(), pitch: 86});
  assert.ok(
    issues.some(({code, path}) => code === 'NATIVE_UNSUPPORTED_STYLE' && path === '/pitch'),
    JSON.stringify(issues),
  );
});

test('keeps a deterministic 160k-node validation budget with a tested boundary', () => {
  assert.equal(tileflowNativeProfileLimits.maximumNodes, 160_000);
  const within = new Array((tileflowNativeProfileLimits.maximumNodes - 2) / 2).fill(0);
  const over = new Array(tileflowNativeProfileLimits.maximumNodes / 2).fill(0);
  assert.equal(isBoundedNativeJson(within), true);
  assert.equal(isBoundedNativeJson(over), false);
});
