import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowAtmosphereMetadataKey} from '../src/atmosphere';
import {fixed, token} from '../src/cartography/values';
import {createStyle, parseTileflowMap} from '../src/map';
import {defineMap, disable, resolveMap} from '../src/maps';
import {createTileflowThemeController} from '../src/browser';
import {
  readTileflowSky,
  tileflowSkyAtSun,
  tileflowSkyGlowStrength,
  tileflowSkyMetadataKey,
  tileflowSkyStarVisibility,
  tileflowSkySunKey,
  type TileflowSkyTimesOfDay,
} from '../src/sky';
import {defineTheme} from '../src/themes';
import type {MapLibreStyle} from '../src/types';
import {tileflowSkyStarField} from '../src/sky-browser';
import {planTileflowThemeBlend, tileflowColourChannels} from '../src/theme-blend';
import {extendStreets, testLightTheme} from './map-fixture';

const plain = extendStreets({modules: {poi: disable()}});
const sky = defineMap({id: 'sky', version: 1, extends: plain, sky: true});

const channels = (colour: string) => tileflowColourChannels(colour)!.slice(0, 3) as never;

test('a sky compiles in any projection with its stars in runtime metadata', () => {
  const style = createStyle(sky);
  assert.equal(style.projection, undefined);
  assert.deepEqual(style.sky, {
    'sky-color': '#5c9ce6',
    'horizon-color': '#dcebf7',
    'fog-color': '#dcebf7',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.75,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 3, 0.45, 5, 0.2, 7, 0],
  });
  // A map without time-of-day families carries no family skies.
  assert.deepEqual(style.metadata?.[tileflowSkyMetadataKey], {
    version: 1,
    starIntensity: 0.6,
    glowColor: '#ffc68a',
  });
  assert.equal(style.metadata?.[tileflowAtmosphereMetadataKey], undefined);
  assert.equal(createStyle(plain).sky, undefined);
});

test('sky colours and numbers follow the theme; descendants replace or disable it', () => {
  const themed = defineMap({
    id: 'themed-sky',
    version: 1,
    extends: sky,
    sky: {
      color: token.color('surface.water'),
      horizonColor: fixed('#ffeedd', {reason: 'Sky fixture'}),
      horizonBlend: 0.3,
      starIntensity: 0,
    },
  });
  const style = createStyle(themed);
  assert.equal(style.sky?.['sky-color'], '#a9d3f5');
  assert.equal(style.sky?.['horizon-color'], '#ffeedd');
  assert.equal(style.sky?.['sky-horizon-blend'], 0.3);
  assert.equal(readTileflowSky(style.metadata?.[tileflowSkyMetadataKey])?.starIntensity, 0);
  assert.deepEqual(resolveMap(defineMap({id: 'inherits', version: 1, extends: sky})).sky, true);
  const off = createStyle(defineMap({id: 'off', version: 1, extends: themed, sky: false}));
  assert.equal(off.sky, undefined);
});

test('a declared sky replaces the globe atmosphere sky but keeps its runtime metadata', () => {
  const style = createStyle(
    defineMap({
      id: 'both',
      version: 1,
      extends: plain,
      projection: 'globe',
      atmosphere: true,
      sky: {color: fixed('#123456', {reason: 'Sky fixture'})},
    }),
  );
  assert.equal(style.sky?.['sky-color'], '#123456');
  assert.ok(style.metadata?.[tileflowAtmosphereMetadataKey]);
  assert.ok(style.metadata?.[tileflowSkyMetadataKey]);
});

test('sky rejects translucent colours, numbers outside 0–1, and unknown fields', () => {
  for (const value of [
    {sky: {color: 'rgba(0, 0, 0, 0.5)'}},
    {sky: {horizonBlend: 1.5}},
    {sky: {starIntensity: -0.1}},
    {sky: {starIntensity: Infinity}},
    {sky: {spaceColor: '#000000'}},
  ]) {
    assert.throws(() => parseTileflowMap({...sky, ...value} as typeof sky));
  }
});

test('the runtime reader accepts only the versioned payload', () => {
  const payload = {version: 1, starIntensity: 0.5, glowColor: '#ffc68a'};
  const moment = {
    color: '#5c9ce6',
    horizonColor: '#dcebf7',
    horizonBlend: 0.6,
    glowColor: '#ffe7b8',
  };
  for (const value of [
    null,
    {},
    {...payload, version: 2},
    {...payload, starIntensity: 2},
    {...payload, glowColor: 'red'},
    {...payload, extra: true},
    {...payload, timesOfDay: {day: moment, dawn: moment, dusk: moment}},
    {
      ...payload,
      timesOfDay: {day: moment, dawn: moment, dusk: moment, night: {...moment, horizonBlend: 2}},
    },
  ])
    assert.equal(readTileflowSky(value), undefined);
  assert.deepEqual(readTileflowSky(payload), payload);
  const times = {day: moment, dawn: moment, dusk: moment, night: moment};
  assert.deepEqual(readTileflowSky({...payload, timesOfDay: times})?.timesOfDay, times);
});

test('stars shine in a night sky and stay out of dusk and day skies', () => {
  assert.equal(tileflowSkyStarVisibility(channels('#0b1630')), 1);
  assert.equal(tileflowSkyStarVisibility(channels('#4a4784')), 0);
  assert.equal(tileflowSkyStarVisibility(channels('#5c9ce6')), 0);
  const between = tileflowSkyStarVisibility(channels('#2a3352'));
  assert.ok(between > 0 && between < 1);
});

test('the star dome is deterministic, above the horizon, and made of unit directions', () => {
  const field = tileflowSkyStarField();
  assert.deepEqual(field, tileflowSkyStarField());
  assert.equal(field.length, 2400 * 5);
  for (let index = 0; index < field.length; index += 5) {
    const [x, y, z, radius, alpha] = field.subarray(index, index + 5);
    assert.ok(Math.abs(Math.hypot(x!, y!, z!) - 1) < 1e-5);
    assert.ok(z! >= 0 && z! < 1 && radius! > 0 && alpha! > 0 && alpha! <= 1);
  }
});

test('a time-of-day blend mixes two skies and keeps their shared atmosphere blend', () => {
  const skyStyle = (colour: string) =>
    createStyle(
      defineMap({
        id: 'blend-sky',
        version: 1,
        extends: plain,
        sky: {color: fixed(colour, {reason: 'Sky fixture'})},
      }),
    );
  const plan = planTileflowThemeBlend([skyStyle('#000000'), skyStyle('#ffffff')]);
  const middle = plan.styleAt(0.5).sky as Record<string, unknown>;
  const [red, green, blue] = tileflowColourChannels(String(middle['sky-color']))!;
  assert.ok(red > 0.3 && red < 0.7 && red === green && green === blue);
  assert.deepEqual(middle['atmosphere-blend'], skyStyle('#000000').sky?.['atmosphere-blend']);
});

const moments = {
  day: {color: '#5c9ce6', horizonColor: '#dcebf7', horizonBlend: 0.6, glowColor: '#ffe7b8'},
  dawn: {color: '#7f9fd6', horizonColor: '#f6d4bc', horizonBlend: 0.75, glowColor: '#ffc48a'},
  dusk: {color: '#4a4784', horizonColor: '#e7a3a4', horizonBlend: 0.8, glowColor: '#ff9a6c'},
  night: {color: '#0b1630', horizonColor: '#26365a', horizonBlend: 0.6, glowColor: '#b4645a'},
} satisfies TileflowSkyTimesOfDay;

test('the sky follows the sun: day overhead, dawn or dusk by the horizon, night after twilight', () => {
  assert.deepEqual(tileflowSkyAtSun(moments, {altitude: 45, azimuth: 180}), moments.day);
  // Round sunrise the dawn sky; round sunset, in the western half of the sky, the dusk sky.
  assert.deepEqual(tileflowSkyAtSun(moments, {altitude: 2, azimuth: 95}), moments.dawn);
  assert.deepEqual(tileflowSkyAtSun(moments, {altitude: 2, azimuth: 275}), moments.dusk);
  assert.deepEqual(tileflowSkyAtSun(moments, {altitude: -30, azimuth: 0}), moments.night);
  // The golden hour and the end of twilight mix continuously.
  const golden = tileflowSkyAtSun(moments, {altitude: 13, azimuth: 260});
  assert.ok(golden.horizonBlend > moments.day.horizonBlend);
  assert.ok(golden.horizonBlend < moments.dusk.horizonBlend);
  const late = tileflowSkyAtSun(moments, {altitude: -6, azimuth: 290});
  assert.notEqual(late.color, moments.dusk.color);
  assert.notEqual(late.color, moments.night.color);
});

test('a sun glows as it touches the horizon and not high in the sky or deep below it', () => {
  assert.equal(tileflowSkyGlowStrength(45), 0);
  assert.equal(tileflowSkyGlowStrength(-20), 0);
  assert.equal(tileflowSkyGlowStrength(2), 1);
  const morning = tileflowSkyGlowStrength(15);
  assert.ok(morning > 0 && morning < 1);
});

class SkyMap {
  private readonly listeners = new Map<string, Set<() => void>>();
  style: unknown;
  skies: unknown[] = [];
  on(event: string, listener: () => void) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
  }
  off(event: string, listener: () => void) {
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
    return {lng: -3.69, lat: 40.45};
  }
  setPaintProperty() {}
  setLayoutProperty() {}
  getImage() {
    return null;
  }
  updateImage() {}
  setLight() {}
  setSky(sky: unknown) {
    this.skies.push(sky);
  }
}

test('a sun the application places brings the sky of its hour from the family and lets it go', async () => {
  const theme = (id: string, top: string, edge: string, glow: string) =>
    defineTheme(testLightTheme, {
      id,
      version: 1,
      colorScheme: 'light',
      tokens: {color: {'sky.top': top, 'sky.edge': edge, 'sky.glow': glow}},
    });
  const map = defineMap({
    id: 'sun-sky',
    version: 1,
    extends: plain,
    defaultTheme: 'day',
    themes: {
      day: theme('day', '#5c9ce6', '#dcebf7', '#ffe7b8'),
      dawn: theme('dawn', '#7f9fd6', '#f6d4bc', '#ffc48a'),
      dusk: theme('dusk', '#4a4784', '#e7a3a4', '#ff9a6c'),
      night: theme('night', '#0b1630', '#26365a', '#b4645a'),
    },
    timeOfDay: {day: {day: 'day', dawn: 'dawn', dusk: 'dusk', night: 'night'}},
    sky: {
      color: token.color('sky.top'),
      horizonColor: token.color('sky.edge'),
      glowColor: token.color('sky.glow'),
    },
  });
  const style = createStyle(map, {theme: 'day'}) as MapLibreStyle;
  const times = readTileflowSky(style.metadata?.[tileflowSkyMetadataKey])?.timesOfDay;
  assert.equal(times?.dusk.color, '#4a4784');
  assert.equal(times?.night.glowColor, '#b4645a');

  const skyMap = new SkyMap();
  const controller = createTileflowThemeController({
    initial: {colorScheme: 'light', fontFaces: [], style, theme: 'day'},
    loadFonts: () => Promise.resolve(),
    map: skyMap,
  });
  await controller.setSun({azimuth: 270, altitude: 1});
  const sunset = skyMap.skies.at(-1) as Record<string, unknown>;
  assert.equal(sunset['sky-color'], '#4a4784');
  assert.equal(sunset['horizon-color'], '#e7a3a4');
  assert.equal(sunset['fog-color'], '#e7a3a4');
  // The rest of the theme's sky stays.
  assert.deepEqual(sunset['atmosphere-blend'], style.sky?.['atmosphere-blend']);
  // The sky layer reads the sun the controller shows.
  const published = (skyMap as unknown as Record<symbol, {altitude: number; source: string}>)[
    tileflowSkySunKey
  ];
  assert.equal(published?.altitude, 1);
  assert.equal(published?.source, 'direction');
  await controller.setSun({azimuth: 90, altitude: -40});
  assert.equal((skyMap.skies.at(-1) as Record<string, unknown>)['sky-color'], '#0b1630');
  await controller.setSun(undefined);
  assert.deepEqual(skyMap.skies.at(-1), style.sky);
  controller.dispose();
});
