import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowNativeSourceController} from '@tileflow/core/native';
import {type CameraCommand, createMapCameraController} from '../src/camera-controller';
import type {MapView} from '../src/contract';

const full = (): MapView => ({center: [0, 20], zoom: 2, bearing: 0, pitch: 0});
const ignore = () => undefined;

function setup() {
  const commands: CameraCommand[] = [];
  const camera = createMapCameraController({
    apply(command) {
      commands.push(command);
      return {finished: Promise.resolve(), cancel() {}};
    },
  });
  return {camera, commands};
}

test('JavaScript camera props cannot bypass ownership or complete-view validation', () => {
  const invalid: unknown[] = [
    null,
    [],
    1,
    {view: full()},
    {view: {zoom: 4}, onViewChange: ignore},
    {view: full(), initialView: {}, onViewChange: ignore},
    {view: full(), onViewChange: null},
    {initialView: null},
    {onViewChange: 'private'},
    {view: null, onViewChange: ignore},
    {initialView: {padding: 1}},
    Object.create({view: full()}),
  ];
  for (const props of invalid) {
    const t = setup();
    assert.throws(() => t.camera.mount(props as never), {code: 'CAMERA_INPUT_INVALID'});
    assert.equal(t.camera.view, undefined);
    assert.equal(t.camera.mode, undefined);
    assert.equal(t.commands.length, 0);
    t.camera.mount({});
    assert.equal(t.commands.length, 1);
  }
});

test('Core owns numeric ranges, unknown fields, safe records and coordinate order', () => {
  for (const candidate of [
    {...full(), zoom: NaN},
    {...full(), zoom: 25},
    {...full(), zoom: -1},
    {...full(), bearing: 181},
    {...full(), bearing: -181},
    {...full(), pitch: 86},
    {...full(), pitch: -1},
    {...full(), pitch: Infinity},
    {...full(), center: [181, 20]},
    {...full(), center: [0, 91]},
    {...full(), center: [-181, 20]},
    {...full(), center: [0, -91]},
    {...full(), center: [0]},
    {...full(), center: [0, 1, 2]},
    {...full(), center: {lng: 1, lat: 2}},
    {...full(), zoom: undefined},
    {...full(), padding: 1},
    Object.assign(Object.create({}), full()),
  ]) {
    const t = setup();
    t.camera.mount({view: full(), onViewChange: ignore});
    const before = t.camera.view;
    assert.throws(() => t.camera.update({view: candidate, onViewChange: ignore} as never), {
      code: 'CAMERA_INPUT_INVALID',
    });
    assert.equal(t.camera.view, before);
    assert.equal(t.commands.length, 1);
  }
  const t = setup();
  t.camera.mount({
    view: {center: [-180, 90], zoom: 24, bearing: -180, pitch: 85},
    onViewChange: ignore,
  });
  assert.deepEqual(t.commands[0]!.view.center, [-180, 90]);
});

test('accessors are not evaluated and invalid native observations do not corrupt live view', () => {
  let reads = 0;
  const t = setup();
  const input = {
    get view() {
      reads++;
      throw new Error('private');
    },
    onViewChange: ignore,
  };
  assert.throws(() => t.camera.mount(input as never), {code: 'CAMERA_INPUT_INVALID'});
  const center = [0, 20];
  Object.defineProperty(center, '0', {
    enumerable: true,
    get() {
      reads++;
      throw new Error('private');
    },
  });
  assert.throws(() => t.camera.mount({view: {...full(), center}, onViewChange: ignore} as never), {
    code: 'CAMERA_INPUT_INVALID',
  });
  assert.equal(reads, 0);
  t.camera.mount({});
  const token = t.camera.startGesture()!;
  const before = t.camera.view;
  assert.throws(() => t.camera.changeGesture(token, {zoom: 8} as never), {
    code: 'CAMERA_INPUT_INVALID',
  });
  assert.throws(() => t.camera.endGesture(token, {zoom: 8} as never), {
    code: 'CAMERA_INPUT_INVALID',
  });
  assert.equal(t.camera.view, before);
  t.camera.endGesture(token, {...full(), zoom: 8});
  assert.equal(t.camera.view?.zoom, 8);
});

test('invalid later seeds are rejected but valid later seeds never reset uncontrolled view', () => {
  const t = setup();
  t.camera.mount({initialView: {zoom: 5}});
  assert.throws(() => t.camera.update({initialView: {pitch: 90}}), {code: 'CAMERA_INPUT_INVALID'});
  t.camera.update({initialView: {zoom: 8}});
  assert.equal(t.commands.length, 1);
  assert.equal(t.camera.view?.zoom, 5);
});

test('source generation and acquisition are independent of camera commands and restoration', async () => {
  let acquisitions = 0;
  const source = createTileflowNativeSourceController({
    acquire() {
      acquisitions++;
      throw new Error('Not needed');
    },
  });
  await source.replace({kind: 'maplibre', style: 'https://maps.example.test/style.json'});
  const before = source.state;
  const t = setup();
  t.camera.mount({});
  t.camera.endGesture(t.camera.startGesture()!, {...full(), zoom: 9});
  t.camera.restoreAfterStyleChange();
  t.camera.update({initialView: {zoom: 3}});
  t.camera.dispose();
  assert.equal(source.state, before);
  assert.equal(source.state?.generation, 1);
  assert.equal(acquisitions, 0);
  source.dispose();
});
