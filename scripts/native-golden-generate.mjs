import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {format, resolveConfig} from 'prettier';

// Writes the golden fixtures that native evaluators (Swift, Kotlin) must reproduce: colour mixing in
// OKLab, template leaves at a position, blend layers of a small family, emphasis at a strength,
// theme selection, and sun and route-ink mixing. Core computes every expected value from the same
// functions the web uses, from the styles in native-family-input.json. `--check` fails instead when
// the committed fixture differs. Build @tileflow/core first.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = 'packages/core/test/fixtures/native-family-input.json';
const target = 'packages/core/test/fixtures/native-evaluators.json';
// The Swift and Kotlin tests read the same bytes; Android's unit tests share the iOS fixtures.
const copies = ['platforms/ios/Tests/TileflowTests/Fixtures/Native/native-evaluators.json'];
const core = (entry) => import(pathToFileURL(resolve(root, `packages/core/dist/${entry}.js`)).href);
const profile = await core('native-profile');
const {resolveTileflowRuntimeTheme, resolveTileflowSun, tileflowSunPosition} = await core('index');
const {tileflowShotStateAt} = await core('browser');

// A small family: three themes that blend and one, `mono`, with another layer list.
const input = JSON.parse(await readFile(resolve(root, source), 'utf8'));
const {themes, styles} = input;

const family = profile.createTileflowNativeFamily({
  map: 'evaluators',
  themes,
  styles,
});

const colours = [
  ['#ff0000', '#0000ff', 0.5],
  ['#fff', '#000', 0.25],
  ['#0000', '#00ff00', 0.5],
  ['#00ff0000', '#0000', 0.5],
  ['#11223344', '#aabbccdd', 0.4],
  ['rgba(0, 128, 255, 0.5)', 'hsl(120, 50%, 50%)', 0.75],
  ['rgb(10%, 20%, 30%)', '#000000', 0.5],
  ['hsla(300, 100%, 25%, 0.2)', 'rgb(255 255 0)', 0.6],
  ['#f00', '#f00', 0.3],
  ['#f00', '#00f', 0],
  ['#f00', '#00f', 1],
  ['#f00', 'red', 0.5],
].map(([from, to, t]) => ({
  from,
  to,
  t,
  mixed: profile.mixTileflowNativeColours(from, to, t) ?? null,
}));

const leafCases = [
  [[0, 10, 20], 0.5],
  [[0, 10, 20], 1.25],
  [[0, 10, 20], 2],
  [[0, 10, 20], 3],
  [[0, 10, 20], -1],
  [[0, 10, 20], 0.5, [2, 0]],
  [['#f4f0ef', '#e8d0c0', '#0b1020'], 0.3],
  [['#f4f0ef', '#e8d0c0', '#0b1020'], 1.6],
  [['#f4f0ef', '#e8d0c0', '#0b1020'], 0.75, [2, 1]],
  [['#ffffff', 'rgba(255, 255, 255, 0)'], 0.5],
  [[5, 5, 5], 0.5],
];
const leaves = leafCases.map(([values, position, select]) => ({
  values,
  position,
  ...(select ? {select} : {}),
  filled: profile.fillTileflowNativeTemplate(
    {[profile.tileflowNativeLeafKey]: values},
    position,
    select ? {select} : {},
  ),
}));

const group = family.blend.groups[0];
const blends = [
  [[0, 1, 2], 0.4],
  [[0, 1, 2], 1.5],
  [[2, 0], 0.6],
  [[1, 2], 0.5],
].map(([selection, position]) => ({
  group: 0,
  selection,
  position,
  layers: profile.tileflowNativeBlendLayers(group, selection, position),
  ...(group.light === undefined
    ? {}
    : {light: profile.fillTileflowNativeTemplate(group.light, position, {select: selection})}),
}));

const keep = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};
const emphasis = [];
for (const theme of [0, 2]) {
  for (const [target, entry] of family.themes[theme].emphasis.targets.entries()) {
    for (const t of [0, 0.5, 1])
      emphasis.push({theme, target, t, value: profile.emphasizeTileflowNativeValue(entry, t)});
    if (entry.kind === 'label')
      emphasis.push({
        theme,
        target,
        t: 0.5,
        keep,
        value: profile.emphasizeTileflowNativeValue(entry, 0.5, keep),
      });
  }
}

const catalog = {
  name: 'Evaluators',
  defaultTheme: 'day',
  systemThemes: {light: 'day', dark: 'night'},
  timeOfDay: {day: {day: 'day', dusk: 'dusk', night: 'night'}},
  themes: Object.fromEntries(themes.map((name) => [name, {}])),
};
const selections = [
  [undefined],
  ['system', 'light'],
  ['system', 'dark'],
  ['day', undefined, 'dusk'],
  ['day', undefined, 'night'],
  ['dusk', undefined, 'day'],
  ['mono', undefined, 'night'],
  ['system', 'dark', 'dusk'],
  ['day', undefined, 'dawn'],
  ['unknown'],
  ['system'],
];
const themeSelections = selections.map(([selection, colorScheme, timeOfDay]) => {
  let theme = null;
  try {
    theme = resolveTileflowRuntimeTheme(catalog, selection, colorScheme, timeOfDay).name;
  } catch {
    // Undefined selections fail instead of falling back: the fixture records null.
  }
  return {
    ...(selection === undefined ? {} : {selection}),
    ...(colorScheme === undefined ? {} : {colorScheme}),
    ...(timeOfDay === undefined ? {} : {timeOfDay}),
    theme,
  };
});

const [day, dusk, night] = family.themes;
const sunMixes = [
  [day.sun, dusk.sun, 0.5],
  [dusk.sun, night.sun, 0.25],
  [day.sun, night.sun, 1],
].map(([from, to, t]) => ({from, to, t, mixed: profile.mixTileflowSunPresets(from, to, t)}));
const inkMixes = [
  [day.routeInks, night.routeInks, 0.5],
  [night.routeInks, dusk.routeInks, 0.2],
].map(([from, to, t]) => ({from, to, t, mixed: profile.mixTileflowRouteInks(from, to, t)}));

// Noon, sunrise, polar winter and the date line exercise the date and refraction branches.
const solar = [
  ['2026-06-21T12:00:00Z', [-3.7, 40.42]],
  ['2026-03-20T06:05:00Z', [0, 51.48]],
  ['2026-12-21T12:00:00Z', [18.96, 69.65]],
  ['2026-09-23T01:30:00Z', [179.5, -16]],
].map(([iso, location]) => {
  const date = Date.parse(iso);
  const position = tileflowSunPosition(date, location);
  return {
    date,
    location,
    preset: day.sun,
    position,
    resolved: resolveTileflowSun(day.sun, position, 'date'),
  };
});

const keyframes = [
  {
    at: 0,
    camera: {center: [178, 10], zoom: 8, bearing: 350, pitch: 5},
    blend: {themes: ['light', 'dark'], position: 0},
  },
  {
    at: 600,
    camera: {center: [-178, 50], zoom: 10, bearing: 10, pitch: 35},
    blend: {themes: ['light', 'dark'], position: 0.7},
  },
  {
    at: 1000,
    camera: {center: [-160, 25], zoom: 9, bearing: 250, pitch: 15},
    blend: {themes: ['light', 'dark'], position: 1},
  },
];
const shots = ['linear', 'smooth'].map((easing) => {
  const shot = {easing, keyframes};
  const samples = [-100, 0, 150, 300, 600, 850, 1000, 1100].map((at) => ({
    ...tileflowShotStateAt(shot, at),
    requestedAt: at,
  }));
  return {shot, samples};
});

const fixture = {
  kind: 'tileflow-native-evaluator-fixtures',
  schemaVersion: 1,
  profile: 'native-v1',
  catalog: {
    defaultTheme: catalog.defaultTheme,
    systemThemes: catalog.systemThemes,
    timeOfDay: catalog.timeOfDay,
    themes,
  },
  family,
  colours,
  leaves,
  blends,
  emphasis,
  themeSelections,
  solar,
  shots,
  suns: sunMixes,
  routeInks: inkMixes,
};
const path = resolve(root, target);
// The repository formats JSON; the committed fixture keeps that form.
const content = await format(JSON.stringify(fixture, null, 2), {
  ...(await resolveConfig(path)),
  parser: 'json',
});
for (const file of [target, ...copies]) {
  const output = resolve(root, file);
  if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => undefined);
    if (current !== content)
      throw new Error(`Regenerate with node scripts/native-golden-generate.mjs:\n${file}`);
  } else {
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, content);
  }
}
