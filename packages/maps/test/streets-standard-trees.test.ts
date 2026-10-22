import {Color} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import test from 'node:test';
import {
  createStyle,
  defineMap,
  defineTheme,
  readTileflowVegetation3D,
  resolveTileflowTheme,
} from '@tileflow/core';
import {streets, streetsThemes} from '../src';
import {streetsPreparedModels} from './streets-assets';
import {standardTreeReference as reference} from './streets-standard-tree-fixture';

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
    sprite: '/test/standard-tree-themes/sprite',
  },
  models: streetsPreparedModels,
};

function rgb(value: unknown): readonly number[] {
  const parsed = typeof value === 'string' ? Color.parse(value) : undefined;
  assert.ok(parsed, `Expected an authored color, got ${String(value)}`);
  assert.equal(parsed.a, 1, '3D tree materials remain opaque');
  return [parsed.r * 255, parsed.g * 255, parsed.b * 255];
}

function guardObservedMaterial(
  value: unknown,
  observed: {readonly median: readonly number[]},
  context: string,
) {
  const actual = rgb(value);
  const expected = observed.median;
  const sum = (channels: readonly number[]) => channels.reduce((a, b) => a + b, 0);
  // Materials are inputs to lighting, whereas the fixture contains lit pixels.
  // These intentionally broad guards catch a return to brown daytime trunks,
  // bright night trees or a ground-cover palette. They do not predict GPU pixels
  // or lock a material to one sampled tree's normal. Browser captures remain
  // responsible for close visual matching after an authored-palette change.
  const brightnessRatio = sum(actual) / sum(expected);
  assert.ok(
    brightnessRatio >= 0.5 && brightnessRatio <= 1.45,
    `${context}: material brightness falls outside the observed tree envelope (${brightnessRatio.toFixed(2)})`,
  );
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    const difference = Math.abs(actual[a]! - actual[b]! - (expected[a]! - expected[b]!));
    assert.ok(
      difference <= 20,
      `${context}: material channel separation differs from the observed tree by ${difference.toFixed(1)}`,
    );
  }
}

for (const [referenceName, theme] of Object.entries(themes)) {
  test(`Streets ${theme} compiles independently calibrated 3D tree materials`, () => {
    const observed = reference.observations[referenceName as keyof typeof themes];
    const colors = resolveTileflowTheme(streetsThemes[theme]).tokens.color;
    const style = createStyle(streets, {theme, preparedAssets});
    const vegetation = readTileflowVegetation3D(style.metadata);
    assert.ok(vegetation, `${theme}: missing compiled 3D trees`);
    const bark = colors['vegetation.tree.bark'];
    const broadleaf = ['a', 'b', 'c', 'd'].map(
      (shade) => colors[`vegetation.tree.broadleaf.${shade}`],
    );
    const conifer = ['a', 'b', 'c'].map((shade) => colors[`vegetation.tree.conifer.${shade}`]);
    assert.equal(vegetation.colors.bark, bark);
    assert.deepEqual(vegetation.colors.broadleaf, broadleaf);
    assert.deepEqual(vegetation.colors.conifer, conifer);
    assert.deepEqual(vegetation.colors.palm, broadleaf.slice(0, 3));
    guardObservedMaterial(vegetation.colors.bark, observed.bark, `${theme} bark`);
    guardObservedMaterial(vegetation.colors.broadleaf[1], observed.crown, `${theme} crown`);

    for (const [kind, palette] of Object.entries(vegetation.colors)) {
      for (const value of typeof palette === 'string' ? [palette] : palette) {
        const channels = rgb(value);
        assert.ok(
          channels.every((channel) => channel > 0),
          `${theme} ${kind}: clipped black material`,
        );
        if (referenceName.startsWith('monochrome-')) {
          assert.equal(channels[0], channels[1], `${theme} ${kind}: red/green tint`);
          assert.equal(channels[1], channels[2], `${theme} ${kind}: green/blue tint`);
        }
      }
    }
    for (const [kind, palette] of Object.entries({broadleaf, conifer})) {
      assert.equal(new Set(palette).size, palette.length, `${theme}: ${kind} variation collapsed`);
      const brightness = palette.map((value) => rgb(value).reduce((a, b) => a + b, 0));
      assert.ok(
        brightness.every((value, index) => index === 0 || value > brightness[index - 1]!),
        `${theme}: ${kind} shade order changed`,
      );
    }
    assert.notDeepEqual(conifer, broadleaf.slice(0, 3), `${theme}: species lost their own palette`);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(vegetation.forms).map(([form, definition]) => [form, definition.models]),
      ),
      {
        round: ['streets-tree-round', 'streets-tree-open'],
        open: ['streets-tree-open'],
        tall: ['streets-tree-tall', 'streets-tree-open'],
        conifer: ['streets-tree-conifer'],
        columnar: ['streets-tree-columnar'],
        palm: ['streets-tree-palm-feather', 'streets-tree-palm-fan'],
      },
      `${theme}: tree forms and palm variants must survive palette changes`,
    );

    const recoloredGround = defineTheme(streetsThemes[theme], {
      id: `tree-independent-${theme}`,
      version: 1,
      colorScheme: streetsThemes[theme].colorScheme,
      tokens: {
        color: {
          'landcover.urbanPark': '#FF00FF',
          'landcover.greenspace': '#FF00FF',
          'surface.park': '#FF00FF',
        },
      },
    });
    const map = defineMap({
      id: `tree-independent-${theme}`,
      version: 1,
      extends: streets,
      defaultTheme: theme,
      themes: {[theme]: recoloredGround},
    });
    const changed = createStyle(map, {theme, preparedAssets});
    assert.deepEqual(
      readTileflowVegetation3D(changed.metadata)?.colors,
      vegetation.colors,
      `${theme}: changing park surfaces must not recolor bark or foliage`,
    );
  });
}

test('Streets retains all twelve independent tree palettes and observed time-of-day ordering', () => {
  assert.deepEqual(Object.keys(reference.observations), Object.keys(themes));
  const signatures = Object.values(themes).map((theme) => {
    const colors = resolveTileflowTheme(streetsThemes[theme]).tokens.color;
    return `${colors['vegetation.tree.bark']}:${colors['vegetation.tree.broadleaf.b']}`;
  });
  assert.equal(
    new Set(signatures).size,
    12,
    'Time and color-theme combinations must stay distinct',
  );
  for (const palette of ['default', 'faded', 'monochrome'] as const) {
    for (const role of ['vegetation.tree.bark', 'vegetation.tree.broadleaf.b']) {
      const brightness = ['day', 'dawn', 'dusk', 'night'].map((time) => {
        const theme = themes[`${palette}-${time}` as keyof typeof themes];
        return rgb(resolveTileflowTheme(streetsThemes[theme]).tokens.color[role]).reduce(
          (a, b) => a + b,
          0,
        );
      });
      assert.ok(
        brightness.every((value, index) => index === 0 || value < brightness[index - 1]!),
        `${palette} ${role}: preserve the observed day → dawn → dusk → night brightness order`,
      );
    }
  }
});
