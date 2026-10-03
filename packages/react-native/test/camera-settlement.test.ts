import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CameraCommand,
  type CameraToken,
  createMapCameraController,
} from '../src/camera-controller';
import type {MapView, MapViewChangeEvent} from '../src/contract';

const view = (zoom = 2): MapView => ({center: [0, 20], zoom, bearing: 0, pitch: 0});
const ignore = () => undefined;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
}

function setup() {
  const commands: Array<{
    command: CameraCommand;
    done: ReturnType<typeof deferred>;
    cancels: number;
  }> = [];
  const camera = createMapCameraController({
    apply(command) {
      const request = {command, done: deferred(), cancels: 0};
      commands.push(request);
      return {
        finished: request.done.promise,
        cancel() {
          request.cancels++;
        },
      };
    },
  });
  return {
    camera,
    commands,
    zooms: () => commands.map(({command}) => command.view.zoom),
    async finish(index = commands.length - 1) {
      const done = commands[index]!.done;
      done.resolve();
      await done.promise;
    },
  };
}

test('a later prop delivery adopts the final view before commit settlement without rollback', async () => {
  const t = setup();
  const delivery = deferred();
  const events: MapViewChangeEvent[] = [];
  let committed: Promise<void> | undefined;
  const onViewChange = (event: MapViewChangeEvent) => {
    events.push(event);
    // A controlled barrier models the next prop delivery, not a scheduler or deadline.
    committed = delivery.promise.then(() => {
      t.camera.update({view: event.view, onViewChange});
    });
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(9));
  assert.deepEqual(t.zooms(), [2]);
  assert.deepEqual(
    events.map((event) => event.view.zoom),
    [9],
  );
  assert.ok(Object.isFrozen(events[0]!.view.center));
  delivery.resolve();
  assert.ok(committed);
  await committed;
  assert.deepEqual(t.zooms(), [2]);
  t.camera.settleGesture(gesture);
  assert.deepEqual(t.zooms(), [2]);
  assert.equal(t.camera.view?.zoom, 9);
  assert.equal(events.length, 1);
  t.camera.dispose();
});

test('unchanged controlled props return once only after settlement, without public echoes', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  const onViewChange = (event: MapViewChangeEvent) => {
    events.push(event);
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(9));
  t.camera.update({view: view(), onViewChange});
  assert.deepEqual(t.zooms(), [2]);
  t.camera.settleGesture(gesture);
  assert.deepEqual(t.zooms(), [2, 2]);
  t.camera.settleGesture(gesture);
  t.camera.endGesture(gesture, null as never);
  t.camera.changeGesture(gesture, null as never);
  t.camera.observeCommand(t.commands[1]!.command.token, view());
  await t.finish();
  t.camera.settleGesture(gesture);
  assert.deepEqual(t.zooms(), [2, 2]);
  assert.deepEqual(
    events.map((event) => event.view.zoom),
    [9],
  );
  t.camera.update({view: view(11), onViewChange});
  assert.deepEqual(t.zooms(), [2, 2, 11]);
  t.camera.update({view: view(11), onViewChange});
  assert.deepEqual(t.zooms(), [2, 2, 11]);
  t.camera.dispose();
});

test('updates while awaiting settlement keep the latest authority and callback without competing', async () => {
  const t = setup();
  const first: number[] = [];
  const next: number[] = [];
  const onViewChange = (event: MapViewChangeEvent) => {
    next.push(event.view.zoom);
  };
  t.camera.mount({
    view: view(),
    onViewChange: (event) => {
      first.push(event.view.zoom);
    },
  });
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(9));
  t.camera.update({view: view(9), onViewChange});
  t.camera.update({view: view(5), onViewChange});
  t.camera.update({view: view(6), onViewChange});
  assert.deepEqual(t.zooms(), [2]);
  t.camera.settleGesture(gesture);
  assert.deepEqual(t.zooms(), [2, 6]);
  await t.finish();
  t.camera.endGesture(t.camera.startGesture()!, view(8));
  assert.deepEqual(first, [9]);
  assert.deepEqual(next, [8]);
  t.camera.dispose();
});

for (const target of [9, 5]) {
  test(`synchronous final callback authority ${target} also waits for owner confirmation`, async () => {
    const t = setup();
    const onViewChange = () => {
      // A reentrant call inside notification is not a post-callback commit confirmation.
      t.camera.settleGesture(gesture);
      t.camera.update({view: view(target), onViewChange});
      t.camera.settleGesture(gesture);
      assert.deepEqual(t.zooms(), [2]);
    };
    t.camera.mount({view: view(), onViewChange});
    await t.finish();
    const gesture = t.camera.startGesture()!;
    t.camera.endGesture(gesture, view(9));
    assert.deepEqual(t.zooms(), [2]);
    t.camera.settleGesture(gesture);
    assert.deepEqual(t.zooms(), target === 9 ? [2] : [2, target]);
    t.camera.dispose();
  });
}

test('a new gesture retires the previous settlement without authorizing an early return', async () => {
  const t = setup();
  t.camera.mount({view: view(), onViewChange: ignore});
  await t.finish();
  const old = t.camera.startGesture()!;
  t.camera.endGesture(old, view(9));
  const latest = t.camera.startGesture()!;
  t.camera.settleGesture(old);
  t.camera.settleGesture(latest);
  t.camera.changeGesture(latest, view(10));
  t.camera.endGesture(latest, view(11));
  t.camera.settleGesture(old);
  assert.deepEqual(t.zooms(), [2]);
  t.camera.settleGesture(latest);
  assert.deepEqual(t.zooms(), [2, 2]);
  t.camera.dispose();
});

test('foreign and copied tokens cannot consume a pending settlement', async () => {
  const first = setup();
  const second = setup();
  for (const t of [first, second]) {
    t.camera.mount({view: view(), onViewChange: ignore});
    await t.finish();
  }
  const foreign = first.camera.startGesture()!;
  const own = second.camera.startGesture()!;
  assert.equal(foreign.sequence, own.sequence);
  second.camera.endGesture(own, view(9));
  second.camera.settleGesture(foreign);
  second.camera.settleGesture(Object.freeze({...own}));
  assert.deepEqual(second.zooms(), [2]);
  second.camera.settleGesture(own);
  assert.deepEqual(second.zooms(), [2, 2]);
  first.camera.dispose();
  second.camera.dispose();
});

test('style restoration retires settlement and preserves controlled authority or initial live view', async () => {
  for (const controlled of [false, true]) {
    const t = setup();
    t.camera.mount(controlled ? {view: view(), onViewChange: ignore} : {initialView: {zoom: 2}});
    await t.finish();
    const gesture = t.camera.startGesture()!;
    t.camera.endGesture(gesture, view(9));
    t.camera.update(controlled ? {view: view(5), onViewChange: ignore} : {initialView: {zoom: 18}});
    assert.deepEqual(t.zooms(), [2]);
    t.camera.restoreAfterStyleChange();
    assert.deepEqual(t.zooms(), [2, controlled ? 5 : 9]);
    t.camera.settleGesture(gesture);
    t.camera.endGesture(gesture, null as never);
    await t.finish();
    t.camera.settleGesture(gesture);
    assert.equal(t.camera.view?.zoom, controlled ? 5 : 9);
    assert.equal(t.commands.length, 2);
    t.camera.dispose();
  }
});

test('disposal retires settlement and ignores late notifications and confirmations', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  t.camera.mount({
    view: view(),
    onViewChange: (event) => {
      events.push(event);
    },
  });
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(9));
  t.camera.dispose();
  t.camera.dispose();
  t.camera.settleGesture(gesture);
  t.camera.changeGesture(gesture, null as never);
  t.camera.endGesture(gesture, null as never);
  assert.deepEqual(t.zooms(), [2]);
  assert.equal(events.length, 1);
});

for (const action of ['gesture', 'restore', 'dispose'] as const) {
  test(`reentrant ${action} during the final callback retires its settlement`, async () => {
    const t = setup();
    const onViewChange = () => {
      if (action === 'gesture') t.camera.startGesture();
      else if (action === 'restore') t.camera.restoreAfterStyleChange();
      else t.camera.dispose();
    };
    t.camera.mount({view: view(), onViewChange});
    await t.finish();
    const old = t.camera.startGesture()!;
    t.camera.endGesture(old, view(9));
    t.camera.settleGesture(old);
    assert.deepEqual(t.zooms(), action === 'restore' ? [2, 2] : [2]);
    t.camera.dispose();
  });
}

test('an outer final callback cannot clear the settlement of a newer completed gesture', async () => {
  const t = setup();
  let latest: CameraToken | undefined;
  let count = 0;
  const onViewChange = () => {
    if (++count !== 1) return;
    latest = t.camera.startGesture()!;
    t.camera.endGesture(latest, view(12));
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const old = t.camera.startGesture()!;
  t.camera.endGesture(old, view(9));
  assert.ok(latest);
  t.camera.settleGesture(old);
  t.camera.update({view: view(12), onViewChange});
  assert.deepEqual(t.zooms(), [2]);
  t.camera.settleGesture(latest);
  assert.deepEqual(t.zooms(), [2]);
  t.camera.update({view: view(14), onViewChange});
  assert.deepEqual(t.zooms(), [2, 14]);
  assert.equal(count, 2);
  t.camera.dispose();
});

test('invalid updates preserve pending settlement and last valid authority', async () => {
  const t = setup();
  t.camera.mount({view: view(), onViewChange: ignore});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(9));
  assert.throws(() => t.camera.update({initialView: {zoom: 4}}), {code: 'CAMERA_MODE_CHANGE'});
  assert.throws(() => t.camera.update({view: {...view(), pitch: 86}, onViewChange: ignore}), {
    code: 'CAMERA_INPUT_INVALID',
  });
  assert.deepEqual(t.zooms(), [2]);
  t.camera.update({view: view(9), onViewChange: ignore});
  t.camera.settleGesture(gesture);
  assert.deepEqual(t.zooms(), [2]);
  t.camera.dispose();
});

test('a coalesced final view still waits for prop delivery and a current settlement token', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  const onViewChange = (event: MapViewChangeEvent) => {
    events.push(event);
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.changeGesture(gesture, view(9));
  t.camera.endGesture(gesture, view(9));
  assert.equal(events.length, 1);
  assert.deepEqual(t.zooms(), [2]);
  t.camera.update({view: view(9), onViewChange});
  t.camera.settleGesture(gesture);
  assert.deepEqual(t.zooms(), [2]);
  t.camera.dispose();
});
