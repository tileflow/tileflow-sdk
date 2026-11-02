import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {
  createTileflowNativeFamily,
  emphasizeTileflowNativeValue,
  fillTileflowNativeTemplate,
  mixTileflowNativeColours,
  mixTileflowRouteInks,
  mixTileflowSunPresets,
  parseTileflowNativeFamily,
  tileflowNativeBlendLayers,
  tileflowNativeBlendOptions,
  type TileflowNativeFamily,
  tileflowNativeLeafKey,
  tileflowNativeLeafValues,
} from '../src/native-profile';
import {resolveTileflowRuntimeTheme} from '../src/runtime';
import {planTileflowThemeBlend} from '../src/theme-blend';
import {emphasizeTileflowValue} from '../src/theme-emphasis';
import type {MapLibreStyle} from '../src/types';

type Input = {themes: string[]; styles: Record<string, MapLibreStyle>};
const read = async (name: string) =>
  JSON.parse(await readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const input = (await read('native-family-input.json')) as Input;
const golden = await read('native-evaluators.json');
const family = createTileflowNativeFamily({map: 'evaluators', ...input});
const blended = input.themes.slice(0, 3).map((name) => input.styles[name]!);

/** Numbers within a tolerance, colours within one 8-bit step; everything else equal. */
function near(actual: unknown, expected: unknown, path = ''): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path);
    assert.ok(Math.abs((actual as number) - expected) < 1e-4, `${path}: ${actual} ≠ ${expected}`);
  } else if (typeof expected === 'string' && /^rgba\(/u.test(expected)) {
    const channels = (value: unknown) =>
      String(value)
        .match(/[\d.]+/gu)!
        .map(Number);
    const [a, b] = [channels(actual), channels(expected)];
    assert.equal(a.length, b.length, path);
    a.forEach((value, index) => assert.ok(Math.abs(value - b[index]!) <= 1, `${path}: ${actual}`));
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    assert.equal(actual.length, expected.length, path);
    expected.forEach((item, index) => near(actual[index], item, `${path}/${index}`));
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual as object).sort(), Object.keys(expected).sort(), path);
    for (const [key, value] of Object.entries(expected))
      near((actual as Record<string, unknown>)[key], value, `${path}/${key}`);
  } else assert.deepEqual(actual, expected, path);
}

test('groups themes that blend, normalizes appearance and keeps degradations per theme', () => {
  assert.deepEqual(
    family.themes.map(({name, colorScheme, sunPublished}) => [name, colorScheme, sunPublished]),
    [
      ['day', 'light', true],
      ['dusk', 'light', true],
      ['night', 'dark', true],
      ['mono', 'light', false],
    ],
  );
  // `mono` draws another layer list, so it blends with no other theme.
  assert.deepEqual(
    family.blend.groups.map((group) => group.themes),
    [[0, 1, 2]],
  );
  assert.deepEqual(family.blend.options, tileflowNativeBlendOptions);
  assert.deepEqual(family.compatibility, {status: 'compatible', reasons: []});
  assert.deepEqual(
    family.themes[0]!.degradations.map(({id}) => id),
    ['globe'],
  );
  assert.deepEqual(family.themes[3]!.notices, [
    {id: 'not-for-navigation', sources: ['world'], text: 'Not for navigation'},
  ]);
  assert.equal(family.themes[2]!.routeInks.line, '#60a5fa');
  assert.equal(family.themes[0]!.emphasis.ground, '#f4f0ef');
});

test('creation is deterministic and leaves its input unchanged', () => {
  const before = JSON.stringify(input);
  const again = createTileflowNativeFamily({map: 'evaluators', ...input});
  assert.equal(JSON.stringify(again), JSON.stringify(family));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(parseTileflowNativeFamily(JSON.parse(JSON.stringify(family))), family);
  assert.throws(() => createTileflowNativeFamily({map: 'evaluators', ...input, themes: ['day']}));
  assert.throws(() =>
    createTileflowNativeFamily({map: 'evaluators', ...input, themes: [...input.themes, 'day']}),
  );
});

test('blend layers over all group themes equal the browser blend at every position', () => {
  const plan = planTileflowThemeBlend(blended, tileflowNativeBlendOptions);
  const group = family.blend.groups[0]!;
  for (const position of [0, 0.3, 0.5, 1, 1.49, 1.5, 2, 3]) {
    assert.deepEqual(
      tileflowNativeBlendLayers(group, [0, 1, 2], position),
      plan.styleAt(position).layers,
      String(position),
    );
    assert.deepEqual(
      fillTileflowNativeTemplate(group.light, position, {select: [0, 1, 2]}),
      plan.styleAt(position).light,
    );
  }
});

test('a blend of any subset or order is filled by choosing values', () => {
  const group = family.blend.groups[0]!;
  const layer = (layers: Record<string, unknown>[], id: string) =>
    layers.find((candidate) => candidate.id === id) as {
      paint?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    };
  const ground = (layers: Record<string, unknown>[]) =>
    layer(layers, 'background').paint?.['background-color'];
  const [day, , night] = input.themes.map((name) => input.styles[name]!);
  const colour = (style: MapLibreStyle) =>
    (style.layers[0]!.paint as Record<string, string>)['background-color']!;
  // At whole themes the blend shows exactly that theme's values.
  const nightFirst = tileflowNativeBlendLayers(group, [2, 0], 0);
  assert.equal(ground(nightFirst), colour(night));
  assert.equal(ground(tileflowNativeBlendLayers(group, [2, 0], 1)), colour(day));
  assert.equal(layer(nightFirst, 'labels').layout?.['icon-image'], 'pin-night');
  assert.equal(
    layer(tileflowNativeBlendLayers(group, [2, 0], 0.6), 'labels').layout?.['icon-image'],
    'pin-day',
  );
  assert.equal(
    ground(tileflowNativeBlendLayers(group, [2, 0], 0.5)),
    mixTileflowNativeColours(colour(night), colour(day), 0.5),
  );
  // Labels follow the nearest selected theme; ground values follow the position.
  const labels = layer(tileflowNativeBlendLayers(group, [2, 0], 0.4), 'labels').paint!;
  assert.equal(labels['text-color'], 'rgba(230, 236, 255, 0.95)');
  assert.throws(() => tileflowNativeBlendLayers(group, [0], 0), RangeError);
  assert.throws(() => tileflowNativeBlendLayers(group, [0, 3], 0.5), RangeError);
});

test('emphasis tables reproduce the browser emphasis at every strength', () => {
  for (const [index, theme] of family.themes.entries()) {
    const style = input.styles[theme.name]!;
    for (const target of theme.emphasis.targets) {
      const layer = style.layers.find((candidate) => candidate.id === target.layer)!;
      const value = (layer.paint as Record<string, unknown> | undefined)?.[target.property];
      for (const amount of [0, 0.25, 0.5, 1]) {
        const core = emphasizeTileflowValue({...target, amount, featureData: false}, value, {
          ground: theme.emphasis.ground,
          strength: 1,
        });
        const native = emphasizeTileflowNativeValue(target, amount);
        // At the design value an unset opacity reads as its default, 1, and opacity
        // expressions keep a factor of 1; both draw the same as the browser.
        if (amount === 0 && core === undefined) assert.equal(native, 1);
        else if (amount === 0 && Array.isArray(native) && native[0] === '*') near(native[1], core);
        else near(native, core, `${index}:${target.layer}/${target.property}@${amount}`);
      }
      if (target.kind === 'label') {
        const keep = {
          type: 'Polygon' as const,
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        };
        near(
          emphasizeTileflowNativeValue(target, 0.5, keep),
          emphasizeTileflowValue({...target, amount: 0.5, featureData: true}, value, {
            keep,
            strength: 1,
          }),
        );
      }
    }
  }
});

test('leaves are exactly one key holding numbers or strings', () => {
  assert.deepEqual(tileflowNativeLeafValues({[tileflowNativeLeafKey]: [1, '#fff']}), [1, '#fff']);
  for (const value of [
    {[tileflowNativeLeafKey]: []},
    {[tileflowNativeLeafKey]: [1], other: true},
    {[tileflowNativeLeafKey]: [null]},
    {[tileflowNativeLeafKey]: 1},
    [tileflowNativeLeafKey, 1],
  ])
    assert.equal(tileflowNativeLeafValues(value), undefined);
  assert.equal(fillTileflowNativeTemplate({[tileflowNativeLeafKey]: [0, 10]}, 0.25), 2.5);
  assert.throws(
    () => fillTileflowNativeTemplate({[tileflowNativeLeafKey]: [0, 10]}, 0, {select: [2, 0]}),
    RangeError,
  );
});

test('family documents reject inconsistent groups, compatibility and oversized content', () => {
  const copy = (): TileflowNativeFamily => JSON.parse(JSON.stringify(family));
  for (const change of [
    (value: TileflowNativeFamily) => {
      value.themes[1]!.name = 'day';
    },
    (value: TileflowNativeFamily) => {
      value.compatibility = {status: 'web-only', reasons: value.compatibility.reasons};
    },
    (value: TileflowNativeFamily) => {
      value.blend.groups[0]!.themes = [0, 1, 4];
    },
    (value: TileflowNativeFamily) => {
      value.blend.groups[0]!.themes = [1, 0, 2];
    },
    (value: TileflowNativeFamily) => {
      value.blend.groups[0]!.switches[0]!.values.pop();
    },
    (value: TileflowNativeFamily) => {
      value.themes[0]!.degradations = [];
      value.themes[0]!.emphasis.targets[0]!.value = 'x'.repeat(9 * 1024 * 1024);
    },
    (value: TileflowNativeFamily) => {
      Object.assign(value, {unknown: true});
    },
  ]) {
    const value = copy();
    change(value);
    assert.throws(() => parseTileflowNativeFamily(value));
  }
});

test('the committed evaluator fixtures follow Core', () => {
  assert.deepEqual(golden.family, family);
  for (const {from, to, t, mixed} of golden.colours)
    assert.equal(mixTileflowNativeColours(from, to, t) ?? null, mixed);
  for (const {values, position, select, filled} of golden.leaves)
    assert.deepEqual(
      fillTileflowNativeTemplate(
        {[tileflowNativeLeafKey]: values},
        position,
        select ? {select} : {},
      ),
      filled,
    );
  for (const {group, selection, position, layers} of golden.blends)
    assert.deepEqual(
      tileflowNativeBlendLayers(family.blend.groups[group]!, selection, position),
      layers,
    );
  for (const {theme, target, t, keep, value} of golden.emphasis)
    assert.deepEqual(
      emphasizeTileflowNativeValue(family.themes[theme]!.emphasis.targets[target]!, t, keep),
      value,
    );
  const catalog = {
    ...golden.catalog,
    name: 'Evaluators',
    themes: Object.fromEntries(golden.catalog.themes.map((name: string) => [name, {}])),
  };
  for (const {selection, colorScheme, timeOfDay, theme} of golden.themeSelections) {
    let resolved: string | null = null;
    try {
      resolved = resolveTileflowRuntimeTheme(catalog, selection, colorScheme, timeOfDay).name;
    } catch {
      resolved = null;
    }
    assert.equal(resolved, theme);
  }
  for (const {from, to, t, mixed} of golden.suns)
    assert.deepEqual(mixTileflowSunPresets(from, to, t), mixed);
  for (const {from, to, t, mixed} of golden.routeInks)
    assert.deepEqual(mixTileflowRouteInks(from, to, t), mixed);
});
