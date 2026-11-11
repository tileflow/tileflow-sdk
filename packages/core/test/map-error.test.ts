import assert from 'node:assert/strict';
import test from 'node:test';
import {reportTileflowMapError, type TileflowMapError} from '../src/map-error';

test('hands a failure to the handler as a code and an Error, and keeps it off the console', (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  const received: TileflowMapError[] = [];
  const cause = new Error('network down');

  reportTileflowMapError((event) => received.push(event), 'manifest', cause);

  assert.deepEqual(received, [{code: 'manifest', error: cause}]);
  assert.deepEqual(logged, []);
});

test('wraps a thrown value that is not an Error', () => {
  const received: TileflowMapError[] = [];
  reportTileflowMapError((event) => received.push(event), 'scene', 'plain text');
  assert.equal(received[0]?.code, 'scene');
  assert.ok(received[0]?.error instanceof Error);
  assert.equal(received[0]?.error.message, 'plain text');
});

test('falls back to console.error with the failure when there is no handler', (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  const cause = new Error('boom');

  reportTileflowMapError(undefined, 'theme', cause);
  reportTileflowMapError(undefined, 'camera', cause);

  assert.deepEqual(logged, [
    ['Failed to change the Tileflow map theme', cause],
    ['Invalid Tileflow map camera', cause],
  ]);
});

test('logs a handler that throws instead of breaking the map', (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
  const failure = new Error('handler bug');

  assert.doesNotThrow(() =>
    reportTileflowMapError(
      () => {
        throw failure;
      },
      'runtime',
      new Error('x'),
    ),
  );
  assert.deepEqual(logged, [['A Tileflow onError handler threw', failure]]);
});
