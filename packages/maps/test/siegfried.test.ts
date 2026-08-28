import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {createStyle, defineMap, disable, resolveMap, resolveTileflowTheme} from '@tileflow/core';
import {createStyleWithInspection} from '@tileflow/core/build';
import {siegfried, siegfriedFonts, siegfriedIcons, siegfriedThemes} from '../src';

const patternNames = [
  'forest',
  'glacier',
  'gravel',
  'orchard',
  'paper-grain',
  'rock',
  'scree',
  'water-lines',
  'wetland',
] as const;

const lightIconIds = patternNames.map((name) => `siegfried-${name}`);
const darkIconIds = patternNames.map((name) => `siegfried-dark-${name}`);
const iconIds = [...lightIconIds, ...darkIconIds];

const fontNames = [
  'Cormorant Garamond Italic',
  'Cormorant Garamond Regular',
  'Cormorant Garamond SemiBold',
] as const;

const themePalettes = {
  light: new Set(['#000000', '#171713', '#5D90D0', '#A96C4D', '#F0EBE0']),
  dark: new Set(['#000000', '#151612', '#79A9D6', '#C48A68', '#E8E0D0']),
} as const;

function compileSiegfried(theme: 'light' | 'dark' = 'light') {
  return createStyle(siegfried, {
    preparedAssets: {
      icons: {ids: iconIds, sprite: '/tileflow/icons/siegfried/sprite'},
    },
    theme,
  });
}

function compileSiegfriedInspected(theme: 'light' | 'dark' = 'light') {
  return createStyleWithInspection(siegfried, {
    preparedAssets: {
      icons: {ids: iconIds, sprite: '/tileflow/icons/siegfried/sprite'},
    },
    theme,
  });
}

function compiledTargets(compiled: ReturnType<typeof compileSiegfriedInspected>): Set<string> {
  return new Set(
    compiled.inspection.layers.flatMap((layer) =>
      layer.contributions.map((contribution) => contribution.target),
    ),
  );
}

function compiledLayer(compiled: ReturnType<typeof compileSiegfriedInspected>, target: string) {
  const layerId = compiled.inspection.layers.find((layer) =>
    layer.contributions.some((contribution) => contribution.target === target),
  )?.id;
  return compiled.style.layers.find((layer) => layer.id === layerId);
}

function compiledLayerIndex(
  compiled: ReturnType<typeof compileSiegfriedInspected>,
  target: string,
): number {
  return compiled.inspection.layers.findIndex((layer) =>
    layer.contributions.some((contribution) => contribution.target === target),
  );
}

function patternReferences(style: ReturnType<typeof compileSiegfried>): string[] {
  return [
    ...new Set(
      style.layers.flatMap((layer) =>
        Object.entries((layer.paint ?? {}) as Record<string, unknown>).flatMap(
          ([property, value]) =>
            property.endsWith('-pattern') && typeof value === 'string' ? [value] : [],
        ),
      ),
    ),
  ].sort();
}

function collectColorLiterals(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^(?:#[0-9a-f]+|hsla?\(|rgba?\()/iu.test(value)) output.push(value.toUpperCase());
  } else if (Array.isArray(value)) {
    for (const item of value) collectColorLiterals(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectColorLiterals(item, output);
    }
  }
  return output;
}

function collectNumericMetrics(
  value: unknown,
  pathPrefix = '',
  output: Array<readonly [string, number]> = [],
): Array<readonly [string, number]> {
  if (typeof value === 'number') {
    output.push([pathPrefix, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collectNumericMetrics(item, `${pathPrefix}[${index}]`, output));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectNumericMetrics(item, pathPrefix ? `${pathPrefix}.${key}` : key, output);
    }
  }
  return output;
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>))
      collectStrings(item, output);
  }
  return output;
}

test('Siegfried is an autonomous map with only its own assets and semantic visuals', async () => {
  const source = await readFile(new URL('../src/official/siegfried.ts', import.meta.url), 'utf8');
  const resolved = resolveMap(siegfried);

  assert.equal('root' in siegfried, false);
  assert.equal('extends' in siegfried, false);
  assert.doesNotMatch(source, /from ['"]\.\/streets['"]/u);
  assert.doesNotMatch(source, /from ['"]\.\/streets-themes['"]/u);
  assert.doesNotMatch(source, /extends\s*:/u);
  assert.doesNotMatch(
    source,
    /@tileflow\/core\/recipe|defineModuleEffects|semanticField|semanticLayer/u,
  );
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/iu);
  for (const id of iconIds) {
    assert.doesNotMatch(
      source,
      new RegExp(`['"]${id}['"]`, 'u'),
      `Physical artwork id ${id} leaked into the semantic map`,
    );
  }
  assert.deepEqual(resolved.icons, [siegfriedIcons]);
  assert.deepEqual(resolved.fonts, [siegfriedFonts]);
  assert.equal(resolved.glyphs, undefined);
  assert.equal(resolved.modules?.addresses?.enabled, false);
  assert.equal(resolved.modules?.aeroways?.enabled, false);
  assert.equal(resolved.modules?.poi?.enabled, false);
  assert.equal(resolved.modules?.roads?.oneWayMarkers, false);
  assert.equal(resolved.modules?.roads?.roundabouts?.casing?.visible, false);
  assert.equal(resolved.modules?.roads?.roundabouts?.fill?.visible, false);
  assert.equal(resolved.modules?.vegetation?.enabled, false);
});

test('Siegfried exposes complete light and dark themes on one map identity', () => {
  const resolved = resolveMap(siegfried);
  const lightTheme = resolveTileflowTheme(siegfriedThemes.light);
  const darkTheme = resolveTileflowTheme(siegfriedThemes.dark);

  assert.deepEqual(Object.keys(resolved.themes), ['light', 'dark']);
  assert.equal(resolved.defaultTheme, 'light');
  assert.deepEqual(resolved.systemThemes, {light: 'light', dark: 'dark'});
  assert.equal(siegfriedThemes.light.id, 'siegfried-light');
  assert.equal(siegfriedThemes.light.colorScheme, 'light');
  assert.equal(siegfriedThemes.dark.id, 'siegfried-dark');
  assert.equal(siegfriedThemes.dark.colorScheme, 'dark');

  for (const category of ['color', 'font', 'image', 'number'] as const) {
    assert.deepEqual(
      Object.keys(darkTheme.tokens[category]).sort(),
      Object.keys(lightTheme.tokens[category]).sort(),
      `${category} token coverage differs by theme`,
    );
  }
  assert.deepEqual(Object.values(lightTheme.tokens.image).sort(), lightIconIds);
  assert.deepEqual(Object.values(darkTheme.tokens.image).sort(), darkIconIds);

  for (const theme of ['light', 'dark'] as const) {
    const style = compileSiegfried(theme);
    assert.equal(style.metadata?.['tileflow:map'], 'siegfried');
    assert.equal(style.metadata?.['tileflow:compiler'], 'tileflow-semantic');
    assert.equal(style.metadata?.['tileflow:extends'], undefined);
    assert.equal(style.metadata?.['tileflow:theme'], theme);
    assert.equal(style.metadata?.['tileflow:colorScheme'], theme);
    assert.deepEqual(validateStyleMin(style as never), []);
  }
});

test('Siegfried dark preserves light topology, structural metrics, and data sources', () => {
  const lightCompiled = compileSiegfriedInspected('light');
  const darkCompiled = compileSiegfriedInspected('dark');
  const light = lightCompiled.style;
  const dark = darkCompiled.style;
  const rockMaskId = compiledLayer(lightCompiled, 'water.render.rockMask')?.id;
  const structuralContract = (layer: (typeof light.layers)[number]) => ({
    filter: layer.filter,
    id: layer.id,
    layout: layer.layout,
    maxzoom: layer.maxzoom,
    minzoom: layer.minzoom,
    source: layer.source,
    sourceLayer: layer['source-layer'],
    type: layer.type,
  });
  const paintMetrics = (layer: (typeof light.layers)[number]) => ({
    id: layer.id,
    metrics: collectNumericMetrics(layer.paint).filter(
      ([path]) => layer.id !== rockMaskId || path !== 'fill-opacity',
    ),
  });

  assert.deepEqual(dark.layers.map(structuralContract), light.layers.map(structuralContract));
  assert.deepEqual(dark.layers.map(paintMetrics), light.layers.map(paintMetrics));
  assert.deepEqual(dark.metadata?.['tileflow:modules'], light.metadata?.['tileflow:modules']);
  assert.deepEqual(dark.sources, light.sources);
  assert.equal(dark.glyphs, light.glyphs);
  assert.equal(
    compiledLayer(lightCompiled, 'water.render.rockMask')?.paint?.['fill-opacity'],
    0.58,
  );
  assert.equal(compiledLayer(darkCompiled, 'water.render.rockMask')?.paint?.['fill-opacity'], 0.42);
});

test('Siegfried compiles contours and post-contour rock and ice engraving without hillshade', () => {
  const compiled = compileSiegfriedInspected();
  const {style} = compiled;
  const source = style.sources['siegfried-contours'];
  const ids = style.layers.map(({id}) => id);
  const contourIds = [
    'tileflow-terrain-contour-minor',
    'tileflow-terrain-contour-index',
    'tileflow-terrain-contour-labels',
  ];

  assert.equal(style.terrain, undefined);
  assert.equal(
    ids.some((id) => id.includes('hillshade')),
    false,
  );
  assert.equal(source?.type, 'vector');
  assert.equal(source?.minzoom, 8);
  assert.equal(source?.maxzoom, 14);
  assert.equal(
    source?.attribution,
    'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
  );
  const contourUrl = new URL(String((source?.tiles as string[] | undefined)?.[0]));
  assert.equal(contourUrl.protocol, 'tileflow-contour:');
  assert.equal(
    contourUrl.searchParams.get('thresholds'),
    '8:200,1000;10:100,500;12:30,300;14:30,300',
  );
  for (const id of contourIds) assert.ok(ids.includes(id), `Missing contour layer ${id}`);

  const contourIndex = ids.indexOf('tileflow-terrain-contour-minor');
  assert.ok(contourIndex > ids.indexOf('tileflow-background'));
  assert.ok(contourIndex < ids.indexOf('tileflow-water'));
  assert.ok(contourIndex < ids.findIndex((id) => id.startsWith('tileflow-road-')));
  assert.ok(contourIndex < ids.indexOf('tileflow-label-place-city'));

  const postContourOrder = [
    ids.indexOf('tileflow-terrain-contour-labels'),
    compiledLayerIndex(compiled, 'water.render.rockMask'),
    compiledLayerIndex(compiled, 'water.render.rockPattern'),
    compiledLayerIndex(compiled, 'water.render.screePattern'),
    compiledLayerIndex(compiled, 'water.render.glacierMask'),
    compiledLayerIndex(compiled, 'water.render.glacierPattern'),
    compiledLayerIndex(compiled, 'water.render.glacierOutline'),
    ids.indexOf('tileflow-water'),
  ];
  for (let index = 1; index < postContourOrder.length; index += 1) {
    const previous = postContourOrder[index - 1]!;
    const current = postContourOrder[index]!;
    assert.ok(previous < current, `Layer ${String(previous)} must precede ${String(current)}`);
  }

  const rockMask = compiledLayer(compiled, 'water.render.rockMask');
  const rock = compiledLayer(compiled, 'water.render.rockPattern');
  const scree = compiledLayer(compiled, 'water.render.screePattern');
  assert.deepEqual(rockMask?.filter, ['match', ['get', 'class'], ['rock'], true, false]);
  assert.match(JSON.stringify(rock?.filter), /\["scree","talus"\],false,true/u);
  assert.match(JSON.stringify(scree?.filter), /\["scree","talus"\],true,false/u);
  assert.equal(
    ids.some((id) => id.startsWith('tileflow-road-circular-')),
    false,
  );
  assert.equal(ids.includes('tileflow-vegetation-trees'), false);
});

test('each Siegfried theme references exactly its nine engraved patterns', () => {
  assert.deepEqual(patternReferences(compileSiegfried('light')), lightIconIds);
  assert.deepEqual(patternReferences(compileSiegfried('dark')), darkIconIds);

  for (const theme of ['light', 'dark'] as const) {
    const targets = compiledTargets(compileSiegfriedInspected(theme));
    for (const target of [
      'land.render.forestPattern',
      'land.render.gravelPattern',
      'land.render.orchardPattern',
      'land.render.wetlandPattern',
      'water.render.glacierPattern',
      'water.render.rockPattern',
      'water.render.screePattern',
      'water.render.waterLines',
      'water.render.intermittentWaterLines',
    ]) {
      assert.ok(targets.has(target), `Missing ${theme} Siegfried render target ${target}`);
    }
  }
});

test('Siegfried keeps hydrography blue while engraving water names in each key ink', () => {
  const expected = {
    light: {blue: '#5D90D0', ink: '#171713'},
    dark: {blue: '#79A9D6', ink: '#E8E0D0'},
  } as const;

  for (const theme of ['light', 'dark'] as const) {
    const style = compileSiegfried(theme);
    const water = style.layers.find(({id}) => id === 'tileflow-water');
    const waterLabels = style.layers.filter(({id}) => id.startsWith('tileflow-label-water-'));

    assert.equal((water?.paint as Record<string, unknown>)['fill-color'], expected[theme].blue);
    assert.ok(waterLabels.length >= 4);
    for (const label of waterLabels) {
      assert.equal(
        (label.paint as Record<string, unknown>)['text-color'],
        expected[theme].ink,
        `${label.id} should use the ${theme} engraving key ink`,
      );
    }
  }
});

test('Siegfried uses its heavier engraved face for overview settlements and road names', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compileSiegfried(theme);
    const overviewLabels = style.layers.filter(
      ({id}) =>
        id === 'tileflow-label-aerodrome' ||
        id.startsWith('tileflow-label-place-') ||
        /^tileflow-label-road-(?:major|minor|primary|secondary|service|tertiary)$/u.test(id),
    );

    assert.ok(overviewLabels.length >= 15);
    for (const layer of overviewLabels) {
      assert.deepEqual(
        (layer.layout as Record<string, unknown>)['text-font'],
        ['Cormorant Garamond SemiBold'],
        `${layer.id} should retain the legible ${theme} overview face`,
      );
    }
  }
});

test("Siegfried landform labels omit the modern ' m' elevation suffix", () => {
  for (const theme of ['light', 'dark'] as const) {
    const labels = compileSiegfried(theme).layers.filter(({id}) =>
      id.startsWith('tileflow-landform-'),
    );
    assert.ok(labels.length >= 6);
    for (const layer of labels) {
      const fragments = collectStrings(layer.layout?.['text-field']);
      assert.equal(
        fragments.some((fragment) => fragment.includes(' m')),
        false,
        `${layer.id} retained a metric suffix`,
      );
    }
  }
});

test('Siegfried removes landcover-backed alpine engraving when land is disabled', () => {
  const child = defineMap({
    id: 'siegfried-without-land',
    version: 1,
    extends: siegfried,
    modules: {land: disable()},
  });
  const compiled = createStyleWithInspection(child, {
    preparedAssets: {icons: {ids: iconIds, sprite: '/tileflow/icons/siegfried/sprite'}},
  });
  const targets = compiledTargets(compiled);

  for (const target of [
    'water.render.rockMask',
    'water.render.rockPattern',
    'water.render.screePattern',
    'water.render.glacierMask',
    'water.render.glacierPattern',
    'water.render.glacierOutline',
  ]) {
    assert.equal(targets.has(target), false, `${target} survived without its land requirement`);
  }
});

test('Siegfried enforces separate four-colour Style and SVG palettes per theme', async () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compileSiegfried(theme);
    const renderedStyle = {
      light: style.light,
      layers: style.layers.map(({layout, paint}) => ({layout, paint})),
    };
    const styleColors = collectColorLiterals(renderedStyle);
    assert.ok(styleColors.length > 40);
    assert.deepEqual(new Set(styleColors), themePalettes[theme]);
  }

  const iconsDirectory = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../assets/siegfried/icons',
  );
  const files = (await readdir(iconsDirectory)).filter((file) => file.endsWith('.svg')).sort();
  assert.deepEqual(files, iconIds.map((id) => `${id}.pattern.svg`).sort());

  for (const file of files) {
    const theme = file.startsWith('siegfried-dark-') ? 'dark' : 'light';
    const svg = await readFile(path.join(iconsDirectory, file), 'utf8');
    const colors = svg.match(/#[0-9A-F]{6}/giu) ?? [];
    assert.ok(colors.length > 0, `${file} has no explicit ink colour`);
    for (const color of colors) {
      assert.ok(
        themePalettes[theme].has(color.toUpperCase()),
        `Unexpected ${theme} colour ${color} in ${file}`,
      );
    }
  }
});

test('both Siegfried themes emit only the three packaged Cormorant faces', () => {
  for (const theme of ['light', 'dark'] as const) {
    const style = compileSiegfried(theme);
    const actual = new Set(
      style.layers.flatMap((layer) => {
        const font = (layer.layout as Record<string, unknown> | undefined)?.['text-font'];
        return Array.isArray(font) && typeof font[0] === 'string' ? [font[0]] : [];
      }),
    );

    assert.deepEqual([...actual].sort(), [...fontNames]);
    assert.equal(style.glyphs, undefined);
  }
});
