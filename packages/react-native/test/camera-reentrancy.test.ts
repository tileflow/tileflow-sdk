import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CameraCommand,
  type CameraControllerError,
  createMapCameraController,
} from '../src/camera-controller';
import type {MapView} from '../src/contract';

const view = (zoom: number): MapView => ({center: [0, 20], zoom, bearing: 0, pitch: 0});
const ignore = () => undefined;

test('retirement callbacks cannot dispatch a stale command after a newer prop update', async () => {
  const commands: CameraCommand[] = [];
  let cancelled = 0;
  const camera = createMapCameraController({
    apply(command) {
      commands.push(command);
      return {
        finished: Promise.resolve(),
        cancel() {
          if (++cancelled === 1) camera.update({view: view(9), onViewChange: ignore});
        },
      };
    },
  });
  camera.mount({view: view(2), onViewChange: ignore});
  camera.update({view: view(3), onViewChange: ignore});
  assert.deepEqual(
    commands.map((command) => command.view.zoom),
    [2, 9],
  );
  camera.observeCommand(commands[1]!.token, view(9));
  await Promise.resolve();
  assert.equal(camera.view?.zoom, 9);
});

test('a malformed command completion cancels its known operation and emits only a safe diagnostic', () => {
  let cancelled = 0;
  const errors: CameraControllerError[] = [];
  const camera = createMapCameraController(
    {
      apply() {
        return {
          finished: undefined as never,
          cancel() {
            cancelled++;
          },
        };
      },
    },
    (error) => {
      errors.push(error);
    },
  );
  camera.mount({});
  assert.equal(cancelled, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, 'CAMERA_COMMAND_FAILED');
  assert.equal(errors[0]!.cause, undefined);
});

test('throwing command/cleanup/owner callbacks cannot leak their cause or prevent disposal', () => {
  let cancelled = 0;
  const errors: CameraControllerError[] = [];
  const camera = createMapCameraController(
    {
      apply() {
        throw new Error('Renderer secret');
      },
    },
    (error) => {
      errors.push(error);
      throw new Error('Owner secret');
    },
  );
  assert.doesNotThrow(() => camera.mount({}));
  assert.equal(errors.length, 1);
  assert.equal(String(errors[0]).includes('secret'), false);
  camera.dispose();
  const next = createMapCameraController({
    apply() {
      return {
        finished: new Promise<void>(() => undefined),
        cancel() {
          cancelled++;
          throw new Error('Cleanup secret');
        },
      };
    },
  });
  next.mount({});
  assert.doesNotThrow(() => {
    next.dispose();
    next.dispose();
  });
  assert.equal(cancelled, 1);
});

test('reentrant input reflection cannot commit an older prop snapshot over a newer update', () => {
  const commands: CameraCommand[] = [];
  const camera = createMapCameraController({
    apply(command) {
      commands.push(command);
      return {finished: Promise.resolve(), cancel() {}};
    },
  });
  camera.mount({view: view(2), onViewChange: ignore});
  let replaced = false;
  const input = new Proxy(
    {view: view(4), onViewChange: ignore},
    {
      getPrototypeOf(target) {
        if (!replaced) {
          replaced = true;
          camera.update({view: view(7), onViewChange: ignore});
        }
        return Reflect.getPrototypeOf(target);
      },
    },
  );
  camera.update(input);
  assert.deepEqual(
    commands.map((command) => command.view.zoom),
    [2, 7],
  );
});
