import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {createStyle, readTileflowSunPreset, resolveTileflowTheme} from '@tileflow/core';
import {mixTileflowSunPresets, resolveTileflowSun} from '@tileflow/core/browser';
import {buildingFloodLightShare} from '../../core/src/building-illumination';
import {readTileflowBuildings3D} from '../../core/src/buildings-3d-design';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';
import {standardLightingReference as reference} from './streets-standard-lighting-fixture';

const themes = {
  'default-dawn': 'dawn',
  'default-day': 'light',
  'default-dusk': 'dusk',
  'default-night': 'dark',
  'faded-dawn': 'dawn-faded',
  'faded-day': 'faded',
  'faded-dusk': 'dusk-faded',
  'faded-night': 'dark-faded',
  'monochrome-dawn': 'dawn-monochrome',
  'monochrome-day': 'monochrome',
  'monochrome-dusk': 'dusk-monochrome',
  'monochrome-night': 'dark-monochrome',
} as const;

const preparedAssets = {
  icons: {
    ids: readdirSync(new URL('../assets/streets/icons/', import.meta.url))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.replace(/(?:\.pattern)?\.svg$/, '')),
    sprite: '/test/standard-lighting/sprite',
  },
  models: streetsPreparedModels,
};

function matchesRgb(actual: readonly number[], expected: readonly number[], context: string) {
  for (let channel = 0; channel < 3; channel += 1)
    assert.ok(
      Math.abs(actual[channel]! * 255 - expected[channel]!) < 0.00001,
      `${context}: channel ${channel} differs from the effective reference light`,
    );
}

for (const [name, theme] of Object.entries(themes)) {
  test(`Streets ${theme} publishes Standard ${name} high-zoom light and transformed color`, () => {
    const expected = reference.lights[name as keyof typeof themes];
    const preset = resolveTileflowTheme(streetsThemes[theme]).sun;
    assert.ok(preset);
    assert.equal(preset.azimuth, expected.direction[0]);
    assert.equal(preset.altitude, 90 - expected.direction[1], 'polar angle converts to altitude');
    assert.equal(preset.intensity, expected.directional.intensity);
    assert.equal(preset.ambient.intensity, expected.ambient.intensity);
    assert.equal(preset.shadowIntensity, expected.shadowIntensity);
    const light = resolveTileflowSun(preset);
    matchesRgb(light.rgb, expected.directional.rgb, `${theme} directional`);
    matchesRgb(light.ambient.rgb, expected.ambient.rgb, `${theme} ambient`);
    const [azimuth, polar] = expected.direction.map((angle) => (angle * Math.PI) / 180);
    const direction = [
      Math.sin(azimuth!) * Math.sin(polar!),
      Math.cos(azimuth!) * Math.sin(polar!),
      Math.cos(polar!),
    ];
    direction.forEach((value, axis) => assert.ok(Math.abs(light.direction[axis]! - value) < 1e-12));

    const compiled = createStyle(streets, {theme, preparedAssets});
    assert.deepEqual(readTileflowSunPreset(compiled.metadata), preset);
    const buildings = readTileflowBuildings3D(compiled.metadata)!;
    assert.equal(buildings.occlusion, true);
    assert.equal(buildings.modelOcclusion, 0.75);
    const dark = name.endsWith('dusk') || name.endsWith('night');
    const mono = name.startsWith('monochrome');
    assert.equal(buildings.modelLighting?.wall?.emissiveStrength, dark ? (mono ? 0.05 : 0.1) : 0);
    assert.deepEqual(buildings.modelLighting?.wall?.emissiveHeight, [0.5, 0, 0, 1, 0.8]);
    const flood = buildings.floodLight!;
    assert.equal(flood.minGroundHeight, 30);
    assert.equal(flood.minWallHeight, 200);
    assert.equal(
      flood.intensity * buildingFloodLightShare(light, flood.brightnessScale),
      name.endsWith('night') && !mono ? 0.3 : 0,
      'colour transforms must not switch ordinary building lights on during dusk',
    );
    assert.deepEqual(compiled.light?.position, [1.15, ...expected.direction]);
    assert.equal(compiled.light?.anchor, 'map');
    // Native extrusion shading is a separate fallback; its tint must not apply
    // Standard's effective scene colors to the observed roof material twice.
    assert.equal(compiled.light?.color, '#FFFFFF');
  });
}

test('all night themes retain moonlight while the current scene remains in its night range', () => {
  for (const theme of ['dark', 'dark-faded', 'dark-monochrome'] as const) {
    const preset = resolveTileflowTheme(streetsThemes[theme]).sun;
    assert.ok(preset);
    const light = resolveTileflowSun(preset);
    assert.equal(light.azimuth, 270);
    assert.equal(light.altitude, 70);
    assert.ok(light.intensity > 0 && light.rgb.some((channel) => channel > 0));
    assert.equal(light.shadowIntensity, 0.5);
    assert.ok(light.brightness < 0.05, `${theme}: moonlight must not turn off night effects`);
  }
});

test('monochrome uses neutral transformed light and its own dawn and dusk directions', () => {
  assert.deepEqual(Object.keys(reference.lights), Object.keys(themes));
  for (const time of ['dawn', 'day', 'dusk', 'night'] as const) {
    const preset = resolveTileflowTheme(streetsThemes[themes[`monochrome-${time}`]]).sun;
    assert.ok(preset);
    const light = resolveTileflowSun(preset);
    assert.equal(light.rgb[0], light.rgb[1]);
    assert.equal(light.rgb[1], light.rgb[2]);
    assert.equal(light.ambient.rgb[0], light.ambient.rgb[1]);
    assert.equal(light.ambient.rgb[1], light.ambient.rgb[2]);
  }
  assert.equal(resolveTileflowTheme(streetsThemes['dawn-monochrome']).sun?.altitude, 50);
  assert.equal(resolveTileflowTheme(streetsThemes['dusk-monochrome']).sun?.altitude, 60);
});

test('time and theme transitions keep valid resolved light through their interpolation', () => {
  for (const family of ['default', 'faded', 'monochrome'] as const) {
    const times = ['day', 'dusk', 'night', 'dawn', 'day'] as const;
    for (let index = 1; index < times.length; index += 1) {
      const from = resolveTileflowTheme(
        streetsThemes[themes[`${family}-${times[index - 1]!}`]],
      ).sun;
      const to = resolveTileflowTheme(streetsThemes[themes[`${family}-${times[index]!}`]]).sun;
      assert.ok(from && to);
      assert.deepEqual(mixTileflowSunPresets(from, to, 0), from);
      assert.deepEqual(mixTileflowSunPresets(from, to, 1), to);
      const mixed = resolveTileflowSun(mixTileflowSunPresets(from, to, 0.5));
      assert.ok(mixed.direction.every(Number.isFinite));
      assert.ok(mixed.rgb.every((channel) => channel >= 0 && channel <= 1));
      assert.ok(Number.isFinite(mixed.brightness));
      assert.ok(
        mixed.altitude > 0,
        'a preset blend does not accidentally put moonlight below ground',
      );
    }
  }
});
