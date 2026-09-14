import assert from 'node:assert/strict';
import test from 'node:test';
import * as budgets from '../src/native-profile-helpers';

// The traversal counts keys and values: an array of n scalars visits 2n + 1 nodes.
function boundary(maximum: number, above = false): number[] {
  return new Array(Math.floor((maximum - 1) / 2) + Number(above)).fill(0);
}

test('keeps untrusted input at 160000 nodes independently of the prepared budget', () => {
  assert.equal(budgets.tileflowNativeProfileLimits.maximumNodes, 160_000);
  assert.equal(budgets.isBoundedNativeJson(boundary(160_000)), true);
  assert.equal(budgets.isBoundedNativeJson(boundary(160_000, true)), false);
  assert.equal(budgets.isBoundedNativeJson(boundary(160_000, true), 'input'), false);
});

test('admits measured prepared expansion with a fixed 540000-node ceiling', () => {
  assert.equal(budgets.isBoundedNativeJson(boundary(540_000), 'prepared'), true);
  assert.equal(budgets.isBoundedNativeJson(boundary(540_000, true), 'prepared'), false);
  assert.deepEqual(budgets.tileflowNativePreparedStyleLimits, {
    ...budgets.tileflowNativeProfileLimits,
    maximumNodes: 540_000,
  });
  assert.equal(Object.isFrozen(budgets.tileflowNativePreparedStyleLimits), true);
});

test('neither stage accepts a caller-defined or unknown validation budget', () => {
  // @ts-expect-error Only the two fixed stages exist, not arbitrary node limits.
  assert.equal(budgets.isBoundedNativeJson([], {maximumNodes: Infinity}), false);
  // @ts-expect-error Unknown stages fail closed at runtime as well.
  assert.equal(budgets.isBoundedNativeJson([], 'unlimited'), false);
});

for (const stage of ['input', 'prepared'] as const) {
  test(`${stage} keeps byte and depth limits unchanged`, () => {
    const bytes = budgets.tileflowNativeProfileLimits.maximumStyleBytes;
    assert.equal(bytes, 8 * 1024 * 1024);
    assert.equal(budgets.tileflowNativeProfileLimits.maximumDepth, 64);
    assert.equal(budgets.tileflowNativeProfileLimits.maximumLayers, 4096);
    assert.equal(budgets.isBoundedNativeJson('a'.repeat(bytes - 2), stage), true);
    assert.equal(budgets.isBoundedNativeJson('a'.repeat(bytes - 1), stage), false);
    let nested: unknown = 0;
    for (let index = 0; index < 64; index++) nested = [nested];
    assert.equal(budgets.isBoundedNativeJson(nested, stage), true);
    assert.equal(budgets.isBoundedNativeJson([nested], stage), false);
  });

  test(`${stage} rejects unsafe JSON without evaluating getters or toJSON`, () => {
    let reads = 0;
    const getter = Object.defineProperty({}, 'data', {enumerable: true, get() {reads++; return 0;}});
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const value of [getter, cyclic, new Array(1), new Date(0), Infinity, NaN,
      {toJSON() {reads++; return {}; }}, {[Symbol('key')]: 0}]) {
      assert.equal(budgets.isBoundedNativeJson(value, stage), false);
    }
    assert.equal(reads, 0);
  });
}
