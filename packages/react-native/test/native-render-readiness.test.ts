import assert from 'node:assert/strict';
import test from 'node:test';
import {createNativeReadiness} from '../src/native-readiness';

test('readiness requires current style, current layout commit and a later fully rendered frame', () => {
  const changes: string[] = [];
  const state = createNativeReadiness((status) => changes.push(status));
  state.begin('one');
  state.native({style: 'one', sequence: 1, kind: 'render', layout: 1});
  state.native({style: 'one', sequence: 2, kind: 'style', layout: 1});
  assert.equal(state.ready, false);
  state.commit('one', 1);
  assert.equal(state.ready, false);
  state.native({style: 'one', sequence: 3, kind: 'render', layout: 1});
  assert.equal(state.ready, true);
  state.native({style: 'one', sequence: 4, kind: 'render', layout: 1});
  assert.deepEqual(changes, ['loading', 'ready']);
});

test('source theme layout and background transitions invalidate prior evidence and reject stale receipts', () => {
  const changes: string[] = [];
  const state = createNativeReadiness((status) => changes.push(status));
  state.begin('one');
  state.native({style: 'one', sequence: 1, kind: 'style', layout: 1});
  state.commit('one', 1);
  state.native({style: 'one', sequence: 2, kind: 'render', layout: 1});
  state.invalidate();
  state.native({style: 'one', sequence: 3, kind: 'render', layout: 1});
  assert.equal(state.ready, false);
  state.commit('one', 2);
  state.native({style: 'one', sequence: 4, kind: 'render', layout: 1});
  assert.equal(state.ready, false);
  state.native({style: 'one', sequence: 5, kind: 'render', layout: 2});
  assert.equal(state.ready, true);
  state.begin('two');
  state.commit('one', 3);
  state.native({style: 'one', sequence: 6, kind: 'style', layout: 3});
  state.native({style: 'two', sequence: 7, kind: 'render', layout: 3});
  assert.equal(state.ready, false);
  state.native({style: 'two', sequence: 8, kind: 'style', layout: 3});
  state.commit('two', 3);
  state.native({style: 'two', sequence: 7, kind: 'render', layout: 3});
  assert.equal(state.ready, false);
  state.native({style: 'two', sequence: 9, kind: 'render', layout: 3});
  assert.equal(state.ready, true);
  state.fail();
  state.native({style: 'two', sequence: 10, kind: 'render', layout: 3});
  assert.equal(state.ready, false);
  state.dispose();
  state.commit('two', 3);
  assert.equal(state.ready, false);
  assert.equal(changes.at(-1), 'error');
});

test('callback reentrancy cannot resurrect prior style evidence', () => {
  const state: ReturnType<typeof createNativeReadiness> = createNativeReadiness((status) => {
    if (status === 'ready') state.begin('replacement');
  });
  state.begin('one');
  state.native({style: 'one', sequence: 1, kind: 'style', layout: 1});
  state.commit('one', 1);
  state.native({style: 'one', sequence: 2, kind: 'render', layout: 1});
  assert.equal(state.ready, false);
});
