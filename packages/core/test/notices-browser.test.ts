import assert from 'node:assert/strict';
import test from 'node:test';
import {readTileflowNotices, tileflowNoticesMetadataKey} from '../src/notices';
import {
  attachTileflowNotices,
  type TileflowNoticeControl,
  type TileflowNoticesMap,
} from '../src/notices-browser';

const nauticalNotice = {id: 'nautical-not-for-navigation', sources: ['tileflow-nautical']};

function fixture(metadata: unknown) {
  const events = new Map<string, Set<() => void>>();
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const controls: Array<{control: TileflowNoticeControl; position: string | undefined}> = [];
  const browser = {
    setTimeout(callback: () => void) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
  };
  const container = {
    ownerDocument: {
      defaultView: browser,
      createElement() {
        const element = {
          className: '',
          dataset: {} as Record<string, string>,
          removed: false,
          style: {} as Record<string, string>,
          textContent: '',
          attributes: {} as Record<string, string>,
          remove() {
            element.removed = true;
          },
          setAttribute(name: string, value: string) {
            element.attributes[name] = value;
          },
        };
        return element;
      },
    },
  };
  const state = {style: {metadata} as {metadata?: unknown} | undefined};
  const map = {
    addControl(control: TileflowNoticeControl, position?: string) {
      controls.push({control, position});
      control.onAdd(map);
    },
    getContainer: () => container,
    getStyle: () => state.style,
    on(event: string, listener: () => void) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(listener);
    },
    off(event: string, listener: () => void) {
      events.get(event)?.delete(listener);
    },
    removeControl(control: TileflowNoticeControl) {
      const index = controls.findIndex((entry) => entry.control === control);
      if (index >= 0) controls.splice(index, 1);
      control.onRemove(map);
    },
  };
  return {
    controls,
    events,
    map: map as unknown as TileflowNoticesMap,
    state,
    timers,
    element: () =>
      controls[0]?.control.onAdd(map) as unknown as {
        attributes: Record<string, string>;
        dataset: Record<string, string>;
        textContent: string;
      },
    emit(event: string) {
      for (const listener of [...(events.get(event) ?? [])]) listener();
    },
    flushTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const timer of pending) timer();
    },
  };
}

test('reads only bounded, well-formed notices from style metadata', () => {
  assert.deepEqual(readTileflowNotices(undefined), []);
  assert.deepEqual(readTileflowNotices({[tileflowNoticesMetadataKey]: 'Not for navigation'}), []);
  assert.deepEqual(
    readTileflowNotices({
      [tileflowNoticesMetadataKey]: [
        {...nauticalNotice, text: 'Not for navigation'},
        {...nauticalNotice, text: 'Duplicate identifiers are ignored'},
        {id: 'markup', sources: [], text: '<b>bold</b>\u0007'},
        {id: 'too-long', sources: [], text: 'x'.repeat(121)},
        {id: 'bad source', sources: ['../tiles'], text: 'Rejected'},
      ],
    }),
    [{...nauticalNotice, text: 'Not for navigation'}],
  );
});

test('shows a compact control while the style declares a notice and follows style changes', () => {
  const f = fixture({
    [tileflowNoticesMetadataKey]: [{...nauticalNotice, text: 'Not for navigation'}],
  });
  const dispose = attachTileflowNotices(f.map);
  assert.equal(f.controls.length, 1);
  assert.equal(f.controls[0]?.position, 'bottom-right');
  assert.equal(f.element().textContent, 'Not for navigation');
  assert.equal(f.element().attributes.role, 'note');
  assert.equal(f.element().dataset.tileflowNotice, nauticalNotice.id);

  // A replaced style without notices removes the control; restoring it adds it again.
  f.state.style = {metadata: {}};
  f.emit('styledata');
  assert.equal(f.controls.length, 1, 'style edits settle before the control changes');
  f.flushTimers();
  assert.equal(f.controls.length, 0);
  f.state.style = {
    metadata: {[tileflowNoticesMetadataKey]: [{...nauticalNotice, text: 'Charted'}]},
  };
  f.emit('style.load');
  assert.equal(f.controls.length, 1);
  assert.equal(f.element().textContent, 'Charted');

  dispose();
  assert.equal(f.controls.length, 0);
  assert.equal(f.timers.size, 0);
  for (const listeners of f.events.values()) assert.equal(listeners.size, 0);
});

test('waits for an unloaded style and releases everything when the map is removed', () => {
  const f = fixture(undefined);
  f.state.style = undefined;
  attachTileflowNotices(f.map, {position: 'bottom-left'});
  assert.equal(f.controls.length, 0);
  f.state.style = {metadata: {[tileflowNoticesMetadataKey]: [{...nauticalNotice, text: 'Note'}]}};
  f.emit('style.load');
  assert.equal(f.controls[0]?.position, 'bottom-left');
  f.emit('styledata');
  f.emit('remove');
  assert.equal(f.controls.length, 0);
  assert.equal(f.timers.size, 0);
  for (const listeners of f.events.values()) assert.equal(listeners.size, 0);
});
