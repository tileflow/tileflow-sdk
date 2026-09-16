import assert from 'node:assert/strict';
import test from 'node:test';
import {isRootCliVersionRequest} from '../src/cli-version';

test('only a standalone root version request bypasses command option parsing', () => {
  assert.equal(isRootCliVersionRequest(['--version']), true);
  assert.equal(isRootCliVersionRequest(['-V']), true);
  assert.equal(isRootCliVersionRequest(['icon-set', 'purge', 'brand', '--version', '2']), false);
  assert.equal(isRootCliVersionRequest(['--version', '--help']), false);
  assert.equal(isRootCliVersionRequest([]), false);
});
