import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBoundedNativeJson,
  nativePointer,
  supportsNativeVersions,
  tileflowNativeProfileLimits,
} from '../src/native-profile-helpers';

const engines = {android: '13.2.0', ios: '6.26.0'};
for (const [name, support, expected] of [
  ['equal', {android: '13.2.0', ios: '6.26.0'}, true],
  ['older', {android: '11.13.0', ios: '6.18.0'}, true],
  ['new Android patch', {android: '13.2.1', ios: '6.18.0'}, false],
  ['new iOS minor', {android: '13.2.0', ios: '6.27.0'}, false],
  ['missing platform', {android: '1.0.0'}, false],
  ['issue link', {android: 'https://example.test/issue', ios: '6.0.0'}, false],
  ['boolean', {android: true, ios: true}, false],
  ['range', {android: '>=1.0.0', ios: '6.0.0'}, false],
  ['prerelease', {android: '13.2.0-rc.1', ios: '6.0.0'}, false],
] as const) {
  test(`checks version evidence: ${name}`, () => {
    assert.equal(supportsNativeVersions(support, engines), expected);
  });
}

test('escapes real JSON Pointer segments and omits sensitive keys', () => {
  assert.equal(nativePointer('/sources', 'a/~'), '/sources/a~1~0');
  for (const key of ['https://private.test/x', 'tf_live_private', '?token=x', 'a\\b', 'x'.repeat(129)]) {
    assert.equal(nativePointer('/sources', key), '/sources');
  }
  assert.equal(nativePointer('/' + 'a'.repeat(299), 'b'), '/' + 'a'.repeat(299));
});

for (const [name, value] of [
  ['function', () => undefined], ['undefined', undefined], ['NaN', NaN], ['infinity', Infinity],
  ['bigint', 1n], ['date', new Date(0)], ['symbol', Symbol('x')], ['sparse', new Array(2)],
] as const) {
  test(`rejects non-JSON value: ${name}`, () => assert.equal(isBoundedNativeJson(value), false));
}

test('accepts bounded recursive JSON, including repeated non-cyclic references', () => {
  const shared = {text: 'é', number: 1, list: [null, true]};
  assert.equal(isBoundedNativeJson({left: shared, right: shared}), true);
  assert.equal(isBoundedNativeJson(Object.create(null)), true);
});

test('does not call accessors or serialization hooks', () => {
  let calls = 0;
  for (const enumerable of [true, false]) {
    const value = Object.defineProperty({}, 'value', {enumerable, get() {calls++; return 'private';} });
    assert.equal(isBoundedNativeJson(value), false);
  }
  const value = Object.defineProperty({}, 'toJSON', {value() {calls++; return 'private';} });
  assert.equal(isBoundedNativeJson(value), false);
  assert.equal(calls, 0);
});

test('bounds nesting, cycles, node count and actual UTF-8 output bytes', () => {
  let nested: unknown = null;
  for (let i = 0; i < tileflowNativeProfileLimits.maximumDepth + 2; i++) nested = {nested};
  assert.equal(isBoundedNativeJson(nested), false);
  const cyclic: Record<string, unknown> = {};
  cyclic.child = cyclic;
  assert.equal(isBoundedNativeJson(cyclic), false);
  assert.equal(isBoundedNativeJson(new Array(tileflowNativeProfileLimits.maximumNodes).fill(0)), false);
  assert.equal(isBoundedNativeJson('é'.repeat(tileflowNativeProfileLimits.maximumStyleBytes / 2)), false);
});
