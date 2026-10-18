import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {createPreviewSceneThemes} from '../src/preview-scene-themes';

test('the preview shares style and sun reads across draws and refreshes after style changes', () => {
  const listeners = new Map<string, Set<() => void>>();
  let metadata: Record<string, unknown> | undefined = {buildings: {color: '#fff'}, sun: 'day'};
  let reads = 0;
  let sunReads = 0;
  const map = {
    getStyle() {
      reads += 1;
      return metadata ? {metadata} : undefined;
    },
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: () => void) {
      listeners.get(event)?.delete(fn);
    },
  };
  const emit = (event: string) => listeners.get(event)?.forEach((fn) => fn());
  // Exercise the serialized function too: the browser page cannot use module closures.
  const create = vm.runInNewContext(
    `(${createPreviewSceneThemes.toString()})`,
  ) as typeof createPreviewSceneThemes;
  const controller = create(map, (value) => {
    sunReads += 1;
    return value?.sun ?? 'default';
  });
  for (let frame = 0; frame < 120; frame += 1) {
    assert.equal(controller.getThemeMetadata('buildings').values[0], metadata.buildings);
    assert.equal(controller.getSun(), 'day');
    assert.equal(controller.getThemeMetadata('vegetation').values[0], undefined);
  }
  assert.equal(reads, 1);
  assert.equal(sunReads, 1);

  metadata = {buildings: {color: '#222'}, sun: 'night'};
  emit('styledata');
  assert.equal(controller.getSun(), 'night');
  assert.equal(controller.getThemeMetadata('buildings').values[0], metadata.buildings);
  assert.equal(reads, 2);

  // Repeated reads during an empty/loading style must also stay cheap.
  metadata = undefined;
  emit('style.load');
  for (let i = 0; i < 20; i += 1) {
    assert.equal(controller.getThemeMetadata('buildings').values[0], undefined);
    assert.equal(controller.getSun(), 'default');
  }
  assert.equal(reads, 3);
  assert.equal(sunReads, 3);
  emit('remove');
  for (const set of listeners.values()) assert.equal(set.size, 0);
});
