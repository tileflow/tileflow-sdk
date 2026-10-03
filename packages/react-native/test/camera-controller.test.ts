import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CameraCommand,
  type CameraControllerError,
  type CameraPort,
  createMapCameraController,
} from '../src/camera-controller';
import type {MapCameraProps, MapView, MapViewChangeEvent} from '../src/contract';

export const view = (zoom = 2): MapView => ({center: [0, 20], zoom, bearing: 0, pitch: 0});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

function setup() {
  const commands: Array<{
    command: CameraCommand;
    done: ReturnType<typeof deferred>;
    cancels: number;
  }> = [];
  const errors: CameraControllerError[] = [];
  const port: CameraPort = {
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
  };
  const camera = createMapCameraController(port, (error) => {
    errors.push(error);
  });
  const finish = async (index = commands.length - 1) => {
    commands[index]!.done.resolve();
    await commands[index]!.done.promise;
  };
  return {camera, commands, errors, port, finish};
}

const ignore = () => undefined;

test('mount composes a partial seed once; later seed changes do not reset a live instance', async () => {
  const t = setup();
  assert.equal(t.camera.view, undefined);
  assert.equal(t.commands.length, 0);
  t.camera.mount(
    {initialView: {zoom: 8}},
    {
      mapOptionsView: {pitch: 20},
      manifestView: {center: [10, 30], zoom: 5, bearing: -10},
    },
  );
  assert.deepEqual(t.commands[0]!.command.view, {
    center: [10, 30],
    zoom: 8,
    bearing: -10,
    pitch: 20,
  });
  await t.finish();
  t.camera.update({initialView: {zoom: 12}});
  t.camera.mount({initialView: {zoom: 14}});
  assert.equal(t.commands.length, 1);
  assert.equal(t.camera.view?.zoom, 8);
  assert.equal(t.camera.mode, 'initial');
});

test('controlled props require complete views and equal values do not produce redundant commands', async () => {
  const t = setup();
  t.camera.mount({view: view(), onViewChange: ignore});
  t.camera.update({view: view(), onViewChange: ignore});
  assert.equal(t.commands.length, 1);
  await t.finish();
  t.camera.update({view: view(), onViewChange: ignore});
  assert.equal(t.commands.length, 1);
  t.camera.update({view: view(4), onViewChange: ignore});
  t.camera.update({view: view(4), onViewChange: ignore});
  assert.equal(t.commands.length, 2);
  await t.finish();
  assert.equal(t.camera.view?.zoom, 4);
});

test('adopted gesture changes emit immutable views and need no return command', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  const onViewChange = (event: MapViewChangeEvent) => {
    events.push(event);
    t.camera.update({view: event.view, onViewChange});
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  assert.equal(t.camera.startGesture(), gesture);
  t.camera.changeGesture(gesture, view());
  t.camera.changeGesture(gesture, view(3));
  t.camera.changeGesture(gesture, view(3));
  t.camera.endGesture(gesture, view(4));
  t.camera.settleGesture(gesture);
  assert.deepEqual(
    events.map((event) => event.view.zoom),
    [3, 4],
  );
  assert.deepEqual(Object.keys(events[0]!).sort(), ['type', 'view']);
  assert.ok(events.every((event) => Object.isFrozen(event) && Object.isFrozen(event.view.center)));
  assert.equal(t.commands.length, 1);
  assert.equal(t.camera.view?.zoom, 4);
});

test('an unadopted gesture returns once to the latest received controlled view at settlement', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  const onViewChange = (event: MapViewChangeEvent) => {
    events.push(event);
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.changeGesture(gesture, view(8));
  t.camera.update({view: view(5), onViewChange});
  assert.equal(t.commands.length, 1);
  t.camera.endGesture(gesture, view(9));
  assert.equal(t.commands.length, 1);
  t.camera.settleGesture(gesture);
  assert.equal(t.commands.length, 2);
  assert.equal(t.commands[1]!.command.view.zoom, 5);
  t.camera.endGesture(gesture, view(9));
  t.camera.changeGesture(gesture, view(10));
  t.camera.observeCommand(t.commands[1]!.command.token, view(5));
  await t.finish();
  assert.deepEqual(
    events.map((event) => event.view.zoom),
    [8, 9],
  );
  assert.equal(t.commands.length, 2);
  t.camera.update({view: view(11), onViewChange});
  assert.equal(t.commands.length, 3);
});

test('adoption inside the final callback is considered at settlement', async () => {
  const t = setup();
  const onViewChange = (event: MapViewChangeEvent) => {
    t.camera.update({view: event.view, onViewChange});
  };
  t.camera.mount({view: view(), onViewChange});
  await t.finish();
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(7));
  t.camera.settleGesture(gesture);
  assert.equal(t.commands.length, 1);
  assert.equal(t.camera.view?.zoom, 7);
});

test('uncontrolled change observation is optional and never grants the callback camera ownership', async () => {
  for (const observed of [false, true]) {
    const t = setup();
    const events: MapViewChangeEvent[] = [];
    t.camera.mount({
      onViewChange: observed
        ? (event) => {
            events.push(event);
          }
        : undefined,
    });
    await t.finish();
    const gesture = t.camera.startGesture()!;
    t.camera.changeGesture(gesture, view(6));
    t.camera.endGesture(gesture, view(6));
    t.camera.settleGesture(gesture);
    assert.equal(events.length, observed ? 1 : 0);
    assert.equal(t.commands.length, 1);
    assert.equal(t.camera.mode, 'initial');
    assert.equal(t.camera.view?.zoom, 6);
  }
});

test('programmatic observations never echo, and gesture start retires an unfinished command', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  t.camera.mount({
    view: view(),
    onViewChange: (event) => {
      events.push(event);
    },
  });
  const command = t.commands[0]!;
  t.camera.observeCommand(command.command.token, view());
  assert.equal(events.length, 0);
  const gesture = t.camera.startGesture()!;
  assert.equal(command.cancels, 1);
  t.camera.changeGesture(gesture, view(8));
  t.camera.observeCommand(command.command.token, null as never);
  await t.finish(0);
  assert.equal(t.camera.view?.zoom, 8);
  assert.equal(events.length, 1);
});

for (const order of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]) {
  test(`obsolete command completions cannot replace current view in order ${order}`, async () => {
    const t = setup();
    t.camera.mount({view: view(1), onViewChange: ignore});
    t.camera.update({view: view(2), onViewChange: ignore});
    t.camera.update({view: view(3), onViewChange: ignore});
    assert.deepEqual(
      t.commands.map((command) => command.cancels),
      [1, 1, 0],
    );
    for (const index of order) await t.finish(index);
    assert.equal(t.camera.view?.zoom, 3);
    assert.equal(t.errors.length, 0);
  });
}

test('restoration reaffirms live uncontrolled view or controlled authority without resetting the seed', async () => {
  for (const controlled of [false, true]) {
    const t = setup();
    const props: MapCameraProps = controlled
      ? {view: view(), onViewChange: ignore}
      : {initialView: {zoom: 2}};
    t.camera.mount(props);
    await t.finish();
    const gesture = t.camera.startGesture()!;
    t.camera.changeGesture(gesture, view(8));
    t.camera.restoreAfterStyleChange();
    assert.equal(t.commands[1]!.command.view.zoom, controlled ? 2 : 8);
    t.camera.endGesture(gesture, view(15));
    t.camera.settleGesture(gesture);
    await t.finish();
    assert.equal(t.camera.view?.zoom, controlled ? 2 : 8);
    assert.equal(t.commands.length, 2);
  }
});

test('invalid replacements preserve the last mode, view and observer', async () => {
  const t = setup();
  const events: MapViewChangeEvent[] = [];
  t.camera.mount({
    view: view(),
    onViewChange: (event) => {
      events.push(event);
    },
  });
  await t.finish();
  const before = t.camera.view;
  assert.throws(() => t.camera.update({initialView: {zoom: 6}}), {code: 'CAMERA_MODE_CHANGE'});
  assert.throws(() => t.camera.update({view: {...view(), pitch: 86}, onViewChange: ignore}), {
    code: 'CAMERA_INPUT_INVALID',
  });
  assert.equal(t.camera.view, before);
  assert.equal(t.commands.length, 1);
  const gesture = t.camera.startGesture()!;
  t.camera.endGesture(gesture, view(4));
  t.camera.settleGesture(gesture);
  assert.equal(events.length, 1);
  const initial = setup();
  initial.camera.mount({});
  assert.throws(() => initial.camera.update({view: view(), onViewChange: ignore}), {
    code: 'CAMERA_MODE_CHANGE',
  });
});

test('inputs and command/event tuples are copied and frozen before external callbacks', () => {
  const t = setup();
  const input = {center: [10, 20] as [number, number], zoom: 3, bearing: 0, pitch: 0};
  t.camera.mount({view: input, onViewChange: ignore});
  input.center[0] = 99;
  input.zoom = 10;
  const command = t.commands[0]!.command;
  assert.deepEqual(command.view.center, [10, 20]);
  assert.equal(command.view.zoom, 3);
  assert.ok(Object.isFrozen(command));
  assert.ok(Object.isFrozen(command.token));
  assert.ok(Object.isFrozen(command.view));
  assert.ok(Object.isFrozen(command.view.center));
  const gesture = t.camera.startGesture()!;
  const next = {...input, center: [2, 3] as [number, number]};
  t.camera.changeGesture(gesture, next);
  next.center[0] = 80;
  assert.deepEqual(t.camera.view?.center, [2, 3]);
});

test('listener exceptions cannot prevent settled reconciliation or create echo loops', async () => {
  const t = setup();
  t.camera.mount({
    view: view(),
    onViewChange() {
      throw new Error('Caller secret');
    },
  });
  await t.finish();
  const gesture = t.camera.startGesture()!;
  assert.doesNotThrow(() => t.camera.endGesture(gesture, view(8)));
  assert.equal(t.commands.length, 1);
  assert.doesNotThrow(() => t.camera.settleGesture(gesture));
  assert.equal(t.commands.length, 2);
  t.camera.observeCommand(t.commands[1]!.command.token, view());
  await t.finish();
  assert.equal(t.commands.length, 2);
  assert.equal(t.errors.length, 0);
});

test('reentrant disposal and a newer gesture suppress a finishing gesture reconciliation', async () => {
  const t = setup();
  t.camera.mount({
    view: view(),
    onViewChange() {
      t.camera.dispose();
    },
  });
  await t.finish();
  const disposedGesture = t.camera.startGesture()!;
  t.camera.endGesture(disposedGesture, view(4));
  t.camera.settleGesture(disposedGesture);
  assert.equal(t.commands.length, 1);
  const next = setup();
  next.camera.mount({
    view: view(),
    onViewChange() {
      next.camera.startGesture();
    },
  });
  await next.finish();
  const retiredGesture = next.camera.startGesture()!;
  next.camera.endGesture(retiredGesture, view(5));
  next.camera.settleGesture(retiredGesture);
  assert.equal(next.commands.length, 1);
  next.camera.dispose();
});

test('command reentrancy cancels a handle returned after retirement and ignores its completion', async () => {
  let oldCancel = 0;
  const old = deferred();
  const latest = deferred();
  let calls = 0;
  const camera = createMapCameraController({
    apply() {
      if (++calls === 1) {
        camera.update({view: view(9), onViewChange: ignore});
        return {
          finished: old.promise,
          cancel() {
            oldCancel++;
          },
        };
      }
      return {finished: latest.promise, cancel() {}};
    },
  });
  camera.mount({view: view(), onViewChange: ignore});
  assert.equal(oldCancel, 1);
  latest.resolve();
  await latest.promise;
  old.resolve();
  await old.promise;
  assert.equal(camera.view?.zoom, 9);
});

test('only an active command failure is reported and no remote error details escape', async () => {
  const t = setup();
  t.camera.mount({view: view(), onViewChange: ignore});
  t.camera.update({view: view(4), onViewChange: ignore});
  t.commands[0]!.done.reject(new Error('retired secret'));
  await t.commands[0]!.done.promise.catch(ignore);
  assert.equal(t.errors.length, 0);
  t.commands[1]!.done.reject(new Error('active secret'));
  await t.commands[1]!.done.promise.catch(ignore);
  assert.equal(t.errors.length, 1);
  assert.equal(t.errors[0]!.code, 'CAMERA_COMMAND_FAILED');
  assert.equal(t.errors[0]!.cause, undefined);
  assert.equal(String(t.errors[0]).includes('secret'), false);
  t.camera.restoreAfterStyleChange();
  assert.equal(t.commands[2]!.command.view.zoom, 4);
});

test('tokens are instance-local and disposal/remount do not share seed or observations', async () => {
  const first = setup();
  first.camera.mount({initialView: {zoom: 5}});
  const token = first.camera.startGesture()!;
  first.camera.dispose();
  first.camera.dispose();
  first.camera.changeGesture(token, null as never);
  first.camera.endGesture(token, null as never);
  first.camera.settleGesture(token);
  first.camera.restoreAfterStyleChange();
  assert.equal(first.commands[0]!.cancels, 1);
  await first.finish();
  assert.throws(() => first.camera.update({}), {code: 'CAMERA_DISPOSED'});
  const second = setup();
  second.camera.mount({initialView: {zoom: 7}});
  const own = second.camera.startGesture()!;
  second.camera.changeGesture(token, view(20));
  assert.equal(second.camera.view?.zoom, 7);
  second.camera.endGesture(own, view(8));
  second.camera.settleGesture(own);
  assert.equal(second.camera.view?.zoom, 8);
});
