import assert from 'node:assert/strict';
import test from 'node:test';
import {planTileflowThemeBlend} from '@tileflow/core/native';
import type {NativeThemeValues} from '../src/native-surface-contract';
import {createNativeThemeBlender, nativeBlendLabelFadeMs} from '../src/native-theme-blend';
import {deferred} from './session-fixture';

type Styles = Parameters<typeof planTileflowThemeBlend>[0];
const style = (layers: Record<string, unknown>[], root: Record<string, unknown> = {}) => ({
  version: 8,
  sources: {world: {type: 'vector', tiles: ['https://tiles.example.test/{z}/{x}/{y}.pbf']}},
  sprite: 'https://tiles.example.test/sprite',
  glyphs: 'https://tiles.example.test/fonts/{fontstack}/{range}.pbf',
  layers,
  ...root,
});
const theme = (ground: string, label: string, pattern: string, casing: unknown) =>
  style(
    [
      {id: 'ground', type: 'background', paint: {'background-color': ground}},
      {
        id: 'grass',
        type: 'fill',
        source: 'world',
        'source-layer': 'land',
        paint: {'fill-pattern': pattern},
      },
      {
        id: 'roads',
        type: 'line',
        source: 'world',
        'source-layer': 'roads',
        paint: {
          'line-color': casing,
          'line-opacity': ['match', ['get', 'class'], 'path', 0.5, 1],
        },
      },
      {
        id: 'names',
        type: 'symbol',
        source: 'world',
        'source-layer': 'places',
        layout: {'text-field': ['get', 'name']},
        paint: {'text-color': label},
      },
    ],
    {light: {anchor: 'viewport', color: ground, intensity: 0.2}},
  );
const casing = (colour: string) => [
  'case',
  ['all', ['has', 'access'], ['>=', ['zoom'], 14]],
  colour,
  '#000000',
];
const plan = planTileflowThemeBlend(
  [
    theme('#000000', '#ffffff', 'grass-night', casing('#202020')),
    theme('#ffffff', '#000000', 'grass-day', casing('#e0e0e0')),
  ] as unknown as Styles,
  {featureSwitches: 'layers', iconImages: 'switch'},
);

function port() {
  const batches: NativeThemeValues[] = [];
  const calls: string[] = [];
  let covered = true;
  let hold: Promise<void> | undefined;
  return {
    batches,
    calls,
    cover(value: boolean) {
      covered = value;
    },
    hold(value: Promise<void> | undefined) {
      hold = value;
    },
    value: {
      async apply(values: NativeThemeValues) {
        calls.push('apply');
        batches.push(values);
        await hold;
      },
      async cover(duration: number) {
        calls.push(`cover ${duration}`);
        return covered;
      },
      async reveal(duration: number) {
        calls.push(`reveal ${duration}`);
      },
    },
  };
}
const paintOf = (values: NativeThemeValues | undefined) =>
  Object.fromEntries(
    (values?.paint ?? []).map(([layer, property, value]) => [`${layer} ${property}`, value]),
  );

test('a blend at its baked position sends nothing; later positions send only changed values', async () => {
  const p = port();
  const blender = createNativeThemeBlender(plan, p.value, {baked: 0, failed: () => assert.fail()});
  blender.set(0);
  await blender.whenIdle();
  assert.deepEqual(p.batches, []);

  blender.set(0.25);
  await blender.whenIdle();
  assert.equal(p.batches.length, 1);
  const values = paintOf(p.batches[0]);
  assert.match(String(values['ground background-color']), /^rgba\(/u);
  assert.equal(values['names text-color'], undefined, 'symbols keep the nearest theme');
  assert.deepEqual(p.batches[0]!.images, [['grass-night', 'grass-night', 'grass-day', 0.25]]);
  assert.match(String(p.batches[0]!.light?.color), /^rgba\(/u);

  // A four-hundredth of a theme is skipped; whole themes are always reached exactly.
  blender.set(0.251);
  await blender.whenIdle();
  assert.equal(p.batches.length, 1);
  blender.set(1);
  await blender.whenIdle();
  // The ground batch, then the nearest theme's symbols and switches.
  assert.equal(paintOf(p.batches.at(-2))['ground background-color'], '#ffffff');
  assert.equal(paintOf(p.batches.at(-1))['names text-color'], '#000000');
});

test('the nearest theme changes symbols and switched layers under a cover, then reveals', async () => {
  const p = port();
  const blender = createNativeThemeBlender(plan, p.value, {
    baked: 0.2,
    failed: () => assert.fail(),
  });
  blender.set(0.6);
  await blender.whenIdle();
  assert.deepEqual(p.calls, [
    'apply',
    `cover ${nativeBlendLabelFadeMs}`,
    'apply',
    `reveal ${nativeBlendLabelFadeMs}`,
  ]);
  const nearest = p.batches[1]!;
  assert.equal(paintOf(nearest)['names text-color'], '#000000');
  assert.deepEqual(
    (nearest.layout ?? []).map(([layer, property, value]) => [layer, property, value]),
    [
      ['roads::theme-0', 'visibility', 'none'],
      ['roads::theme-1', 'visibility', 'visible'],
    ],
  );
  assert.equal(blender.dominant, 1);

  // Without a cover (reduced motion or an older native build) the change is immediate.
  const q = port();
  q.cover(false);
  const immediate = createNativeThemeBlender(plan, q.value, {
    baked: 0.2,
    failed: () => assert.fail(),
  });
  immediate.set(0.6);
  await immediate.whenIdle();
  assert.deepEqual(q.calls, ['apply', `cover ${nativeBlendLabelFadeMs}`, 'apply']);
});

test('positions that arrive while a batch is in flight coalesce into one later batch', async () => {
  const p = port();
  const gate = deferred<void>();
  p.hold(gate.promise);
  const blender = createNativeThemeBlender(plan, p.value, {baked: 0, failed: () => assert.fail()});
  blender.set(0.1);
  await Promise.resolve();
  for (const position of [0.15, 0.2, 0.3, 0.35, 0.4]) blender.set(position);
  p.hold(undefined);
  gate.resolve();
  await blender.whenIdle();
  assert.equal(p.batches.length, 2);
  assert.equal(blender.position, 0.4);
});

test('a failed batch stops the blender once and reports the failure', async () => {
  let failures = 0;
  const blender = createNativeThemeBlender(
    plan,
    {
      async apply() {
        throw new Error('Native surface operation failed.');
      },
      async cover() {
        return false;
      },
      async reveal() {},
    },
    {baked: 0, failed: () => failures++},
  );
  blender.set(0.5);
  await blender.whenIdle();
  blender.set(0.9);
  await blender.whenIdle();
  assert.equal(failures, 1);
});
