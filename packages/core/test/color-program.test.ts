import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import test from 'node:test';
import {color, createStyle, defineTheme, disable, fixed, land, token} from '../src';
import {createTileflowThemeController} from '../src/browser-bundle';
import {type TileflowColorBindings, tileflowColorMetadataKey} from '../src/color-program';
import {applyTileflowColorOverrides} from '../src/color-program-runtime';
import {createTileflowStyleFamily, materializeTileflowStyleFamily} from '../src/style-family';
import {createTileflowFamilyAnimator} from '../src/style-family-browser';
import {prepareTileflowStyleFamilyForRendering} from '../src/style-family-render';
import {extendStreets, testLightTheme} from './map-fixture';

const theme = defineTheme(testLightTheme, {
  id: 'colors',
  version: 1,
  colorScheme: 'light',
  tokens: {
    color: {
      'surface.water': '#00aaff',
      'surface.background': '#00aaff',
      'surface.park': color.alpha(token.color('surface.water'), 0.5),
    },
  },
  lighting: {sun: {color: token.color('surface.water')}},
});

test('colour changes interrupt transitions, roll back failed writes and stop on disposal', async () => {
  const family = prepareTileflowStyleFamilyForRendering(
    createTileflowStyleFamily({
      light: createStyle(map, {theme: 'light', runtimeColors: true}),
      dusk: createStyle(map, {theme: 'dusk', runtimeColors: true}),
    }),
  );
  let now = 0,
    next = 0,
    failWrite = false;
  const callbacks = new Map<number, (time: number) => void>();
  const animator = createTileflowFamilyAnimator({
    family,
    initialTheme: 'light',
    now: () => now,
    requestFrame: (callback) => {
      callbacks.set(++next, callback);
      return next;
    },
    cancelFrame: (id) => {
      callbacks.delete(id);
    },
    writePaint() {
      if (failWrite) {
        failWrite = false;
        throw new Error('Unavailable');
      }
    },
    onFrame() {},
  });
  const advance = (time: number) => {
    now = time;
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(now));
  };
  const themeChange = animator.setTheme('dusk', 100);
  advance(40);
  const first = animator.setColors({'surface.water': '#00ff00'}, 100);
  const last = animator.setColors({'surface.water': '#ff0000'}, 100);
  assert.equal((await themeChange).status, 'superseded');
  assert.equal((await first).status, 'superseded');
  advance(160);
  assert.equal((await last).status, 'applied');
  failWrite = true;
  assert.equal((await animator.setColors({'surface.water': '#0000ff'}, 0)).status, 'failed');
  assert.deepEqual(animator.getColors(), {'surface.water': '#ff0000'});
  failWrite = true;
  assert.equal((await animator.setTheme('light', 0)).status, 'failed');
  assert.equal(
    (await animator.setColors({}, 0)).theme,
    'dusk',
    'failed targets must not become current',
  );
  animator.dispose();
  assert.equal(callbacks.size, 0);
  assert.equal((await animator.setColors({'surface.water': '#0000ff'}, 0)).status, 'superseded');
  assert.deepEqual(animator.getColors(), {});
});
const map = extendStreets({
  themes: {
    light: theme,
    dusk: defineTheme(theme, {
      id: 'dusk',
      version: 1,
      colorScheme: 'dark',
      tokens: {color: {'surface.water': '#005588'}},
    }),
  },
  modules: {
    poi: disable(),
    land: land({background: {color: token.color('surface.background')}}),
  },
});

test('custom sky colours remain consistent when the independent sun selects another moment', () => {
  const withSky = extendStreets({
    themes: map.themes,
    timeOfDay: {light: {day: 'light', dawn: 'light', dusk: 'dusk', night: 'dusk'}},
    sky: {
      color: token.color('surface.water'),
      horizonColor: fixed('#ffeedd', {reason: 'Fixed horizon'}),
      glowColor: token.color('surface.water'),
    },
    modules: {poi: disable()},
  });
  const source = createStyle(withSky, {theme: 'light', runtimeColors: true});
  const changed = applyTileflowColorOverrides(source, {'surface.water': '#00ff00'});
  assert.equal(changed.sky!['sky-color'], '#00ff00');
  const sky = changed.metadata!['tileflow:sky'] as {
    timesOfDay: Record<string, {color: string; horizonColor: string; glowColor: string}>;
  };
  for (const moment of Object.values(sky.timesOfDay)) {
    assert.equal(moment.color, '#00ff00');
    assert.equal(moment.glowColor, '#00ff00');
    assert.equal(moment.horizonColor, '#ffeedd');
  }
  assert.equal(applyTileflowColorOverrides(source, {}), source);
});

test('runtime programs retain semantic identity, derivations, fixed colours and valid output', () => {
  const style = createStyle(map, {runtimeColors: true});
  const metadata = style.metadata?.[tileflowColorMetadataKey] as TileflowColorBindings;
  assert.ok(metadata.bindings.length > 10);
  const changed = applyTileflowColorOverrides(style, {'surface.water': '#00ff00'});
  const background = (value: typeof style) =>
    value.layers.find((layer) => layer.type === 'background')?.paint;
  assert.deepEqual(
    background(changed),
    background(style),
    'equal literals do not establish identity',
  );
  assert.equal(JSON.stringify(changed).includes('rgba(0, 255, 0, 0.5)'), true);
  assert.equal((changed.metadata?.['tileflow:sun'] as {color: string}).color, '#00ff00');
  assert.deepEqual(validateStyleMin(changed), []);
  assert.equal(applyTileflowColorOverrides(style, {}), style);
  assert.throws(
    () => applyTileflowColorOverrides(style, {missing: '#000000'}),
    /Unknown colour token/u,
  );
  assert.throws(() => applyTileflowColorOverrides(style, {'surface.water': 'invalid'}));
  assert.equal(JSON.stringify(style).includes('#00ff00'), false, 'input is immutable');
  const fixedMap = extendStreets({
    themes: {light: theme},
    modules: {
      poi: disable(),
      land: land({background: {color: fixed('#00aaff', {reason: 'Application brand'})}}),
    },
  });
  const own = createStyle(fixedMap, {runtimeColors: true});
  assert.deepEqual(
    background(applyTileflowColorOverrides(own, {'surface.water': '#00ff00'})),
    background(own),
  );
});

test('prepared families apply and reset colours without replacing styles or changing application layers', async () => {
  const family = prepareTileflowStyleFamilyForRendering(
    createTileflowStyleFamily({
      light: createStyle(map, {theme: 'light', runtimeColors: true}),
      dusk: createStyle(map, {theme: 'dusk', runtimeColors: true}),
    }),
  );
  assert.equal(family.updates.appearanceOnly, true);
  const paints: [string, string, unknown][] = [];
  const controller = createTileflowThemeController({
    initial: {family, theme: 'light', style: materializeTileflowStyleFamily(family, 'light')},
    map: {
      on() {},
      off() {},
      setStyle() {
        assert.fail('must not replace styles');
      },
      setPaintProperty(id: string, property: string, value: unknown) {
        paints.push([id, property, value]);
      },
    },
  });
  assert.equal(
    (await controller.setColors({'surface.water': '#00ff00'}, {transition: 0})).status,
    'applied',
  );
  assert.deepEqual(controller.getColors(), {'surface.water': '#00ff00'});
  assert.ok(paints.some(([, , value]) => JSON.stringify(value).includes('#00ff00')));
  assert.ok(paints.every(([id]) => id.startsWith('tileflow-')));
  assert.equal(
    (
      await controller.setTheme(
        {family, theme: 'dusk', style: materializeTileflowStyleFamily(family, 'dusk')},
        {transition: 0},
      )
    ).status,
    'applied',
  );
  assert.deepEqual(controller.getColors(), {'surface.water': '#00ff00'});
  assert.equal((await controller.setColors({missing: '#000000'})).status, 'failed');
  assert.deepEqual(controller.getColors(), {'surface.water': '#00ff00'});
  assert.equal((await controller.setColors({}, {transition: 0})).status, 'applied');
  assert.deepEqual(controller.getColors(), {});
  assert.deepEqual(validateStyleMin(controller.getCurrent().style), []);
  controller.dispose();
});

test('runtime colour overrides accept CSS Color 4 and name what they cannot read', () => {
  const style = createStyle(map, {runtimeColors: true});
  const changed = applyTileflowColorOverrides(style, {
    'surface.water': 'oklch(0.145 0 0)',
  });
  assert.equal((changed.metadata?.['tileflow:sun'] as {color: string}).color, '#0a0a0a');
  assert.deepEqual(validateStyleMin(changed), []);
  assert.equal(
    JSON.stringify(applyTileflowColorOverrides(style, {'surface.water': '#0a0a0a'})),
    JSON.stringify(changed),
    'oklch() gives the style of the sRGB colour it converts to',
  );
  assert.throws(
    () => applyTileflowColorOverrides(style, {'surface.water': 'var(--primary)'}),
    /colour for "surface\.water" "var\(--primary\)" depends on the page/u,
  );
  assert.throws(
    () => applyTileflowColorOverrides(style, {'surface.water': 'papayawhip'}),
    /not a colour Tileflow reads/u,
  );
  assert.throws(
    () => applyTileflowColorOverrides(style, {'surface.nope': '#fff', 'surface.also': '#fff'}),
    /Unknown colour tokens "surface\.nope", "surface\.also"\./u,
  );
});

const knobDusk = defineTheme(theme, {
  id: 'knob-dusk',
  version: 1,
  colorScheme: 'dark',
  tokens: {color: {'surface.water': '#005588', 'surface.background': '#102030'}},
});
const knobMap = extendStreets({
  themes: {light: theme, dusk: knobDusk},
  colorKnobs: {
    sea: {
      reference: 'surface.water',
      tokens: {'surface.background': 'shift', 'surface.water': 'replace'},
    },
  },
  modules: {
    poi: disable(),
    land: land({background: {color: token.color('surface.background')}}),
  },
});
const background = (style: ReturnType<typeof createStyle>) =>
  style.layers.find((layer) => layer.type === 'background')!.paint!['background-color'];

test('a colour knob recolours the tokens it governs and leaves the rest as authored', () => {
  const style = createStyle(knobMap, {theme: 'light', runtimeColors: true});
  const catalog = style.metadata?.[tileflowColorMetadataKey] as TileflowColorBindings;
  assert.deepEqual(Object.keys(catalog.knobs!), ['sea']);

  const changed = applyTileflowColorOverrides(style, {sea: '#ff0000'});
  // Both tokens were #00aaff, so replace and shift land on the same colour.
  assert.equal(background(changed), '#ff0000');
  assert.equal((changed.metadata?.['tileflow:sun'] as {color: string}).color, '#ff0000');
  assert.equal(background(style), '#00aaff', 'the input is untouched');
  assert.deepEqual(validateStyleMin(changed), []);
});

test('a token named in colors wins over the knob that governs it', () => {
  const style = createStyle(knobMap, {theme: 'light', runtimeColors: true});
  const changed = applyTileflowColorOverrides(style, {
    sea: '#ff0000',
    'surface.background': '#00ff00',
  });
  assert.equal(background(changed), '#00ff00');
  assert.equal((changed.metadata?.['tileflow:sun'] as {color: string}).color, '#ff0000');
});

test("a knob works from each theme's own colours, so a darker theme keeps its offset", () => {
  const dusk = createStyle(knobMap, {theme: 'dusk', runtimeColors: true});
  // In dusk the background (#102030) is much darker than the water (#005588); a shift keeps that.
  const changed = applyTileflowColorOverrides(dusk, {sea: '#ffcc00'});
  const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16);
  assert.ok(lightness(background(changed) as string) < lightness('#ffcc00'));
  assert.notEqual(background(changed), '#ffcc00');
});

test('an unknown knob, or a knob a map does not declare, is an error that says what exists', () => {
  const style = createStyle(knobMap, {theme: 'light', runtimeColors: true});
  assert.throws(
    () => applyTileflowColorOverrides(style, {sky: '#ffffff'}),
    /Unknown colour knob "sky"\. This map has sea\./u,
  );
  const plain = createStyle(map, {theme: 'light', runtimeColors: true});
  assert.throws(
    () => applyTileflowColorOverrides(plain, {sea: '#ffffff'}),
    /Unknown colour token or knob "sea"\. This map declares no colour knobs/u,
  );
});

test('a map whose knob governs a token its themes lack fails to compile with the knob and token', () => {
  const broken = extendStreets({
    themes: {light: theme, dusk: knobDusk},
    colorKnobs: {sea: {tokens: {'surface.nowhere': 'replace'}}},
    modules: {poi: disable()},
  });
  assert.throws(
    () => createStyle(broken, {theme: 'light', runtimeColors: true}),
    /colorKnobs.*sea governs "surface\.nowhere", which is not a colour token of the map/u,
  );
});

test('knobs set through the family animator reach every theme and survive theme changes', async () => {
  const family = prepareTileflowStyleFamilyForRendering(
    createTileflowStyleFamily({
      light: createStyle(knobMap, {theme: 'light', runtimeColors: true}),
      dusk: createStyle(knobMap, {theme: 'dusk', runtimeColors: true}),
    }),
  );
  const animator = createTileflowFamilyAnimator({
    family,
    initialTheme: 'light',
    now: () => 0,
    requestFrame: () => 0,
    cancelFrame() {},
    writePaint() {},
    onFrame() {},
  });
  assert.equal((await animator.setColors({sea: '#ff0000'}, 0)).status, 'applied');
  assert.deepEqual(animator.getColors(), {sea: '#ff0000'});
  assert.equal(background(animator.getStyle('light') as ReturnType<typeof createStyle>), '#ff0000');
  assert.notEqual(
    background(animator.getStyle('dusk') as ReturnType<typeof createStyle>),
    '#102030',
  );
  assert.equal((await animator.setTheme('dusk', 0)).status, 'applied');
  assert.deepEqual(animator.getColors(), {sea: '#ff0000'});
  assert.equal((await animator.setColors({}, 0)).status, 'applied');
  assert.equal(background(animator.getStyle('light') as ReturnType<typeof createStyle>), '#00aaff');
  animator.dispose();
});
