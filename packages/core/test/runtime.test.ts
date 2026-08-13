import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTileflowMapMode} from '../src/index';

test('uses the interactive map for implicit image mode on local development hosts', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1']) {
    withWindowHostname(hostname, () => {
      assert.equal(
        resolveTileflowMapMode({
          mode: 'image',
          preferLocalDev: true,
        }),
        'interactive',
      );
    });
  }
});

test('keeps image mode outside the local development fallback', () => {
  assert.equal(resolveTileflowMapMode({mode: 'image'}), 'image');

  withWindowHostname('example.com', () => {
    assert.equal(resolveTileflowMapMode({mode: 'image'}), 'image');
  });

  withWindowHostname('localhost', () => {
    assert.equal(
      resolveTileflowMapMode({
        mode: 'image',
        preferLocalDev: false,
      }),
      'image',
    );
    assert.equal(
      resolveTileflowMapMode({
        imageUrl: '/map.png',
        mode: 'image',
      }),
      'image',
    );
  });
});

test('defaults to interactive mode', () => {
  assert.equal(resolveTileflowMapMode({}), 'interactive');
  assert.equal(resolveTileflowMapMode({mode: 'interactive'}), 'interactive');
});

function withWindowHostname(hostname: string, run: () => void): void {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {location: {hostname}},
  });

  try {
    run();
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}
