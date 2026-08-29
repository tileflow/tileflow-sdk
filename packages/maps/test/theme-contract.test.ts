import assert from 'node:assert/strict';
import test from 'node:test';
import {auditTileflowMapThemeValues, resolveMap, resolveTileflowTheme} from '@tileflow/core';
import {
  baedeker,
  cyberpunk,
  ferraris,
  harad,
  matrix,
  sanFrancisto,
  siegfried,
  siegfriedThemes,
  soundings,
  streets,
  streetsThemes,
  verdant,
} from '../src';

type TokenReference = {
  category: 'color' | 'font' | 'image' | 'number';
  kind: 'theme-token';
  token: string;
};

const colorLiteralPattern = /^(?:#[\da-f]+|hsla?\(|rgba?\()/iu;

function inspectThemeValues(
  value: unknown,
  path: string,
  references: Array<{owner?: string; path: string; reference: TokenReference}>,
  rawColors: Array<{path: string; value: string}>,
  owner?: string,
): void {
  if (typeof value === 'string') {
    if (colorLiteralPattern.test(value)) rawColors.push({path, value});
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectThemeValues(entry, `${path}[${index}]`, references, rawColors, owner),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (record.kind === 'theme-fixed') return;
  if (record.kind === 'theme-token') {
    references.push({owner, path, reference: record as TokenReference});
    return;
  }
  const nextOwner = typeof record.owner === 'string' ? record.owner : owner;
  for (const [key, entry] of Object.entries(record)) {
    inspectThemeValues(entry, `${path}.${key}`, references, rawColors, nextOwner);
  }
}

test('Streets appearance is exhaustively tokenized or explicitly fixed', () => {
  const references: Array<{owner?: string; path: string; reference: TokenReference}> = [];
  const rawColors: Array<{path: string; value: string}> = [];
  inspectThemeValues(streets.modules, 'streets.modules', references, rawColors);

  assert.deepEqual(rawColors, [], `Unclassified Streets colors: ${JSON.stringify(rawColors)}`);
  assert.ok(references.length > 150, `Only ${references.length} semantic references were found`);

  for (const {path, reference} of references) {
    assert.equal(
      reference.token in streetsThemes.light.tokens[reference.category],
      true,
      `${path} references missing light ${reference.category} token ${reference.token}`,
    );
    assert.equal(
      reference.token in streetsThemes.dark.tokens[reference.category],
      true,
      `${path} references missing dark ${reference.category} token ${reference.token}`,
    );
  }
});

test('Streets routes independently configurable Standard roles through dedicated tokens', () => {
  const references: Array<{owner?: string; path: string; reference: TokenReference}> = [];
  const rawColors: Array<{path: string; value: string}> = [];
  inspectThemeValues(streets.modules, 'streets.modules', references, rawColors);
  const activeColorTokens = new Set(
    references
      .filter(({reference}) => reference.category === 'color')
      .map(({reference}) => reference.token),
  );

  for (const tokenId of [
    'surface.background',
    'hydro.ocean',
    'landcover.global.barren',
    'landcover.global.crop',
    'landcover.global.grass',
    'landcover.global.shrub',
    'landcover.global.snow',
    'landcover.global.trees',
    'landcover.global.urban',
    'landuse.businessCorridor',
    'landuse.civic',
    'landuse.education',
    'landuse.government',
    'landuse.industrial',
    'landuse.medical',
    'landuse.railway',
    'landuse.recreation',
    'landuse.residential',
    'labels.country',
    'labels.neighborhood',
    'labels.road',
    'labels.settlement',
  ]) {
    assert.equal(activeColorTokens.has(tokenId), true, `${tokenId} is no longer render-reachable`);
  }
});

test('every official module, render stack, and terrain value has a valid semantic owner', () => {
  const allowedColorGroups: Readonly<Record<string, readonly string[]>> = {
    addresses: ['addresses', 'labels'],
    aeroways: ['aeroways', 'roads', 'surface'],
    boundaries: ['boundaries'],
    buildings: ['buildings', 'surface'],
    labels: ['labels', 'poi', 'transit'],
    land: ['land', 'landcover', 'landuse', 'surface'],
    landforms: ['landforms', 'labels', 'surface'],
    poi: ['poi', 'labels', 'transit'],
    roads: ['roads'],
    terrain: ['terrain', 'landcover', 'surface', 'labels'],
    transit: ['transit', 'roads'],
    vegetation: ['vegetation', 'landcover'],
    water: ['water', 'hydro', 'surface', 'labels'],
  };

  for (const map of [
    streets,
    baedeker,
    cyberpunk,
    ferraris,
    harad,
    matrix,
    sanFrancisto,
    siegfried,
    soundings,
    verdant,
  ]) {
    assert.deepEqual(
      auditTileflowMapThemeValues(resolveMap(map)),
      [],
      `${map.id} has implicit fixed visual values`,
    );
    const references: Array<{owner?: string; path: string; reference: TokenReference}> = [];
    const rawColors: Array<{path: string; value: string}> = [];
    for (const [owner, module] of Object.entries(map.modules ?? {})) {
      inspectThemeValues(module, `${map.id}.modules.${owner}`, references, rawColors, owner);
    }
    inspectThemeValues(map.terrain, `${map.id}.terrain`, references, rawColors, 'terrain');

    assert.deepEqual(
      rawColors,
      [],
      `${map.id} has unclassified colors: ${JSON.stringify(rawColors)}`,
    );
    const resolved = resolveMap(map);
    for (const {owner, path, reference} of references) {
      for (const [themeName, theme] of Object.entries(resolved.themes)) {
        assert.equal(
          reference.token in theme.tokens[reference.category],
          true,
          `${path} references missing ${themeName} ${reference.category} token ${reference.token}`,
        );
      }
      if (reference.category !== 'color' || !owner || !allowedColorGroups[owner]) continue;
      const [group] = reference.token.split('.');
      const validGroups = [
        ...allowedColorGroups[owner]!,
        ...(map.id === 'siegfried' ? ['ink', 'substrate'] : []),
      ];
      assert.equal(
        validGroups.includes(group!),
        true,
        `${path} assigns ${owner} appearance to unrelated token ${reference.token}`,
      );
    }
  }
});

test('Streets light and dark expose the same complete semantic vocabulary', () => {
  for (const category of ['color', 'font', 'image', 'number'] as const) {
    assert.deepEqual(
      Object.keys(streetsThemes.dark.tokens[category]).sort(),
      Object.keys(streetsThemes.light.tokens[category]).sort(),
      `${category} token coverage differs by theme`,
    );
  }
  assert.ok(Object.keys(streetsThemes.light.tokens.color).length > 110);
});

test('Siegfried light and dark expose identical semantic vocabularies', () => {
  const light = resolveTileflowTheme(siegfriedThemes.light);
  const dark = resolveTileflowTheme(siegfriedThemes.dark);

  for (const category of ['color', 'font', 'image', 'number'] as const) {
    assert.deepEqual(
      Object.keys(dark.tokens[category]).sort(),
      Object.keys(light.tokens[category]).sort(),
      `${category} token coverage differs by Siegfried theme`,
    );
  }
  assert.deepEqual(
    Object.values(light.tokens.image).sort(),
    Object.values(dark.tokens.image)
      .map((id) => id.replace('siegfried-dark-', 'siegfried-'))
      .sort(),
  );
});

test('every official map has a deterministic complete theme collection', () => {
  for (const map of [
    streets,
    baedeker,
    cyberpunk,
    ferraris,
    harad,
    matrix,
    sanFrancisto,
    siegfried,
    soundings,
    verdant,
  ]) {
    const resolved = resolveMap(map);
    assert.ok(Object.keys(resolved.themes).length > 0, `${map.id} has no themes`);
    assert.ok(resolved.themes[resolved.defaultTheme], `${map.id} has an invalid defaultTheme`);
    for (const [name, theme] of Object.entries(resolved.themes)) {
      assert.ok(theme.id, `${map.id}.${name} has no theme id`);
      assert.equal(theme.version, 1);
      assert.deepEqual(Object.keys(theme.tokens).sort(), ['color', 'font', 'image', 'number']);
      assert.ok(theme.typography.font, `${map.id}.${name} has no default typography`);
      assert.ok(theme.lighting.color, `${map.id}.${name} has no lighting color`);
    }
  }
});
