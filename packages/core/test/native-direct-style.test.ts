import assert from 'node:assert/strict';
import test from 'node:test';
import {snapshotNativeDirectStyle} from '../src/native-direct-style';
import {tileflowNativeProfileLimits} from '../src/native-profile-helpers';
import {TileflowNativeSourceError} from '../src/native-source-types';

function invalid(value: unknown): void {
  assert.throws(
    () => snapshotNativeDirectStyle(value, {}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeSourceError);
      assert.equal(error.code, 'NATIVE_SOURCE_INVALID');
      assert.equal(error.field, 'source');
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );
}

test('snapshots finite JSON without coercing values, references, expressions or style metadata', () => {
  const shared = {nested: [null, false, -0, 0.1, 'e\u0301', '\ud800', '\ufeff']};
  const input = {
    version: 8,
    name: 'Data',
    sources: {},
    layers: [],
    metadata: {left: shared, right: shared},
    projection: {type: 'globe'},
    custom: ['case', ['get', 'enabled'], 1, 0],
  };
  const snapshot = snapshotNativeDirectStyle(input, {}) as any;
  assert.deepEqual(snapshot, input);
  assert.notEqual(snapshot, input);
  assert.notEqual(snapshot.metadata.left, shared);
  assert.notEqual(snapshot.metadata.left, snapshot.metadata.right);
  assert.ok(Object.isFrozen(snapshot.metadata.left.nested));
  assert.equal(Object.isFrozen(shared), false);
  assert.ok(Object.is(snapshot.metadata.left.nested[2], -0));
  shared.nested[0] = 'changed';
  assert.equal(snapshot.metadata.left.nested[0], null);
});

test('rejects non-JSON values and non-record roots instead of silently dropping them', () => {
  for (const value of [null, [], undefined, true, 2, () => 0, Symbol('secret'), 1n]) invalid(value);
  for (const value of [
    undefined,
    () => 0,
    Symbol('secret'),
    1n,
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    new Map(),
    new Set(),
    new Uint8Array([1]),
    /secret/,
  ]) {
    invalid({metadata: {value}});
  }
});

test('rejects getters, hidden/symbol keys and unsafe prototypes without invoking accessors', () => {
  let reads = 0;
  const getter = {
    get value() {
      reads++;
      throw new Error('secret');
    },
  };
  invalid(getter);
  invalid({metadata: getter});
  invalid(
    Object.defineProperty({}, 'hidden', {
      get() {
        reads++;
        return 1;
      },
    }),
  );
  invalid(Object.defineProperty({}, 'hidden', {value: 1}));
  invalid({[Symbol('secret')]: 1});
  invalid(Object.create({secret: true}));
  invalid({metadata: Object.create({secret: true})});
  const array = [1];
  Object.defineProperty(array, '0', {
    get() {
      reads++;
      return 1;
    },
  });
  invalid({metadata: array});
  const extra = [1] as number[] & {extra?: boolean};
  extra.extra = true;
  invalid({metadata: extra});
  invalid({metadata: Array(2)});
  invalid({metadata: Object.setPrototypeOf([1], {})});
  assert.equal(reads, 0);
});

test('rejects cycles and prototype-mutating keys at every depth, but permits shared plain data', () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  invalid(cycle);
  const array: unknown[] = [];
  array.push(array);
  invalid({metadata: array});
  for (const key of ['__proto__', 'constructor', 'prototype', 'toJSON']) {
    invalid(Object.fromEntries([[key, 'secret']]));
    invalid({metadata: Object.fromEntries([[key, 'secret']])});
  }
  const plain = Object.assign(Object.create(null), {value: 1});
  assert.deepEqual(snapshotNativeDirectStyle({metadata: plain}, {}), {metadata: {value: 1}});
  const {proxy, revoke} = Proxy.revocable({}, {});
  revoke();
  invalid(proxy);
});

test('applies the existing raw style node ceiling, not the prepared-output allowance', () => {
  const maximum = tileflowNativeProfileLimits.maximumNodes;
  assert.equal(maximum, 160_000);
  // A record with one array property visits root, key, array, then index/value pairs.
  const inside = {metadata: Array((maximum - 4) / 2).fill(0)};
  const outside = {metadata: Array((maximum - 2) / 2).fill(0)};
  assert.doesNotThrow(() => snapshotNativeDirectStyle(inside, {}));
  invalid(outside);
});

test('counts actual escaped UTF-8 JSON bytes at the existing 8 MiB ceiling', () => {
  const maximum = tileflowNativeProfileLimits.maximumStyleBytes;
  const overhead = new TextEncoder().encode(JSON.stringify({metadata: ''})).byteLength;
  const input = {metadata: 'a'.repeat(maximum - overhead)};
  assert.equal(new TextEncoder().encode(JSON.stringify(input)).byteLength, maximum);
  assert.doesNotThrow(() => snapshotNativeDirectStyle(input, {}));
  invalid({metadata: input.metadata + 'a'});
  const count = Math.floor((maximum - overhead) / 6);
  assert.doesNotThrow(() => snapshotNativeDirectStyle({metadata: '\u0000'.repeat(count)}, {}));
  invalid({metadata: '\u0000'.repeat(count + 1)});
});

test('enforces depth, layer and source cardinality without validating the Style Specification', () => {
  const nested = (depth: number): object => {
    let value: unknown = 0;
    for (let index = 0; index < depth; index++) value = {item: value};
    return value as object;
  };
  assert.doesNotThrow(() =>
    snapshotNativeDirectStyle(nested(tileflowNativeProfileLimits.maximumDepth), {}),
  );
  invalid(nested(tileflowNativeProfileLimits.maximumDepth + 1));
  assert.doesNotThrow(() => snapshotNativeDirectStyle({layers: Array(4_096).fill({})}, {}));
  invalid({layers: Array(4_097).fill({})});
  const sources = (count: number) =>
    Object.fromEntries(Array.from({length: count}, (_, i) => [`s${i}`, {}]));
  assert.doesNotThrow(() => snapshotNativeDirectStyle({sources: sources(128)}, {}));
  invalid({sources: sources(129)});
  assert.doesNotThrow(() => snapshotNativeDirectStyle({metadata: {applicationField: true}}, {}));
});
