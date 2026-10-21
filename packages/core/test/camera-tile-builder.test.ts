import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {meshTileflowBuildings} from '../src/buildings-3d-mesh';
import {prepareBuildingTile} from '../src/buildings-3d-tile';
import {createCameraTileBuilder} from '../src/camera-tile-builder';
import {type CameraTileTask} from '../src/camera-tile-tasks';
import {placeTileflowStreetLights} from '../src/street-lights';
import {decodeTileflowVectorTile} from '../src/vector-tile-decode';
import {encodeTile} from './vector-tile-fixture';

const bytes = encodeTile({
  building: {
    extent: 8192,
    features: [500, 4500].map((x) => ({
      type: 3 as const,
      properties: {render_height: 30},
      parts: [
        [
          [x, 500],
          [x + 500, 500],
          [x + 500, 1000],
          [x, 1000],
        ],
      ],
    })),
  },
  transportation: {
    extent: 8192,
    features: [
      {
        type: 2,
        properties: {class: 'primary', lit: 'yes'},
        parts: [
          [
            [0, 4000],
            [8192, 4000],
          ],
        ],
      },
    ],
  },
});
const decoded = decodeTileflowVectorTile(bytes);
const buildings: CameraTileTask & {kind: 'buildings'} = {
  kind: 'buildings',
  layers: {building: 'building'},
  options: {tileMetres: 1000, edgeRadius: 0.8},
};
const lights: CameraTileTask & {kind: 'lights'} = {
  kind: 'lights',
  layers: {streetFurniture: 'street_furniture', transportation: 'transportation'},
  options: {tileMetres: 1000},
};
const meshed = () =>
  prepareBuildingTile(meshTileflowBuildings(decoded.building!, buildings.options)!);
const job = <Task extends CameraTileTask>(task: Task, priority = 0, url = 'tile/15/1/1') => ({
  url,
  bytes: bytes.slice(),
  task,
  priority,
});

test('the packaged worker builds as the page does, decoding each tile once', async () => {
  const code = await readFile(
    new URL('../dist/worker/camera-tile-worker.global.js', import.meta.url),
    'utf8',
  );
  const worker = new Worker(
    `const {parentPort} = require('node:worker_threads'); globalThis.postMessage = (value, transfer) => parentPort.postMessage(value, transfer); ${code}; parentPort.on('message', data => globalThis.onmessage({data}));`,
    {eval: true},
  );
  const send = (message: object) =>
    new Promise<{result?: unknown; error?: string}>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage(message);
    });
  try {
    assert.deepEqual((await send(job(buildings))).result, meshed());
    // The tile at this address is decoded already: its lamps come from it, not from these bytes.
    const placed = await send({...job(lights), bytes: new Uint8Array([255, 255, 255])});
    assert.equal(placed.error, undefined);
    assert.deepEqual(
      placed.result,
      placeTileflowStreetLights({transportation: decoded.transportation!}, lights.options),
    );
  } finally {
    await worker.terminate();
  }
});

test('the nearest tile builds first and a tile no longer wanted is never built', async () => {
  const posted: string[] = [];
  const fake = {
    onmessage: null as ((event: {data: object}) => void) | null,
    onerror: null,
    terminate() {},
    postMessage({url}: {url: string}) {
      posted.push(url);
    },
  };
  const builder = createCameraTileBuilder(() => fake as unknown as globalThis.Worker);
  const reply = () => fake.onmessage!({data: {result: undefined}});
  const first = builder.build(job(lights, 5, 'first'), new AbortController().signal);
  const far = builder.build(job(lights, 9, 'far'), new AbortController().signal);
  const gone = new AbortController();
  const dropped = builder.build(job(lights, 1, 'dropped'), gone.signal);
  const near = builder.build(job(lights, 2, 'near'), new AbortController().signal);
  gone.abort();
  await assert.rejects(dropped, /cancelled/);
  reply();
  await first;
  reply();
  await near;
  reply();
  await far;
  assert.deepEqual(posted, ['first', 'near', 'far']);
  builder.dispose();
});

test('blocked workers fall back once, cancelled builds and disposal settle', async () => {
  let attempts = 0;
  const builder = createCameraTileBuilder(() => {
    attempts++;
    throw new Error('CSP');
  });
  const signal = new AbortController();
  assert.deepEqual(await builder.build(job(buildings), signal.signal), meshed());
  await builder.build(job(buildings), signal.signal);
  assert.equal(attempts, 1);
  signal.abort();
  await assert.rejects(builder.build(job(buildings), signal.signal), /cancelled/);
  builder.dispose();
  await assert.rejects(builder.build(job(buildings), new AbortController().signal), /cancelled/);
});

test('worker errors fall back and disposing an active worker rejects without hanging', async () => {
  const fake = {
    onmessage: null,
    onerror: null,
    terminate() {},
    postMessage() {},
  } as unknown as globalThis.Worker;
  const builder = createCameraTileBuilder(() => fake);
  const result = builder.build(job(buildings), new AbortController().signal);
  await Promise.resolve();
  fake.onerror!({preventDefault() {}} as ErrorEvent);
  assert.deepEqual(await result, meshed());
  builder.dispose();
  const active = createCameraTileBuilder(() => fake);
  const pending = active.build(job(buildings), new AbortController().signal);
  await Promise.resolve();
  active.dispose();
  await assert.rejects(pending, /disposed/);
});
