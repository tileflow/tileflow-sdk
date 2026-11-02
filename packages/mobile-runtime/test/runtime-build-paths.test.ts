import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {isWithin} from '../../../scripts/mobile-runtime-paths.mjs';

test('the runtime build finds Core sources with POSIX and Windows paths', () => {
  const posix = '/repo/packages/core/src';
  assert.equal(isWithin(posix, '/repo/packages/core/src/native.ts', path.posix), true);
  assert.equal(isWithin(posix, '/repo/packages/core/src/a/b.ts', path.posix), true);
  assert.equal(isWithin(posix, '/repo/packages/core/src-next/native.ts', path.posix), false);
  assert.equal(isWithin(posix, '/repo/packages/core/src', path.posix), false);
  assert.equal(isWithin(posix, '/repo/packages/core/native.ts', path.posix), false);
  const windows = 'D:\\a\\repo\\packages\\core\\src';
  assert.equal(isWithin(windows, 'D:\\a\\repo\\packages\\core\\src\\native.ts', path.win32), true);
  assert.equal(isWithin(windows, 'd:\\a\\repo\\packages\\core\\src\\native.ts', path.win32), true);
  assert.equal(
    isWithin(windows, 'D:\\a\\repo\\packages\\core\\srcx\\native.ts', path.win32),
    false,
  );
  assert.equal(isWithin(windows, 'C:\\a\\repo\\packages\\core\\src\\native.ts', path.win32), false);
});
