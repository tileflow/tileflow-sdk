import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveIconOptions} from '../src/icon-options';

const hosted = 'https://api.tileflow.dev';

test('icon origins preserve asset base paths and explicit API selection precedence', (t) => {
  const previous = process.env.TILEFLOW_API_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.TILEFLOW_API_URL;
    else process.env.TILEFLOW_API_URL = previous;
  });
  delete process.env.TILEFLOW_API_URL;
  assert.equal(resolveIconOptions(), undefined);
  assert.equal(resolveIconOptions({apiBaseUrl: `${hosted}/base`}), undefined);
  assert.deepEqual(resolveIconOptions({cacheDir: './cache', offline: true}), {
    cacheRoot: './cache',
    offline: true,
  });

  process.env.TILEFLOW_API_URL = '';
  assert.equal(resolveIconOptions(), undefined);
  assert.equal(resolveIconOptions({apiBaseUrl: ''}), undefined);

  process.env.TILEFLOW_API_URL = 'http://127.0.0.1:8787';
  assert.deepEqual(resolveIconOptions(), {
    deliveryOrigins: [hosted, 'http://127.0.0.1:8787'],
  });
  assert.deepEqual(resolveIconOptions({apiBaseUrl: 'https://api.example.test/base'}), {
    deliveryOrigins: [hosted, 'https://api.example.test'],
  });
  assert.deepEqual(
    resolveIconOptions({
      apiUrl: 'https://control.example.test',
      apiBaseUrl: 'https://api.example.test/base',
    }),
    {
      deliveryOrigins: [hosted, 'https://control.example.test'],
    },
  );
  assert.equal(resolveIconOptions({apiUrl: hosted}), undefined);

  assert.throws(() => resolveIconOptions({apiUrl: 'https://api.example.test/base'}));
  for (const apiBaseUrl of [
    'ftp://api.example.test/base',
    'https://user:password@api.example.test/base',
    'https://api.example.test/base?token=secret',
    'https://api.example.test/base#fragment',
  ]) {
    assert.throws(() => resolveIconOptions({apiBaseUrl}));
  }
});
