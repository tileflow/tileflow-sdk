import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {createStyle, resolveMap, token} from '@tileflow/core';
import {matrix, matrixFonts, matrixIcons} from '../src';

const matrixAssetIds = ['matrix-crt-scanlines', 'matrix-data-grid', 'matrix-poi-node'] as const;
const matrixColors = new Set([
  '#000000',
  '#010704',
  '#020D06',
  '#031509',
  '#05210E',
  '#082F15',
  '#0C421D',
  '#115827',
  '#197234',
  '#23933F',
  '#30B94E',
  '#43DB60',
  '#63F77B',
  '#87FF98',
  '#B3FFC0',
  '#D9FFDE',
  'rgba(0, 0, 0, 0)',
]);

function compile(map: typeof matrix, ids: readonly string[]) {
  return createStyle(map, {
    preparedAssets: {icons: {ids, sprite: `/tileflow/icons/${map.id}/sprite`}},
  });
}

function collectColorLiterals(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/#[0-9a-f]+|hsla?\([^)]*\)|rgba?\([^)]*\)/giu)) {
      output.add(match[0]);
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) collectColorLiterals(entry, output);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectColorLiterals(entry, output);
    }
  }
  return output;
}

test('Matrix is a frozen self-contained root with only Matrix-owned assets', async () => {
  assert.equal(matrix.id, 'matrix');
  assert.equal(matrix.name, 'Matrix');
  assert.equal(matrix.version, 1);
  assert.equal('extends' in matrix, false);
  assert.deepEqual(matrix.root, {compiler: 'streets', compilerVersion: 1});
  assert.deepEqual(matrix.data, {
    generation: 'v1',
    selection: {kind: 'current', product: 'world-v1'},
    type: 'tileflow-world',
  });
  assert.equal(matrix.projection, 'mercator');
  assert.equal(matrix.terrain, 'none');
  assert.equal(Object.isFrozen(matrix), true);

  const resolved = resolveMap(matrix);
  assert.deepEqual(resolved.icons, [matrixIcons]);
  assert.deepEqual(resolved.fonts, [matrixFonts]);
  assert.equal(resolved.glyphs, undefined);
  assert.equal(resolved.defaultTheme, 'dark');
  assert.equal(resolved.themes.dark.colorScheme, 'dark');
  assert.equal(resolved.themes.dark.typography?.font, 'Oxanium Medium');
  assert.equal(resolved.themes.dark.typography?.transform, 'uppercase');
  assert.deepEqual(resolved.view, {
    bearing: 0,
    center: [-3.6942, 40.4146],
    pitch: 0,
    zoom: 15.25,
  });

  const source = await readFile(new URL('../src/official/matrix.ts', import.meta.url), 'utf8');
  assert.match(source, /\bdefineRootMap\s*\(/u);
  assert.doesNotMatch(source, /from\s+['"]\.\/(?:cyberpunk|streets|streets-themes)['"]/u);
  assert.doesNotMatch(source, /\b(?:resolveMap|getResolvedModuleEffects|matrixizeValue)\b/u);
  assert.doesNotMatch(source, /\bcyberpunk\b|cyber-/iu);
});

test('Matrix owns a restrained terminal grammar without Cyberpunk signatures', () => {
  const matrixStyle = compile(matrix, matrixAssetIds);

  assert.equal(matrixStyle.metadata?.['tileflow:map'], 'matrix');
  assert.equal(matrixStyle.metadata?.['tileflow:extends'], undefined);
  assert.equal(matrixStyle.sprite, '/tileflow/icons/matrix/sprite');
  assert.deepEqual(validateStyleMin(matrixStyle as never), []);

  const serialized = JSON.stringify(matrixStyle);
  for (const id of matrixAssetIds) assert.match(serialized, new RegExp(`"${id}"`, 'u'));
  assert.doesNotMatch(serialized, /cyber-(?:circuit|data-grid|target-brackets)/u);
  assert.doesNotMatch(serialized, /"cyberpunk-[^"]+"/u);

  const byId = new Map(matrixStyle.layers.map((layer) => [layer.id, layer]));
  const auraIndex = matrixStyle.layers.findIndex(
    ({id}) => id === 'matrix-road-principal-neon-aura',
  );
  const glowIndex = matrixStyle.layers.findIndex(
    ({id}) => id === 'matrix-road-principal-neon-glow',
  );
  assert.ok(auraIndex >= 0 && glowIndex > auraIndex, 'Matrix road glow order drifted');
  assert.equal(byId.has('matrix-road-principal-neon-core'), false);
  assert.equal(byId.has('matrix-buildings-circuit-fill'), false);
  assert.equal(
    matrixStyle.layers.some(({type}) => type === 'fill-extrusion'),
    false,
  );

  const node = byId.get('matrix-destination-poi-node');
  assert.ok(node, 'Matrix lost its compact POI node');
  assert.equal(node.layout?.['icon-image'], 'matrix-poi-node');
  assert.equal(node.layout?.['text-transform'], 'uppercase');
  assert.equal(node.layout?.['icon-allow-overlap'], false);
  assert.equal(node.layout?.['text-allow-overlap'], false);

  const crtMask = byId.get('matrix-crt-mask');
  assert.ok(crtMask, 'Matrix lost its full-screen CRT mask');
  assert.equal(crtMask.type, 'background');
  assert.equal(crtMask.paint?.['background-pattern'], 'matrix-crt-scanlines');
  assert.equal(crtMask.paint?.['background-opacity'], 0.84);
  const crtMaskIndex = matrixStyle.layers.findIndex(({id}) => id === 'matrix-crt-mask');
  const textLayerIndexes = matrixStyle.layers.flatMap((layer, index) =>
    layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined ? [index] : [],
  );
  assert.ok(textLayerIndexes.length > 0, 'Matrix lost its text layers');
  assert.ok(
    textLayerIndexes.every((index) => index > crtMaskIndex),
    'Matrix text must stay crisp above the CRT mask',
  );

  const resolved = resolveMap(matrix);
  assert.deepEqual(
    resolved.modules?.roads?.classes?.primary?.surface?.fill?.color,
    token.color('roads.city.primary'),
  );
  const primaryCasingColor = resolved.modules?.roads?.classes?.primary?.surface?.casing?.color;
  assert.equal(primaryCasingColor?.kind, 'theme-token');
  assert.equal(primaryCasingColor?.category, 'color');
  assert.match(primaryCasingColor?.token ?? '', /^roads\./u);
});

test('Matrix compiled cartography uses only its reviewed green-screen ramp', () => {
  const style = compile(matrix, matrixAssetIds);
  const colors = collectColorLiterals({layers: style.layers, light: style.light});

  assert.ok(colors.size >= 12, 'Matrix lost too much phosphor contrast');
  for (const color of colors) {
    if (color === 'rgba(0, 0, 0, 0)') continue;
    assert.match(color, /^#[0-9a-f]{6}$/iu, `Matrix emitted an unsupported color ${color}`);
    const channels = Number.parseInt(color.slice(1), 16);
    const red = channels >> 16;
    const green = (channels >> 8) & 0xff;
    const blue = channels & 0xff;
    assert.ok(green >= red && green >= blue, `Matrix emitted a non-phosphor color ${color}`);
  }
  for (const color of ['#010704', '#43DB60', '#63F77B', '#D9FFDE']) {
    assert.equal(colors.has(color), true, `Matrix lost phosphor ramp color ${color}`);
  }
});

test('Matrix SVG artwork stays inside the same phosphor ramp', async () => {
  for (const file of [
    'matrix-crt-scanlines.pattern.svg',
    'matrix-data-grid.pattern.svg',
    'matrix-poi-node.svg',
  ]) {
    const source = await readFile(
      new URL(`../assets/matrix/icons/${file}`, import.meta.url),
      'utf8',
    );
    const colors = collectColorLiterals(source);
    assert.ok(colors.size > 0, `${file} has no color literals`);
    for (const color of colors) {
      assert.equal(matrixColors.has(color), true, `${file} emitted an unreviewed color ${color}`);
    }
  }
});
