import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, defineMap, defineTheme, disable, resolveTileflowTheme} from '../src';
import {createTileflowThemeController} from '../src/browser';
import type {TileflowRuntimeStyle} from '../src/runtime';
import {
  mixTileflowAzimuths,
  mixTileflowSunPresets,
  readTileflowSunPreset,
  resolveTileflowSun,
  tileflowDefaultSunPreset,
  tileflowStyleSunPreset,
  tileflowSunDirection,
  tileflowSunLight,
  tileflowSunMetadataKey,
  tileflowSunPosition,
  type TileflowSunPreset,
  tileflowSunPresetAt,
} from '../src/sun';
import type {MapLibreStyle} from '../src/types';
import {testLightTheme} from './map-fixture';

const near = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message ?? ''} expected ${expected} ± ${tolerance}, got ${actual}`,
  );

test('the sun stands where published references put it', () => {
  // SunCalc's reference position (azimuth from south, westward; altitude), in radians.
  const position = tileflowSunPosition(Date.UTC(2013, 2, 5), [30.5, 50.5]);
  near(position.azimuth, (-2.5003175907168385 * 180) / Math.PI + 180, 0.3, 'azimuth');
  near(position.altitude, (-0.7000406838781611 * 180) / Math.PI, 0.3, 'altitude');
});

test('the noon sun follows the seasons', () => {
  const highest = (day: number, location: readonly [number, number]) => {
    let best = {altitude: -90, azimuth: 0};
    for (let minute = 0; minute < 1440; minute += 1) {
      const sun = tileflowSunPosition(day + minute * 60_000, location);
      if (sun.altitude > best.altitude) best = sun;
    }
    return best;
  };
  // At the June solstice the noon sun stands over the Tropic of Cancer and 90° − |φ − 23.44°|
  // above Miami, in the south.
  const tropic = highest(Date.UTC(2026, 5, 21), [-80, 23.44]);
  near(tropic.altitude, 90, 0.2, 'over the tropic');
  const miami = highest(Date.UTC(2026, 5, 21), [-80.19, 25.77]);
  near(miami.altitude, 90 - (25.77 - 23.44), 0.2, 'over Miami');
  // At the March equinox the noon sun stands 90° − φ high, due south.
  const madrid = highest(Date.UTC(2026, 2, 20), [-3.7, 40.42]);
  near(madrid.altitude, 90 - 40.42, 0.5, 'over Madrid');
  near(madrid.azimuth, 180, 0.5, 'due south');
  // In the southern summer the noon sun stands north of Sydney.
  const sydney = highest(Date.UTC(2026, 11, 21), [151.2, -33.87]);
  near(sydney.altitude, 90 - (33.87 - 23.44), 0.3, 'over Sydney');
  assert.ok(sydney.azimuth > 270 || sydney.azimuth < 90, 'north of Sydney');
});

test('the sun rises in the east and sets in the west at the equinox', () => {
  const day = Date.UTC(2026, 2, 20);
  let rising: {azimuth: number; altitude: number} | undefined;
  let setting: {azimuth: number; altitude: number} | undefined;
  let previous = tileflowSunPosition(day, [0, 0]);
  for (let minute = 1; minute < 1440; minute += 1) {
    const sun = tileflowSunPosition(day + minute * 60_000, [0, 0]);
    if (previous.altitude < 0 && sun.altitude >= 0) rising = sun;
    if (previous.altitude >= 0 && sun.altitude < 0) setting = sun;
    previous = sun;
  }
  near(rising!.azimuth, 90, 1, 'sunrise');
  near(setting!.azimuth, 270, 1, 'sunset');
});

test('a sun position needs a valid date and place', () => {
  assert.throws(() => tileflowSunPosition(Number.NaN, [0, 0]), /valid date/u);
  assert.throws(() => tileflowSunPosition(0, [0, 91]), /latitude/u);
  assert.throws(() => tileflowSunPosition(new Date('nope'), [0, 0]), /valid date/u);
});

test('directions point east, north and up', () => {
  const [eastX, eastY, eastZ] = tileflowSunDirection(90, 0);
  near(eastX, 1, 1e-9);
  near(eastY, 0, 1e-9);
  near(eastZ, 0, 1e-9);
  const [, northY] = tileflowSunDirection(0, 0);
  near(northY, 1, 1e-9);
  const [, , up] = tileflowSunDirection(123, 90);
  near(up, 1, 1e-9);
});

test('a sun below the horizon lights nothing, and brightness follows the light', () => {
  const day = resolveTileflowSun(tileflowDefaultSunPreset);
  assert.equal(day.intensity, tileflowDefaultSunPreset.intensity);
  assert.equal(day.source, 'theme');
  assert.deepEqual(day.rgb, [1, 1, 1]);
  const set = resolveTileflowSun(tileflowDefaultSunPreset, {azimuth: 270, altitude: -4}, 'date');
  assert.equal(set.intensity, 0);
  assert.equal(set.source, 'date');
  assert.ok(set.brightness < day.brightness);
  const dark = resolveTileflowSun({
    ...tileflowDefaultSunPreset,
    color: '#1b2340',
    ambient: {color: '#0b1020', intensity: 0.4},
  });
  assert.ok(dark.brightness < 0.05, `night brightness ${dark.brightness}`);
  assert.ok(day.brightness > 0.4 && day.brightness <= 1, `day brightness ${day.brightness}`);
});

test('suns mix the short way round, in OKLab colours', () => {
  near(mixTileflowAzimuths(350, 30, 0.5), 10, 1e-9);
  near(mixTileflowAzimuths(30, 350, 0.25), 20, 1e-9);
  const evening: TileflowSunPreset = {
    ...tileflowDefaultSunPreset,
    azimuth: 290,
    altitude: 8,
    color: '#ff9a4a',
    intensity: 0.9,
  };
  assert.equal(
    mixTileflowSunPresets(tileflowDefaultSunPreset, evening, 0),
    tileflowDefaultSunPreset,
  );
  assert.equal(mixTileflowSunPresets(tileflowDefaultSunPreset, evening, 1), evening);
  const half = mixTileflowSunPresets(tileflowDefaultSunPreset, evening, 0.5);
  near(half.azimuth, 250, 1e-9);
  near(half.altitude, 34, 1e-9);
  near(half.intensity, 0.7, 1e-9);
  assert.notEqual(half.color, evening.color);
  assert.deepEqual(tileflowSunPresetAt([tileflowDefaultSunPreset, evening], 0.5), half);
  assert.equal(tileflowSunPresetAt([], 0), undefined);
});

test('the map light points from the sun, anchored to the map', () => {
  assert.deepEqual(
    tileflowSunLight(
      {azimuth: 290, altitude: 8},
      {color: '#fff', intensity: 0.15, position: [1.5, 0, 0]},
    ),
    {anchor: 'map', color: '#fff', intensity: 0.15, position: [1.5, 290, 82]},
  );
  assert.deepEqual(
    tileflowSunLight({azimuth: -10, altitude: -20}, undefined).position,
    [1.15, 350, 90],
  );
});

const evening = defineTheme(testLightTheme, {
  id: 'test-evening',
  version: 1,
  colorScheme: 'dark',
  lighting: {
    sun: {azimuth: 290, altitude: 8, color: '#ff9a4a', intensity: 0.9, shadowIntensity: 0.8},
    ambient: {color: '#4a3a7a', intensity: 0.4},
  },
});

function mapWith(themes: Record<string, ReturnType<typeof defineTheme>>) {
  return defineMap({
    id: 'sun-map',
    version: 1,
    defaultTheme: 'light',
    glyphs: {
      kind: 'url',
      url: 'https://fixtures.tileflow.test/fonts/{fontstack}/{range}.pbf',
      fontStacks: ['Noto Sans Regular'],
    },
    modules: {poi: disable()},
    themes,
  });
}

test('a theme describes its sun and the compiler publishes it with a light from it', () => {
  const resolved = resolveTileflowTheme(evening);
  assert.deepEqual(resolved.sun, {
    azimuth: 290,
    altitude: 8,
    color: '#ff9a4a',
    intensity: 0.9,
    shadowIntensity: 0.8,
    ambient: {color: '#4a3a7a', intensity: 0.4},
  });
  assert.equal(resolved.lighting.anchor, 'map');
  assert.deepEqual(resolved.lighting.position?.slice(1), [290, 82]);

  const style = createStyle(mapWith({light: testLightTheme, evening}), {theme: 'evening'});
  assert.deepEqual(readTileflowSunPreset(style.metadata), resolved.sun);
  assert.deepEqual(style.light, resolved.lighting);
  // A theme without a sun compiles as before.
  const plain = createStyle(mapWith({light: testLightTheme}));
  assert.equal(plain.metadata?.[tileflowSunMetadataKey], undefined);
  assert.equal(resolveTileflowTheme(testLightTheme).sun, undefined);
});

test('a derived theme changes one value of its base sun', () => {
  const later = defineTheme(evening, {
    id: 'test-later',
    version: 1,
    colorScheme: 'dark',
    lighting: {sun: {altitude: 2}},
  });
  const sun = resolveTileflowTheme(later).sun!;
  assert.equal(sun.altitude, 2);
  assert.equal(sun.azimuth, 290);
  assert.equal(sun.color, '#ff9a4a');
  // Unset values take the defaults.
  const minimal = defineTheme(testLightTheme, {
    id: 'test-minimal',
    version: 1,
    colorScheme: 'light',
    lighting: {ambient: {intensity: 0.3}},
  });
  assert.deepEqual(resolveTileflowTheme(minimal).sun, {
    ...tileflowDefaultSunPreset,
    ambient: {...tileflowDefaultSunPreset.ambient, intensity: 0.3},
  });
});

test('theme suns are validated', () => {
  const define = (lighting: unknown) =>
    defineTheme(testLightTheme, {
      id: 'test-bad',
      version: 1,
      colorScheme: 'light',
      lighting: lighting as never,
    });
  assert.throws(() => define({sun: {elevation: 30}}), /Unknown Tileflow theme field "elevation"/u);
  assert.throws(() => define({sun: {altitude: 120}}), /altitude must be between -90 and 90/u);
  assert.throws(() => define({sun: {intensity: 2}}), /intensity must be between 0 and 1/u);
  assert.throws(() => define({ambient: {color: 12}}), /color/u);
});

test('a style without a published sun reads one from its light', () => {
  assert.equal(tileflowStyleSunPreset(undefined), tileflowDefaultSunPreset);
  const preset = tileflowStyleSunPreset({light: {position: [1.15, 120, 40], color: '#ffeedd'}});
  assert.equal(preset.azimuth, 120);
  assert.equal(preset.altitude, 50);
  assert.equal(preset.color, '#ffeedd');
  assert.equal(readTileflowSunPreset({[tileflowSunMetadataKey]: {version: 2}}), undefined);
});

type Listener = (event?: unknown) => void;

class LightMap {
  private readonly listeners = new Map<string, Set<Listener>>();
  style: unknown;
  lights: unknown[] = [];
  centre = {lng: -80.19, lat: 25.77};
  on(event: string, listener: Listener) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
  }
  setStyle(style: unknown) {
    this.style = style;
    queueMicrotask(() => {
      for (const listener of [...(this.listeners.get('style.load') ?? [])]) listener();
    });
  }
  getStyle() {
    return this.style;
  }
  getCenter() {
    return this.centre;
  }
  setPaintProperty() {}
  setLayoutProperty() {}
  getImage() {
    return null;
  }
  updateImage() {}
  setSky() {}
  setLight(light: unknown) {
    this.lights.push(light);
  }
}

function runtime(theme: 'light' | 'evening'): TileflowRuntimeStyle {
  const style = createStyle(mapWith({light: testLightTheme, evening}), {theme}) as MapLibreStyle;
  return {
    colorScheme: theme === 'light' ? 'light' : 'dark',
    fontFaces: [],
    style,
    theme,
  };
}

test('the controller shows the theme sun and mixes it during a blend', async () => {
  const map = new LightMap();
  const day = runtime('light');
  const dusk = runtime('evening');
  const controller = createTileflowThemeController({
    initial: dusk,
    loadFonts: () => Promise.resolve(),
    map,
  });
  const sun = controller.getSun();
  assert.equal(sun.source, 'theme');
  assert.equal(sun.azimuth, 290);
  assert.equal(sun.shadowIntensity, 0.8);

  assert.equal((await controller.setBlend({position: 0.5, themes: [day, dusk]})).status, 'applied');
  const half = controller.getSun();
  // The light theme lights from MapLibre's default direction, [1.15, 210, 30].
  near(half.azimuth, 250, 1e-6);
  near(half.altitude, (60 + 8) / 2, 1e-6);
  // The blend's light turns with the mixed sun.
  const light = map.lights.at(-1) as {anchor: string; position: number[]};
  assert.equal(light.anchor, 'map');
  near(light.position[1]!, 250, 1e-3);
  controller.dispose();
});

test('an application places the sun by direction or by date and returns it to the theme', async () => {
  const map = new LightMap();
  const controller = createTileflowThemeController({
    initial: runtime('evening'),
    loadFonts: () => Promise.resolve(),
    map,
  });
  assert.equal((await controller.setSun({azimuth: 100, altitude: 30})).status, 'applied');
  let sun = controller.getSun();
  assert.equal(sun.source, 'direction');
  assert.equal(sun.azimuth, 100);
  assert.equal(sun.altitude, 30);
  // The theme keeps the light's colours.
  assert.equal(sun.color, '#ff9a4a');
  assert.deepEqual((map.lights.at(-1) as {position: number[]}).position.slice(1), [100, 60]);

  const noon = Date.UTC(2026, 5, 21, 17, 30);
  assert.equal((await controller.setSun({date: noon})).status, 'applied');
  sun = controller.getSun();
  assert.equal(sun.source, 'date');
  const expected = tileflowSunPosition(noon, [-80.19, 25.77]);
  near(sun.azimuth, expected.azimuth, 1e-9);
  near(sun.altitude, expected.altitude, 1e-9);

  await controller.setSun({date: new Date(noon), location: [-3.7, 40.42]});
  near(controller.getSun().altitude, tileflowSunPosition(noon, [-3.7, 40.42]).altitude, 1e-9);

  assert.equal((await controller.setSun(undefined)).status, 'applied');
  sun = controller.getSun();
  assert.equal(sun.source, 'theme');
  assert.equal(sun.azimuth, 290);
  controller.dispose();
});

test('a theme without a sun gets its light back when the application lets the sun go', async () => {
  const map = new LightMap();
  const plain = runtime('light');
  const controller = createTileflowThemeController({
    initial: plain,
    loadFonts: () => Promise.resolve(),
    map,
  });
  await controller.setSun({azimuth: 45, altitude: 20});
  assert.equal((map.lights.at(-1) as {anchor: string}).anchor, 'map');
  await controller.setSun(undefined);
  // The test theme sets no light, so MapLibre's defaults return.
  assert.equal((plain.style as MapLibreStyle).light, undefined);
  assert.deepEqual(map.lights.at(-1), {
    anchor: 'viewport',
    color: '#ffffff',
    intensity: 0.5,
    position: [1.15, 210, 30],
  });
  controller.dispose();
});

test('sun requests are validated', async () => {
  const controller = createTileflowThemeController({
    initial: runtime('evening'),
    loadFonts: () => Promise.resolve(),
    map: new LightMap(),
  });
  for (const request of [
    {azimuth: Number.NaN, altitude: 10},
    {azimuth: 10, altitude: 95},
    {date: Number.NaN},
    {date: 0, location: [0, 100] as [number, number]},
    null,
  ]) {
    const result = await controller.setSun(request as never);
    assert.equal(result.status, 'failed', JSON.stringify(request));
    assert.ok(result.error instanceof TypeError);
  }
  const noCentre = createTileflowThemeController({
    initial: runtime('evening'),
    loadFonts: () => Promise.resolve(),
    map: Object.assign(new LightMap(), {getCenter: undefined}),
  });
  assert.equal((await noCentre.setSun({date: 0})).status, 'failed');
  controller.dispose();
  noCentre.dispose();
});
