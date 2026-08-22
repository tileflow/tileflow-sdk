import assert from 'node:assert/strict';
import {test} from 'node:test';
import {posix, win32} from 'node:path';
import {isPathWithinWith} from '../src/path-safety';

test('path containment is portable across POSIX and Windows separators', () => {
  assert.equal(
    isPathWithinWith(posix, '/runtime/three/jsm', '/runtime/three/jsm/loaders/a.js'),
    true,
  );
  assert.equal(isPathWithinWith(posix, '/runtime/three/jsm', '/runtime/three/escape.js'), false);

  assert.equal(
    isPathWithinWith(
      win32,
      String.raw`C:\runtime\three\jsm`,
      String.raw`C:\runtime\three\jsm\loaders\a.js`,
    ),
    true,
  );
  assert.equal(
    isPathWithinWith(
      win32,
      String.raw`C:\runtime\three\jsm`,
      String.raw`C:\runtime\three\escape.js`,
    ),
    false,
  );
});
