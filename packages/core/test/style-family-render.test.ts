import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import {createTileflowStyleFamily, materializeTileflowStyleFamily} from '../src/style-family';
import {prepareTileflowStyleFamilyForRendering} from '../src/style-family-render';
import {loadTileflowRuntimeAppearance} from '../src/style-family-runtime';
import {
  createTileflowContourProtocolUrl,
  parseTileflowContourProtocolRequest,
} from '../src/terrain/contour-protocol';
import type {MapLibreStyle} from '../src/types';

function familyFixture() {
  const style = (theme: string, color: string): MapLibreStyle => ({
    version: 8,
    sprite: './icons/sprite',
    glyphs: './fonts/{fontstack}/{range}.pbf',
    sources: {world: {type: 'vector', tiles: ['./tiles/{z}/{x}/{y}.pbf']}},
    metadata: {
      'tileflow:theme': theme,
      'tileflow:vegetation': {flatLayers: ['trees']},
      'tileflow:vegetation-display': {flatLayers: [{id: 'trees', visible: true}]},
    },
    layers: [
      {
        id: 'trees',
        type: 'fill',
        source: 'world',
        'source-layer': 'trees',
        paint: {
          'fill-color': [
            'let',
            'class',
            ['get', 'class'],
            ['match', ['var', 'class'], 'park', color, '#000000'],
          ],
        },
      },
    ],
  });
  return createTileflowStyleFamily({
    day: style('day', '#00ff00'),
    night: style('night', '#003300'),
  });
}

test('renderer preparation binds feature conditions once and aligns flat vegetation references', () => {
  const wire = familyFixture();
  const original = JSON.stringify(wire);
  const family = prepareTileflowStyleFamilyForRendering(wire);
  assert.equal(prepareTileflowStyleFamilyForRendering(wire), family);
  assert.equal(prepareTileflowStyleFamilyForRendering(family), family);
  const delivered = JSON.parse(JSON.stringify(family));
  assert.equal(
    prepareTileflowStyleFamilyForRendering(delivered),
    delivered,
    'build-prepared plans need no browser replanning',
  );
  assert.equal(JSON.stringify(wire), original);
  for (const theme of family.themes) {
    const style = materializeTileflowStyleFamily(family, theme);
    assert.deepEqual(validateStyleMin(style), []);
    assert.deepEqual(
      (style.metadata!['tileflow:vegetation'] as {flatLayers: string[]}).flatLayers,
      style.layers.map((layer) => layer.id),
    );
    assert.ok(style.layers.every((layer) => !JSON.stringify(layer.paint).includes('get')));
  }
});

test('initial family assets resolve relative to their document and the controller reuses them', async () => {
  let requests = 0;
  const runtime = await loadTileflowRuntimeAppearance(
    {
      theme: 'day',
      style: 'https://example.test/day.json',
      familyUrl: 'https://example.test/maps/family.json',
    },
    {
      fetch: (async () => {
        requests++;
        return Response.json(familyFixture());
      }) as typeof fetch,
    },
  );
  assert.notEqual(typeof runtime.style, 'string');
  const style = runtime.style as MapLibreStyle;
  assert.equal(style.sprite, 'https://example.test/maps/icons/sprite');
  assert.equal(style.glyphs, 'https://example.test/maps/fonts/{fontstack}/{range}.pbf');
  assert.deepEqual((style.sources.world as {tiles: string[]}).tiles, [
    'https://example.test/maps/tiles/{z}/{x}/{y}.pbf',
  ]);
  const controller = createTileflowThemeController({
    initial: runtime,
    loadFamily: async () => assert.fail('an initial family must be reused'),
    map: {
      on() {},
      off() {},
      setStyle() {
        assert.fail('same-family change must retain geometry');
      },
      setPaintProperty() {},
    },
  });
  assert.equal(
    (
      await controller.setTheme(
        {theme: 'night', familyUrl: runtime.familyUrl, style: 'https://example.test/night.json'},
        {transition: {duration: 0}},
      )
    ).status,
    'applied',
  );
  assert.equal(requests, 1);
  controller.dispose();
});

test('family URL resolution preserves nested contour templates through outer tile substitution', async () => {
  const demUrl = 'https://terrain.example.test/{z}/{x}/{y}.webp?token=a%2Bb';
  const contourUrl = createTileflowContourProtocolUrl({
    demUrl,
    demMaxzoom: 12,
    encoding: 'terrarium',
    maxzoom: 14,
    multiplier: 1,
    overzoom: 2,
    thresholds: {8: [200, 1000], 14: [30, 300]},
  });
  for (const structural of [false, true]) {
    const day: MapLibreStyle = {
      version: 8,
      sources: {
        contours: {type: 'vector', tiles: [contourUrl]},
        world: {
          type: 'vector',
          tiles: ['./tiles/{z}/{x}/{y}.pbf?zoom={z}&literal=%7Bz%7D'],
        },
      },
      layers: [{id: 'background', type: 'background', paint: {'background-color': '#fff'}}],
    };
    const night: MapLibreStyle = {
      ...day,
      layers: [
        {
          id: structural ? 'night-background' : 'background',
          type: 'background',
          paint: {'background-color': '#000'},
        },
      ],
    };
    const runtime = await loadTileflowRuntimeAppearance(
      {theme: 'day', style: day, familyUrl: 'https://example.test/maps/family.json'},
      {fetch: (async () => Response.json(createTileflowStyleFamily({day, night}))) as typeof fetch},
    );
    const delivered = runtime.style as MapLibreStyle;
    const template = (delivered.sources.contours as {tiles: string[]}).tiles[0]!;
    assert.equal(template, contourUrl);
    const request = template
      .replaceAll('{z}', '12')
      .replaceAll('{x}', '2134')
      .replaceAll('{y}', '1456');
    assert.equal(parseTileflowContourProtocolRequest(request).config.demUrl, demUrl);
    assert.deepEqual((delivered.sources.world as {tiles: string[]}).tiles, [
      'https://example.test/maps/tiles/{z}/{x}/{y}.pbf?zoom={z}&literal=%7Bz%7D',
    ]);
  }
});

test('palette-specific RGBA artwork shares symbol layout and changes only its atlas pixels', async () => {
  const variant = (icon: string): MapLibreStyle => ({
    version: 8,
    sources: {places: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
    layers: [{id: 'poi', type: 'symbol', source: 'places', layout: {'icon-image': icon}}],
  });
  const family = prepareTileflowStyleFamilyForRendering(
    createTileflowStyleFamily({day: variant('day-icon'), night: variant('night-icon')}),
  );
  const day = materializeTileflowStyleFamily(family, 'day');
  const night = materializeTileflowStyleFamily(family, 'night');
  assert.equal(family.updates.appearanceOnly, true);
  assert.deepEqual(day.layers, night.layers);
  const pixels = new Map(
    ['day-icon', 'night-icon'].map((name, i) => [
      name,
      {data: {width: 1, height: 1, data: new Uint8Array([i * 255, 0, 0, 255])}},
    ]),
  );
  let uploads = 0;
  const controller = createTileflowThemeController({
    initial: {family, theme: 'day', style: day},
    map: {
      on() {},
      off() {},
      setStyle() {
        assert.fail('must not replace style');
      },
      setPaintProperty() {},
      getImage(name: string) {
        return pixels.get(name);
      },
      updateImage(name: string, value: {width: number; height: number; data: Uint8Array}) {
        uploads++;
        pixels.set(name, {data: value});
      },
    },
  });
  assert.equal(
    (await controller.setTheme({family, theme: 'night', style: night}, {transition: 0})).status,
    'applied',
  );
  assert.equal(pixels.get('day-icon')!.data.data[0], 255);
  assert.equal(uploads, 1);
  assert.equal(
    (await controller.setTheme({family, theme: 'day', style: day}, {transition: 0})).status,
    'applied',
  );
  assert.equal(
    pixels.get('day-icon')!.data.data[0],
    0,
    'the original atlas pixels remain reusable',
  );
  controller.dispose();
});

test('an unprepared family changes icon layout through the ordinary style path', async () => {
  const style = (icon: string): MapLibreStyle => ({
    version: 8,
    sources: {places: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
    layers: [{id: 'poi', type: 'symbol', source: 'places', layout: {'icon-image': icon}}],
  });
  const day = style('day-icon');
  const night = style('night-icon');
  const family = createTileflowStyleFamily({day, night});
  let installed: unknown;
  const controller = createTileflowThemeController({
    initial: {family, theme: 'day', style: day},
    loadFonts: async () => {},
    map: {
      on() {},
      off() {},
      isStyleLoaded: () => true,
      setStyle(value: unknown) {
        installed = value;
      },
      setPaintProperty() {},
    },
  });
  assert.equal(
    (await controller.setTheme({family, theme: 'night', style: night}, {transition: 0})).status,
    'applied',
  );
  assert.equal(installed, night);
  controller.dispose();
});
