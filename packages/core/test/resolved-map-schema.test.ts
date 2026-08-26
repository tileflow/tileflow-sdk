import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labels,
  land,
  parseTileflowMap as parseMap,
  poi,
  roads,
  tileflowWorldV1Schema,
  validateTileflowMap,
  vegetation,
  water,
  zoom,
} from '../src';
import {extendStreets} from './map-fixture';

function parseDesign(input: unknown) {
  return parseMap(extendStreets(input as Parameters<typeof extendStreets>[0]));
}

function validateDesign(input: unknown) {
  return validateTileflowMap(extendStreets(input as Parameters<typeof extendStreets>[0]));
}

test('requires exact bounded portable identity and falls back from name to id', () => {
  const normalized = parseMap(extendStreets({id: 'madrid', name: '  Madrid Map  '}));
  assert.equal(normalized.id, 'madrid');
  assert.equal(normalized.name, 'Madrid Map');

  const fallback = parseMap(extendStreets({id: 'unnamed'}));
  assert.equal(fallback.name, 'unnamed');
  assert.equal(parseMap(extendStreets({id: 'a'.repeat(64)})).id, 'a'.repeat(64));

  for (const id of [
    'a'.repeat(65),
    'Main',
    'con',
    'constructor',
    '__proto__',
    'not_portable',
    'not portable',
    '  madrid  ',
  ]) {
    assert.throws(() => parseMap(extendStreets({id})), /map id/i);
  }
});

test('accepts the canonical singular map design and validates bounded controls', () => {
  const design = {
    projection: 'globe' as const,
    theme: {
      colors: {},
      mode: 'light' as const,
      modules: {
        landcover: {farmland: '#DCECCB', rock: '#F7F4F0', wetland: '#BFE2CF'},
      },
    },
    modules: {
      labels: labels({
        styles: {
          places: {
            city: {
              priority: 80,
              text: {
                keepUpright: true,
                maxAngle: 40,
                radialOffset: 1,
                variableAnchors: ['top', 'bottom'],
              },
            },
          },
        },
      }),
      roads: roads({hierarchy: 'strong'}),
    },
    view: {center: [-3.7038, 40.4168] as [number, number], pitch: 45, zoom: 15},
  };
  assert.deepEqual(parseDesign(design).theme, design.theme);
  assert.equal(validateTileflowMap(extendStreets({...design, theme: {mode: 'dark'}})).valid, true);
  assert.throws(() => parseDesign({view: {pitch: 86}}), /view\.pitch/);
  assert.throws(() => parseDesign({projection: 'sphere'} as never), /projection/);
  assert.throws(() => parseDesign({light: {intensity: 1.1}}), /light\.intensity/);
});

test('accepts ordered icon-directory arrays and rejects provider objects or bare paths', () => {
  const canonicalDirectories = [
    './base',
    './nested/icons',
    '../shared',
    '../../shared/icons',
    `./${'a'.repeat(510)}`,
  ];
  assert.deepEqual(parseDesign({icons: canonicalDirectories}).icons, canonicalDirectories);
  assert.deepEqual(parseDesign({icons: []}).icons, []);

  for (const icons of [
    {source: './icons'},
    {builtin: 'streets'},
    './icons',
    ['icons'],
    ['./'],
    ['../'],
    ['./icons/'],
    ['./icons//nested'],
    ['././icons'],
    ['./icons/../other'],
    ['../shared/../other'],
    ['./icons\\nested'],
    ['./icons\0nested'],
    [`./${'a'.repeat(511)}`],
  ]) {
    assert.throws(() => parseDesign({icons} as never), /icons|array|directory/i);
  }
});

test('validates leaf-owned Hosted delivery without a plural project wrapper', () => {
  assert.equal(
    validateDesign({
      delivery: {
        hosted: {allowedOrigins: ['https://maps.example.test', 'http://localhost:3000']},
      },
    }).valid,
    true,
  );
  assert.equal(
    validateDesign({delivery: {hosted: {allowedOrigins: ['not an origin']}}}).valid,
    false,
  );
  for (const origin of [
    ' https://maps.example.test',
    'https://maps.example.test/',
    'https://maps.example.test/path',
    'https://user@maps.example.test',
  ]) {
    assert.equal(validateDesign({delivery: {hosted: {allowedOrigins: [origin]}}}).valid, false);
  }
  assert.equal(validateDesign({allowedOrigins: ['https://maps.example.test']}).valid, false);
});

test('rejects glyph URL fragments for absolute and relative providers', () => {
  for (const url of [
    '/fonts/{fontstack}/{range}.pbf#fragment',
    './fonts/{fontstack}/{range}.pbf#fragment',
    '../fonts/{fontstack}/{range}.pbf#fragment',
    'https://fonts.example.test/{fontstack}/{range}.pbf#fragment',
  ]) {
    assert.equal(
      validateDesign({
        glyphs: {kind: 'url', url, fontStacks: ['Noto Sans Regular']},
      }).valid,
      false,
      url,
    );
  }
});

test('requires exact unique NFC font faces', () => {
  assert.equal(
    validateDesign({
      theme: {
        typography: {
          font: 'Noto Sans Regular',
          fallbacks: ['Arial Unicode MS', 'sans-serif'],
        },
      },
    }).valid,
    true,
  );
  for (const typography of [
    {font: ' Noto Sans Regular'},
    {font: 'Noto Sans\\Regular'},
    {font: 'Cafe\u0301'},
    {fallbacks: ['sans-serif', 'sans-serif']},
  ]) {
    assert.equal(validateDesign({theme: {typography}}).valid, false);
  }
});

test('accepts a resolved-map remap for the optional global land-cover extension', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Example',
      schema: {
        type: 'openmaptiles',
        contractVersion: 1,
        layers: {globalLandcover: 'worldcover_lowzoom'},
      },
      url: '/tiles.json',
    },
  });

  assert.equal(map.data?.type, 'vector-tiles');
  if (map.data?.type !== 'vector-tiles') return;
  assert.equal(map.data.schema.layers.globalLandcover, 'worldcover_lowzoom');
  assert.equal(map.data.schema.layers.landcover, 'landcover');
});

test('accepts the typed Tileflow World V1 bathymetry extension at runtime', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Example',
      schema: tileflowWorldV1Schema(),
      url: '/tiles.json',
    },
  });

  assert.equal(map.data?.type, 'vector-tiles');
  if (map.data?.type !== 'vector-tiles') return;
  assert.equal(map.data.schema.layers.bathymetry, 'bathymetry');
  assert.equal(map.data.schema.fields.bathymetryMinDepth, 'min_depth');
  assert.equal(map.data.schema.fields.bathymetrySortKey, 'sort_key');
});

test('accepts detailed cartographic module styles and their optional data bindings', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Example',
      schema: tileflowWorldV1Schema({
        fields: {
          circularInnerRadiusMeters: 'inner_radius_m',
          circularKind: 'circle_kind',
          circularOuterRadiusMeters: 'outer_radius_m',
          circularRadiusAtZoom15: 'radius_px_z15',
          circularRadiusMeters: 'radius_m',
          direction: 'direction',
          importanceTier: 'importance_tier',
        },
        layers: {
          circularFeature: 'circular_feature',
          sidewalk: 'sidewalk',
          streetFurniture: 'street_furniture',
        },
      }),
      url: '/tiles.json',
    },
    modules: {
      land: land({globalLandcover: {color: '#123456'}}),
      roads: roads({
        crossings: {image: 'crosswalk'},
        roundabouts: {fill: {strokeColor: '#234567'}},
        sidewalks: {pattern: {pattern: 'sidewalk-dot'}},
      }),
      vegetation: vegetation({
        flat: {color: '#345678'},
        mode: '3d',
        threeDimensional: {
          barkColor: '#456789',
          broadleafColors: ['#56789A'],
          coniferColors: ['#6789AB'],
          crownScale: 1.2,
          heightScale: 1.4,
        },
      }),
      water: water({bathymetry: {color: '#789ABC'}}),
    },
  });

  assert.equal(map.modules?.land?.globalLandcover?.color, '#123456');
  assert.equal(map.modules?.roads?.crossings?.image, 'crosswalk');
  assert.equal(map.modules?.vegetation?.threeDimensional?.heightScale, 1.4);
  assert.equal(map.modules?.water?.bathymetry?.color, '#789ABC');
  if (map.data?.type !== 'vector-tiles') return;
  assert.equal(map.data.schema.layers.circularFeature, 'circular_feature');
  assert.equal(map.data.schema.fields.direction, 'direction');

  assert.throws(
    () =>
      parseDesign({
        modules: {vegetation: vegetation({threeDimensional: {heightScale: 11}})},
      }),
    /heightScale/,
  );
});

test('accepts bounded progressive POI rank ceilings and rejects invalid stops', () => {
  const progressiveRank = zoom.step([
    [14, 14],
    [17, 80],
    [19, 500],
  ]);
  const map = parseDesign({
    modules: {
      poi: poi({
        maxRank: progressiveRank,
        styles: {
          culture: {
            maxRank: zoom.step([
              [15, 20],
              [18, 120],
            ]),
          },
        },
      }),
    },
  });

  assert.deepEqual(map.modules?.poi?.maxRank, progressiveRank);
  assert.deepEqual(
    map.modules?.poi?.styles?.culture?.maxRank,
    zoom.step([
      [15, 20],
      [18, 120],
    ]),
  );

  for (const valid of [
    zoom.linear([
      [14, 14],
      [18, 80],
    ]),
    zoom.exponential(1.5, [
      [14, 14],
      [18, 80],
    ]),
  ]) {
    assert.deepEqual(
      parseDesign({modules: {poi: poi({maxRank: valid})}}).modules?.poi?.maxRank,
      valid,
    );
  }

  for (const invalid of [
    {kind: 'zoom', interpolation: 'step', stops: [[15, 0]]},
    {kind: 'zoom', interpolation: 'step', stops: [[15, 14]]},
    {
      kind: 'zoom',
      interpolation: 'step',
      stops: [
        [15, 14],
        [15, 80],
      ],
    },
    {
      kind: 'zoom',
      interpolation: 'step',
      stops: [
        [16, 14],
        [15, 80],
      ],
    },
    {
      kind: 'zoom',
      interpolation: 'step',
      stops: [
        [15, 80],
        [17, 14],
      ],
    },
    {
      kind: 'zoom',
      interpolation: 'exponential',
      stops: [
        [15, 14],
        [17, 80],
      ],
    },
    {
      kind: 'zoom',
      interpolation: 'linear',
      base: 1.5,
      stops: [
        [15, 14],
        [17, 80],
      ],
    },
  ]) {
    assert.throws(() => parseDesign({modules: {poi: {type: 'poi', maxRank: invalid}}}), /maxRank/);
  }
});

test('accepts direct fixture tile templates without a TileJSON lookup', () => {
  const map = parseDesign({
    data: {
      type: 'vector-tiles',
      attribution: '© Fixture',
      revision: 'fixture_1',
      schema: {type: 'openmaptiles', contractVersion: 1},
      tiles: ['pmtiles://./test/fixtures/world.pmtiles'],
      minzoom: 0,
      maxzoom: 14,
      bounds: [-180, -85, 180, 85],
    },
  });

  assert.equal(map.data?.type, 'vector-tiles');
  if (map.data?.type !== 'vector-tiles') return;
  assert.deepEqual(map.data.tiles, ['pmtiles://./test/fixtures/world.pmtiles']);
  assert.equal(map.data.url, undefined);
});

test('rejects unsafe vector URLs at the resolved-map validation boundary', () => {
  for (const data of [
    {
      type: 'vector-tiles',
      attribution: '© Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      url: 'http://tiles.example.test/tiles.json',
    },
    {
      type: 'vector-tiles',
      attribution: '© Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      tiles: ['javascript:alert(1)'],
    },
    {
      type: 'vector-tiles',
      attribution: '© Fixture',
      schema: {type: 'openmaptiles', contractVersion: 1},
      url: 'pmtiles://./../private/world.pmtiles',
    },
  ]) {
    assert.throws(() => parseDesign({data}), /vector tile URL|PMTiles/u);
  }
});

test('accepts current and exact World selectors and rejects incomplete identity', () => {
  const map = parseDesign({
    data: {
      type: 'tileflow-world',
      generation: 'v1',
      selection: {kind: 'current', product: 'world-v1'},
    },
  });

  assert.deepEqual(map.data, {
    type: 'tileflow-world',
    generation: 'v1',
    selection: {kind: 'current', product: 'world-v1'},
  });
  const exact = {
    kind: 'release' as const,
    product: 'world-v1' as const,
    release: {
      descriptorSha256: 'a'.repeat(64),
      releaseId: 'world-v1-archive-42',
    },
  };
  assert.deepEqual(
    parseDesign({
      data: {type: 'tileflow-world', generation: 'v1', selection: exact},
    }).data,
    {type: 'tileflow-world', generation: 'v1', selection: exact},
  );
  assert.throws(() =>
    parseDesign({
      data: {
        type: 'tileflow-world',
        generation: 'v1',
        selection: {
          kind: 'release',
          product: 'world-v1',
          release: {releaseId: 'world-v1-archive-42'},
        },
      },
    }),
  );
  assert.throws(() => parseDesign({data: {type: 'tileflow-world'}}), /data/);
});

test('rejects every removed renderer and data path with its exact location', () => {
  const removed = [
    [{renderer: 'generated'}, 'renderer'],
    [{tileset: 'world'}, 'tileset'],
    [{tiles: ['https://tiles.example/{z}/{x}/{y}.pbf']}, 'tiles'],
    [{colors: {water: '#fff'}}, 'colors'],
    [{roads: 'standard'}, 'roads'],
  ] as const;

  for (const [legacy, path] of removed) {
    const result = validateDesign({...legacy});
    assert.equal(result.valid, false);
    assert.match(result.messages[0]?.message ?? '', new RegExp(`\\b${path}\\b`));
  }
});

test('rejects legacy roots and requires keyed modules', () => {
  assert.throws(
    () => parseDesign({basemap: {type: 'osm'}, modules: []}),
    /unrecognized key "basemap"|modules/,
  );
  assert.throws(() => parseDesign({modules: [roads()]}), /modules/);
});

test('rejects unknown semantic controls instead of ignoring them', () => {
  assert.throws(
    () =>
      parseDesign({
        modules: {roads: {...roads(), magicWidth: 12}},
      }),
    /modules\.roads/,
  );
});

test('accepts semantic path road targets and rejects the old overlapping path target', () => {
  assert.doesNotThrow(() =>
    parseDesign({
      modules: {
        labels: labels({roadClasses: ['pedestrian', 'footway', 'cycleway', 'steps', 'pathway']}),
        roads: roads({
          areas: {
            pedestrian: {
              fill: {color: '#F1F3F5'},
              outline: {color: '#D5DCE3', width: 1},
            },
          },
          classes: {pedestrian: {}, footway: {}, cycleway: {}, steps: {}, pathway: {}},
          structures: {
            tunnel: {
              hatch: {
                angle: 4,
                color: '#8EA3B8',
                minZoom: 15,
                opacity: 0.25,
                size: 12,
                spacing: 10,
              },
            },
          },
          modifiers: {
            construction: {surface: {fill: {dash: [2, 1], opacity: 0.7}}},
            expressway: {widthScale: 1.1},
            indoor: {surface: {fill: {opacity: 0.4}}},
            official: {surface: {casing: {color: '#445566'}}},
            ramp: {widthScale: 0.7},
            unpaved: {surface: {fill: {color: '#E9E4DA'}}},
          },
          mountainBike: {'0': {surface: {fill: {color: '#55AA66'}}}},
          restrictions: {
            access: {surface: {fill: {opacity: 0.5}}},
            toll: {surface: {fill: {dash: [3, 1]}}},
          },
          serviceTypes: {driveway: {widthScale: 0.75}, parkingAisle: {widthScale: 0.6}},
        }),
      },
    }),
  );

  assert.throws(
    () =>
      parseDesign({
        modules: {roads: {type: 'roads', classes: {path: {}}}},
      } as never),
    /path/,
  );

  assert.throws(
    () =>
      parseDesign({
        modules: {roads: {...roads(), modifiers: {crossing: {widthScale: 0.5}}}},
      } as never),
    /crossing/,
  );

  assert.throws(
    () =>
      parseDesign({
        modules: {
          water: {
            type: 'water',
            waterways: {river: {filter: {kind: 'filter', value: []}}},
          },
        },
      } as never),
    /filter/,
  );
});

test('rejects unsafe authoring objects and unresolved map references', () => {
  assert.throws(() => parseDesign({theme: 'missing'}), /theme.*Expected object/i);
  assert.throws(() => parseDesign({theme: {extends: 'dark'}}), /theme\.extends.*Unrecognized key/i);
  assert.throws(
    () => parseMap(Object.create({id: 'madrid', version: 1, extends: extendStreets()})),
    /map object/,
  );
});
