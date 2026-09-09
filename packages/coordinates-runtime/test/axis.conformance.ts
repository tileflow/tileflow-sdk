import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const binary = process.env.COORDINATES_NATIVE_PATH;
const resources = process.env.COORDINATES_RESOURCES_PATH;
const proofPath = process.env.COORDINATES_PROOF_PATH;
if (!binary || !resources) throw new Error('Explicit native artifact and resources are required.');

function execute(request: object, withProof = true) {
  const run = spawnSync(binary!, [resources!, ...(withProof && proofPath ? [proofPath] : [])], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    timeout: 15000,
    env: {PATH: '/usr/bin:/bin', PROJ_NETWORK: 'ON', PROJ_DATA: '/unavailable'},
  });
  assert.equal(run.status, 0);
  assert.equal(run.stderr, '');
  return JSON.parse(run.stdout);
}

function transform(from: string, to: string, position: number[], extra = {}) {
  const reply = execute({command: 'transform', from, to, positions: [position], ...extra});
  assert.equal(reply.ok, true, JSON.stringify(reply));
  return reply.result[0];
}

function near(actual: number[], expected: number[], tolerance: number | number[]) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, index) => {
    const bound = typeof tolerance === 'number' ? tolerance : tolerance[index];
    assert.ok(
      Math.abs(actual[index] - value) <= bound,
      `${index}: ${actual[index]} versus ${value}`,
    );
  });
}

test('conventional and reordered projected axes share public x/y and preserve official order', () => {
  for (const target of ['EPSG:25832', 'EPSG:3044']) {
    const forward = transform('EPSG:4258', target, [12, 55]);
    near(forward.position, [691875.6321, 6098907.825], 0.0001);
    near(transform(target, 'EPSG:4258', forward.position).position, [12, 55], 1e-9);
  }
  const {result} = execute({command: 'describe', id: 'EPSG:3044'});
  assert.equal(result.summary.coordinateModel, 'projected');
  assert.equal(result.officialAxes[0].direction, 'north');
  assert.deepEqual(result.normalization.publicToOfficial, [
    {officialAxis: 1, scale: 1},
    {officialAxis: 0, scale: 1},
  ]);
});

test('polar axes use their meridians and projection basis, including reordered UPS', () => {
  // Independent ellipsoidal polar stereographic variant B equations (WGS 84).
  const e = Math.sqrt(1 - (1 - 1 / 298.257223563) ** 2);
  const rad = Math.PI / 180;
  const t = (latitude: number) =>
    Math.tan(Math.PI / 4 - latitude / 2) /
    ((1 - e * Math.sin(latitude)) / (1 + e * Math.sin(latitude))) ** (e / 2);
  for (const [id, standard, origin, latitude] of [
    ['EPSG:3031', -71, 0, -75],
    ['EPSG:3413', 70, -45, 75],
  ] as const) {
    const phi = Math.abs(standard) * rad;
    const rho =
      (((6378137 * Math.cos(phi)) / Math.sqrt(1 - e * e * Math.sin(phi) ** 2)) *
        t(Math.abs(latitude) * rad)) /
      t(phi);
    for (const offset of [0, 45, 90, 180]) {
      const longitude = ((origin + offset + 540) % 360) - 180;
      const input = [longitude, latitude];
      const row = transform('EPSG:4326', id, input);
      near(
        row.position,
        [rho * Math.sin(offset * rad), -Math.sign(latitude) * rho * Math.cos(offset * rad)],
        0.001,
      );
      near(transform(id, 'EPSG:4326', row.position).position, input, 1e-9);
      const discovery = execute({command: 'operations', from: id, to: 'EPSG:4326'});
      near(
        transform(id, 'EPSG:4326', row.position, {operationIndex: discovery.result[0].index})
          .position,
        input,
        1e-9,
      );
    }
    const {result} = execute({command: 'describe', id});
    assert.ok(result.officialAxes.every((axis: {meridian: unknown}) => axis.meridian));
    assert.equal(result.normalizedAxes[0].name, 'Easting');
  }
  const ups = transform('EPSG:4326', 'EPSG:32661', [15, 85]);
  near(transform('EPSG:32661', 'EPSG:4326', ups.position).position, [15, 85], 1e-9);
});

test('Westing/Southing are sign-normalized without changing declared CRS units or prime meridian', () => {
  // EPSG Guidance Note 7-2 Krovak control; longitude converted from Greenwich to Ferro.
  const input = [16.849771944444445 + 17 + 40 / 60, 50.20901166666667];
  const row = transform('EPSG:4818', 'EPSG:2065', input);
  near(row.position, [-568991, -1050538.64], 0.011);
  near(transform('EPSG:2065', 'EPSG:4818', row.position).position, input, 1e-9);

  const south = transform('EPSG:4148', 'EPSG:2053', [29, -25]);
  // On the central meridian, easting is zero and meridional northing is negative.
  near([south.position[0]], [0], 1e-7);
  assert.ok(south.position[1] < 0);
  near(transform('EPSG:2053', 'EPSG:4148', south.position).position, [29, -25], 1e-9);
  const {result} = execute({command: 'describe', id: 'EPSG:2053'});
  assert.deepEqual(result.normalization.publicToOfficial, [
    {officialAxis: 0, scale: -1},
    {officialAxis: 1, scale: -1},
  ]);
});

test('non-metric linear axes retain their EPSG unit scale', () => {
  const metric = transform('EPSG:6318', 'EPSG:6502', [-93, 48]);
  const feet = transform('EPSG:6318', 'EPSG:6503', [-93, 48]);
  near(
    feet.position.map((value: number) => (value * 1200) / 3937),
    metric.position,
    0.001,
  );
  near(transform('EPSG:6503', 'EPSG:6318', feet.position).position, [-93, 48], 1e-9);
});

test('geocentric XYZ has an independent ellipsoid oracle, explicit model and reversible 3D semantics', () => {
  assert.ok(proofPath, 'An explicitly registered proof artifact is required');
  const [longitude, latitude, height] = [12, 55, 10];
  const phi = (latitude * Math.PI) / 180;
  const lambda = (longitude * Math.PI) / 180;
  const e2 = 1 - (1 - 1 / 298.257223563) ** 2;
  const n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const expected = [
    (n + height) * Math.cos(phi) * Math.cos(lambda),
    (n + height) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - e2) + height) * Math.sin(phi),
  ];
  const row = transform('EPSG:4979', 'EPSG:4978', [longitude, latitude, height]);
  near(row.position, expected, 0.001);
  assert.equal(row.height, 'not-applicable');
  assert.equal(row.operation.heightEffect, 'not-applicable');
  assert.equal(row.operation.areasOfUse, null);
  assert.equal(row.operation.accuracy, null);
  assert.match(row.operation.analyticProofId, /^ap_[a-f0-9]{64}$/u);
  assert.equal(row.analyticProofVerified, true);
  const back = transform('EPSG:4978', 'EPSG:4979', expected);
  near(back.position, [longitude, latitude, height], [1e-9, 1e-9, 0.001]);
  assert.equal(back.height, 'not-applicable');
  const {result} = execute({command: 'describe', id: 'EPSG:4978'});
  assert.equal(result.summary.coordinateModel, 'geocentric');
  assert.equal(result.summary.eligibility.eligible, true);
  assert.deepEqual(
    result.normalizedAxes.map((axis: {direction: string}) => axis.direction),
    ['geocentricX', 'geocentricY', 'geocentricZ'],
  );
  const mismatch = execute({
    command: 'transform',
    from: 'EPSG:4326',
    to: 'EPSG:4978',
    positions: [[12, 55, 10]],
  });
  assert.equal(mismatch.code, 'CRS_DIMENSION_MISMATCH');
  const undefinedLocation = execute({
    command: 'transform',
    from: 'EPSG:4978',
    to: 'EPSG:4979',
    positions: [expected, [0, 0, 0]],
  });
  assert.equal(undefinedLocation.ok, false);
  assert.equal(undefinedLocation.index, 1);
  assert.equal(undefinedLocation.code, 'APPLICABILITY_UNDETERMINED');
  assert.equal('result' in undefinedLocation, false);
});

test('additional polar LAEA and equidistant profiles have independent radial controls', () => {
  const rad = Math.PI / 180;
  const a = 6378137;
  const e2 = 1 - (1 - 1 / 298.257223563) ** 2;
  const e = Math.sqrt(e2);
  const q = (phi: number) =>
    (1 - e2) *
    (Math.sin(phi) / (1 - e2 * Math.sin(phi) ** 2) -
      Math.log((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) / (2 * e));
  for (const [target, hemisphere] of [
    ['EPSG:3408', 1],
    ['EPSG:3409', -1],
  ] as const) {
    const rho = 2 * 6371228 * Math.sin(5 * rad);
    for (const longitude of [0, 45, 90, -170]) {
      const input = [longitude, hemisphere * 80];
      const row = transform('EPSG:10346', target, input);
      near(
        row.position,
        [rho * Math.sin(longitude * rad), -hemisphere * rho * Math.cos(longitude * rad)],
        0.001,
      );
      near(transform(target, 'EPSG:10346', row.position).position, input, 1e-8);
    }
  }
  for (const [target, origin, hemisphere] of [
    ['EPSG:3571', 180, 1],
    ['EPSG:3572', -150, 1],
    ['EPSG:3573', -100, 1],
    ['EPSG:3574', -40, 1],
    ['EPSG:3575', 10, 1],
    ['EPSG:3576', 90, 1],
    ['EPSG:6931', 0, 1],
    ['EPSG:6932', 0, -1],
  ] as const) {
    const rho = a * Math.sqrt(q(Math.PI / 2) - q(80 * rad));
    const longitude = ((origin + 90 + 540) % 360) - 180;
    const input = [longitude, hemisphere * 80];
    const row = transform('EPSG:4326', target, input);
    near(row.position, [rho, 0], 0.001);
    const inverse = transform(target, 'EPSG:4326', row.position).position;
    inverse[0] = input[0] + ((((inverse[0] - input[0]) % 360) + 540) % 360) - 180;
    near(inverse, input, 1e-8);
  }
  // Independent Simpson integration of meridian curvature, with no PROJ calls in the oracle.
  const n = 4096;
  const step = (10 * rad) / n;
  const curvature = (phi: number) => (a * (1 - e2)) / (1 - e2 * Math.sin(phi) ** 2) ** 1.5;
  let integral = curvature(-Math.PI / 2) + curvature(-80 * rad);
  for (let i = 1; i < n; i++) integral += (i % 2 ? 4 : 2) * curvature(-Math.PI / 2 + i * step);
  const rho = (integral * step) / 3;
  const row = transform('EPSG:4326', 'EPSG:27702', [90, -80]);
  near(row.position, [3714266.977 + rho, 3402016.506], 0.001);
  near(transform('EPSG:27702', 'EPSG:4326', row.position).position, [90, -80], 1e-8);
  for (const id of ['EPSG:3973', 'EPSG:3974']) {
    const description = execute({command: 'describe', id});
    assert.equal(description.result.summary.eligibility.eligible, true);
    assert.equal(description.result.summary.deprecated, true);
  }
});

test('analytical applicability requires its registered proof and is not used for identity or datum changes', () => {
  const pair = {
    command: 'transform',
    from: 'EPSG:4979',
    to: 'EPSG:4978',
    positions: [[12, 55, 10]],
  };
  const missing = execute({...pair, analyticProofId: 'ap_' + 'a'.repeat(64)}, false);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'APPLICABILITY_UNDETERMINED');
  const identity = execute({...pair, to: 'EPSG:4979'});
  assert.equal(identity.ok, true);
  assert.notEqual(identity.result[0].operation.areasOfUse, null);
  assert.equal(identity.result[0].operation.analyticProofId, null);
  assert.equal(identity.result[0].analyticProofVerified, false);
  const discovery = execute({command: 'operations', from: pair.from, to: pair.to});
  const selected = transform(pair.from, pair.to, pair.positions[0], {
    operationIndex: discovery.result[0].index,
  });
  assert.equal(selected.operation.analyticProofId, discovery.result[0].analyticProofId);
  assert.equal(selected.analyticProofVerified, true);
  const differentDatum = execute({command: 'operations', from: 'EPSG:4937', to: 'EPSG:4978'});
  assert.equal(differentDatum.ok, true);
  assert.ok(
    differentDatum.result.every(
      (operation: {analyticProofId: unknown}) => operation.analyticProofId === null,
    ),
  );
  const dynamic = execute({
    command: 'transform',
    from: 'EPSG:7912',
    to: 'EPSG:7789',
    positions: [[12, 55, 10]],
  });
  assert.equal(dynamic.code, 'UNSUPPORTED_CRS');
});

test('analytical proof refuses undefined longitude, ambiguous normal branches and inaccurate inverses atomically', () => {
  for (const position of [
    [0, 0, 0],
    [0, 0, 6356752.314245],
    [1000, 0, 0],
    [1, 1, 1],
  ]) {
    const reply = execute({
      command: 'transform',
      from: 'EPSG:4978',
      to: 'EPSG:4979',
      positions: [[3586475.2672, 762328.8513, 5201391.7147], position],
    });
    assert.equal(reply.ok, false, JSON.stringify(reply));
    assert.equal(reply.code, 'APPLICABILITY_UNDETERMINED');
    assert.equal(reply.index, 1);
    assert.equal('result' in reply, false);
  }
  for (const position of [
    [0, 90, 0],
    [0, 0, -6378137],
    [12, 55, 1e8],
  ]) {
    const reply = execute({
      command: 'transform',
      from: 'EPSG:4979',
      to: 'EPSG:4978',
      positions: [position],
    });
    assert.equal(reply.ok, false, JSON.stringify(reply));
    assert.equal(reply.code, 'APPLICABILITY_UNDETERMINED');
  }
});

test('geocentric proof validates a full 50-position batch in both directions', () => {
  const positions = Array.from({length: 50}, (_, i) => [
    -179 + i * 7,
    -85 + i * 3.4,
    ((i % 3) - 1) * 1000,
  ]);
  const forward = execute({command: 'transform', from: 'EPSG:4979', to: 'EPSG:4978', positions});
  assert.equal(forward.ok, true, JSON.stringify(forward));
  assert.equal(forward.result.length, 50);
  const inverse = execute({
    command: 'transform',
    from: 'EPSG:4978',
    to: 'EPSG:4979',
    positions: forward.result.map((item: {position: number[]}) => item.position),
  });
  assert.equal(inverse.ok, true, JSON.stringify(inverse));
  inverse.result.forEach((row: {position: number[]; analyticProofVerified: boolean}, i: number) => {
    near(row.position, positions[i], [1e-9, 1e-9, 0.002]);
    assert.equal(row.analyticProofVerified, true);
  });
});
