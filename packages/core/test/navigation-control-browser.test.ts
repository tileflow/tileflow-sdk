import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNavigationControlBinding,
  resolveTileflowNavigationControl,
  tileflowNavigationControlKey,
} from '../src/navigation-control-browser';

test('shows no navigation control unless it is asked for, and then at the top right', () => {
  assert.equal(resolveTileflowNavigationControl(undefined), null);
  assert.equal(resolveTileflowNavigationControl(false), null);
  assert.equal(tileflowNavigationControlKey(undefined), '');
  assert.equal(tileflowNavigationControlKey(false), '');
  assert.deepEqual(resolveTileflowNavigationControl(true), {options: {}, position: 'top-right'});
  assert.deepEqual(resolveTileflowNavigationControl({}), {options: {}, position: 'top-right'});
});

test('moves the control and limits its buttons', () => {
  assert.deepEqual(
    resolveTileflowNavigationControl({position: 'bottom-left', showCompass: false}),
    {options: {showCompass: false}, position: 'bottom-left'},
  );
  assert.notEqual(
    tileflowNavigationControlKey({position: 'bottom-left'}),
    tileflowNavigationControlKey(true),
  );
  assert.equal(tileflowNavigationControlKey(true), tileflowNavigationControlKey({}));
});

test('names an unknown position and falls back to the default corner', (t) => {
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (message: string) => warnings.push(message));
  assert.equal(
    resolveTileflowNavigationControl({position: 'middle' as never})?.position,
    'top-right',
  );
  assert.match(warnings[0]!, /Unknown navigationControl position "middle"/u);
});

test('keeps one control in step with the setting and removes it on dispose', () => {
  const log: string[] = [];
  const map = {
    addControl: (control: {id: number}, position: string) =>
      log.push(`add ${control.id} ${position}`),
    removeControl: (control: {id: number}) => log.push(`remove ${control.id}`),
  };
  let created = 0;
  const binding = createTileflowNavigationControlBinding({
    createControl: () => ({id: ++created}),
    map: map as never,
  });
  binding.update(undefined);
  binding.update(true);
  binding.update({});
  binding.update({position: 'bottom-left'});
  binding.update(false);
  binding.update(false);
  binding.update(true);
  binding.dispose();
  binding.update(true);
  assert.deepEqual(log, [
    'add 1 top-right',
    'remove 1',
    'add 2 bottom-left',
    'remove 2',
    'add 3 top-right',
    'remove 3',
  ]);
});

test('leaves the control to a map that removed it while being taken down', () => {
  const removeListeners = new Set<() => void>();
  let removed = 0;
  const map = {
    addControl: () => undefined,
    off: (_type: 'remove', listener: () => void) => removeListeners.delete(listener),
    on: (_type: 'remove', listener: () => void) => removeListeners.add(listener),
    removeControl: () => void (removed += 1),
  };
  const binding = createTileflowNavigationControlBinding({
    createControl: () => ({}),
    map: map as never,
  });
  binding.update(true);
  // MapLibre's remove() takes its controls down, then fires `remove`.
  for (const listener of [...removeListeners]) listener();
  binding.dispose();
  binding.update(true);
  assert.equal(removed, 0);

  const kept = createTileflowNavigationControlBinding({createControl: () => ({}), map});
  kept.update(true);
  kept.dispose();
  assert.equal(removed, 1);
  assert.equal(removeListeners.size, 0);
});
