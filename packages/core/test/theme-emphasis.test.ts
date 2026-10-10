import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowThemeController} from '../src/browser';
import {createStyle} from '../src/index';
import {tileflowLayerDomainMetadataKey} from '../src/layer-domain';
import type {TileflowRuntimeStyle} from '../src/runtime';
import {mixTileflowColours} from '../src/theme-blend';
import {
  emphasizeTileflowValue,
  planTileflowEmphasis,
  tileflowEmphasisGround,
  type TileflowEmphasisTarget,
  validateTileflowEmphasis,
} from '../src/theme-emphasis';
import type {MapLibreStyle} from '../src/types';
import {extendStreets, testLightTheme} from './map-fixture';

type Listener = (event?: unknown) => void;

/** A MapLibre-shaped map that records paint writes and answers for its current paint values. */
class FakeMap {
  readonly paints: [string, string, unknown][] = [];
  readonly styles: unknown[] = [];
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private layerIds = new Set<string>();

  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  setStyle(style: MapLibreStyle) {
    this.styles.push(style);
    this.show(style);
    queueMicrotask(() => {
      for (const listener of [...(this.listeners.get('style.load') ?? [])]) listener();
    });
  }
  show(style: MapLibreStyle) {
    this.values.clear();
    this.layerIds = new Set(style.layers.map((layer) => layer.id));
    for (const layer of style.layers)
      for (const [name, value] of Object.entries(layer.paint ?? {}))
        this.values.set(`${layer.id}.${name}`, value);
  }
  getLayer(id: string) {
    return this.layerIds.has(id) ? {id} : undefined;
  }
  setPaintProperty(layer: string, name: string, value: unknown) {
    this.paints.push([layer, name, value]);
    this.values.set(`${layer}.${name}`, value);
  }
  setLayoutProperty() {}
  getImage() {
    return null;
  }
  updateImage() {}
  value(layer: string, name: string) {
    return this.values.get(`${layer}.${name}`);
  }
}

const domain = (name: string) => ({metadata: {[tileflowLayerDomainMetadataKey]: name}});

function fixture(groundColour: string, roadColour: string): MapLibreStyle {
  return {
    glyphs: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
    layers: [
      {
        id: 'ground',
        paint: {'background-color': groundColour},
        type: 'background',
        ...domain('land'),
      },
      {
        id: 'water',
        paint: {'fill-color': '#1060a0'},
        source: 'world',
        'source-layer': 'water',
        type: 'fill',
        ...domain('water'),
      },
      {
        id: 'road',
        paint: {'line-color': ['interpolate', ['linear'], ['zoom'], 12, roadColour, 16, '#ffffff']},
        source: 'world',
        'source-layer': 'transportation',
        type: 'line',
        ...domain('roads'),
      },
      {
        id: 'road-class',
        paint: {'line-color': ['match', ['get', 'class'], 'primary', '#ffcc00', '#888888']},
        source: 'world',
        'source-layer': 'transportation',
        type: 'line',
        ...domain('roads'),
      },
      {
        id: 'sidewalk-texture',
        paint: {'fill-opacity': 0.6, 'fill-pattern': 'dots'},
        source: 'world',
        'source-layer': 'transportation',
        type: 'fill',
        ...domain('roads'),
      },
      {
        id: 'names',
        layout: {'text-field': ['get', 'name']},
        paint: {'text-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 1]},
        source: 'world',
        'source-layer': 'place',
        type: 'symbol',
        ...domain('labels'),
      },
      {
        id: 'app-route',
        paint: {'line-color': '#ff00aa'},
        source: 'world',
        'source-layer': 'transportation',
        type: 'line',
      },
    ],
    name: 'emphasis fixture',
    sources: {world: {type: 'vector', url: 'https://fixtures.tileflow.test/world.json'}},
    version: 8,
  };
}

const night = fixture('#000000', '#404040');
const day = fixture('#ffffff', '#c0c0c0');
const theme = (name: string, style: MapLibreStyle): TileflowRuntimeStyle => ({
  fontFaces: [],
  style,
  theme: name,
});
const focus = {labels: 0.5, recede: {roads: 0.5}} as const;
const area = {
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
  type: 'Polygon',
} as const;

function controllerFor(map: FakeMap, initial = theme('night', night)) {
  map.show(initial.style as MapLibreStyle);
  return createTileflowThemeController({
    initial,
    loadFonts: () => Promise.resolve(),
    map,
  });
}

test('every layer a module compiles names its module', () => {
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
  const style = createStyle(extendStreets({themes: {light: testLightTheme}}), {
    preparedAssets,
    theme: 'light',
  });
  const domains = new Map<string, number>();
  for (const layer of style.layers) {
    const name = (layer.metadata as Record<string, unknown> | undefined)?.[
      tileflowLayerDomainMetadataKey
    ];
    assert.equal(typeof name, 'string', `${layer.id} names its module`);
    domains.set(name as string, (domains.get(name as string) ?? 0) + 1);
  }
  for (const module of ['roads', 'water', 'labels']) assert.ok(domains.has(module), module);
  assert.deepEqual(validateStyleMin(style as never), []);
});

test('plans the colours, patterns, and labels an emphasis changes, never an application layer', () => {
  const targets = planTileflowEmphasis(night.layers, {...focus, keep: area});
  const key = (target: TileflowEmphasisTarget) =>
    `${target.layer}.${target.property}:${target.kind}:${target.amount}:${target.featureData}`;
  assert.deepEqual(targets.map(key), [
    'road.line-color:colour:0.5:false',
    'road-class.line-color:colour:0.5:true',
    'sidewalk-texture.fill-opacity:fade:0.5:false',
    'names.text-opacity:label:0.5:true',
    'names.icon-opacity:label:0.5:true',
  ]);
  assert.equal(tileflowEmphasisGround(night.layers), '#000000');
});

test('recedes colour literals towards the ground and keeps zoom curves at the top', () => {
  const [road] = planTileflowEmphasis(night.layers, {recede: {roads: 0.5}});
  const value = night.layers[2]!.paint!['line-color'];
  assert.equal(emphasizeTileflowValue(road!, value, {ground: '#000000', strength: 0}), value);
  const receded = emphasizeTileflowValue(road!, value, {ground: '#000000', strength: 1});
  assert.deepEqual(receded, [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    mixTileflowColours('#404040', '#000000', 0.5),
    16,
    mixTileflowColours('#ffffff', '#000000', 0.5),
  ]);
  // Half strength recedes half as far.
  const half = emphasizeTileflowValue(road!, '#ffffff', {ground: '#000000', strength: 0.5});
  assert.equal(half, mixTileflowColours('#ffffff', '#000000', 0.25));
});

test('fades labels except inside the keep area, inside each zoom stop', () => {
  const targets = planTileflowEmphasis(night.layers, {keep: area, labels: 0.5});
  const label = targets.find((target) => target.property === 'text-opacity')!;
  const value = night.layers[5]!.paint!['text-opacity'];
  const kept = emphasizeTileflowValue(label, value, {keep: area, strength: 1});
  assert.deepEqual(kept, [
    'interpolate',
    ['linear'],
    ['zoom'],
    13,
    ['case', ['within', area], 0, 0],
    14,
    ['case', ['within', area], 1, 0.5],
  ]);
  const icon = targets.find((target) => target.property === 'icon-opacity')!;
  assert.equal(emphasizeTileflowValue(icon, undefined, {strength: 1}), 0.5);
});

test('rejects malformed emphasis requests', () => {
  assert.equal(validateTileflowEmphasis(focus), undefined);
  assert.match(String(validateTileflowEmphasis({labels: 2})), /labels share/u);
  assert.match(String(validateTileflowEmphasis({recede: {roads: -1}})), /recede amount/u);
  assert.match(String(validateTileflowEmphasis({glow: 1})), /no "glow" option/u);
  assert.match(
    String(validateTileflowEmphasis({keep: {type: 'Point', coordinates: [0, 0]}})),
    /Polygon/u,
  );
});

test('the controller writes an emphasis and returns the map to its design', async () => {
  const map = new FakeMap();
  const controller = controllerFor(map);
  const shown = await controller.setEmphasis(focus);
  assert.equal(shown.status, 'applied');
  assert.deepEqual(controller.getEmphasis(), focus);
  assert.equal(map.value('water', 'fill-color'), '#1060a0', 'water does not recede');
  assert.equal(map.value('app-route', 'line-color'), '#ff00aa', 'application layers stay');
  assert.equal(map.value('road-class', 'line-color')?.toString().includes('rgba'), true);
  assert.deepEqual(map.value('sidewalk-texture', 'fill-opacity'), 0.3);
  assert.deepEqual(map.value('names', 'icon-opacity'), 0.5);

  await controller.setEmphasis(undefined);
  assert.equal(controller.getEmphasis(), undefined);
  for (const layer of night.layers)
    for (const [name, value] of Object.entries(layer.paint ?? {}))
      assert.deepEqual(map.value(layer.id, name), value, `${layer.id} ${name} as designed`);
});

test('an emphasis stays through theme changes', async () => {
  const map = new FakeMap();
  const controller = controllerFor(map);
  await controller.setEmphasis({recede: {roads: 1}});
  assert.equal(map.value('road-class', 'line-color')?.toString().includes('0, 0, 0'), true);
  await controller.setTheme(theme('day', day));
  // Receding all the way shows the new ground colour.
  assert.deepEqual(map.value('road-class', 'line-color'), [
    'match',
    ['get', 'class'],
    'primary',
    mixTileflowColours('#ffcc00', '#ffffff', 1),
    mixTileflowColours('#888888', '#ffffff', 1),
  ]);
});

test('an emphasis follows a blend: receded colours move with the blended ground', async () => {
  const map = new FakeMap();
  const controller = controllerFor(map);
  const themes = [theme('night', night), theme('day', day)];
  await controller.setBlend({position: 0, themes});
  await controller.setEmphasis({recede: {roads: 1}});
  const atNight = map.value('road', 'line-color');
  assert.deepEqual(atNight, [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    mixTileflowColours('#404040', '#000000', 1),
    16,
    mixTileflowColours('#ffffff', '#000000', 1),
  ]);
  await controller.setBlend({position: 1, themes});
  assert.deepEqual(map.value('road', 'line-color'), [
    'interpolate',
    ['linear'],
    ['zoom'],
    12,
    mixTileflowColours(mixTileflowColours('#404040', '#c0c0c0', 1)!, '#ffffff', 1),
    16,
    mixTileflowColours('#ffffff', '#ffffff', 1),
  ]);
  // The water, which does not recede, still follows the blend unchanged.
  assert.equal(map.value('water', 'fill-color'), '#1060a0');
});
