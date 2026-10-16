import assert from 'node:assert/strict';
import test from 'node:test';
import {createStyle, defineMap, disable, parseTileflowMap, resolveThemeSelection} from '../src';
import {createManifest} from '../src/build';
import {parseTileflowRuntimeManifest} from '../src/manifest';
import {createTileflowNativeSourceController} from '../src/native';
import {parseTileflowRuntimeManifest as parseNative} from '../src/native-manifest-schema';
import {
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeTheme,
  resolveTileflowStaticImageUrl,
} from '../src/runtime';
import {extendStreets, testLightTheme} from './map-fixture';
import {bytes, source, transport} from './native-manifest-fixture';

const authored = extendStreets({
  id: 'streets',
  modules: {poi: disable()},
  defaultTheme: 'paper',
  systemThemes: {light: 'paper', dark: 'ink'},
  themes: {
    paper: testLightTheme,
    ink: {...testLightTheme, id: 'ink', colorScheme: 'dark'},
    plain: testLightTheme,
  },
  timeOfDay: {paper: {day: 'paper', dawn: 'paper', dusk: 'ink', night: 'ink'}},
});
const resolved = parseTileflowMap(authored);
const manifest = createManifest({maps: {streets: resolved}});
const runtime = resolveTileflowManifestMap(manifest, 'streets')!;

test('timeOfDay resolves arbitrary themes, aliases, defaults and system without changing omitted selection', () => {
  for (const [theme, scheme, moment, expected] of [
    [undefined, undefined, undefined, 'paper'],
    ['ink', undefined, undefined, 'ink'],
    [undefined, undefined, 'night', 'ink'],
    ['ink', undefined, 'day', 'paper'],
    ['system', 'dark', undefined, 'ink'],
    ['system', 'dark', 'day', 'paper'],
    ['system', 'light', 'night', 'ink'],
    ['plain', undefined, 'night', 'plain'],
  ] as const) {
    assert.equal(resolveTileflowRuntimeTheme(runtime, theme, scheme, moment).name, expected);
  }
  assert.equal(
    resolveTileflowRuntimeStyle({
      source: {map: 'streets'},
      manifestMap: runtime,
      theme: 'paper',
      timeOfDay: 'night',
    })?.style,
    runtime.themes.ink!.styleUrl,
  );
  assert.equal(resolveThemeSelection(resolved, 'paper', 'night').name, 'ink');
  assert.throws(() => resolveTileflowRuntimeTheme(runtime, 'missing', undefined, 'day'), /Unknown/);
  assert.throws(() => resolveTileflowRuntimeTheme(runtime, 'system', undefined, 'day'));
  const image = resolveTileflowStaticImageUrl({
    manifestMap: {...runtime, mapId: 'test'},
    theme: 'paper',
    timeOfDay: 'night',
    center: [0, 0],
    zoom: 2,
    imageSize: {height: 200, width: 200},
  })!;
  assert.equal(new URL(image).searchParams.get('theme'), 'ink');
});

test('maps without the capability are unchanged; partial families reject unavailable moments', () => {
  assert.equal(
    resolveTileflowRuntimeTheme({...runtime, timeOfDay: undefined}, 'paper', undefined, 'night')
      .name,
    'paper',
  );
  const partial = {...runtime, timeOfDay: {paper: {day: 'paper'}}} as const;
  assert.equal(resolveTileflowRuntimeTheme(partial, 'plain', undefined, 'night').name, 'plain');
  assert.throws(
    () => resolveTileflowRuntimeTheme(partial, 'paper', undefined, 'night'),
    /does not offer/,
  );
});

test('catalog inherits atomically, can be disabled and is cleared when themes are replaced', () => {
  const child = (design: object) =>
    defineMap({id: 'child', version: 1, extends: authored, ...design});
  assert.deepEqual(parseTileflowMap(child({})).timeOfDay, resolved.timeOfDay);
  assert.deepEqual(parseTileflowMap(child({timeOfDay: {}})).timeOfDay, {});
  assert.doesNotThrow(() =>
    parseTileflowMap(child({timeOfDay: {paper: {day: 'paper', night: undefined}}})),
  );
  assert.equal(parseTileflowMap(child({themes: {paper: testLightTheme}})).timeOfDay, undefined);
  assert.deepEqual(parseTileflowMap(child({timeOfDay: {paper: {day: 'paper'}}})).timeOfDay, {
    paper: {day: 'paper'},
  });
});

test('catalog selection compiles the existing complete style including lighting unchanged', () => {
  assert.deepEqual(
    createStyle(authored, {theme: 'paper', timeOfDay: 'night'}),
    createStyle(authored, {theme: 'ink'}),
  );
  assert.deepEqual(
    createStyle(authored, {theme: 'paper', timeOfDay: 'day'}),
    createStyle(authored, {theme: 'paper'}),
  );
});

test('V2 roundtrips the catalog through browser and native; explicit V1 export preserves every concrete theme', () => {
  assert.equal(manifest.version, 2);
  assert.deepEqual(parseTileflowRuntimeManifest(manifest), parseNative(manifest));
  assert.deepEqual(runtime.timeOfDay, resolved.timeOfDay);
  const legacy = createManifest({maps: {streets: resolved}}, {manifestVersion: 1});
  assert.equal(legacy.version, 1);
  assert.equal(legacy.maps.streets!.timeOfDay, undefined);
  assert.deepEqual(legacy.maps.streets!.themes, runtime.themes);
  assert.deepEqual(parseTileflowRuntimeManifest(legacy), parseNative(legacy));
  assert.throws(() => parseTileflowRuntimeManifest({...manifest, version: 1}));
});

test('both readers and authoring reject dangling, ambiguous, empty and unknown presets', () => {
  for (const timeOfDay of [
    {absent: {day: 'paper'}},
    {paper: {day: 'missing'}},
    {paper: {}},
    {paper: {day: 'ink'}},
    {paper: {day: 'paper', midnight: 'ink'}},
    {paper: {day: 'paper', night: 'ink'}, ink: {day: 'ink'}},
  ]) {
    assert.throws(() => parseTileflowMap({...authored, timeOfDay}));
    const input = {...manifest, maps: {streets: {...manifest.maps.streets, timeOfDay}}};
    assert.throws(() => parseTileflowRuntimeManifest(input));
    assert.throws(() => parseNative(input));
  }
});

test('native acquisition resolves the same preset and retains catalog metadata', async () => {
  const controller = createTileflowNativeSourceController({
    acquire: transport(bytes(manifest)).acquire,
  });
  await controller.replace(source, {theme: 'system', colorScheme: 'light', timeOfDay: 'night'});
  const state = controller.state;
  assert.equal(state?.status, 'ready');
  if (state?.status !== 'ready') throw new Error('Expected ready native source');
  assert.equal(state.theme.name, 'ink');
  assert.deepEqual(state.map.timeOfDay, resolved.timeOfDay);
  controller.dispose();
});
