import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  color,
  createStyle,
  defineTheme,
  fixed,
  parseTileflowMap,
  token,
  validateTileflowMap,
} from '../src';
import {resolveColors, resolveThemeColors} from '../src/themes';
import {extendStreets, testLightTheme} from './map-fixture';

const preparedAssets = {
  icons: {
    ids: [
      'coffee',
      'crosswalk',
      'culture',
      'education',
      'food',
      'health',
      'lodging',
      'major-transit',
      'oneway',
      'services',
      'shopping',
      'sidewalk-dot',
    ],
    sprite: '/tileflow/test/streets/sprite',
  },
} as const;

const contourTerrain = {
  contours: {
    demMaxZoom: 13,
    demUrl: 'https://terrain.example.test/dem/{z}/{x}/{y}.webp?variant=swiss',
    index: {
      color: fixed('#734F2A', {reason: 'Exact contour fixture.'}),
      opacity: 0.9,
      width: 1.2,
    },
    labels: {
      color: fixed('#734F2A', {reason: 'Exact contour fixture.'}),
      haloColor: fixed('#F7F0DE', {reason: 'Exact contour fixture.'}),
      haloWidth: 1.5,
      minZoom: 11,
      opacity: 0.95,
      size: 9,
      spacing: 240,
    },
    maxZoom: 15,
    minZoom: 9,
    minor: {
      color: fixed('#91683A', {reason: 'Exact contour fixture.'}),
      opacity: 0.72,
      width: 0.55,
    },
    multiplier: 1,
    overzoom: 2,
    thresholds: {
      9: [100, 500],
      11: [50, 250],
      13: [20, 100],
      15: [10, 50],
    },
  },
  encoding: 'terrarium',
  mode: 'none',
} as const;

test('compiles contour-only terrain into one standard vector source and three ordered layers', () => {
  const style = createStyle(extendStreets({terrain: contourTerrain}), {preparedAssets});
  const source = style.sources['tileflow-contours']!;
  const tiles = source.tiles as string[];
  const protocolUrl = new URL(tiles[0]!);

  assert.equal(style.sources['tileflow-terrain'], undefined);
  assert.equal(style.terrain, undefined);
  assert.equal(source.type, 'vector');
  assert.equal(source.minzoom, 9);
  assert.equal(source.maxzoom, 15);
  assert.equal(protocolUrl.protocol, 'tileflow-contour:');
  assert.equal(protocolUrl.hostname, 'tiles');
  assert.equal(
    protocolUrl.searchParams.get('demUrl'),
    'https://terrain.example.test/dem/{z}/{x}/{y}.webp?variant=swiss',
  );
  assert.equal(protocolUrl.searchParams.get('encoding'), 'terrarium');
  assert.equal(protocolUrl.searchParams.get('demMaxzoom'), '13');
  assert.equal(protocolUrl.searchParams.get('maxzoom'), '15');
  assert.equal(protocolUrl.searchParams.get('overzoom'), '2');
  assert.equal(protocolUrl.searchParams.get('multiplier'), '1');
  assert.equal(
    protocolUrl.searchParams.get('thresholds'),
    '9:100,500;11:50,250;13:20,100;15:10,50',
  );

  const minor = style.layers.find((layer) => layer.id === 'streets-terrain-contour-minor')!;
  const index = style.layers.find((layer) => layer.id === 'streets-terrain-contour-index')!;
  const labels = style.layers.find((layer) => layer.id === 'streets-terrain-contour-labels')!;
  assert.equal(minor['source-layer'], 'contours');
  assert.equal(index['source-layer'], 'contours');
  assert.equal(labels['source-layer'], 'contours');
  assert.deepEqual(minor.filter, ['==', ['get', 'level'], 0]);
  assert.deepEqual(index.filter, ['>', ['get', 'level'], 0]);
  assert.equal((minor.paint as Record<string, unknown>)['line-color'], '#91683A');
  assert.equal((index.paint as Record<string, unknown>)['line-width'], 1.2);
  assert.equal(labels.minzoom, 11);
  assert.deepEqual((labels.layout as Record<string, unknown>)['text-font'], ['Noto Sans Regular']);
  assert.deepEqual((labels.layout as Record<string, unknown>)['text-field'], [
    'number-format',
    ['get', 'ele'],
    {'max-fraction-digits': 0},
  ]);

  const layerIds = style.layers.map((layer) => layer.id);
  assert.ok(layerIds.indexOf('streets-background') < layerIds.indexOf(String(minor.id)));
  assert.ok(layerIds.indexOf(String(labels.id)) < layerIds.indexOf('streets-water'));
  assert.deepEqual(
    validateStyleMin(style as never).map((error) => error.message),
    [],
  );
});

test('keeps raster terrain compatible while exposing bounded hillshade paint', () => {
  const style = createStyle(
    extendStreets({
      terrain: {
        encoding: 'mapbox',
        hillshade: {
          accentColor: fixed('#000000', {reason: 'Exact hillshade fixture.'}),
          exaggeration: 0.18,
          highlightColor: fixed('#F0E4CB', {reason: 'Exact hillshade fixture.'}),
          illuminationAnchor: 'viewport',
          illuminationDirection: 315,
          maxZoom: 17,
          minZoom: 5,
          shadowColor: fixed('#6A4827', {reason: 'Exact hillshade fixture.'}),
        },
        mode: 'hillshade',
        url: 'https://terrain.example.test/tiles.json',
      },
    }),
    {preparedAssets},
  );
  const layer = style.layers.find((candidate) => candidate.id === 'streets-terrain-hillshade')!;
  const paint = layer.paint as Record<string, unknown>;

  assert.equal(style.sources['tileflow-terrain']?.type, 'raster-dem');
  assert.equal(style.sources['tileflow-contours'], undefined);
  assert.equal(layer.minzoom, 5);
  assert.equal(layer.maxzoom, 17);
  assert.equal(paint['hillshade-accent-color'], '#000000');
  assert.equal(paint['hillshade-exaggeration'], 0.18);
  assert.equal(paint['hillshade-highlight-color'], '#F0E4CB');
  assert.equal(paint['hillshade-illumination-anchor'], 'viewport');
  assert.equal(paint['hillshade-illumination-direction'], 315);
  assert.equal(paint['hillshade-shadow-color'], '#6A4827');
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('dark terrain defaults derive from semantic roles and exact terrain tokens take priority', () => {
  const darkTheme = defineTheme(testLightTheme, {
    colorScheme: 'dark',
    id: 'test-terrain-dark',
    tokens: {
      color: {
        'labels.halo': '#0B1220',
        'labels.muted': '#9AA9B8',
        'labels.primary': '#E8EDF3',
        'surface.background': '#151E2D',
        'surface.building': '#202B3A',
        'surface.land': '#151E2D',
        'surface.park': '#20382B',
        'surface.water': '#10324B',
      },
    },
    version: 1,
  });
  const darkColors = resolveThemeColors(darkTheme);
  assert.deepEqual(darkColors.terrain, {
    contour: {
      halo: '#0B1220',
      index: '#E8EDF3',
      label: '#E8EDF3',
      minor: '#9AA9B8',
    },
    hillshade: {
      accent: 'rgba(11, 18, 32, 0.18)',
      highlight: 'rgba(232, 237, 243, 0.28)',
      shadow: 'rgba(11, 18, 32, 0.34)',
    },
  });
  assert.equal(Object.values(resolveColors().terrain.contour).every(Boolean), true);
  assert.equal(Object.values(resolveColors().terrain.hillshade).every(Boolean), true);

  const style = createStyle(
    extendStreets({
      defaultTheme: 'dark',
      themes: {dark: darkTheme},
      terrain: {
        contours: {
          demMaxZoom: 13,
          demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp',
          thresholds: {9: [100, 500]},
        },
        mode: 'hillshade',
        url: 'https://terrain.example.test/tiles.json',
      },
    }),
    {preparedAssets},
  );
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  const hillshade = byId.get('streets-terrain-hillshade')!;
  const minor = byId.get('streets-terrain-contour-minor')!;
  const index = byId.get('streets-terrain-contour-index')!;
  const labels = byId.get('streets-terrain-contour-labels')!;

  assert.equal(
    (hillshade.paint as Record<string, unknown>)['hillshade-accent-color'],
    darkColors.terrain.hillshade.accent,
  );
  assert.equal(
    (hillshade.paint as Record<string, unknown>)['hillshade-highlight-color'],
    darkColors.terrain.hillshade.highlight,
  );
  assert.equal(
    (hillshade.paint as Record<string, unknown>)['hillshade-shadow-color'],
    darkColors.terrain.hillshade.shadow,
  );
  assert.equal(
    (minor.paint as Record<string, unknown>)['line-color'],
    darkColors.terrain.contour.minor,
  );
  assert.equal(
    (index.paint as Record<string, unknown>)['line-color'],
    darkColors.terrain.contour.index,
  );
  assert.equal(
    (labels.paint as Record<string, unknown>)['text-color'],
    darkColors.terrain.contour.label,
  );
  assert.equal(
    (labels.paint as Record<string, unknown>)['text-halo-color'],
    darkColors.terrain.contour.halo,
  );

  const exactTheme = defineTheme(darkTheme, {
    colorScheme: 'dark',
    id: 'test-terrain-dark-exact',
    tokens: {
      color: {
        'terrain.contour.halo': '#010203',
        'terrain.contour.index': '#111213',
        'terrain.contour.label': '#212223',
        'terrain.contour.minor': '#313233',
        'terrain.hillshade.accent': '#414243',
        'terrain.hillshade.highlight': '#515253',
        'terrain.hillshade.shadow': '#616263',
      },
    },
    version: 1,
  });
  assert.deepEqual(resolveThemeColors(exactTheme).terrain, {
    contour: {halo: '#010203', index: '#111213', label: '#212223', minor: '#313233'},
    hillshade: {accent: '#414243', highlight: '#515253', shadow: '#616263'},
  });
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('resolves theme values throughout contour and hillshade appearance', () => {
  const terrainTheme = defineTheme(testLightTheme, {
    id: 'test-terrain-theme',
    version: 1,
    colorScheme: 'light',
    tokens: {
      color: {
        'terrain.contour.index': '#734F2A',
        'terrain.contour.minor': '#91683A',
        'terrain.hillshade.accent': '#102030',
      },
      number: {
        'terrain.contour.width': 0.6,
        'terrain.hillshade.direction': 305,
        'terrain.hillshade.exaggeration': 0.22,
      },
    },
  });
  const style = createStyle(
    extendStreets({
      themes: {light: terrainTheme},
      terrain: {
        contours: {
          ...contourTerrain.contours,
          index: {
            color: color.mix(
              token.color('terrain.contour.minor'),
              token.color('terrain.contour.index'),
              {
                amount: fixed(0.5, {
                  reason: 'the contour blend ratio is invariant across themes',
                }),
                space: 'oklch',
              },
            ),
            opacity: fixed(0.9, {reason: 'index contours must remain visually dominant'}),
            width: 1.2,
          },
          labels: {
            ...contourTerrain.contours.labels,
            color: token.color('terrain.contour.index'),
            font: token.font('default'),
            haloColor: fixed('#F7F0DE', {reason: 'paper halo is part of the contour grammar'}),
          },
          minor: {
            color: token.color('terrain.contour.minor'),
            opacity: 0.72,
            width: token.number('terrain.contour.width'),
          },
        },
        encoding: 'terrarium',
        hillshade: {
          accentColor: token.color('terrain.hillshade.accent'),
          exaggeration: token.number('terrain.hillshade.exaggeration'),
          highlightColor: fixed('#F0E4CB', {reason: 'fixed illuminated paper tone'}),
          illuminationDirection: token.number('terrain.hillshade.direction'),
          shadowColor: color.alpha(
            token.color('terrain.contour.index'),
            fixed(0.5, {reason: 'the contour shadow opacity is invariant across themes'}),
          ),
        },
        mode: 'hillshade',
        url: 'https://terrain.example.test/tiles.json',
      },
    }),
    {preparedAssets},
  );
  const byId = new Map(style.layers.map((layer) => [layer.id, layer]));
  const hillshade = byId.get('streets-terrain-hillshade')!;
  const minor = byId.get('streets-terrain-contour-minor')!;
  const index = byId.get('streets-terrain-contour-index')!;
  const labels = byId.get('streets-terrain-contour-labels')!;

  assert.equal((hillshade.paint as Record<string, unknown>)['hillshade-accent-color'], '#102030');
  assert.equal((hillshade.paint as Record<string, unknown>)['hillshade-exaggeration'], 0.22);
  assert.equal(
    (hillshade.paint as Record<string, unknown>)['hillshade-highlight-color'],
    '#F0E4CB',
  );
  assert.equal(
    (hillshade.paint as Record<string, unknown>)['hillshade-illumination-direction'],
    305,
  );
  assert.equal(
    (hillshade.paint as Record<string, unknown>)['hillshade-shadow-color'],
    'rgba(115, 79, 42, 0.5)',
  );
  assert.equal((minor.paint as Record<string, unknown>)['line-color'], '#91683A');
  assert.equal((minor.paint as Record<string, unknown>)['line-width'], 0.6);
  assert.equal(typeof (index.paint as Record<string, unknown>)['line-color'], 'string');
  assert.equal((index.paint as Record<string, unknown>)['line-opacity'], 0.9);
  assert.equal((labels.paint as Record<string, unknown>)['text-color'], '#734F2A');
  assert.equal((labels.paint as Record<string, unknown>)['text-halo-color'], '#F7F0DE');
  assert.deepEqual((labels.layout as Record<string, unknown>)['text-font'], ['Noto Sans Regular']);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('validates explicit safe DEM templates, thresholds, and contour bounds', () => {
  assert.deepEqual(
    parseTileflowMap(extendStreets({terrain: contourTerrain})).terrain,
    contourTerrain,
  );
  assert.equal(
    validateTileflowMap(
      extendStreets({
        terrain: {
          contours: {
            demMaxZoom: 12,
            demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp',
            maxZoom: 13,
            minZoom: 13,
            multiplier: 0.07,
            overzoom: 2,
            thresholds: {13: [0.7, 3.5]},
          },
          mode: 'none',
        },
      }),
    ).valid,
    true,
  );

  for (const contours of [
    {...contourTerrain.contours, demUrl: 'javascript:alert(1)/{z}/{x}/{y}'},
    {...contourTerrain.contours, demUrl: 'https://terrain.example.test/{z}/{x}.webp'},
    {
      ...contourTerrain.contours,
      demUrl: 'https://terrain.example.test/{z}/{z}/{x}/{y}.webp',
    },
    {
      ...contourTerrain.contours,
      demUrl: 'https://user:secret@terrain.example.test/{z}/{x}/{y}.webp',
    },
    {
      ...contourTerrain.contours,
      demUrl: 'https://terrain.example.test/{z}/{x}/{y}.webp#fragment',
    },
    {...contourTerrain.contours, demMaxZoom: 25},
    {...contourTerrain.contours, maxZoom: 14},
    {...contourTerrain.contours, minZoom: 5},
    {...contourTerrain.contours, maxZoom: undefined, minZoom: 20},
    {...contourTerrain.contours, overzoom: 9},
    {...contourTerrain.contours, overzoom: 2, thresholds: {1: [100, 500]}},
    {...contourTerrain.contours, minZoom: 12, labels: {maxZoom: 10}},
    {...contourTerrain.contours, minor: {maxZoom: 9, minZoom: 10}},
    {...contourTerrain.contours, minor: {maxZoom: 8, minZoom: 5}},
    {...contourTerrain.contours, thresholds: {}},
    {...contourTerrain.contours, thresholds: {9: [500, 100]}},
    {...contourTerrain.contours, thresholds: {9: [30, 100]}},
    {...contourTerrain.contours, thresholds: {9: [10, 50]}},
    {...contourTerrain.contours, multiplier: 2, thresholds: {15: [10, 50]}},
  ]) {
    assert.equal(
      validateTileflowMap(extendStreets({terrain: {...contourTerrain, contours} as never})).valid,
      false,
    );
  }
});
