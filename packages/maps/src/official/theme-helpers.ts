import {
  classifyTileflowVisualProperty,
  defineTheme,
  fixed,
  resolveTileflowTheme,
  type TileflowMap,
  type TileflowTheme,
  type TileflowThemeDefinition,
  token,
} from '@tileflow/core';
import {isMapLibreExpressionOperator} from '@tileflow/core/recipe';

type ThemeTypography = NonNullable<TileflowThemeDefinition['typography']>;
type ThemeLighting = NonNullable<TileflowThemeDefinition['lighting']>;

const baseColorTokenIds = {
  background: 'surface.background',
  boundary: 'boundaries.default',
  building: 'surface.building',
  land: 'surface.land',
  park: 'surface.park',
  road: 'roads.default',
  roadCasing: 'roads.casing',
  roadMajor: 'roads.major',
  text: 'labels.primary',
  textHalo: 'labels.halo',
  textMuted: 'labels.muted',
  water: 'surface.water',
} as const;

type BaseColorKey = keyof typeof baseColorTokenIds;

export type OfficialThemeInput = {
  base?: TileflowTheme;
  id: string;
  version: number;
  colorScheme: 'light' | 'dark';
  colors: Partial<Record<BaseColorKey, string>>;
  modules?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  typography: ThemeTypography;
  lighting: ThemeLighting;
  images?: Readonly<Record<string, string>>;
  fonts?: Readonly<Record<string, string>>;
  extraColors?: Readonly<Record<string, string>>;
  numbers?: Readonly<Record<string, number>>;
};

/**
 * Materializes the semantic color tables used by the independent official
 * maps. This is package authoring infrastructure, not a second public theme
 * format: callers receive the same complete `TileflowTheme` as `defineTheme`.
 */
export function defineOfficialTheme(input: OfficialThemeInput) {
  const colorTokens: Record<string, string> = {...input.extraColors};
  for (const [name, value] of Object.entries(input.colors)) {
    colorTokens[baseColorTokenIds[name as BaseColorKey]] = value;
  }
  for (const [moduleName, moduleColors] of Object.entries(input.modules ?? {})) {
    for (const [name, value] of Object.entries(moduleColors)) {
      colorTokens[`${moduleName}.${name}`] = value;
    }
  }

  const typographyFonts = Object.fromEntries(
    [
      ['default', input.typography.font],
      ['places', input.typography.places?.font],
      ['poi', input.typography.poi?.font],
      ['roads', input.typography.roads?.font],
      ['water', input.typography.water?.font],
    ].flatMap(([name, value]) =>
      typeof value === 'string' ? [[`typography.${name}`, value]] : [],
    ),
  );
  const definition = {
    id: input.id,
    version: input.version,
    colorScheme: input.colorScheme,
    tokens: {
      color: colorTokens,
      number: input.numbers ?? {},
      font: {...typographyFonts, ...input.fonts},
      image: input.images ?? {},
    },
    typography: input.typography,
    lighting: input.lighting,
  } satisfies TileflowThemeDefinition;
  return input.base ? defineTheme(input.base, definition) : defineTheme(definition);
}

const ownerTokenGroups: Readonly<Record<string, readonly string[]>> = {
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

const colorLiteralPattern = /^(?:#[\da-f]+|hsla?\(|rgba?\()/iu;

/**
 * Classify every authored visual literal in an official map before it becomes
 * public. Existing role tokens are reused only inside the owning semantic
 * domain; otherwise a stable path-named token is materialized. Transparent
 * sentinels remain explicit, auditable `fixed()` values. The compiled style is
 * unchanged.
 */
export function bindOfficialMapTheme<TMap extends TileflowMap>(map: TMap): TMap {
  const themes = map.themes ?? {};
  const theme = themes[map.defaultTheme ?? ''];
  if (!theme) throw new Error(`${map.id} must declare its complete default theme before binding.`);
  const resolved = resolveTileflowTheme(theme);
  const colorTokens = reverseTokens(resolved.tokens.color);
  const fontTokens = reverseTokens(resolved.tokens.font);
  const imageTokens = reverseTokens(resolved.tokens.image);
  const generatedColors: Record<string, string> = {};
  const generatedFonts: Record<string, string> = {};
  const generatedImages: Record<string, string> = {};
  const occupiedColorTokens = new Map(Object.entries(resolved.tokens.color));
  const occupiedFontTokens = new Map(Object.entries(resolved.tokens.font));
  const occupiedImageTokens = new Map(Object.entries(resolved.tokens.image));

  const fixedMetric = (value: number | readonly number[], semanticPath: string) =>
    fixed(value, {
      reason: `${map.id} keeps the ${semanticPath} visual metric invariant across themes`,
    });

  const bindNumericOutput = (value: unknown, path: string, semanticPath: string): unknown => {
    if (typeof value === 'number') return fixedMetric(value, semanticPath);
    if (Array.isArray(value)) {
      if (isMapLibreExpressionOperator(value[0])) {
        return bindNumericExpression(value, path, semanticPath);
      }
      if (value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        return fixedMetric(value as readonly number[], semanticPath);
      }
      return value.map((entry, index) =>
        bindNumericOutput(entry, `${path}[${index}]`, `${semanticPath}.component${index + 1}`),
      );
    }
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (
      record.kind === 'theme-token' ||
      record.kind === 'theme-fixed' ||
      record.kind === 'theme-color'
    ) {
      return value;
    }
    if (record.kind === 'expression' && Array.isArray(record.value)) {
      return {...record, value: bindNumericExpression(record.value, `${path}.value`, semanticPath)};
    }
    if (record.kind === 'zoom' && Array.isArray(record.stops)) {
      return {
        ...record,
        stops: record.stops.map((stop, index) =>
          Array.isArray(stop)
            ? [
                stop[0],
                bindNumericOutput(
                  stop[1],
                  `${path}.stops[${index}][1]`,
                  `${semanticPath}.zoom${String(stop[0])}`,
                ),
              ]
            : stop,
        ),
      };
    }
    return value;
  };

  function bindNumericExpression(
    value: readonly unknown[],
    path: string,
    semanticPath: string,
  ): readonly unknown[] {
    const operator = typeof value[0] === 'string' ? value[0] : undefined;
    if (!operator) return value;
    const result = [...value];
    if (numericExpressionDataOperators.has(operator)) return result;
    if (operator === 'let') {
      const outputIndex = result.length - 1;
      if (outputIndex > 0) {
        result[outputIndex] = bindNumericOutput(
          result[outputIndex],
          `${path}[${outputIndex}]`,
          `${semanticPath}.result`,
        );
      }
      return result;
    }
    for (const index of numericExpressionOutputIndices(operator, result.length)) {
      result[index] = bindNumericOutput(
        result[index],
        `${path}[${index}]`,
        `${semanticPath}.output${index}`,
      );
    }
    return result;
  }

  const bind = (
    value: unknown,
    path: string,
    owner: string | undefined,
    semanticPath: string,
    insideExpression = false,
    property?: string,
  ): unknown => {
    if (property !== undefined && classifyTileflowVisualProperty(property, value) === 'number') {
      return bindNumericOutput(value, path, semanticPath);
    }
    if (typeof value === 'string') {
      if (colorLiteralPattern.test(value)) {
        const tokenName = chooseToken(colorTokens.get(value), path, owner, true);
        if (tokenName) return token.color(tokenName);
        if (isTransparentColor(value)) {
          return fixed(value, {reason: `${map.id} transparent visual sentinel at ${path}`});
        }
        const generatedToken = createSemanticToken(
          semanticPath,
          value,
          generatedColors,
          occupiedColorTokens,
        );
        return token.color(generatedToken);
      }
      if (/font/iu.test(path)) {
        const tokenName = chooseToken(fontTokens.get(value), path, owner);
        if (tokenName) return token.font(tokenName);
        if (!insideExpression) {
          return token.font(
            createSemanticToken(semanticPath, value, generatedFonts, occupiedFontTokens),
          );
        }
      }
      if (/(?:image|pattern)/iu.test(path)) {
        const tokenName = chooseToken(imageTokens.get(value), path, owner);
        if (tokenName) return token.image(tokenName);
        if (!insideExpression) {
          return token.image(
            createSemanticToken(semanticPath, value, generatedImages, occupiedImageTokens),
          );
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      const nextInsideExpression = insideExpression || isMapLibreExpressionOperator(value[0]);
      return value.map((entry, index) =>
        bind(
          entry,
          `${path}[${index}]`,
          owner,
          `${semanticPath}.variant${index + 1}`,
          nextInsideExpression,
          undefined,
        ),
      );
    }
    if (!value || typeof value !== 'object') return value;

    const record = value as Record<PropertyKey, unknown>;
    if (
      record.kind === 'theme-token' ||
      record.kind === 'theme-fixed' ||
      record.kind === 'theme-color'
    ) {
      return value;
    }
    const nextOwner = typeof record.owner === 'string' ? record.owner : owner;
    const effectTarget = typeof record.target === 'string' ? record.target : undefined;
    const result: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(record)) {
      const segment = typeof key === 'symbol' ? String(key) : key;
      const semanticSegment = normalizeSemanticSegment(segment);
      const nextSemanticPath =
        effectTarget && segment === 'layer'
          ? effectTarget
          : ['layer', 'layout', 'paint', 'value'].includes(segment)
            ? semanticPath
            : `${semanticPath}.${semanticSegment}`;
      result[key] = bind(
        record[key],
        `${path}.${segment}`,
        nextOwner,
        nextSemanticPath,
        insideExpression,
        segment,
      );
    }
    return result;
  };

  const result = {...map} as Record<PropertyKey, unknown>;
  if (map.modules) {
    result.modules = Object.fromEntries(
      Object.entries(map.modules).map(([owner, module]) => [
        owner,
        bind(module, `${map.id}.modules.${owner}`, owner, owner),
      ]),
    );
  }
  if (map.terrain && typeof map.terrain === 'object') {
    result.terrain = bind(map.terrain, `${map.id}.terrain`, 'terrain', 'terrain');
  }
  for (const key of Reflect.ownKeys(map)) {
    if (typeof key === 'symbol') {
      result[key] = bind(
        (map as unknown as Record<PropertyKey, unknown>)[key],
        `${map.id}.${String(key)}`,
        undefined,
        'effects',
      );
    }
  }
  if (
    Object.keys(generatedColors).length > 0 ||
    Object.keys(generatedFonts).length > 0 ||
    Object.keys(generatedImages).length > 0
  ) {
    if (Object.keys(themes).length !== 1) {
      throw new Error(
        `${map.id} must author explicit tokens for multi-theme collections instead of inferring variants.`,
      );
    }
    const themeName = map.defaultTheme!;
    result.themes = {
      [themeName]: defineTheme(theme, {
        id: theme.id,
        version: theme.version,
        colorScheme: theme.colorScheme,
        tokens: {
          color: generatedColors,
          font: generatedFonts,
          image: generatedImages,
        },
      }),
    };
  }
  return result as TMap;
}

function reverseTokens(tokens: Readonly<Record<string, string>>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [name, value] of Object.entries(tokens)) {
    const names = result.get(value) ?? [];
    names.push(name);
    result.set(value, names);
  }
  return result;
}

function chooseToken(
  candidates: readonly string[] | undefined,
  path: string,
  owner: string | undefined,
  restrictOwnerGroup = false,
): string | undefined {
  if (!candidates?.length) return undefined;
  const groups = owner ? (ownerTokenGroups[owner] ?? [owner]) : [];
  const eligible =
    restrictOwnerGroup && groups.length > 0
      ? candidates.filter((name) => groups.includes(name.split('.')[0]!))
      : [...candidates];
  if (eligible.length === 0) return undefined;
  const pathWords = new Set(path.toLowerCase().split(/[^a-z0-9]+/u));
  return eligible.sort((left, right) => {
    const score = (name: string) => {
      const [group] = name.split('.');
      const ownerScore = groups.includes(group!) ? 100 : 0;
      const wordScore = name
        .toLowerCase()
        .split('.')
        .filter((word) => pathWords.has(word)).length;
      return ownerScore + wordScore;
    };
    return score(right) - score(left) || left.localeCompare(right);
  })[0];
}

function createSemanticToken(
  semanticPath: string,
  value: string,
  generated: Record<string, string>,
  occupied: Map<string, string>,
): string {
  const base = semanticPath.split('.').map(normalizeSemanticSegment).filter(Boolean).join('.');
  let name = base;
  let variant = 2;
  while (occupied.has(name) && occupied.get(name) !== value) {
    name = `${base}.variant${variant}`;
    variant += 1;
  }
  if (!occupied.has(name)) {
    occupied.set(name, value);
    generated[name] = value;
  }
  return name;
}

function normalizeSemanticSegment(segment: string): string {
  const normalized = segment
    .replace(/^Symbol\(.+\)$/u, 'effects')
    .replace(/[-_]+([A-Za-z0-9])/gu, (_, character: string) => character.toUpperCase())
    .replace(/[^A-Za-z0-9_-]/gu, '');
  if (!normalized) return 'value';
  return /^[A-Za-z]/u.test(normalized) ? normalized : `variant${normalized}`;
}

function isTransparentColor(value: string): boolean {
  if (/^#[\da-f]{4}$/iu.test(value)) return value.slice(4).toLowerCase() === '0';
  if (/^#[\da-f]{8}$/iu.test(value)) return value.slice(7).toLowerCase() === '00';
  const alpha = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*(\d+(?:\.\d+)?)\s*\)$/iu)?.[1];
  return alpha !== undefined && Number(alpha) === 0;
}

function numericExpressionOutputIndices(operator: string, length: number): number[] {
  switch (operator) {
    case 'case':
      return uniqueIndices([...numericRange(2, length - 1, 2), length - 1]);
    case 'match':
      return uniqueIndices([...numericRange(3, length - 1, 2), length - 1]);
    case 'step':
      return numericRange(2, length, 2);
    case 'interpolate':
    case 'interpolate-hcl':
    case 'interpolate-lab':
      return numericRange(4, length, 2);
    case 'format':
      return numericRange(1, length, 2);
    case 'at':
      return length > 2 ? [2] : [];
    case 'array':
      return length > 1 ? [length - 1] : [];
    case 'image':
      return length > 1 ? [1] : [];
    default:
      return numericRange(1, length, 1);
  }
}

const numericExpressionDataOperators = new Set([
  'accumulated',
  'collator',
  'distance',
  'elevation',
  'error',
  'feature-state',
  'geometry-type',
  'get',
  'global-state',
  'has',
  'heatmap-density',
  'id',
  'in',
  'index-of',
  'is-supported-script',
  'length',
  'line-progress',
  'properties',
  'resolved-locale',
  'typeof',
  'within',
  'zoom',
]);

function numericRange(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let index = start; index < end; index += step) values.push(index);
  return values;
}

function uniqueIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)];
}
