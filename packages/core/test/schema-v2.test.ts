import assert from 'node:assert/strict';
import test from 'node:test';
import {
  labels,
  parseTileflowMap,
  parseTileflowProject,
  roads,
  streets,
  validateConfig,
} from '../src';

test('accepts the canonical Streets project shape', () => {
  const project = {
    maps: {
      madrid: {
        basemap: streets(),
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
        view: {center: [-3.7038, 40.4168], pitch: 45, zoom: 15},
      },
    },
  };

  assert.deepEqual(parseTileflowProject(project), project);
  assert.deepEqual(validateConfig(project), {valid: true, messages: []});
  assert.throws(() => parseTileflowMap({basemap: streets(), view: {pitch: 86}}), /view\.pitch/);
});

test('accepts a schema-v2 remap for the optional global land-cover extension', () => {
  const map = parseTileflowMap({
    basemap: streets(),
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

test('accepts direct fixture tile templates without a TileJSON lookup', () => {
  const map = parseTileflowMap({
    basemap: streets(),
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

test('accepts the World generation identity and rejects revision selectors', () => {
  const map = parseTileflowMap({
    basemap: streets(),
    data: {type: 'tileflow-world', generation: 'v1'},
  });

  assert.deepEqual(map.data, {type: 'tileflow-world', generation: 'v1'});
  assert.throws(
    () =>
      parseTileflowMap({
        basemap: streets(),
        data: {type: 'tileflow-world', generation: 'v1', revision: 'archive_42'},
      }),
    /data/,
  );
  assert.throws(
    () => parseTileflowMap({basemap: streets(), data: {type: 'tileflow-world'}}),
    /data/,
  );
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
    const result = validateConfig({basemap: streets(), ...legacy});
    assert.equal(result.valid, false);
    assert.ok(
      result.messages.some((message) => message.path === path),
      JSON.stringify(result),
    );
  }
});

test('requires streets() and keyed modules', () => {
  assert.throws(() => parseTileflowMap({}), /basemap/);
  assert.throws(
    () => parseTileflowMap({basemap: {type: 'osm'}, modules: []}),
    /basemap\.type|modules/,
  );
  assert.throws(() => parseTileflowMap({basemap: streets(), modules: [roads()]}), /modules/);
});

test('rejects unknown semantic controls instead of ignoring them', () => {
  assert.throws(
    () =>
      parseTileflowMap({
        basemap: streets(),
        modules: {roads: {...roads(), magicWidth: 12}},
      }),
    /modules\.roads/,
  );
});

test('accepts semantic path road targets and rejects the old overlapping path target', () => {
  assert.doesNotThrow(() =>
    parseTileflowMap({
      basemap: streets(),
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
      parseTileflowMap({
        basemap: streets(),
        modules: {roads: {type: 'roads', classes: {path: {}}}},
      } as never),
    /path/,
  );

  assert.throws(
    () =>
      parseTileflowMap({
        basemap: streets(),
        modules: {roads: {...roads(), modifiers: {crossing: {widthScale: 0.5}}}},
      } as never),
    /crossing/,
  );

  assert.throws(
    () =>
      parseTileflowMap({
        basemap: streets(),
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

test('rejects unsafe and unresolved project references', () => {
  assert.throws(
    () => parseTileflowProject({maps: {madrid: {basemap: streets(), theme: 'missing'}}}),
    /maps\.madrid\.theme/,
  );
  assert.throws(
    () => parseTileflowProject(Object.create({maps: {madrid: {basemap: streets()}}})),
    /inherited properties/,
  );
});
