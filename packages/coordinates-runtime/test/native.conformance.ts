import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {coordinatesCrsDescriptionSchema} from '@tileflow/coordinates/contract';

const binary = process.env.COORDINATES_NATIVE_PATH;
const resources = process.env.COORDINATES_RESOURCES_PATH;
if (!binary || !resources)
  throw new Error(
    'Native conformance requires an explicit native artifact and resource directory.',
  );

function execute(requests: unknown[]) {
  const result = spawnSync(binary!, [resources!], {
    input: `${requests.map((request) => JSON.stringify(request)).join('\n')}\n`,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {PATH: '/usr/bin:/bin', PROJ_NETWORK: 'ON', PROJ_DATA: '/unavailable'},
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  return result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

test('the published UTM boundary control remains applicable after inverse-projection roundoff', () => {
  const [reply] = execute([
    {command: 'transform', from: 'EPSG:4258', to: 'EPSG:25832', positions: [[12, 55]]},
  ]);
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.ok(Math.abs(reply.result[0].position[0] - 691875.6321) < 0.0001);
  assert.ok(Math.abs(reply.result[0].position[1] - 6098907.825) < 0.0001);

  const [outside] = execute([
    {command: 'transform', from: 'EPSG:4258', to: 'EPSG:25832', positions: [[12 + 1e-9, 55]]},
  ]);
  assert.equal(outside.ok, false);
  assert.equal(outside.index, 0);
});

test('all pinned EPSG descriptions fit the shared contract without truncation', () => {
  const replies = execute(
    Array.from({length: 156}, (_, index) => ({command: 'catalog', offset: index * 50})),
  );
  const records = replies.flatMap((reply) => {
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.result;
  });
  assert.equal(records.length, 7724);
  assert.equal(new Set(records.map((record) => record.description.summary.id)).size, 7724);
  for (const record of records) {
    const checked = coordinatesCrsDescriptionSchema.safeParse(record.description);
    assert.equal(
      checked.success,
      true,
      `${record.description.summary.id}: ${checked.error?.message}`,
    );
  }
  const longArea = records.find((record) => record.description.summary.id === 'EPSG:4329');
  assert.equal(longArea.description.summary.areasOfUse[0].name.length, 3035);
  const multipleDomains = records.find((record) => record.description.summary.id === 'EPSG:25832');
  assert.equal(multipleDomains.description.summary.areasOfUse.length, 2);
});

test('static height control, missing best grid, explicit quality choice and atomic errors', () => {
  const [british, strict, relaxed, dimension, atomic, metadata] = execute([
    {
      command: 'transform',
      from: 'EPSG:4937',
      to: 'EPSG:7405',
      positions: [[-5.20304609998, 49.9600613782, 124.269]],
    },
    {command: 'transform', from: 'EPSG:4979', to: 'EPSG:9518', positions: [[12, 55, 10]]},
    {
      command: 'transform',
      from: 'EPSG:4979',
      to: 'EPSG:9518',
      positions: [[12, 55, 10]],
      requireBestKnown: false,
    },
    {command: 'transform', from: 'EPSG:4326', to: 'EPSG:4979', positions: [[12, 55, 10]]},
    {
      command: 'transform',
      from: 'EPSG:4258',
      to: 'EPSG:25832',
      positions: [
        [10, 55],
        [40, 55],
      ],
    },
    {command: 'metadata'},
  ]);
  assert.equal(british.ok, true);
  [170370.718, 11572.405, 71.264].forEach((value, index) =>
    assert.ok(Math.abs(british.result[0].position[index] - value) < 0.002),
  );
  assert.equal(british.result[0].height, 'transformed');
  assert.equal(strict.ok, false);
  assert.equal(strict.code, 'MISSING_GRID');
  assert.equal(strict.index, 0);
  assert.equal(relaxed.ok, true);
  assert.ok(Math.abs(relaxed.result[0].position[2] + 27.8257) < 0.0001);
  assert.notEqual(relaxed.result[0].operation.name, relaxed.result[0].bestKnown.name);
  assert.equal(dimension.code, 'CRS_DIMENSION_MISMATCH');
  assert.equal(atomic.ok, false);
  assert.equal(atomic.index, 1);
  assert.equal('result' in atomic, false);
  assert.equal(metadata.result.networkEnabled, false);

  const [discovery] = execute([{command: 'operations', from: 'EPSG:4979', to: 'EPSG:9518'}]);
  const chosen = discovery.result.find((operation: {grids: {name: string}[]}) =>
    operation.grids.some((grid) => grid.name === 'us_nga_egm08_25.tif'),
  );
  assert.ok(chosen);
  const [explicit] = execute([
    {
      command: 'transform',
      from: 'EPSG:4979',
      to: 'EPSG:9518',
      positions: [[12, 55, 10]],
      operationIndex: chosen.index,
    },
  ]);
  assert.equal(explicit.ok, true);
  assert.equal(explicit.result[0].operation.internalPipeline, chosen.internalPipeline);
});

test('an auxiliary z never supplies an implicit height datum to a horizontal 2D operation', () => {
  const pair = {from: 'EPSG:4277', to: 'EPSG:4326'};
  const [discovery] = execute([{command: 'operations', ...pair}]);
  const operation = discovery.result.find(
    (item: {instantiable: boolean; internalPipeline: string | null}) =>
      item.instantiable && item.internalPipeline?.includes('+proj=helmert'),
  );
  assert.ok(operation);
  const [result] = execute([
    {
      command: 'transform',
      ...pair,
      operationIndex: operation.index,
      positions: [
        [-2, 53, 0],
        [-2, 53, 100000],
      ],
    },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result[0].position.slice(0, 2), result.result[1].position.slice(0, 2));
  assert.equal(result.result[0].position[2], 0);
  assert.equal(result.result[1].position[2], 100000);
  assert.equal(result.result[1].height, 'auxiliary-preserved');
});

test('degree normalization, prime meridians, wrapped longitude and invalid execution domains', () => {
  const [forward, inverse, wrapped, invalid] = execute([
    {command: 'transform', from: 'EPSG:4807', to: 'EPSG:4275', positions: [[0, 46.8]]},
    {
      command: 'transform',
      from: 'EPSG:4275',
      to: 'EPSG:4807',
      positions: [[2.5969213 * 0.9, 46.8]],
    },
    {
      command: 'transform',
      from: 'EPSG:4326',
      to: 'EPSG:3857',
      positions: [
        [179, 0],
        [-179, 0],
      ],
      areaOfInterest: [170, -10, -170, 10],
    },
    {command: 'transform', from: 'EPSG:25832', to: 'EPSG:4258', positions: [[1e100, 1e100]]},
  ]);
  for (const result of [forward, inverse, wrapped])
    assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(Math.abs(forward.result[0].position[0] - 2.5969213 * 0.9) < 5e-8);
  assert.ok(Math.abs(forward.result[0].position[1] - 46.8) < 1e-10);
  assert.ok(Math.abs(inverse.result[0].position[0]) < 5e-8);
  assert.ok(Math.abs(inverse.result[0].position[1] - 46.8) < 1e-10);
  for (const [index, sign] of [
    [0, 1],
    [1, -1],
  ]) {
    assert.ok(
      Math.abs(wrapped.result[index].position[0] - (sign * 6378137 * 179 * Math.PI) / 180) < 1e-6,
    );
  }
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'APPLICABILITY_UNDETERMINED');
  assert.equal(invalid.index, 0);
});

test('regional resource probes and ballpark policy retain independent meanings', () => {
  const probes = [
    {from: 'EPSG:23030', to: 'EPSG:25830', positions: [[440000, 4474000]], grid: 'PENR2009.gsb'},
    {from: 'EPSG:4230', to: 'EPSG:4258', positions: [[3, 39.5]], grid: 'BALR2009.gsb'},
    {
      from: 'EPSG:21781',
      to: 'EPSG:2056',
      positions: [[600000, 200000]],
      grid: 'ch_swisstopo_CHENyx06a.tif',
    },
  ];
  const results = execute(
    probes.map(({grid: _grid, ...pair}) => ({command: 'transform', ...pair})),
  );
  for (const [index, result] of results.entries()) {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(
      result.result[0].operation.grids.some(
        (grid: {name: string}) => grid.name === probes[index].grid,
      ),
    );
  }
  const pair = {command: 'transform', from: 'EPSG:4047', to: 'EPSG:4326', positions: [[0, 0]]};
  const [strict, relaxedBest, allowed] = execute([
    pair,
    {...pair, requireBestKnown: false},
    {...pair, allowBallpark: true},
  ]);
  assert.equal(strict.code, 'BALLPARK_NOT_ALLOWED');
  assert.equal(relaxedBest.code, 'BALLPARK_NOT_ALLOWED');
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
  assert.equal(allowed.result[0].operation.ballpark, true);
  assert.equal(allowed.result[0].operation.accuracy, null);
});
