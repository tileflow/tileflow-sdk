import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compactTileflowDeploymentArtifact,
  expandTileflowDeploymentArtifact,
  tileflowDeploymentWebBytes,
} from '../src/family-deployment';
import {
  createTileflowStyleFamily,
  expandTileflowStyleFamily,
  materializeTileflowStyleFamily,
  parseTileflowStyleFamily,
} from '../src/style-family';
import type {MapLibreStyle} from '../src/types';

const style = (color: string): MapLibreStyle => ({
  version: 8,
  sources: {},
  layers: [{id: 'water', type: 'background', paint: {'background-color': color}}],
});

test('publication shares repeated data contracts, preserves exceptions and rejects unknown defaults', () => {
  const requirements = {version: 1, layers: {water: {fields: ['class']}}};
  const artifact = {
    kind: 'tileflow-map-deployment',
    schemaVersion: 1,
    mapId: 'main',
    styles: {day: style('#00aaff'), night: style('#002244')},
    buildManifest: {
      schemaVersion: 1,
      maps: {
        main: {
          sourceAssets: {fonts: [], icons: []},
          themes: {
            day: {
              dataRequirements: requirements,
              sourceRequirements: requirements,
              styleSha256: 'a',
            },
            night: {
              dataRequirements: requirements,
              sourceRequirements: requirements,
              styleSha256: 'b',
            },
          },
        },
      },
    },
  };
  const compact = compactTileflowDeploymentArtifact(artifact);
  assert.deepEqual(expandTileflowDeploymentArtifact(compact), artifact);
  const wire = compact as typeof compact & {
    buildManifest: typeof artifact.buildManifest;
    sharedRequirements: {main: typeof artifact.buildManifest.maps.main.themes.day};
  };
  assert.equal(wire.buildManifest.maps.main.themes.day.dataRequirements, undefined);
  assert.deepEqual(wire.sharedRequirements.main.dataRequirements, requirements);
  assert.equal(
    tileflowDeploymentWebBytes({artifact: compact}),
    Buffer.byteLength(JSON.stringify({artifact: compact})),
  );
  const exception = {version: 1, layers: {water: {fields: ['depth']}}};
  wire.buildManifest.maps.main.themes.day.dataRequirements = exception;
  const expanded = expandTileflowDeploymentArtifact(wire) as typeof artifact;
  assert.deepEqual(expanded.buildManifest.maps.main.themes.day.dataRequirements, exception);
  assert.deepEqual(expanded.buildManifest.maps.main.themes.night.dataRequirements, requirements);
  Object.assign(wire.sharedRequirements.main, {unexpected: true});
  assert.throws(() => expandTileflowDeploymentArtifact(wire), /Invalid shared/);
});

test('compact families preserve arbitrary JSON, reuse columns and materialize detached styles', () => {
  const day = {...style('#abcdef'), metadata: {literal: {$variant: 4}, nested: {color: '#abcdef'}}};
  const night = {
    ...style('#012345'),
    metadata: {literal: {$variant: 7}, nested: {color: '#012345'}},
  };
  const family = createTileflowStyleFamily({night, day});
  assert.deepEqual(family, createTileflowStyleFamily({day, night}));
  assert.deepEqual(expandTileflowStyleFamily(JSON.parse(JSON.stringify(family))), {day, night});
  assert.equal(family.parameters.length, 2);
  assert.deepEqual(family.updates, {
    appearanceOnly: false,
    paint: [[0, 'background-color']],
    roots: [],
  });
  const copy = materializeTileflowStyleFamily(family, 'day');
  copy.layers.splice(0);
  assert.equal(materializeTileflowStyleFamily(family, 'day').layers.length, 1);
});

test('compaction detaches styles and keeps JSON normalization at the wire boundary', () => {
  const holes = [undefined, undefined, Infinity, -0];
  Reflect.deleteProperty(holes, 1);
  const day = {
    ...style('#abcdef'),
    metadata: {notWritten: undefined, holes, labels: {z: 1, a: 2}},
  };
  const compact = createTileflowStyleFamily({day});
  const expanded = materializeTileflowStyleFamily(compact, 'day');
  assert.deepEqual(expanded, JSON.parse(JSON.stringify(day)));
  day.metadata.labels.a = 3;
  assert.deepEqual(expanded.metadata?.labels, {a: 2, z: 1});
});

test('structurally different author maps remain supported and cannot take the appearance fast path', () => {
  const day = style('#000000');
  const night = {
    ...style('#ffffff'),
    sources: {satellite: {type: 'raster', tiles: ['https://tiles.test/{z}/{x}/{y}.png']}},
  } as MapLibreStyle;
  const family = createTileflowStyleFamily({day, night});
  assert.equal(family.updates.appearanceOnly, false);
  assert.deepEqual(expandTileflowStyleFamily(family), {day, night});
});

test('shared literals reduce repeated expressions, round-trip reserved keys and bound expansion', () => {
  const repeated = [
    'match',
    ['get', 'class'],
    Array.from({length: 60}, (_, index) => `class-${index}`),
    true,
    false,
  ];
  const source = {
    ...style('#000000'),
    metadata: {a: repeated, b: repeated, authored: {$constant: 99}},
  };
  const family = createTileflowStyleFamily({day: source});
  assert.ok(family.constants.length > 0);
  assert.ok(JSON.stringify(family).length < JSON.stringify(source).length);
  assert.deepEqual(
    materializeTileflowStyleFamily(JSON.parse(JSON.stringify(family)), 'day'),
    source,
  );
  assert.throws(
    () => parseTileflowStyleFamily({...family, template: {$constant: 99}}),
    /Invalid constant/,
  );
  assert.throws(
    () =>
      parseTileflowStyleFamily({
        ...family,
        constants: ['x'.repeat(100_000)],
        template: {version: 8, sources: {}, layers: [], metadata: Array(100).fill({$constant: 0})},
      }),
    /Expanded family/,
  );
});

test('untrusted families reject versions, forged update plans, references and expansion bombs', () => {
  const family = createTileflowStyleFamily({day: style('#000000'), night: style('#ffffff')});
  assert.throws(() => parseTileflowStyleFamily({...family, version: 2}));
  assert.throws(() =>
    parseTileflowStyleFamily({...family, updates: {appearanceOnly: false, paint: [], roots: []}}),
  );
  assert.throws(() => parseTileflowStyleFamily({...family, template: {$variant: 100}}));
  assert.throws(() => parseTileflowStyleFamily({...family, parameters: []}));
  assert.throws(() => parseTileflowStyleFamily({...family, themes: ['day', 'day']}));
  assert.throws(() => parseTileflowStyleFamily({...family, extra: true}));
  const bomb = {
    ...family,
    template: {version: 8, sources: {}, layers: [], metadata: Array(100).fill({$variant: 0})},
    parameters: [['x'.repeat(100_000), 'y'.repeat(100_000)]],
    updates: {appearanceOnly: false, paint: [], roots: []},
  };
  assert.throws(() => parseTileflowStyleFamily(bomb), /Expanded family/);
  const poisoned = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(
    () => parseTileflowStyleFamily({...family, template: poisoned}),
    /Unsafe object key/,
  );
  assert.throws(() => materializeTileflowStyleFamily(family, 'missing'), /Unknown family theme/);
});

test('each theme is checked through its references, and a checked family is not checked again', () => {
  const family = createTileflowStyleFamily({day: style('#000000'), night: style('#ffffff')});
  const layer = (id: unknown) => ({id, type: 'background'});
  const nested = (depth: number): unknown => (depth === 0 ? 1 : [nested(depth - 1)]);
  const variant = (template: unknown, values: unknown[]) => ({
    ...family,
    template,
    parameters: [values],
    updates: {appearanceOnly: false, paint: [], roots: []},
  });
  // A rule broken in one theme only, reached through a parameter.
  assert.throws(
    () =>
      parseTileflowStyleFamily(
        variant({version: 8, sources: {}, layers: [layer('a'), layer({$variant: 0})]}, ['b', 'a']),
      ),
    /Invalid or duplicate layer/,
  );
  assert.throws(
    () =>
      parseTileflowStyleFamily(variant({version: {$variant: 0}, sources: {}, layers: []}, [8, 7])),
    /Invalid expanded MapLibre style/,
  );
  // A parameter value is literal: a marker inside it is not resolved again.
  assert.throws(
    () =>
      parseTileflowStyleFamily(
        variant({version: 8, sources: {}, layers: [{$variant: 0}]}, [
          layer({$variant: 0}),
          layer('a'),
        ]),
      ),
    /Invalid or duplicate layer/,
  );
  // Depth and value counts include what references expand to: each value below is within the
  // document's own limits, and exceeds them only where the template places it.
  const deep = (at: unknown) =>
    variant({version: 8, sources: {}, layers: [], metadata: {a: {b: {c: {d: {e: at}}}}}}, [
      nested(92),
      1,
    ]);
  assert.equal(
    parseTileflowStyleFamily({...deep(1), updates: {appearanceOnly: true, paint: [], roots: []}})
      .themes.length,
    2,
  );
  assert.throws(() => parseTileflowStyleFamily(deep({$variant: 0})), /Family complexity limit/);
  const shared = Array.from({length: 50_000}, (_, index) => index);
  assert.throws(
    () =>
      parseTileflowStyleFamily({
        ...variant(
          {version: 8, sources: {}, layers: [], metadata: Array(12).fill({$constant: 0})},
          [1, 2],
        ),
        constants: [shared],
      }),
    /Family complexity limit exceeded/,
  );
  assert.equal(parseTileflowStyleFamily(family), family);
});
