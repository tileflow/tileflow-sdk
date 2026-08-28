import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isCanonicalOpenMapTilesSchema,
  openMapTiles,
  resolveTileflowData,
  tileflowWorld,
  tileflowWorldGeneration,
  tileflowWorldTileJsonUrl,
  tileflowWorldV1Schema,
  validateTileflowWorldV1Tilejson,
  vectorTiles,
} from '../src';

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
  assert.equal(resolved.attribution, '© OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors');
  assert.deepEqual(resolved.identity, {
    generation: 'v1',
    kind: 'tileflow-world',
    schema: 'openmaptiles',
    schemaVersion: 1,
    worldSelection: {kind: 'current', product: 'world-v1'},
    semantics: {parkLayer: 'protected-only'},
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
    layers: {globalLandcover: 'worldcover_lowzoom', road: 'roads_v2'},
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
  assert.deepEqual(canonical.semantics, {parkLayer: 'mixed'});
  assert.equal(isCanonicalOpenMapTilesSchema(remapped), false);
  assert.equal(canonical.layers.globalLandcover, 'globallandcover');
  assert.equal(canonical.layers.businessCorridor, 'business_corridor');
  assert.equal(canonical.layers.tree, 'tree');
  assert.equal(remapped.layers.globalLandcover, 'worldcover_lowzoom');
  assert.equal(remapped.layers.road, 'roads_v2');
  assert.equal(remapped.fields.class, 'kind');
  assert.equal(remapped.fields.access, 'permission');
  assert.equal(remapped.fields.ramp, 'is_ramp');
  assert.equal(remapped.fields.surface, 'pavement');
  assert.equal(canonical.fields.bicycle, 'bicycle');
  assert.equal(canonical.fields.mtbScale, 'mtb_scale');
  assert.equal(canonical.fields.toll, 'toll');
});

test('makes park-layer semantics explicit while normalizing legacy schemas', () => {
  const world = tileflowWorldV1Schema();
  const protectedOnly = openMapTiles({semantics: {parkLayer: 'protected-only'}});
  const legacy = openMapTiles();

  assert.equal(world.semantics.parkLayer, 'protected-only');
  assert.equal(protectedOnly.semantics.parkLayer, 'protected-only');
  assert.equal(isCanonicalOpenMapTilesSchema(protectedOnly), false);
  assert.equal(legacy.semantics.parkLayer, 'mixed');

  const legacyWithoutMarker = {
    ...legacy,
    semantics: undefined,
  } as unknown as typeof legacy;
  const resolvedLegacy = resolveTileflowData(
    vectorTiles({
      attribution: '© Legacy fixture',
      schema: legacyWithoutMarker,
      url: '/legacy.json',
    }),
  );
  assert.deepEqual(resolvedLegacy.schema.semantics, {parkLayer: 'mixed'});
  assert.deepEqual(resolvedLegacy.identity.semantics, {parkLayer: 'mixed'});
});

test('preserves explicitly absent optional source-layer capabilities', () => {
  const schema = openMapTiles({
    capabilities: {businessCorridor: false, globalLandcover: false, tree: false},
  });

  assert.equal(isCanonicalOpenMapTilesSchema(schema), false);

  const resolved = resolveTileflowData(
    vectorTiles({
      attribution: '© Example',
      schema,
      url: '/tiles.json',
    }),
  );
  assert.equal(resolved.schema.layers.globalLandcover, undefined);
  assert.equal(resolved.schema.layers.businessCorridor, undefined);
  assert.equal(resolved.schema.layers.tree, undefined);
  assert.equal(resolved.identity.capabilities?.globalLandcover, false);
  assert.equal(resolved.identity.capabilities?.businessCorridor, false);
  assert.equal(resolved.identity.capabilities?.bathymetry, false);
  assert.equal(resolved.identity.capabilities?.tree, false);
});

test('defines and validates the required Tileflow World V1 surface extensions', () => {
  const generic = openMapTiles();
  const worldV1 = tileflowWorldV1Schema();

  assert.equal(generic.layers.bathymetry, undefined);
  assert.equal(generic.fields.bathymetryMinDepth, undefined);
  assert.equal(generic.fields.shieldKind, undefined);
  assert.equal(generic.fields.shieldLineLengthMeters, undefined);
  assert.equal(generic.fields.shieldNetwork, undefined);
  assert.equal(generic.fields.shieldRank, undefined);
  assert.equal(generic.fields.shieldText, undefined);
  assert.equal(generic.fields.shieldTextColor, undefined);
  assert.equal(worldV1.layers.bathymetry, 'bathymetry');
  assert.equal(worldV1.layers.circularFeature, 'circular_feature');
  assert.equal(worldV1.layers.globalLandcover, 'globallandcover');
  assert.equal(worldV1.layers.sidewalk, 'sidewalk');
  assert.equal(worldV1.layers.streetFurniture, 'street_furniture');
  assert.equal(worldV1.layers.roadShield, 'transportation_shield');
  assert.equal(worldV1.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(worldV1.fields.bathymetrySortKey, 'sort_key');
  assert.equal(worldV1.fields.importanceTier, 'importance_tier');
  assert.equal(worldV1.fields.poiCategory, 'category');
  assert.equal(worldV1.fields.poiFilterRank, 'filter_rank');
  assert.equal(worldV1.fields.poiIcon, 'icon');
  assert.equal(worldV1.fields.poiSizeRank, 'size_rank');
  assert.equal(worldV1.fields.poiType, 'type');
  assert.equal(worldV1.fields.shieldKind, 'shield_kind');
  assert.equal(worldV1.fields.shieldLineLengthMeters, 'shield_line_length_m');
  assert.equal(worldV1.fields.shieldNetwork, 'shield_network');
  assert.equal(worldV1.fields.shieldRank, 'shield_rank');
  assert.equal(worldV1.fields.shieldText, 'shield_text');
  assert.equal(worldV1.fields.shieldTextColor, 'shield_text_color');
  assert.deepEqual(
    validateTileflowWorldV1Tilejson({
      vector_layers: validWorldV1VectorLayers(),
    }),
    [],
  );
  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: []}), [
    'Tileflow World V1 requires bathymetry.',
    'Tileflow World V1 requires globallandcover.',
    'Tileflow World V1 requires circular_feature.',
    'Tileflow World V1 requires sidewalk.',
    'Tileflow World V1 requires street_furniture.',
    'Tileflow World V1 requires poi.',
    'Tileflow World V1 requires transportation.',
    'Tileflow World V1 requires transportation_name.',
    'Tileflow World V1 requires transportation_shield.',
  ]);
  assert.equal(
    tileflowWorldV1Schema({capabilities: {globalLandcover: false}}).layers.globalLandcover,
    'globallandcover',
  );
  const invalidLandcover = validWorldV1VectorLayers();
  invalidLandcover[1] = {
    id: 'globallandcover',
    minzoom: 0,
    maxzoom: 8,
    fields: {class: 'Number'},
  };
  assert.deepEqual(
    validateTileflowWorldV1Tilejson({
      vector_layers: invalidLandcover,
    }),
    [
      'Tileflow World V1 globallandcover must declare z0-z10.',
      'Tileflow World V1 requires String class on globallandcover.',
    ],
  );
});

test('fails closed on malformed or duplicate Tileflow World V1 detail capabilities', () => {
  const malformed = validWorldV1VectorLayers();
  malformed[2] = {
    ...malformed[2],
    maxzoom: 14,
    fields: {...malformed[2]!.fields, radius_m: 'String'},
  };
  malformed[3] = {
    ...malformed[3],
    minzoom: 14,
    fields: {...malformed[3]!.fields, class: 'Number'},
  };
  malformed[4] = {
    ...malformed[4],
    fields: {
      ...malformed[4]!.fields,
      crossing: 'Boolean',
      direction: 'Boolean',
      markings: 'Boolean',
    },
  };
  malformed[5] = {
    ...malformed[5],
    fields: {...malformed[5]!.fields, clearance_extra_px_z15: 'String'},
  };

  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: malformed}), [
    'Tileflow World V1 circular_feature must declare native z15.',
    'Tileflow World V1 requires Number radius_m on circular_feature.',
    'Tileflow World V1 sidewalk must declare native z15.',
    'Tileflow World V1 requires String class on sidewalk.',
    'Tileflow World V1 requires Number or String direction on street_furniture.',
    'Tileflow World V1 requires String crossing on street_furniture.',
    'Tileflow World V1 requires String markings on street_furniture.',
    'Tileflow World V1 requires Number clearance_extra_px_z15 on transportation.',
  ]);

  const malformedShields = validWorldV1VectorLayers();
  malformedShields[6] = {
    ...malformedShields[6]!,
    fields: {...malformedShields[6]!.fields, shield_kind: 'Number'},
  };
  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: malformedShields}), [
    'Tileflow World V1 requires String shield_kind on transportation_name.',
  ]);

  const malformedOverview = validWorldV1VectorLayers();
  malformedOverview[7] = {
    ...malformedOverview[7]!,
    minzoom: 5,
    fields: {...malformedOverview[7]!.fields, shield_text_color: 'Number'},
  };
  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: malformedOverview}), [
    'Tileflow World V1 transportation_shield must declare z6-z10.',
    'Tileflow World V1 requires String shield_text_color on transportation_shield.',
  ]);

  const malformedPoi = validWorldV1VectorLayers();
  malformedPoi[8] = {
    ...malformedPoi[8]!,
    minzoom: 5,
    fields: {
      ...malformedPoi[8]!.fields,
      category: 'Number',
      filter_rank: 'String',
      min_zoom: 'String',
    },
  };
  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: malformedPoi}), [
    'Tileflow World V1 poi must declare z12-z15.',
    'Tileflow World V1 requires String category on poi.',
    'Tileflow World V1 requires Number filter_rank on poi.',
    'Tileflow World V1 requires Number min_zoom on poi.',
  ]);

  const duplicate = validWorldV1VectorLayers();
  duplicate.push({...duplicate[2]!});
  assert.deepEqual(validateTileflowWorldV1Tilejson({vector_layers: duplicate}), [
    'Tileflow World V1 requires exactly one circular_feature layer.',
  ]);
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

function validWorldV1VectorLayers(): Array<{
  fields: Record<string, string>;
  id: string;
  maxzoom: number;
  minzoom: number;
}> {
  return [
    {
      id: 'bathymetry',
      minzoom: 0,
      maxzoom: 9,
      fields: {min_depth: 'Number', sort_key: 'Number'},
    },
    {
      id: 'globallandcover',
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
      fields: {class: 'String', subclass: 'String'},
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
        subclass: 'String',
      },
    },
    {
      id: 'transportation',
      minzoom: 4,
      maxzoom: 15,
      fields: {clearance_extra_px_z15: 'Number'},
    },
    {
      id: 'transportation_name',
      minzoom: 11,
      maxzoom: 15,
      fields: {
        class: 'String',
        ref: 'String',
        ref_length: 'Number',
        shield_kind: 'String',
        shield_line_length_m: 'Number',
        shield_network: 'String',
        shield_rank: 'Number',
        shield_text: 'String',
        shield_text_color: 'String',
      },
    },
    {
      id: 'transportation_shield',
      minzoom: 6,
      maxzoom: 10,
      fields: {
        class: 'String',
        ref: 'String',
        ref_length: 'Number',
        shield_kind: 'String',
        shield_network: 'String',
        shield_rank: 'Number',
        shield_text: 'String',
        shield_text_color: 'String',
      },
    },
    {
      id: 'poi',
      minzoom: 12,
      maxzoom: 15,
      fields: {
        category: 'String',
        filter_rank: 'Number',
        icon: 'String',
        min_zoom: 'Number',
        size_rank: 'Number',
        type: 'String',
      },
    },
  ];
}
