import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStyle,
  disable,
  fixed,
  isCanonicalOpenMapTilesSchema,
  openMapTiles,
  renderPass,
  type ResolvedTileflowData,
  resolveTileflowData,
  tileflowDetailSourceId,
  tileflowWorld,
  tileflowWorldDetailLayers,
  tileflowWorldDetailTileJsonUrl,
  tileflowWorldGeneration,
  tileflowWorldLayers,
  tileflowWorldSchema,
  tileflowWorldTileJsonUrl,
  tileflowWorldTilesetOf,
  transit,
  validateTileflowWorldTilejson,
  vectorTiles,
  withRenderStack,
} from '../src';
import {
  bindSemanticLayer,
  createSemanticDataView,
  dataLayer,
  dataSource,
} from '../src/cartography/semantic-bindings';
import {compileLand} from '../src/modules/land/compiler';
import {resolveColors} from '../src/themes';
import {assembleTileflowLayers} from './layer-ir-fixture';
import {extendStreets} from './map-fixture';

test('resolves omitted data to the World current TileJSON discovery selector', () => {
  const resolved = resolveTileflowData(undefined);

  assert.equal(resolved.kind, 'tileflow-world');
  assert.equal(resolved.generation, tileflowWorldGeneration);
  assert.equal(resolved.tiles, undefined);
  assert.equal(resolved.url, tileflowWorldTileJsonUrl);
  assert.equal(resolved.revision, undefined);
  assert.equal(resolved.sourceId, 'tileflow');
  assert.equal(resolved.schema.layers.bathymetry, 'bathymetry');
  assert.equal(resolved.schema.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(resolved.schema.fields.bathymetrySortKey, 'sort_key');
  assert.equal(resolved.schema.type, 'tileflow-world');
  assert.equal(resolved.schema.adapter, undefined);
  assert.equal(resolved.schema.layers.roadLabel, 'road_label');
  assert.equal(resolved.schema.nameLanguagePrefix, 'name_');
  assert.deepEqual(resolved.detail, {
    delivery: 'composite',
    url: 'https://api.tileflow.dev/tiles/world,world-detail/tiles.json',
  });
  assert.equal(
    resolved.attribution,
    '<a href="https://tileflow.dev/copyright">© Tileflow</a> ' +
      '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
  );
  assert.deepEqual(resolved.identity, {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'tileflow-world',
    schemaVersion: 1,
    worldSelection: {kind: 'current', product: 'world-v1'},
    sourceId: 'tileflow',
    url: tileflowWorldTileJsonUrl,
  });
});

test('resolves an exact World selection with both immutable identity fields', () => {
  const releaseId = 'world-v1-release-test';
  const descriptorSha256 = 'b'.repeat(64);
  const resolved = resolveTileflowData(tileflowWorld({release: {descriptorSha256, releaseId}}), {
    apiBaseUrl: 'https://api.example.test/base',
  });

  assert.equal(resolved.generation, tileflowWorldGeneration);
  assert.equal(
    resolved.url,
    `https://api.example.test/tiles/world/tiles.json?worldReleaseId=${releaseId}&worldDescriptorSha256=${descriptorSha256}`,
  );
  assert.equal(resolved.tiles, undefined);
  assert.deepEqual(resolved.detail, {
    delivery: 'composite',
    url: `https://api.example.test/tiles/world,world-detail/tiles.json?worldReleaseId=${releaseId}&worldDescriptorSha256=${descriptorSha256}`,
  });
  assert.deepEqual(resolved.identity.worldSelection, {
    kind: 'release',
    product: 'world-v1',
    release: {descriptorSha256, releaseId},
  });
});

test('resolves external vector data without network access', () => {
  const external = resolveTileflowData(
    vectorTiles({
      attribution: '© Example',
      revision: 'fixture_1',
      schema: openMapTiles(),
      url: 'pmtiles://catalog/world.pmtiles?public=value',
    }),
  );

  assert.equal(external.url, 'pmtiles://catalog/world.pmtiles?public=value');
  assert.equal(external.attribution, '© Example');
  assert.equal(external.identity.kind, 'vector-tiles');
  assert.equal(external.identity.revision, 'fixture_1');

  const direct = resolveTileflowData(
    vectorTiles({
      attribution: '© Fixture',
      bounds: [-10, -5, 10, 5],
      maxzoom: 12,
      minzoom: 2,
      revision: 'fixture_2',
      schema: openMapTiles(),
      tiles: ['https://fixtures.example.test/{z}/{x}/{y}.pbf'],
    }),
  );
  assert.equal(direct.url, undefined);
  assert.deepEqual(direct.tiles, ['https://fixtures.example.test/{z}/{x}/{y}.pbf']);
  assert.equal(direct.identity.url, 'https://fixtures.example.test/{z}/{x}/{y}.pbf');
  assert.deepEqual(direct.bounds, [-10, -5, 10, 5]);
  assert.equal(direct.minzoom, 2);
  assert.equal(direct.maxzoom, 12);
});

test('accepts only public HTTPS, loopback development, root-relative, or safe PMTiles URLs', () => {
  const accepted = [
    'https://tiles.example.test/tiles.json',
    'http://localhost:4173/tiles.json',
    'http://maps.localhost:4173/tiles.json',
    'http://127.42.3.4:4173/{z}/{x}/{y}.pbf',
    'http://[::1]:4173/tiles.json',
    '/tiles/world/tiles.json?release=exact',
    'pmtiles://https://cdn.example.test/world.pmtiles?version=1',
    'pmtiles://http://127.0.0.1:4173/world.pmtiles',
    'pmtiles:///fixtures/world.pmtiles',
    'pmtiles://./test/fixtures/world.pmtiles',
    'pmtiles://catalog/world.pmtiles?public=value',
  ];

  for (const url of accepted) {
    assert.equal(
      vectorTiles({attribution: '© Example', schema: openMapTiles(), url}).url,
      url,
      url,
    );
  }
});

test('rejects unsafe vector and PMTiles URL protocols, authority, and paths', () => {
  const rejected = [
    'http://tiles.example.test/tiles.json',
    'http://localhost.evil.test/tiles.json',
    'javascript:alert(1)',
    'data:application/json,{}',
    'ftp://tiles.example.test/world.pmtiles',
    'file:///tmp/world.pmtiles',
    '//tiles.example.test/tiles.json',
    'relative/tiles.json',
    'https://tiles.example.test/tiles.json#private',
    ' https://tiles.example.test/tiles.json',
    'https://tiles.example.test\\@evil.test/tiles.json',
    'pmtiles://http://tiles.example.test/world.pmtiles',
    'pmtiles://https://user:secret@tiles.example.test/world.pmtiles',
    'pmtiles://javascript:alert(1)',
    'pmtiles://data:application/octet-stream,bytes',
    'pmtiles://ftp://tiles.example.test/world.pmtiles',
    'pmtiles://file:///tmp/world.pmtiles',
    'pmtiles:////tiles.example.test/world.pmtiles',
    'pmtiles://../world.pmtiles',
    'pmtiles://./../world.pmtiles',
    'pmtiles:///fixtures/%2e%2e/world.pmtiles',
    'pmtiles://catalog/world.zip',
    'pmtiles://https://tiles.example.test/world.pmtiles#private',
  ];

  for (const url of rejected) {
    assert.throws(
      () => vectorTiles({attribution: '© Example', schema: openMapTiles(), url}),
      /Tileflow/u,
      url,
    );
  }
});

test('supports explicit schema bindings and identifies canonical OpenMapTiles', () => {
  const canonical = openMapTiles();
  const remapped = openMapTiles({
    layers: {landcover: 'cover_v2', road: 'roads_v2'},
    fields: {
      access: 'permission',
      class: 'kind',
      layer: 'stacking_order',
      ramp: 'is_ramp',
      service: 'service_kind',
      surface: 'pavement',
    },
  });

  assert.equal(isCanonicalOpenMapTilesSchema(canonical), true);
  assert.equal(canonical.contractVersion, 2);
  assert.deepEqual(canonical.semantics, {parkLayer: 'mixed'});
  assert.equal(isCanonicalOpenMapTilesSchema(remapped), false);
  // OpenMapTiles bindings name canonical OpenMapTiles layers and fields only.
  for (const layer of ['businessCorridor', 'canopy', 'globalLandcover', 'tree']) {
    assert.equal(Object.hasOwn(canonical.layers, layer), false, layer);
  }
  for (const field of ['canopyClearanceAtZoom15', 'canopyCoverPercent', 'canopyRank']) {
    assert.equal(Object.hasOwn(canonical.fields, field), false, field);
  }
  assert.equal(canonical.layers.road, 'transportation');
  assert.equal(remapped.layers.landcover, 'cover_v2');
  assert.equal(remapped.layers.road, 'roads_v2');
  assert.equal(remapped.fields.class, 'kind');
  assert.equal(remapped.fields.access, 'permission');
  assert.equal(remapped.fields.ramp, 'is_ramp');
  assert.equal(remapped.fields.surface, 'pavement');
  assert.equal(canonical.fields.bicycle, 'bicycle');
  assert.equal(canonical.fields.mtbScale, 'mtb_scale');
  assert.equal(canonical.fields.toll, 'toll');
});

test('makes park-layer semantics explicit and requires them on every OpenMapTiles schema', () => {
  const protectedOnly = openMapTiles({semantics: {parkLayer: 'protected-only'}});
  const generic = openMapTiles();

  assert.equal(protectedOnly.semantics.parkLayer, 'protected-only');
  assert.equal(isCanonicalOpenMapTilesSchema(protectedOnly), false);
  assert.equal(generic.semantics.parkLayer, 'mixed');

  const withoutSemantics = {
    ...generic,
    semantics: undefined,
  } as unknown as typeof generic;
  assert.throws(
    () =>
      vectorTiles({
        attribution: '© Example',
        schema: withoutSemantics,
        url: '/tiles.json',
      }),
    /semantics\.parkLayer is invalid/u,
  );
  assert.throws(
    () =>
      vectorTiles({
        attribution: '© Example',
        schema: {type: 'tileflow-world', version: 2} as never,
        url: '/tiles.json',
      }),
    /Tileflow World schema version must be 1/u,
  );
});

test('reads OpenMapTiles through World layers and fields, without the layers it lacks', () => {
  const resolved = resolveTileflowData(
    vectorTiles({attribution: '© Example', schema: openMapTiles(), url: '/tiles.json'}),
  );

  assert.equal(resolved.schema.type, 'openmaptiles');
  assert.equal(resolved.schema.version, 2);
  assert.equal(resolved.schema.nameLanguagePrefix, 'name:');
  assert.equal(resolved.schema.layers.admin, 'boundary');
  assert.equal(resolved.schema.layers.landuseOverlay, 'park');
  assert.equal(resolved.schema.layers.road, 'transportation');
  assert.equal(resolved.schema.layers.roadLabel, 'transportation_name');
  for (const layer of [
    'bathymetry',
    'canopy',
    'landcover',
    'roadOutline',
    'roadShield',
    'sidewalk',
    'tree',
  ] as const) {
    assert.equal(resolved.schema.layers[layer], undefined, layer);
  }
  assert.equal(resolved.schema.fields.link, 'ramp');
  assert.equal(resolved.schema.fields.structure, 'brunnel');
  assert.equal(resolved.schema.fields.extrude, 'hide_3d');
  assert.equal(resolved.schema.fields.canopyRank, undefined);
  assert.equal(resolved.schema.fields.icon, undefined);
  assert.equal(resolved.detail, undefined);
  // OpenMapTiles identities record their bindings and park semantics; World needs neither.
  assert.deepEqual(resolved.identity, {
    bindings: {fields: {...openMapTiles().fields}, layers: {...openMapTiles().layers}},
    kind: 'vector-tiles',
    schema: 'openmaptiles',
    schemaVersion: 2,
    semantics: {parkLayer: 'mixed'},
    sourceId: 'tileflow',
    url: '/tiles.json',
  });

  const world = resolveTileflowData(
    vectorTiles({attribution: '© Example', schema: tileflowWorldSchema(), url: '/tiles.json'}),
  );
  assert.deepEqual(world.schema.layers, {...tileflowWorldLayers});
  assert.equal(world.detail, undefined);
  assert.deepEqual(world.identity, {
    kind: 'vector-tiles',
    schema: 'tileflow-world',
    schemaVersion: 1,
    sourceId: 'tileflow',
    url: '/tiles.json',
  });
});

test('validates the layers and fields a Tileflow World TileJSON declares', () => {
  assert.deepEqual(validateTileflowWorldTilejson({vector_layers: validWorldVectorLayers()}), []);
  assert.deepEqual(validateTileflowWorldTilejson({vector_layers: []}), [
    'Tileflow World requires admin.',
    'Tileflow World requires aeroway.',
    'Tileflow World requires airport_label.',
    'Tileflow World requires building.',
    'Tileflow World requires housenum_label.',
    'Tileflow World requires landuse.',
    'Tileflow World requires landuse_overlay.',
    'Tileflow World requires natural_label.',
    'Tileflow World requires place_label.',
    'Tileflow World requires water.',
    'Tileflow World requires waterway.',
    'Tileflow World requires bathymetry.',
    'Tileflow World requires landcover.',
    'Tileflow World requires poi_label.',
    'Tileflow World requires circular_feature.',
    'Tileflow World requires sidewalk.',
    'Tileflow World requires street_furniture.',
    'Tileflow World requires road.',
    'Tileflow World requires road_label.',
    'Tileflow World requires road_shield.',
    'Tileflow World requires road_outline.',
  ]);
  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: worldVectorLayers({
        landcover: {maxzoom: 8, fields: {class: 'Number'}},
        place_label: {fields: {class: 'Number'}},
      }),
    }),
    [
      'Tileflow World requires String class on place_label.',
      'Tileflow World landcover must declare z0-z10.',
      'Tileflow World requires String class on landcover.',
    ],
  );
});

test('fails closed on malformed or duplicate Tileflow World detail layers', () => {
  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: worldVectorLayers({
        circular_feature: {maxzoom: 14, fields: {radius_m: 'String'}},
        sidewalk: {minzoom: 14, fields: {class: 'Number'}},
        street_furniture: {
          fields: {crossing: 'Boolean', direction: 'Boolean', markings: 'Boolean'},
        },
        road: {fields: {clearance_extra_px_z15: 'String'}},
      }),
    }),
    [
      'Tileflow World circular_feature must declare native z15.',
      'Tileflow World requires Number radius_m on circular_feature.',
      'Tileflow World sidewalk must declare native z15.',
      'Tileflow World requires String class on sidewalk.',
      'Tileflow World requires String crossing on street_furniture.',
      'Tileflow World requires String markings on street_furniture.',
      'Tileflow World requires Number or String direction on street_furniture.',
      'Tileflow World requires Number clearance_extra_px_z15 on road.',
    ],
  );

  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: worldVectorLayers({road_label: {fields: {shield_kind: 'Number'}}}),
    }),
    ['Tileflow World requires String shield_kind on road_label.'],
  );

  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: worldVectorLayers({
        road_shield: {minzoom: 5, fields: {shield_text_color: 'Number'}},
      }),
    }),
    [
      'Tileflow World road_shield must declare z6-z10.',
      'Tileflow World requires String shield_text_color on road_shield.',
    ],
  );

  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: worldVectorLayers({
        poi_label: {
          minzoom: 5,
          fields: {class: 'Number', filterrank: 'String', min_zoom: 'String'},
        },
      }),
    }),
    [
      'Tileflow World poi_label must declare z12-z15.',
      'Tileflow World requires String class on poi_label.',
      'Tileflow World requires Number filterrank on poi_label.',
      'Tileflow World requires Number min_zoom on poi_label.',
    ],
  );

  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: worldVectorLayers({road_outline: {minzoom: 14, fields: {class: 'Number'}}}),
    }),
    [
      'Tileflow World road_outline must declare z13-z15.',
      'Tileflow World requires String class on road_outline.',
    ],
  );

  const duplicate = validWorldVectorLayers();
  duplicate.push({...duplicate.find(({id}) => id === 'circular_feature')!});
  assert.deepEqual(validateTileflowWorldTilejson({vector_layers: duplicate}), [
    'Tileflow World requires exactly one circular_feature layer.',
  ]);
});

test('accepts World TileJSON without canopy and validates canopy when declared', () => {
  assert.deepEqual(validateTileflowWorldTilejson({vector_layers: validWorldVectorLayers()}), []);
  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: [...validWorldVectorLayers(), validCanopyVectorLayer()],
    }),
    [],
  );

  const malformed = {
    ...validCanopyVectorLayer(),
    minzoom: 15,
    fields: {clearance_px_z15: 'Number', rank: 'String'},
  };
  assert.deepEqual(
    validateTileflowWorldTilejson({vector_layers: [...validWorldVectorLayers(), malformed]}),
    [
      'Tileflow World canopy must declare z14-z15.',
      'Tileflow World requires Number rank on canopy.',
      'Tileflow World requires Number cover_pct on canopy.',
    ],
  );
  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: [...validWorldVectorLayers(), {...validCanopyVectorLayer(), maxzoom: 16}],
    }),
    ['Tileflow World canopy must declare z14-z15.'],
  );
  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: [
        ...validWorldVectorLayers(),
        validCanopyVectorLayer(),
        validCanopyVectorLayer(),
      ],
    }),
    ['Tileflow World requires exactly one canopy layer.'],
  );
});

test('validates the world and world-detail tilesets of a release apart', () => {
  assert.deepEqual(
    tileflowWorldDetailLayers.map((name) => tileflowWorldLayers[name]),
    ['building_entrance', 'transit_line', 'underground'],
  );
  assert.equal(tileflowWorldTilesetOf('transitLine'), 'world-detail');
  assert.equal(tileflowWorldTilesetOf('road'), 'world');

  const detail = [{id: 'building_entrance'}, {id: 'transit_line'}, {id: 'underground'}];
  assert.deepEqual(validateTileflowWorldTilejson({vector_layers: detail}, 'world-detail'), []);
  assert.deepEqual(
    validateTileflowWorldTilejson(
      {vector_layers: [{id: 'transit_line'}, {id: 'road'}]},
      'world-detail',
    ),
    [
      'Tileflow World requires building_entrance.',
      'Tileflow World requires underground.',
      'Tileflow World world-detail must not declare road.',
    ],
  );
  assert.deepEqual(
    validateTileflowWorldTilejson({
      vector_layers: [...validWorldVectorLayers(), {id: 'transit_line'}],
    }),
    ['Tileflow World world must not declare transit_line.'],
  );
  assert.deepEqual(resolveTileflowData(undefined, {worldDetail: 'separate'}).detail, {
    delivery: 'separate',
    sourceId: tileflowDetailSourceId,
    url: tileflowWorldDetailTileJsonUrl,
  });
});

test('a World map loads world-detail only when one of its layers draws a detail layer', () => {
  const transitLines = withRenderStack(transit(), {
    lines: renderPass({
      placement: 'above-roads',
      feature: 'transitLine',
      renderer: 'line',
      style: {color: fixed('#123456', {reason: 'Test colour.'}), width: 2},
    }),
  });
  const plain = createStyle(extendStreets({modules: {poi: disable()}}));
  const detailed = createStyle(extendStreets({modules: {poi: disable(), transit: transitLines}}));
  const compositeUrl = 'https://api.tileflow.dev/tiles/world,world-detail/tiles.json';
  const sourceIdentity = (style: typeof plain) =>
    (style.metadata as Record<string, Record<string, {url?: string}>>)['tileflow:sources']?.tileflow
      ?.url;

  // By default one source serves both tilesets; its URL names world-detail only when drawn.
  assert.deepEqual(Object.keys(plain.sources), ['tileflow']);
  assert.equal((plain.sources.tileflow as {url?: string}).url, tileflowWorldTileJsonUrl);
  assert.equal(sourceIdentity(plain), tileflowWorldTileJsonUrl);
  assert.deepEqual(Object.keys(detailed.sources), ['tileflow']);
  assert.equal((detailed.sources.tileflow as {url?: string}).url, compositeUrl);
  assert.equal(sourceIdentity(detailed), compositeUrl);
  const lines = detailed.layers.find((layer) => layer.id === 'tileflow-transit-render-lines');
  assert.equal((lines as {source?: string} | undefined)?.source, 'tileflow');
  assert.equal((lines as {'source-layer'?: string} | undefined)?.['source-layer'], 'transit_line');

  // Served apart, world-detail layers draw from their own source; World's others stay primary.
  const separate = resolveTileflowData(undefined, {worldDetail: 'separate'});
  const bind = (name: 'road' | 'transitLine', data: ResolvedTileflowData) =>
    bindSemanticLayer(
      {id: 'detail-fixture', type: 'line', source: dataSource(), 'source-layer': dataLayer(name)},
      data,
    ).map((layer) => [layer.source, layer['source-layer']]);
  assert.deepEqual(bind('transitLine', separate), [[tileflowDetailSourceId, 'transit_line']]);
  assert.deepEqual(bind('road', separate), [['tileflow', 'road']]);
  assert.deepEqual(bind('transitLine', resolveTileflowData(undefined)), [
    ['tileflow', 'transit_line'],
  ]);
});

test('OpenMapTiles splits World landuse over the layers that hold it and skips those a filter excludes', () => {
  const lower = (parkLayer: 'mixed' | 'protected-only') => {
    const data = resolveTileflowData(
      vectorTiles({
        attribution: '© Example',
        schema: openMapTiles({semantics: {parkLayer}}),
        url: '/tiles.json',
      }),
    );
    const context = {
      colors: resolveColors(),
      data: createSemanticDataView(data),
      images: {},
      typography: {font: 'Noto Sans Regular'},
    };
    return assembleTileflowLayers(compileLand(undefined, context), data);
  };
  const sourceLayers = (layers: ReturnType<typeof lower>, id: string) =>
    layers
      .filter((layer) => layer.id === id || layer.id.startsWith(`${id}~`))
      .map((layer) => [layer.id, layer['source-layer']]);
  const matches = (
    layers: ReturnType<typeof lower>,
    id: string,
    properties: Record<string, string>,
  ) =>
    featureFilter(layers.find((layer) => layer.id === id)?.filter as never).filter({zoom: 14}, {
      type: 3,
      properties,
    } as never);

  const mixed = lower('mixed');
  // Urban use reads OpenMapTiles landuse only, natural cover its landcover only.
  assert.deepEqual(sourceLayers(mixed, 'tileflow-landuse-education'), [
    ['tileflow-landuse-education', 'landuse'],
  ]);
  assert.deepEqual(sourceLayers(mixed, 'tileflow-landcover-wood'), [
    ['tileflow-landcover-wood', 'landcover'],
  ]);
  // Parks are landuse parks (theme parks), landcover parks and the ordinary parks of a mixed
  // park layer; the first copy keeps the layer's ID.
  assert.deepEqual(sourceLayers(mixed, 'tileflow-landcover-urbanPark'), [
    ['tileflow-landcover-urbanPark', 'landuse'],
    ['tileflow-landcover-urbanPark~landcover', 'landcover'],
    ['tileflow-landcover-urbanPark~park', 'park'],
  ]);
  assert.deepEqual(sourceLayers(mixed, 'tileflow-landcover-wetland'), [
    ['tileflow-landcover-wetland', 'landcover'],
  ]);
  // A World class no OpenMapTiles layer produces draws nothing.
  assert.deepEqual(sourceLayers(mixed, 'tileflow-landuse-parking'), []);

  // Each copy reads its own layer's values as World's.
  assert.equal(matches(mixed, 'tileflow-landuse-education', {class: 'school'}), true);
  assert.equal(matches(mixed, 'tileflow-landuse-education', {class: 'residential'}), false);
  assert.equal(
    matches(mixed, 'tileflow-landcover-wood', {class: 'wood', subclass: 'forest'}),
    true,
  );
  assert.equal(
    matches(mixed, 'tileflow-landcover-wood', {class: 'wetland', subclass: 'wood'}),
    false,
  );
  assert.equal(matches(mixed, 'tileflow-landcover-wetland', {class: 'wetland'}), true);
  assert.equal(matches(mixed, 'tileflow-landcover-urbanPark', {class: 'theme_park'}), true);
  assert.equal(matches(mixed, 'tileflow-landcover-urbanPark', {class: 'zoo'}), false);
  assert.equal(matches(mixed, 'tileflow-landuse-recreation', {class: 'zoo'}), true);
  assert.equal(
    matches(mixed, 'tileflow-landcover-urbanPark~landcover', {class: 'grass', subclass: 'park'}),
    true,
  );
  assert.equal(
    matches(mixed, 'tileflow-landcover-urbanPark~landcover', {
      class: 'grass',
      subclass: 'recreation_ground',
    }),
    false,
  );
  assert.equal(
    matches(mixed, 'tileflow-landcover-recreationGround~landcover', {
      class: 'grass',
      subclass: 'recreation_ground',
    }),
    true,
  );
  assert.equal(matches(mixed, 'tileflow-landcover-urbanPark~park', {class: 'park'}), true);
  assert.equal(
    matches(mixed, 'tileflow-landcover-urbanPark~park', {class: 'national_park'}),
    false,
  );
  assert.equal(matches(mixed, 'tileflow-landcover-protected', {class: 'national_park'}), true);
  assert.equal(matches(mixed, 'tileflow-landcover-protected', {class: 'park'}), false);

  // A protected-only park layer holds no ordinary parks.
  const protectedOnly = lower('protected-only');
  assert.deepEqual(sourceLayers(protectedOnly, 'tileflow-landcover-urbanPark'), [
    ['tileflow-landcover-urbanPark', 'landuse'],
    ['tileflow-landcover-urbanPark~landcover', 'landcover'],
  ]);
  assert.equal(matches(protectedOnly, 'tileflow-landcover-protected', {class: 'park'}), true);
});

test('rejects private URL credentials, invalid descriptors, and missing attribution', () => {
  assert.throws(
    () =>
      vectorTiles({
        attribution: '© Example',
        schema: openMapTiles(),
        url: 'https://user:secret@example.test/tiles.json',
      }),
    /must not contain user information/,
  );
  assert.throws(
    () => vectorTiles({attribution: ' ', schema: openMapTiles(), url: '/tiles.json'}),
    /must not be empty/,
  );
  assert.throws(
    () => vectorTiles({attribution: '© Example', schema: openMapTiles(), url: 'file:///tmp/a'}),
    /file protocol/,
  );
  assert.throws(
    () =>
      vectorTiles({
        attribution: '© Example',
        schema: openMapTiles(),
        tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
        url: 'https://example.test/tiles.json',
      }),
    /exactly one/,
  );
});

type VectorLayer = {
  fields: Record<string, string>;
  id: string;
  maxzoom: number;
  minzoom: number;
};

function validCanopyVectorLayer(): VectorLayer {
  return {
    id: 'canopy',
    minzoom: 14,
    maxzoom: 15,
    fields: {clearance_px_z15: 'Number', cover_pct: 'Number', rank: 'Number'},
  };
}

/** The valid World layers, with some changed: their zooms replaced, their fields merged. */
function worldVectorLayers(
  changes: Readonly<Record<string, Partial<VectorLayer>>> = {},
): VectorLayer[] {
  return validWorldVectorLayers().map((layer) => {
    const change = changes[layer.id];
    return change ? {...layer, ...change, fields: {...layer.fields, ...change.fields}} : layer;
  });
}

function validWorldVectorLayers(): VectorLayer[] {
  const classed = (id: string): VectorLayer => ({
    id,
    minzoom: 0,
    maxzoom: 15,
    fields: {class: 'String'},
  });
  return [
    {id: 'admin', minzoom: 0, maxzoom: 15, fields: {admin_level: 'Number'}},
    classed('aeroway'),
    classed('airport_label'),
    classed('building'),
    {id: 'housenum_label', minzoom: 15, maxzoom: 15, fields: {house_num: 'String'}},
    classed('landuse'),
    classed('landuse_overlay'),
    classed('natural_label'),
    classed('place_label'),
    classed('water'),
    classed('waterway'),
    {
      id: 'bathymetry',
      minzoom: 0,
      maxzoom: 9,
      fields: {min_depth: 'Number', sort_key: 'Number'},
    },
    {
      id: 'landcover',
      minzoom: 0,
      maxzoom: 10,
      fields: {class: 'String'},
    },
    {
      id: 'circular_feature',
      minzoom: 15,
      maxzoom: 15,
      fields: {
        circle_kind: 'String',
        class: 'String',
        inner_radius_m: 'Number',
        outer_radius_m: 'Number',
        radius_m: 'Number',
        radius_px_z15: 'Number',
      },
    },
    {
      id: 'sidewalk',
      minzoom: 15,
      maxzoom: 15,
      fields: {class: 'String', type: 'String'},
    },
    {
      id: 'street_furniture',
      minzoom: 15,
      maxzoom: 15,
      fields: {
        class: 'String',
        crossing: 'String',
        direction: 'Number',
        markings: 'String',
        type: 'String',
      },
    },
    {
      id: 'road',
      minzoom: 4,
      maxzoom: 15,
      fields: {class: 'String', clearance_extra_px_z15: 'Number'},
    },
    {
      id: 'road_label',
      minzoom: 11,
      maxzoom: 15,
      fields: {
        class: 'String',
        ref: 'String',
        reflen: 'Number',
        shield_kind: 'String',
        shield_line_length_m: 'Number',
        shield_network: 'String',
        shield_rank: 'Number',
        shield_text: 'String',
        shield_text_color: 'String',
      },
    },
    {
      id: 'road_shield',
      minzoom: 6,
      maxzoom: 10,
      fields: {
        class: 'String',
        ref: 'String',
        reflen: 'Number',
        shield_kind: 'String',
        shield_network: 'String',
        shield_rank: 'Number',
        shield_text: 'String',
        shield_text_color: 'String',
      },
    },
    {
      id: 'poi_label',
      minzoom: 12,
      maxzoom: 15,
      fields: {
        class: 'String',
        filterrank: 'Number',
        icon: 'String',
        min_zoom: 'Number',
        sizerank: 'Number',
        type: 'String',
      },
    },
    {
      id: 'road_outline',
      minzoom: 13,
      maxzoom: 15,
      fields: {
        class: 'String',
        structure: 'String',
        type: 'String',
        underground: 'Boolean',
      },
    },
  ];
}
