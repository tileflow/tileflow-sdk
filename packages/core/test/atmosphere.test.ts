import assert from 'node:assert/strict';
import test from 'node:test';
import {
  atmosphereAngleDelta,
  atmosphereSpaceOpacity,
  createAtmosphereStars,
  readTileflowAtmosphere,
  tileflowAtmosphereMetadataKey,
} from '../src/atmosphere';
import {resolveTileflowAtmosphere} from '../src/atmosphere-compile';
import {fixed, token} from '../src/cartography/values';
import {createStyle, parseTileflowMap} from '../src/map';
import {defineMap, disable, resolveMap} from '../src/maps';
import {extendStreets} from './map-fixture';

const plain = extendStreets({modules: {poi: disable()}});
const base = defineMap({
  id: 'globe',
  version: 1,
  extends: plain,
  projection: 'globe',
  atmosphere: true,
});

test('atmosphere compiles from map authoring into valid sky and portable runtime metadata', () => {
  const style = createStyle(base);
  assert.deepEqual(style.projection, {type: 'globe'});
  assert.equal(style.sky?.['horizon-color'], '#b6cfe2');
  assert.equal(style.sky?.['atmosphere-blend'], 0, 'the contour replaces native sun scattering');
  const metadata = style.metadata?.[tileflowAtmosphereMetadataKey];
  assert.equal(readTileflowAtmosphere(metadata)?.starIntensity, 0.6);
  assert.equal(readTileflowAtmosphere(metadata)?.starParallax, 0.4);
  assert.equal(readTileflowAtmosphere(metadata)?.starCount, 1100);
  assert.equal(readTileflowAtmosphere(metadata)?.starSize, 1);
  assert.equal(readTileflowAtmosphere(metadata)?.starColor, '#e0ebff');
  assert.equal(base.atmosphere, true);
});

test('omission is unchanged; descendants inherit, replace atomically, or disable atmosphere', () => {
  assert.equal(createStyle(plain).sky, undefined);
  const inherited = defineMap({id: 'inherited', version: 1, extends: base});
  assert.equal(resolveMap(inherited).atmosphere, true);
  const configured = defineMap({
    id: 'configured',
    version: 1,
    extends: base,
    atmosphere: {
      horizonColor: fixed('#ff8800', {reason: 'Warm atmosphere fixture'}),
      starIntensity: 0,
      starParallax: 0,
    },
  });
  const style = createStyle(configured);
  assert.equal(style.sky?.['horizon-color'], '#ff8800');
  assert.equal(
    readTileflowAtmosphere(style.metadata?.[tileflowAtmosphereMetadataKey])?.starIntensity,
    0,
  );
  const replaced = defineMap({
    id: 'replaced',
    version: 1,
    extends: configured,
    atmosphere: {starParallax: 0.2},
  });
  assert.deepEqual(resolveMap(replaced).atmosphere, {starParallax: 0.2});
  const disabled = createStyle(
    defineMap({
      id: 'off',
      version: 1,
      extends: configured,
      atmosphere: false,
      projection: 'mercator',
    }),
  );
  assert.equal(disabled.sky, undefined);
  assert.equal(disabled.metadata?.[tileflowAtmosphereMetadataKey], undefined);
});

test('atmosphere rejects incompatible projection and malformed or unbounded configuration', () => {
  for (const value of [
    {projection: 'mercator'},
    {atmosphere: {starIntensity: -1}},
    {atmosphere: {starIntensity: 1.1}},
    {atmosphere: {starParallax: Infinity}},
    ...[-1, 1.5, 4097, Infinity, NaN].map((starCount) => ({atmosphere: {starCount}})),
    ...[-1, 4.1, Infinity, NaN].map((starSize) => ({atmosphere: {starSize}})),
    {atmosphere: {starColor: 'rgba(0, 0, 0, 0.5)'}},
    {atmosphere: {skyColor: 'url(https://example.test)'}},
    {atmosphere: {spaceColor: 'rgba(0, 0, 0, 0.5)'}},
    {atmosphere: {unsupported: true}},
  ]) {
    assert.throws(() => parseTileflowMap({...base, ...value} as typeof base));
  }
  assert.throws(() => parseTileflowMap(extendStreets({atmosphere: true})), /globe/);
});

test('runtime reader rejects unknown versions, incomplete payloads, and unsafe colors', () => {
  const payload = createStyle(base).metadata![tileflowAtmosphereMetadataKey] as object;
  for (const value of [
    null,
    true,
    {},
    {...payload, version: 3},
    {...payload, starIntensity: NaN},
    {...payload, skyColor: 'red'},
    {...payload, starColor: 'red'},
    ...[-1, 1.5, 4097, Infinity, NaN].map((starCount) => ({...payload, starCount})),
    ...[-1, 4.1, Infinity, NaN].map((starSize) => ({...payload, starSize})),
    {...payload, extra: true},
  ])
    assert.equal(readTileflowAtmosphere(value), undefined);
  assert.deepEqual(
    readTileflowAtmosphere(JSON.parse(JSON.stringify(payload))),
    readTileflowAtmosphere(payload),
  );
});

test('stars are deterministic, zoom fades to zero, and rotation crosses the dateline smoothly', () => {
  const stars = createAtmosphereStars();
  assert.deepEqual(stars, createAtmosphereStars());
  assert.equal(stars.length, 650);
  assert.ok(
    stars.every(
      ({x, y, radius, alpha}) =>
        x >= 0 && x < 1 && y >= 0 && y < 1 && radius > 0 && alpha > 0 && alpha <= 1,
    ),
  );
  assert.equal(atmosphereSpaceOpacity(2), 1);
  assert.equal(atmosphereSpaceOpacity(4.5), 0.5);
  assert.equal(atmosphereSpaceOpacity(6), 0);
  assert.equal(atmosphereSpaceOpacity(16), 0);
  assert.equal(atmosphereAngleDelta(-179, 179), 2);
  assert.equal(atmosphereAngleDelta(179, -179), -2);
});

test('atmosphere colors participate in theme token resolution', () => {
  const style = createStyle(
    defineMap({
      id: 'themed',
      version: 1,
      extends: base,
      atmosphere: {
        horizonColor: token.color('surface.water'),
        starColor: token.color('surface.water'),
        starCount: 400,
        starSize: 0.5,
      },
    }),
  );
  assert.equal(style.sky?.['horizon-color'], '#a9d3f5');
  const atmosphere = readTileflowAtmosphere(style.metadata?.[tileflowAtmosphereMetadataKey]);
  assert.equal(atmosphere?.starColor, '#a9d3f5');
  assert.equal(atmosphere?.starCount, 400);
  assert.equal(atmosphere?.starSize, 0.5);
});

test('legacy atmosphere metadata retains the established star appearance', () => {
  const payload = {
    version: 1,
    skyColor: '#263b50',
    horizonColor: '#b6cfe2',
    fogColor: '#d4e1ec',
    spaceColor: '#142233',
    starIntensity: 0.6,
    starParallax: 0.4,
  };
  assert.deepEqual(
    readTileflowAtmosphere(payload),
    readTileflowAtmosphere(createStyle(base).metadata?.[tileflowAtmosphereMetadataKey]),
  );
  assert.equal(readTileflowAtmosphere({...payload, version: 2}), undefined);
  assert.equal(readTileflowAtmosphere({...payload, extra: true}), undefined);
});

test('optional atmosphere values set to undefined retain defaults', () => {
  const options = {starCount: undefined, starSize: undefined, starColor: undefined};
  assert.deepEqual(resolveTileflowAtmosphere(options), resolveTileflowAtmosphere(true));
  const style = createStyle(
    defineMap({id: 'optional', version: 1, extends: base, atmosphere: options}),
  );
  assert.deepEqual(
    readTileflowAtmosphere(style.metadata?.[tileflowAtmosphereMetadataKey]),
    resolveTileflowAtmosphere(true),
  );
});
