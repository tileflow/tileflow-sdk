import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowNavigationControlBinding,
  resolveTileflowNavigationControl,
  tileflowNavigationControlKey,
} from '../src/navigation-control-browser';

test('shows the navigation control at the top right unless it is turned off', () => {
  assert.deepEqual(resolveTileflowNavigationControl(undefined), {
    options: {},
    position: 'top-right',
  });
  assert.deepEqual(resolveTileflowNavigationControl(true), {options: {}, position: 'top-right'});
  assert.equal(resolveTileflowNavigationControl(false), null);
  assert.equal(tileflowNavigationControlKey(false), '');
});

test('moves the control and limits its buttons', () => {
  assert.deepEqual(
    resolveTileflowNavigationControl({position: 'bottom-left', showCompass: false}),
    {options: {showCompass: false}, position: 'bottom-left'},
  );
  assert.notEqual(
    tileflowNavigationControlKey({position: 'bottom-left'}),
    tileflowNavigationControlKey(undefined),
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
  binding.update(undefined);
  binding.dispose();
  binding.update(undefined);
  assert.deepEqual(log, [
    'add 1 top-right',
    'remove 1',
    'add 2 bottom-left',
    'remove 2',
    'add 3 top-right',
    'remove 3',
  ]);
});
