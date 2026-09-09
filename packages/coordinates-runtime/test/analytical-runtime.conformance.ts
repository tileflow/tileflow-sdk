import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {createLocalCoordinates} from '@tileflow/coordinates-runtime';
import {CoordinatesContractError} from '@tileflow/coordinates/contract';

const directory = process.env.COORDINATES_INSTALLATION_PATH;
if (!directory)
  throw new Error('An explicit installed proof-bearing execution release is required.');
let client: Awaited<ReturnType<typeof createLocalCoordinates>>;
before(async () => {
  client = await createLocalCoordinates({directory, allowDevelopment: true});
});
after(async () => {
  await client?.close();
});

test('the installed release binds proof bytes, operation metadata and every batch result', async () => {
  const proof = client.provenance.applicabilityProofs?.[0];
  assert.ok(proof);
  const discovery = await client.operations({from: 'EPSG:4979', to: 'EPSG:4978'});
  assert.equal(discovery.ok, true);
  if (!discovery.ok) assert.fail();
  const operation = discovery.result.operations[0];
  assert.equal(operation.areasOfUse, null);
  assert.equal(operation.accuracy, null);
  assert.deepEqual(operation.applicability, {
    source: 'analytic-proof',
    proofId: proof.id,
    proofVersion: 1,
    method: {authority: 'EPSG', code: '9602'},
    releaseId: client.releaseId,
  });
  const positions = Array.from({length: 50}, (_, i) => [12 + i / 100, 55, 10]);
  const reply = await client.transform({
    from: 'EPSG:4979',
    to: 'EPSG:4978',
    positions,
    operationRef: operation.operationRef,
    areaOfInterest: [-80, -40, -70, -30],
  });
  assert.equal(reply.ok, true);
  if (!reply.ok) assert.fail();
  assert.equal(reply.result.results.length, 50);
  assert.equal(reply.result.operations.length, 1);
  assert.deepEqual(reply.usage, {mode: 'local', units: 0});
  for (const result of reply.result.results) {
    assert.equal(result.operationRef, operation.operationRef);
    assert.equal(result.selection.mode, 'explicit');
    assert.equal(result.height, 'not-applicable');
    assert.equal(result.applicability.operationArea, 'not-provided');
    assert.deepEqual(result.analyticalProof, {proofId: proof.id, status: 'verified'});
  }
  const inverse = await client.transform({
    from: 'EPSG:4978',
    to: 'EPSG:4979',
    positions: reply.result.results.map((row) => row.position),
  });
  assert.equal(inverse.ok, true);
  if (!inverse.ok) assert.fail();
  inverse.result.results.forEach((row, i) => {
    positions[i].forEach((value, axis) =>
      assert.ok(Math.abs(value - row.position[axis]) <= (axis === 2 ? 0.002 : 1e-9)),
    );
  });
});

test('geocentric descriptions expose Cartesian axes while every static projected profile has a mapping', async () => {
  const description = await client.describe({id: 'EPSG:4978', formats: ['projjson']});
  assert.equal(description.ok, true);
  if (!description.ok) assert.fail();
  assert.equal(description.result.summary.coordinateModel, 'geocentric');
  assert.deepEqual(
    description.result.normalizedAxes?.map((axis) => axis.direction),
    ['geocentricX', 'geocentricY', 'geocentricZ'],
  );
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await client.search({
      filters: {kind: 'projected'},
      deprecated: 'include',
      limit: 50,
      ...(cursor ? {cursor} : {}),
    });
    assert.equal(page.ok, true);
    if (!page.ok) assert.fail();
    for (const item of page.result.items)
      if (item.dimension === 2 && !item.dynamic) {
        assert.equal(item.eligibility.eligible, true, item.id);
        total++;
      }
    cursor = page.result.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(total, 5447);
});

test('an analytical batch failure remains indexed, atomic, account-free and download-free', async () => {
  const fetcher = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Execution attempted to download');
  };
  try {
    await assert.rejects(
      client.transform({
        from: 'EPSG:4978',
        to: 'EPSG:4979',
        positions: [
          [3586475.2672, 762328.8513, 5201391.7147],
          [0, 0, 0],
        ],
      }),
      (error: unknown) => {
        assert.ok(error instanceof CoordinatesContractError);
        assert.equal(error.reason, 'APPLICABILITY_UNDETERMINED');
        assert.equal(error.details.pointIndex, 1);
        const wire = error.toJSON();
        assert.deepEqual(wire.usage, {mode: 'local', units: 0});
        assert.equal('result' in wire, false);
        assert.equal(wire.releaseId, client.releaseId);
        return true;
      },
    );
  } finally {
    globalThis.fetch = fetcher;
  }
});
