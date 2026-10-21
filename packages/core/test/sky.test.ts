import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowAtmosphereMetadataKey} from '../src/atmosphere';
import {fixed, token} from '../src/cartography/values';
import {createStyle, parseTileflowMap} from '../src/map';
import {defineMap, disable, resolveMap} from '../src/maps';
import {readTileflowSky, tileflowSkyMetadataKey, tileflowSkyStarVisibility} from '../src/sky';
import {tileflowSkyStarField} from '../src/sky-stars-browser';
import {planTileflowThemeBlend, tileflowColourChannels} from '../src/theme-blend';
import {extendStreets} from './map-fixture';

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
  assert.deepEqual(style.metadata?.[tileflowSkyMetadataKey], {version: 1, starIntensity: 0.6});
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
  // Starless skies carry no runtime payload.
  assert.equal(style.metadata?.[tileflowSkyMetadataKey], undefined);
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
  for (const value of [
    null,
    {},
    {version: 2, starIntensity: 0.5},
    {version: 1, starIntensity: 2},
    {version: 1, starIntensity: 0.5, extra: true},
  ])
    assert.equal(readTileflowSky(value), undefined);
  assert.deepEqual(readTileflowSky({version: 1, starIntensity: 0.5}), {
    version: 1,
    starIntensity: 0.5,
  });
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
