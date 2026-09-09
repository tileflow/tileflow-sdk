import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createLocalCoordinates, setupCoordinates} from '@tileflow/coordinates-runtime';
import {CoordinatesContractError} from '@tileflow/coordinates/contract';

const source = process.env.COORDINATES_DISTRIBUTION_PATH;
const cacheDirectory = process.env.COORDINATES_CACHE_PATH;
if (!source || !cacheDirectory)
  throw new Error('Runtime conformance requires an explicit development distribution and cache.');
let client: Awaited<ReturnType<typeof createLocalCoordinates>>;

before(async () => {
  const receipt = await setupCoordinates({source, cacheDirectory, allowDevelopment: true});
  assert.equal(receipt.assets.length, 2);
  client = await createLocalCoordinates({directory: receipt.directory, allowDevelopment: true});
});
after(async () => {
  await client?.close();
});

test('catalog discovery is complete, filtered, and pageable under an optional release pin', async () => {
  const all = await client.search({deprecated: 'include', limit: 1});
  assert.equal(all.ok, true);
  if (!all.ok) return;
  assert.equal(all.result.total, 7724);
  assert.ok(all.result.nextCursor);
  const next = await client.search({
    deprecated: 'include',
    limit: 1,
    cursor: all.result.nextCursor!,
    requiredReleaseId: all.releaseId,
  });
  assert.equal(next.ok, true);
  if (next.ok) assert.notEqual(next.result.items[0].id, all.result.items[0].id);
  const exact = await client.search({query: '25830'});
  assert.equal(exact.ok, true);
  if (exact.ok) assert.equal(exact.result.items[0].id, 'EPSG:25830');
  const filtered = await client.search({
    filters: {datum: 'ETRS89', kind: 'projected', unit: 'metre'},
  });
  assert.equal(filtered.ok, true);
  if (filtered.ok) assert.ok(filtered.result.items.length > 0);
  const described = await client.describe({
    id: 'EPSG:4807',
    formats: ['wkt2', 'projjson', 'legacy-proj'],
  });
  assert.equal(described.ok, true);
  if (described.ok) {
    assert.equal(described.result.officialAxes[0].direction, 'north');
    assert.equal(described.result.officialAxes[0].unit.name, 'grad');
    assert.equal(described.result.normalizedAxes![0].unit.name, 'degree');
    assert.equal(described.result.definitions.length, 3);
  }
});

test('strict missing resources survive the artifact boundary as a structured SDK error', async () => {
  await assert.rejects(
    client.transform({from: 'EPSG:4979', to: 'EPSG:9518', positions: [[12, 55, 10]]}),
    (error: unknown) => {
      assert.ok(error instanceof CoordinatesContractError);
      assert.equal(error.code, 'COORDINATES_MISSING_GRID');
      assert.equal(error.details.pointIndex, 0);
      assert.ok(error.details.missingGrids?.includes('Und_min1x1_egm2008_isw=82_WGS84_TideFree'));
      assert.equal(error.response.releaseId, client.releaseId);
      return true;
    },
  );
});

test('explicit operation selection is independent of best-known relaxation and AOI containment', async () => {
  const candidates = await client.operations({
    from: 'EPSG:4979',
    to: 'EPSG:9518',
    areaOfInterest: [100, 0, 110, 10],
  });
  assert.equal(candidates.ok, true);
  if (!candidates.ok) return;
  const selected = candidates.result.operations.find((operation) =>
    operation.grids.some((grid) => grid.name === 'us_nga_egm08_25.tif'),
  );
  assert.ok(selected);
  const response = await client.transform({
    from: 'EPSG:4979',
    to: 'EPSG:9518',
    positions: [[12, 55, 10]],
    operationRef: selected.operationRef,
    areaOfInterest: [-100, 0, -90, 10],
  });
  assert.equal(response.ok, true);
  if (!response.ok) return;
  assert.ok(Math.abs(response.result.results[0].position[2]! + 27.8257) < 0.0001);
  assert.equal(response.result.policy.requireBestKnown, true);
  assert.equal(response.result.results[0].selection.mode, 'explicit');
  assert.equal(response.result.results[0].selection.bestKnown.relation, 'different');
  assert.deepEqual(response.result.results[0].selection.relaxationsApplied, ['best-known']);
  assert.deepEqual(response.usage, {mode: 'local', units: 0});
});

test('a batch records per-point operations and never returns a partial failure', async () => {
  const response = await client.transform({
    from: 'EPSG:4267',
    to: 'EPSG:4326',
    positions: [
      [-100, 40],
      [-150, 65],
    ],
  });
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.result.results.length, 2);
    assert.notEqual(
      response.result.results[0].operationRef,
      response.result.results[1].operationRef,
    );
  }
  await assert.rejects(
    client.transform({
      from: 'EPSG:4258',
      to: 'EPSG:25832',
      positions: [
        [10, 55],
        [40, 55],
      ],
    }),
    (error: unknown) => {
      assert.ok(error instanceof CoordinatesContractError);
      assert.equal(error.details.pointIndex, 1);
      assert.equal('result' in error.toJSON(), false);
      return true;
    },
  );
});

test('execution methods do not download and identify the actual invalid CRS field', async () => {
  const fetcher = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Unexpected execution download');
  };
  try {
    const response = await client.transform({
      from: 'EPSG:4258',
      to: 'EPSG:25832',
      positions: [[12, 55, 432.1]],
      areaOfInterest: [100, 0, 110, 10],
    });
    assert.equal(response.ok, true);
    if (response.ok) {
      assert.equal(response.result.results[0].position[2], 432.1);
      assert.equal(response.result.results[0].height, 'auxiliary-preserved');
    }
    await assert.rejects(
      client.transform({from: 'EPSG:4258', to: 'EPSG:99999999', positions: [[12, 55]]}),
      (error: unknown) => {
        assert.ok(error instanceof CoordinatesContractError);
        assert.equal(error.code, 'COORDINATES_CRS_NOT_FOUND');
        assert.deepEqual(error.details.path, ['to']);
        return true;
      },
    );
  } finally {
    globalThis.fetch = fetcher;
  }
});
