import {isMapLibreExpressionOperator} from '../cartography/expression-operators';
import {getResolvedModuleEffects} from '../cartography/module-effects';
import type {
  TileflowFixedValue,
  TileflowThemeColorOperation,
  TileflowThemeColorValue,
  TileflowThemeFontValue,
  TileflowThemeImageValue,
  TileflowThemeNumberValue,
  TileflowThemeTokenCategory,
  TileflowThemeTokenReference,
} from '../cartography/values';
import {
  isTileflowFixedValue,
  isTileflowThemeColorOperation,
  isTileflowThemeTokenReference,
} from '../cartography/values';
import {isTileflowThemeName} from '../portable-identity-rules';
import type {ResolvedTileflowTypography, TileflowLight, TileflowTypographyStyle} from '../types';
import {classifyTileflowVisualProperty, type TileflowVisualValueCategory} from './visual-semantics';

export type TileflowThemeColorScheme = 'dark' | 'light';
export type TileflowThemeName = string;

export type TileflowThemeTokens = {
  color: Readonly<Record<string, TileflowThemeColorValue>>;
  font: Readonly<Record<string, TileflowThemeFontValue>>;
  image: Readonly<Record<string, TileflowThemeImageValue>>;
  number: Readonly<Record<string, TileflowThemeNumberValue>>;
};

export type TileflowThemeTypographyStyle = {
  fallbacks?: readonly TileflowThemeFontValue[];
  font?: TileflowThemeFontValue;
  letterSpacing?: TileflowThemeNumberValue;
  transform?: TileflowTypographyStyle['transform'];
};

export type TileflowThemeTypography = TileflowThemeTypographyStyle & {
  places?: TileflowThemeTypographyStyle;
  poi?: TileflowThemeTypographyStyle;
  roads?: TileflowThemeTypographyStyle;
  water?: TileflowThemeTypographyStyle;
};

export type TileflowThemeLighting = {
  anchor?: 'map' | 'viewport';
  color?: TileflowThemeColorValue;
  intensity?: TileflowThemeNumberValue;
  position?: readonly [
    TileflowThemeNumberValue,
    TileflowThemeNumberValue,
    TileflowThemeNumberValue,
  ];
};

/** A complete, inheritance-free appearance document. */
export type TileflowTheme = {
  colorScheme: TileflowThemeColorScheme;
  id: string;
  lighting: TileflowThemeLighting;
  tokens: TileflowThemeTokens;
  typography: TileflowThemeTypography;
  version: number;
};

type TileflowThemeTokenOverrides = {
  [TCategory in keyof TileflowThemeTokens]?: Readonly<Partial<TileflowThemeTokens[TCategory]>>;
};

/** Input accepted by defineTheme. The returned theme is always fully materialized. */
export type TileflowThemeDefinition = Pick<TileflowTheme, 'colorScheme' | 'id' | 'version'> & {
  lighting?: TileflowThemeLighting;
  tokens?: TileflowThemeTokenOverrides;
  typography?: TileflowThemeTypography;
};

export type ResolvedTileflowThemeTokens = {
  color: Readonly<Record<string, string>>;
  font: Readonly<Record<string, string>>;
  image: Readonly<Record<string, string>>;
  number: Readonly<Record<string, number>>;
};

export type ResolvedTileflowTheme = Omit<TileflowTheme, 'lighting' | 'tokens' | 'typography'> & {
  lighting: TileflowLight;
  tokens: ResolvedTileflowThemeTokens;
  typography: ResolvedTileflowTypography;
};

export type TileflowResolvedThemeSelection = {
  name: TileflowThemeName;
  theme: TileflowTheme;
};

export type TileflowThemeAuditScope = 'compiler-effect' | 'module' | 'terrain' | 'value';
export type TileflowThemeAuditEffectKind = 'add' | 'patch';

export type TileflowThemeAuditContext = {
  effectKind?: TileflowThemeAuditEffectKind;
  owner?: string;
  scope: TileflowThemeAuditScope;
  target?: string;
};

export type TileflowThemeAuditDiagnostic = {
  category: TileflowVisualValueCategory;
  code: 'THEME_IMPLICIT_FIXED';
  effectKind?: TileflowThemeAuditEffectKind;
  message: string;
  owner?: string;
  path: string;
  phase: 'theme-audit';
  scope: TileflowThemeAuditScope;
  severity: 'error' | 'warning';
  suggestion: string;
  target?: string;
  value: number | string;
};

/** A deterministic, machine-readable failure for blocking theme-audit diagnostics. */
export class TileflowThemeAuditError extends Error {
  readonly diagnostics: readonly TileflowThemeAuditDiagnostic[];

  constructor(diagnostics: readonly TileflowThemeAuditDiagnostic[]) {
    const errors = diagnostics
      .filter(({severity}) => severity === 'error')
      .sort(compareAuditDiagnostics)
      .map((diagnostic) => ({...diagnostic}));
    const first = errors[0];
    super(
      `Tileflow theme audit failed with ${errors.length} blocking diagnostic${errors.length === 1 ? '' : 's'}` +
        `${first ? `; first error at ${first.path}` : ''}.`,
    );
    this.name = 'TileflowThemeAuditError';
    this.diagnostics = errors;
  }
}

const defaultTypography = {
  font: 'Noto Sans Regular',
} as const satisfies TileflowThemeTypography;

const themeTokenCategories = ['color', 'font', 'image', 'number'] as const;
const themeDocumentKeys = [
  'colorScheme',
  'id',
  'lighting',
  'tokens',
  'typography',
  'version',
] as const;
const themeDefinitionRequiredKeys = ['colorScheme', 'id', 'version'] as const;
const themeTypographyStyleKeys = ['fallbacks', 'font', 'letterSpacing', 'transform'] as const;
const themeTypographyKeys = [
  ...themeTypographyStyleKeys,
  'places',
  'poi',
  'roads',
  'water',
] as const;
const themeTypographyDomains = ['places', 'poi', 'roads', 'water'] as const;
const themeLightingKeys = ['anchor', 'color', 'intensity', 'position'] as const;

export function defineTheme(definition: TileflowThemeDefinition): TileflowTheme;
export function defineTheme(
  base: TileflowTheme,
  definition: TileflowThemeDefinition,
): TileflowTheme;
export function defineTheme(
  baseOrDefinition: TileflowTheme | TileflowThemeDefinition,
  maybeDefinition?: TileflowThemeDefinition,
): TileflowTheme {
  const base = maybeDefinition ? (baseOrDefinition as TileflowTheme) : undefined;
  const definition = maybeDefinition ?? (baseOrDefinition as TileflowThemeDefinition);
  assertThemeDefinition(definition);
  if (base) assertThemeDocument(base);

  const theme: TileflowTheme = {
    colorScheme: definition.colorScheme,
    id: definition.id,
    lighting: mergeRecord(base?.lighting ?? {}, definition.lighting ?? {}),
    tokens: {
      color: mergeRecord(base?.tokens.color ?? {}, definition.tokens?.color ?? {}),
      font: mergeRecord(base?.tokens.font ?? {}, definition.tokens?.font ?? {}),
      image: mergeRecord(base?.tokens.image ?? {}, definition.tokens?.image ?? {}),
      number: mergeRecord(base?.tokens.number ?? {}, definition.tokens?.number ?? {}),
    },
    typography: mergeTypography(base?.typography ?? defaultTypography, definition.typography),
    version: definition.version,
  };

  // Resolve eagerly so malformed graphs never enter a map document. Keep the authored
  // derivation AST in the returned theme for provenance and deterministic inspection.
  resolveTileflowTheme(theme);
  return cloneJson(theme);
}

export function resolveTileflowTheme(theme: TileflowTheme): ResolvedTileflowTheme {
  assertThemeDocument(theme);
  const resolver = new ThemeValueResolver(theme);
  const tokens = {
    color: resolver.resolveCategory('color'),
    font: resolver.resolveCategory('font'),
    image: resolver.resolveCategory('image'),
    number: resolver.resolveCategory('number'),
  };
  const typography = resolver.resolveTypography(theme.typography);
  const lighting = resolver.resolveLighting(theme.lighting);
  return {
    colorScheme: theme.colorScheme,
    id: theme.id,
    lighting,
    tokens,
    typography,
    version: theme.version,
  };
}

/** Resolve every theme node in modules, effects, zoom values and expression arrays. */
export function resolveThemeValues<T>(value: T, theme: TileflowTheme, path = 'value'): T {
  const resolver = new ThemeValueResolver(theme);
  // Validate the complete graph, including tokens not reached by this particular value tree.
  resolver.resolveAllTokens();
  const resolved = resolver.resolveTree(value, path) as T;
  const errors = auditTileflowThemeValues(value, path).filter(({severity}) => severity === 'error');
  if (errors.length > 0) throw new TileflowThemeAuditError(errors);
  return resolved;
}

/** Select an explicit theme or the map's deterministic default. Browser "system" is external. */
export function resolveThemeSelection(
  map: {
    defaultTheme: string;
    themes: Readonly<Record<string, TileflowTheme>>;
  },
  requested?: string,
): TileflowResolvedThemeSelection {
  const name = requested ?? map.defaultTheme;
  if (name === 'system') {
    throw new Error(
      'Tileflow theme "system" is a browser-only selector; resolve it to a concrete theme before compilation.',
    );
  }
  if (!isThemeName(name)) {
    throw new Error(
      `Invalid Tileflow theme name ${JSON.stringify(name)}; expected a portable identifier.`,
    );
  }
  const theme = map.themes[name];
  if (!theme) {
    const available = Object.keys(map.themes).sort().join(', ') || '<none>';
    throw new Error(`Unknown Tileflow theme "${name}"; available themes: ${available}.`);
  }
  return {name, theme};
}

/** Find visual literals whose permanence is otherwise invisible to an agent. */
export function auditTileflowThemeValues(
  value: unknown,
  path = 'value',
  context: TileflowThemeAuditContext = inferAuditContext(path),
): TileflowThemeAuditDiagnostic[] {
  const diagnostics: TileflowThemeAuditDiagnostic[] = [];
  visitAuditableValue(value, path, undefined, {
    context,
    diagnostics,
    resolvingVariables: new Set(),
    variables: new Map(),
  });
  return diagnostics.sort(compareAuditDiagnostics);
}

/** Audit every appearance-bearing branch of a resolved map, including compiler-private effects. */
export function auditTileflowMapThemeValues(map: {
  modules?: unknown;
  terrain?: unknown;
}): TileflowThemeAuditDiagnostic[] {
  const modules = isRecord(map.modules) ? map.modules : undefined;
  const moduleDiagnostics = modules
    ? Object.keys(modules)
        .sort(compareCodeUnits)
        .flatMap((owner) =>
          auditTileflowThemeValues(modules[owner], `modules.${owner}`, {
            owner,
            scope: 'module',
          }),
        )
    : [];
  const compilerDiagnostics = getResolvedModuleEffects(map).flatMap((effect) => {
    if (effect.kind === 'remove') return [];
    return auditTileflowThemeValues(
      effect.kind === 'add' ? effect.layer : effect.patch,
      `compilerEffects.${effect.target}.${effect.kind}`,
      {
        effectKind: effect.kind,
        owner: effect.owner,
        scope: 'compiler-effect',
        target: effect.target,
      },
    );
  });
  return [
    ...moduleDiagnostics,
    ...auditTileflowThemeValues(map.terrain, 'terrain', {scope: 'terrain'}),
    ...compilerDiagnostics,
  ].sort(compareAuditDiagnostics);
}

/** Fail closed when a map contains implicit chromatic, font, or image literals. */
export function assertTileflowMapThemeValues(map: {modules?: unknown; terrain?: unknown}): void {
  const errors = auditTileflowMapThemeValues(map).filter(({severity}) => severity === 'error');
  if (errors.length > 0) throw new TileflowThemeAuditError(errors);
}

type AuditVariable = {path: string; value: unknown};

type AuditTraversalState = {
  context: TileflowThemeAuditContext;
  diagnostics: TileflowThemeAuditDiagnostic[];
  resolvingVariables: ReadonlySet<string>;
  variables: ReadonlyMap<string, AuditVariable>;
};

function visitThemeIntentNode(
  value: Readonly<Record<string, unknown>>,
  path: string,
  expectedCategory: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
): void {
  const tokenReference = isTileflowThemeTokenReference(value) ? value : undefined;
  const fixedValue = isTileflowFixedValue(value) ? value : undefined;
  const colorOperation = isTileflowThemeColorOperation(value) ? value : undefined;

  if (!tokenReference && !fixedValue && !colorOperation) {
    addThemeNodeDiagnostic(
      expectedCategory ?? inferThemeNodeCategory(value),
      path,
      state,
      themeNodeDisplayValue(value),
      `Malformed Tileflow ${String(value.kind)} node cannot establish explicit theme intent.`,
      'Use token.*, fixed(value, {reason}), or color.* constructors without extra fields.',
    );
    return;
  }

  const actualCategory = tokenReference?.category ?? (colorOperation ? 'color' : undefined);
  if (!expectedCategory) {
    addThemeNodeDiagnostic(
      actualCategory ?? inferThemeNodeCategory(value),
      path,
      state,
      themeNodeDisplayValue(value),
      'Tileflow theme values may only be consumed by a categorized visual property.',
      'Move the value to a color, font, image, or visual-number field; keep structure literal.',
    );
    return;
  }

  if (actualCategory && actualCategory !== expectedCategory) {
    addThemeNodeDiagnostic(
      expectedCategory,
      path,
      state,
      themeNodeDisplayValue(value),
      `Tileflow theme value category mismatch: expected ${expectedCategory}, received ${actualCategory}.`,
      `Use token.${expectedCategory}(...) or an explicit fixed ${expectedCategory} value.`,
    );
    return;
  }

  if (fixedValue) {
    if (!isThemePrimitiveForCategory(fixedValue.value, expectedCategory)) {
      addThemeNodeDiagnostic(
        expectedCategory,
        path,
        state,
        themeNodeDisplayValue(value),
        `Tileflow fixed value category mismatch: expected ${expectedCategory}.`,
        `Use a primitive ${expectedCategory} value inside fixed(value, {reason}).`,
      );
    }
    return;
  }

  if (!colorOperation) return;
  if (colorOperation.operation === 'alpha') {
    visitAuditableValue(colorOperation.color, `${path}.color`, 'color', state, true);
    visitAuditableValue(colorOperation.opacity, `${path}.opacity`, 'number', state, true);
    return;
  }
  visitAuditableValue(colorOperation.from, `${path}.from`, 'color', state, true);
  visitAuditableValue(colorOperation.to, `${path}.to`, 'color', state, true);
  visitAuditableValue(colorOperation.amount, `${path}.amount`, 'number', state, true);
}

function addThemeNodeDiagnostic(
  category: TileflowVisualValueCategory,
  path: string,
  state: AuditTraversalState,
  value: number | string,
  message: string,
  suggestion: string,
): void {
  state.diagnostics.push({
    category,
    code: 'THEME_IMPLICIT_FIXED',
    ...(state.context.effectKind ? {effectKind: state.context.effectKind} : {}),
    message,
    ...(state.context.owner ? {owner: state.context.owner} : {}),
    path,
    phase: 'theme-audit',
    scope: state.context.scope,
    severity: 'error',
    suggestion,
    ...(state.context.target ? {target: state.context.target} : {}),
    value,
  });
}

function inferThemeNodeCategory(
  value: Readonly<Record<string, unknown>>,
): TileflowVisualValueCategory {
  if (isThemeTokenCategory(value.category)) return value.category;
  if (value.kind === 'theme-color') return 'color';
  return typeof value.value === 'number' ? 'number' : 'color';
}

function themeNodeDisplayValue(value: Readonly<Record<string, unknown>>): number | string {
  if (typeof value.token === 'string') return value.token;
  if (typeof value.value === 'string' || typeof value.value === 'number') return value.value;
  if (typeof value.operation === 'string') return value.operation;
  return String(value.kind);
}

function isThemePrimitiveForCategory(
  value: unknown,
  category: TileflowVisualValueCategory,
): boolean {
  return category === 'number'
    ? (typeof value === 'number' && Number.isFinite(value)) ||
        (Array.isArray(value) &&
          value.every((entry) => typeof entry === 'number' && Number.isFinite(entry)))
    : typeof value === 'string' && value.length > 0;
}

function isThemeValueCandidate(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.kind === 'theme-token' || value.kind === 'theme-fixed' || value.kind === 'theme-color')
  );
}

function visitAuditableValue(
  value: unknown,
  path: string,
  category: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
  intentRequired = false,
): void {
  if (isThemeStructuralPath(path)) category = undefined;
  if (isThemeValueCandidate(value)) {
    visitThemeIntentNode(value, path, category, state);
    return;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    addAuditDiagnostic(value, path, category, state, intentRequired);
    return;
  }
  if (Array.isArray(value)) {
    visitAuditableArray(value, path, category, state, false, intentRequired);
    return;
  }
  if (!isRecord(value)) return;
  if (value.kind === 'expression' && Array.isArray(value.value)) {
    visitAuditableArray(value.value, `${path}.value`, category, state, true, intentRequired);
    return;
  }
  if (value.kind === 'zoom' && Array.isArray(value.stops)) {
    for (const [index, stop] of value.stops.entries()) {
      if (Array.isArray(stop)) {
        visitAuditableValue(stop[0], `${path}.stops[${index}][0]`, undefined, state);
        visitAuditableValue(
          stop[1],
          `${path}.stops[${index}][1]`,
          category,
          state,
          category !== undefined && category !== 'number',
        );
      }
    }
    return;
  }
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    visitAuditableValue(
      value[key],
      `${path}.${key}`,
      classifyTileflowVisualProperty(key, value[key]),
      state,
    );
  }
}

function visitAuditableArray(
  value: readonly unknown[],
  path: string,
  category: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
  forceExpression = false,
  intentRequired = false,
): void {
  const operator = typeof value[0] === 'string' ? value[0] : undefined;
  const isExpression = forceExpression || isMapLibreExpressionOperator(operator);
  if (!isExpression) {
    for (const [index, entry] of value.entries()) {
      visitAuditableValue(entry, `${path}[${index}]`, category, state, intentRequired);
    }
    return;
  }
  visitExpressionOutputs(value, path, category, state, intentRequired);
}

function visitExpressionOutputs(
  value: readonly unknown[],
  path: string,
  category: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
  intentRequired: boolean,
): void {
  const operator = typeof value[0] === 'string' ? value[0] : undefined;
  if (!operator) return;

  if (operator === 'let') {
    const variables = new Map(state.variables);
    for (let index = 1; index < value.length - 1; index += 2) {
      const name = value[index];
      if (typeof name === 'string') {
        variables.set(name, {path: `${path}[${index + 1}]`, value: value[index + 1]});
      }
    }
    if (value.length > 1) {
      visitAuditableValue(
        value.at(-1),
        `${path}[${value.length - 1}]`,
        category,
        {...state, variables},
        intentRequired || (category !== undefined && category !== 'number'),
      );
    }
    return;
  }

  if (operator === 'var') {
    const name = value[1];
    if (typeof name !== 'string' || state.resolvingVariables.has(name)) {
      addDynamicExpressionDiagnostic(
        operator,
        path,
        category,
        state,
        intentRequired || (category !== undefined && category !== 'number'),
      );
      return;
    }
    const variable = state.variables.get(name);
    if (!variable) {
      addDynamicExpressionDiagnostic(
        operator,
        path,
        category,
        state,
        intentRequired || (category !== undefined && category !== 'number'),
      );
      return;
    }
    visitAuditableValue(
      variable.value,
      variable.path,
      category,
      {...state, resolvingVariables: new Set([...state.resolvingVariables, name])},
      intentRequired,
    );
    return;
  }

  if (operator === 'literal') {
    if (value.length > 1) {
      visitLiteralOutput(value[1], `${path}[1]`, category, state, intentRequired);
    }
    return;
  }

  if (expressionDataOperators.has(operator)) {
    for (let index = 1; index < value.length; index += 1) {
      visitAuditableValue(value[index], `${path}[${index}]`, undefined, state);
    }
    addDynamicExpressionDiagnostic(
      operator,
      path,
      category,
      state,
      intentRequired || (category !== undefined && category !== 'number'),
    );
    return;
  }

  // rgb/rgba synthesize a color rather than selecting an explicitly themed color output. Even
  // fixed numeric channels cannot make that chromatic intent visible to an agent.
  if (operator === 'rgb' || operator === 'rgba') {
    for (let index = 1; index < value.length; index += 1) {
      visitAuditableValue(value[index], `${path}[${index}]`, undefined, state);
    }
    addDynamicExpressionDiagnostic(operator, path, category, state, true);
    return;
  }

  const outputIndices = new Set(expressionOutputIndices(operator, value.length));
  for (let index = 1; index < value.length; index += 1) {
    const isOutput = outputIndices.has(index);
    visitAuditableValue(
      value[index],
      `${path}[${index}]`,
      isOutput ? category : undefined,
      state,
      isOutput && (intentRequired || (category !== undefined && category !== 'number')),
    );
  }
}

function visitLiteralOutput(
  value: unknown,
  path: string,
  category: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
  intentRequired: boolean,
): void {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      visitLiteralOutput(entry, `${path}[${index}]`, category, state, intentRequired);
    }
    return;
  }
  visitAuditableValue(value, path, category, state, intentRequired);
}

function addAuditDiagnostic(
  value: number | string,
  path: string,
  category: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
  blocking = false,
): void {
  if (!category) return;
  if (category === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
  } else {
    // Theme intent is orthogonal to MapLibre syntax validity. Named CSS colors, HSL, and invalid
    // strings are all still implicit literals here; the final style schema owns validity.
    if (typeof value !== 'string') return;
  }
  state.diagnostics.push({
    category,
    code: 'THEME_IMPLICIT_FIXED',
    ...(state.context.effectKind ? {effectKind: state.context.effectKind} : {}),
    message:
      `Visual ${category} literal is implicitly fixed; use token.${category}(...) or ` +
      'fixed(value, {reason}).',
    ...(state.context.owner ? {owner: state.context.owner} : {}),
    path,
    phase: 'theme-audit',
    scope: state.context.scope,
    severity: category === 'number' && !blocking ? 'warning' : 'error',
    suggestion:
      `Replace the literal with token.${category}(...) or document the invariant with ` +
      'fixed(value, {reason}).',
    ...(state.context.target ? {target: state.context.target} : {}),
    value,
  });
}

function addDynamicExpressionDiagnostic(
  operator: string,
  path: string,
  category: TileflowVisualValueCategory | undefined,
  state: AuditTraversalState,
  intentRequired: boolean,
): void {
  if (!category || category === 'number' || !intentRequired) return;
  state.diagnostics.push({
    category,
    code: 'THEME_IMPLICIT_FIXED',
    ...(state.context.effectKind ? {effectKind: state.context.effectKind} : {}),
    message:
      `Visual ${category} expression has a dynamic output from ${operator}; every possible output ` +
      `must be token.${category}(...), fixed(value, {reason}), or a valid theme color operation.`,
    ...(state.context.owner ? {owner: state.context.owner} : {}),
    path,
    phase: 'theme-audit',
    scope: state.context.scope,
    severity: 'error',
    suggestion: `Make every ${category} output branch carry explicit theme intent.`,
    ...(state.context.target ? {target: state.context.target} : {}),
    value: operator,
  });
}

function expressionOutputIndices(operator: string, length: number): number[] {
  switch (operator) {
    case 'case':
      return uniqueIndices([...range(2, length - 1, 2), length - 1]);
    case 'match':
      return uniqueIndices([...range(3, length - 1, 2), length - 1]);
    case 'step':
      return range(2, length, 2);
    case 'interpolate':
    case 'interpolate-hcl':
    case 'interpolate-lab':
      return range(4, length, 2);
    case 'format':
      return range(1, length, 2);
    case 'at':
      return length > 2 ? [2] : [];
    case 'array':
      return length > 1 ? [length - 1] : [];
    case 'image':
      return length > 1 ? [1] : [];
    case 'coalesce':
    case 'concat':
    case 'join':
    case 'boolean':
    case 'number':
    case 'object':
    case 'string':
    case 'to-boolean':
    case 'to-color':
    case 'to-number':
    case 'to-string':
      return range(1, length, 1);
    default:
      // Arithmetic, string transforms, and other value-producing expressions derive their
      // visual output from every operand. Nested data-access expressions are ignored separately.
      return range(1, length, 1);
  }
}

const expressionDataOperators = new Set([
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

function uniqueIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)];
}

function inferAuditContext(path: string): TileflowThemeAuditContext {
  if (path === 'terrain' || path.startsWith('terrain.')) return {scope: 'terrain'};
  if (path === 'modules' || path.startsWith('modules.')) {
    const owner = path.match(/^modules\.([^.[]+)/u)?.[1];
    return {scope: 'module', ...(owner ? {owner} : {})};
  }
  if (path === 'compilerEffects' || path.startsWith('compilerEffects.')) {
    return {scope: 'compiler-effect'};
  }
  return {scope: 'value'};
}

function compareAuditDiagnostics(
  left: TileflowThemeAuditDiagnostic,
  right: TileflowThemeAuditDiagnostic,
): number {
  const leftKey = [
    left.scope,
    left.owner ?? '',
    left.target ?? '',
    left.effectKind ?? '',
    left.path,
    left.category,
    typeof left.value,
    String(left.value),
  ];
  const rightKey = [
    right.scope,
    right.owner ?? '',
    right.target ?? '',
    right.effectKind ?? '',
    right.path,
    right.category,
    typeof right.value,
    String(right.value),
  ];
  for (let index = 0; index < leftKey.length; index += 1) {
    const compared = compareCodeUnits(leftKey[index]!, rightKey[index]!);
    if (compared !== 0) return compared;
  }
  return 0;
}

function range(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let index = start; index < end; index += step) values.push(index);
  return values;
}

class ThemeValueResolver {
  readonly #cache = new Map<string, string | number>();
  readonly #stack: string[] = [];
  readonly #theme: TileflowTheme;

  constructor(theme: TileflowTheme) {
    assertThemeDocument(theme);
    this.#theme = theme;
  }

  resolveAllTokens(): void {
    for (const category of ['color', 'font', 'image', 'number'] as const) {
      this.resolveCategory(category);
    }
  }

  resolveCategory<TCategory extends TileflowThemeTokenCategory>(
    category: TCategory,
  ): TCategory extends 'number' ? Record<string, number> : Record<string, string> {
    return Object.fromEntries(
      Object.keys(this.#theme.tokens[category])
        .sort(compareCodeUnits)
        .map((name) => [
          name,
          this.#resolveToken(category, name, `theme.tokens.${category}.${name}`),
        ]),
    ) as TCategory extends 'number' ? Record<string, number> : Record<string, string>;
  }

  resolveTree(
    value: unknown,
    path: string,
    expectedCategory?: TileflowThemeTokenCategory,
  ): unknown {
    const category = isThemeStructuralPath(path)
      ? undefined
      : (expectedCategory ?? inferThemeCategoryFromPath(path));
    if (isThemeValueCandidate(value)) {
      assertThemeNodeResolutionContext(value, category, path);
    }
    if (isTileflowThemeTokenReference(value)) {
      return this.#resolveReference(value, path);
    }
    if (isTileflowFixedValue(value)) {
      return this.resolveTree(value.value, `${path}.value`, category);
    }
    if (isTileflowThemeColorOperation(value)) return this.#resolveColorOperation(value, path);
    if (Array.isArray(value)) {
      return value.map((entry, index) => this.resolveTree(entry, `${path}[${index}]`, category));
    }
    if (!isRecord(value)) return value;

    if (value.kind === 'expression' && Array.isArray(value.value)) {
      return {
        ...value,
        value: this.resolveTree(value.value, `${path}.value`, category),
      };
    }
    if (value.kind === 'zoom' && Array.isArray(value.stops)) {
      return {
        ...value,
        stops: value.stops.map((stop, index) =>
          Array.isArray(stop)
            ? [
                this.resolveTree(stop[0], `${path}.stops[${index}][0]`),
                this.resolveTree(stop[1], `${path}.stops[${index}][1]`, category),
              ]
            : this.resolveTree(stop, `${path}.stops[${index}]`),
        ),
      };
    }

    const result: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      const nextPath =
        typeof key === 'symbol' ? `${path}.[${String(key)}]` : `${path}.${String(key)}`;
      const nextValue = value[key as keyof typeof value];
      const nextCategory =
        typeof key === 'string' ? classifyTileflowVisualProperty(key, nextValue) : undefined;
      result[key] = this.resolveTree(nextValue, nextPath, nextCategory);
    }
    return result;
  }

  resolveTypography(typography: TileflowThemeTypography): ResolvedTileflowTypography {
    const global = this.#resolveTypographyStyle(typography, 'theme.typography', {
      font: 'Noto Sans Regular',
    });
    return {
      ...global,
      places: this.#resolveTypographyStyle(typography.places, 'theme.typography.places', global),
      poi: this.#resolveTypographyStyle(typography.poi, 'theme.typography.poi', global),
      roads: this.#resolveTypographyStyle(typography.roads, 'theme.typography.roads', global),
      water: this.#resolveTypographyStyle(typography.water, 'theme.typography.water', global),
    };
  }

  resolveLighting(lighting: TileflowThemeLighting): TileflowLight {
    const result = this.resolveTree(lighting, 'theme.lighting') as Record<string, unknown>;
    if (result.anchor !== undefined && result.anchor !== 'map' && result.anchor !== 'viewport') {
      throw themeTypeError('theme.lighting.anchor', 'map or viewport', result.anchor);
    }
    if (result.color !== undefined) assertColor(result.color, 'theme.lighting.color');
    if (result.intensity !== undefined) {
      assertFiniteNumber(result.intensity, 'theme.lighting.intensity');
      if (result.intensity < 0 || result.intensity > 1) {
        throw new Error('Tileflow theme.lighting.intensity must be between 0 and 1.');
      }
    }
    if (result.position !== undefined) {
      if (
        !Array.isArray(result.position) ||
        result.position.length !== 3 ||
        result.position.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
      ) {
        throw themeTypeError('theme.lighting.position', 'three finite numbers', result.position);
      }
    }
    return result as TileflowLight;
  }

  #resolveTypographyStyle(
    style: TileflowThemeTypographyStyle | undefined,
    path: string,
    defaults: {font: string} & Omit<TileflowTypographyStyle, 'font'>,
  ): {font: string} & Omit<TileflowTypographyStyle, 'font'> {
    const resolved = this.resolveTree(style ?? {}, path) as Record<string, unknown>;
    const font = resolved.font ?? defaults.font;
    if (typeof font !== 'string' || !font) throw themeTypeError(`${path}.font`, 'font', font);
    assertFontName(font, `${path}.font`);
    const fallbacks = resolved.fallbacks ?? defaults.fallbacks;
    if (
      fallbacks !== undefined &&
      (!Array.isArray(fallbacks) || fallbacks.some((entry) => typeof entry !== 'string' || !entry))
    ) {
      throw themeTypeError(`${path}.fallbacks`, 'font array', fallbacks);
    }
    if (Array.isArray(fallbacks)) {
      const seen = new Set<string>();
      for (const [index, fallback] of fallbacks.entries()) {
        assertFontName(fallback as string, `${path}.fallbacks[${index}]`);
        if (seen.has(fallback as string)) {
          throw new Error(
            `Duplicate Tileflow font fallback ${JSON.stringify(fallback)} at ${path}.fallbacks[${index}].`,
          );
        }
        seen.add(fallback as string);
      }
    }
    const letterSpacing = resolved.letterSpacing ?? defaults.letterSpacing;
    if (letterSpacing !== undefined) assertFiniteNumber(letterSpacing, `${path}.letterSpacing`);
    const transform = resolved.transform ?? defaults.transform;
    if (
      transform !== undefined &&
      !['lowercase', 'none', 'uppercase'].includes(String(transform))
    ) {
      throw themeTypeError(`${path}.transform`, 'text transform', transform);
    }
    return {
      font,
      ...(fallbacks === undefined ? {} : {fallbacks: [...(fallbacks as string[])]}),
      ...(letterSpacing === undefined ? {} : {letterSpacing: letterSpacing as number}),
      ...(transform === undefined
        ? {}
        : {transform: transform as 'lowercase' | 'none' | 'uppercase'}),
    };
  }

  #resolveReference(reference: TileflowThemeTokenReference, path: string): string | number {
    return this.#resolveToken(reference.category, reference.token, path);
  }

  #resolveToken(
    category: TileflowThemeTokenCategory,
    name: string,
    consumedAt: string,
  ): string | number {
    const cacheKey = `${category}:${name}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const tokens = this.#theme.tokens[category] as Readonly<Record<string, unknown>>;
    if (!Object.hasOwn(tokens, name)) {
      throw new Error(
        `Unknown Tileflow ${category} token "${name}" at ${consumedAt} in theme "${this.#theme.id}".`,
      );
    }
    const cycleStart = this.#stack.indexOf(cacheKey);
    if (cycleStart >= 0) {
      const cycle = [...this.#stack.slice(cycleStart), cacheKey]
        .map((key) => key.replace(':', '.'))
        .join(' -> ');
      throw new Error(`Circular Tileflow theme token reference: ${cycle}.`);
    }
    this.#stack.push(cacheKey);
    try {
      const path = `theme.tokens.${category}.${name}`;
      const value = this.resolveTree(tokens[name], path, category);
      assertTokenPrimitive(category, value, path);
      this.#cache.set(cacheKey, value);
      return value;
    } finally {
      this.#stack.pop();
    }
  }

  #resolveColorOperation(operation: TileflowThemeColorOperation, path: string): string {
    if (operation.operation === 'alpha') {
      const source = this.resolveTree(operation.color, `${path}.color`, 'color');
      const opacity = this.resolveTree(operation.opacity, `${path}.opacity`, 'number');
      assertColor(source, `${path}.color`);
      assertUnitInterval(opacity, `${path}.opacity`);
      return applyAlpha(source, opacity);
    }
    const from = this.resolveTree(operation.from, `${path}.from`, 'color');
    const to = this.resolveTree(operation.to, `${path}.to`, 'color');
    const amount = this.resolveTree(operation.amount, `${path}.amount`, 'number');
    assertColor(from, `${path}.from`);
    assertColor(to, `${path}.to`);
    assertUnitInterval(amount, `${path}.amount`);
    if (operation.space !== 'oklch') {
      throw new Error(`Tileflow theme color mix at ${path} must use the oklch color space.`);
    }
    return mixOklch(from, to, amount);
  }
}

function assertThemeIdentity(theme: Pick<TileflowTheme, 'colorScheme' | 'id' | 'version'>): void {
  if (!isThemeName(theme.id)) {
    throw new Error(
      `Invalid Tileflow theme id ${JSON.stringify(theme.id)}; expected a portable identifier.`,
    );
  }
  if (!Number.isSafeInteger(theme.version) || theme.version < 1) {
    throw new Error(`Tileflow theme "${theme.id}" version must be a positive integer.`);
  }
  if (theme.colorScheme !== 'light' && theme.colorScheme !== 'dark') {
    throw new Error(`Tileflow theme "${theme.id}" colorScheme must be light or dark.`);
  }
}

function assertThemeDefinition(definition: TileflowThemeDefinition): void {
  const record = assertPlainThemeRecord(definition, 'theme');
  assertExactThemeKeys(record, 'theme', themeDocumentKeys);
  assertRequiredThemeKeys(record, 'theme', themeDefinitionRequiredKeys);
  assertThemeIdentity(definition);
  if (Object.hasOwn(record, 'tokens')) {
    assertThemeTokens(record.tokens, 'theme.tokens', false);
  }
  if (Object.hasOwn(record, 'typography')) {
    assertThemeTypography(record.typography, 'theme.typography');
  }
  if (Object.hasOwn(record, 'lighting')) {
    assertThemeLighting(record.lighting, 'theme.lighting');
  }
  cloneJson(definition);
}

function assertThemeDocument(theme: TileflowTheme): void {
  const record = assertPlainThemeRecord(theme, 'theme');
  assertExactThemeKeys(record, 'theme', themeDocumentKeys);
  assertRequiredThemeKeys(record, 'theme', themeDocumentKeys);
  assertThemeIdentity(theme);
  assertThemeTokens(record.tokens, 'theme.tokens', true);
  assertThemeTypography(record.typography, 'theme.typography');
  assertThemeLighting(record.lighting, 'theme.lighting');
  cloneJson(theme);
}

function assertThemeTokens(value: unknown, path: string, complete: boolean): void {
  const tokens = assertPlainThemeRecord(value, path);
  assertExactThemeKeys(tokens, path, themeTokenCategories);
  if (complete) assertRequiredThemeKeys(tokens, path, themeTokenCategories);
  for (const category of themeTokenCategories) {
    if (!Object.hasOwn(tokens, category)) continue;
    const values = assertPlainThemeRecord(tokens[category], `${path}.${category}`);
    for (const name of Reflect.ownKeys(values)) {
      if (typeof name !== 'string') {
        throw new Error(
          `Invalid Tileflow ${category} token key ${String(name)} at ${path}.${category}.`,
        );
      }
      assertTokenName(name, category);
      assertThemeCategoryValue(values[name], category, `${path}.${category}.${name}`);
    }
  }
}

function assertThemeTypography(value: unknown, path: string): void {
  const typography = assertPlainThemeRecord(value, path);
  assertExactThemeKeys(typography, path, themeTypographyKeys);
  assertThemeTypographyStyleFields(typography, path);
  for (const domain of themeTypographyDomains) {
    if (!Object.hasOwn(typography, domain)) continue;
    const stylePath = `${path}.${domain}`;
    const style = assertPlainThemeRecord(typography[domain], stylePath);
    assertExactThemeKeys(style, stylePath, themeTypographyStyleKeys);
    assertThemeTypographyStyleFields(style, stylePath);
  }
}

function assertThemeTypographyStyleFields(
  style: Readonly<Record<string, unknown>>,
  path: string,
): void {
  if (Object.hasOwn(style, 'font')) {
    assertThemeCategoryValue(style.font, 'font', `${path}.font`);
  }
  if (Object.hasOwn(style, 'fallbacks')) {
    if (!Array.isArray(style.fallbacks)) {
      throw themeTypeError(`${path}.fallbacks`, 'font array', style.fallbacks);
    }
    for (const [index, fallback] of style.fallbacks.entries()) {
      assertThemeCategoryValue(fallback, 'font', `${path}.fallbacks[${index}]`);
    }
  }
  if (Object.hasOwn(style, 'letterSpacing')) {
    assertThemeCategoryValue(style.letterSpacing, 'number', `${path}.letterSpacing`);
  }
  if (
    Object.hasOwn(style, 'transform') &&
    !['lowercase', 'none', 'uppercase'].includes(String(style.transform))
  ) {
    throw themeTypeError(`${path}.transform`, 'text transform', style.transform);
  }
}

function assertThemeLighting(value: unknown, path: string): void {
  const lighting = assertPlainThemeRecord(value, path);
  assertExactThemeKeys(lighting, path, themeLightingKeys);
  if (
    Object.hasOwn(lighting, 'anchor') &&
    lighting.anchor !== 'map' &&
    lighting.anchor !== 'viewport'
  ) {
    throw themeTypeError(`${path}.anchor`, 'map or viewport', lighting.anchor);
  }
  if (Object.hasOwn(lighting, 'color')) {
    assertThemeCategoryValue(lighting.color, 'color', `${path}.color`);
  }
  if (Object.hasOwn(lighting, 'intensity')) {
    assertThemeCategoryValue(lighting.intensity, 'number', `${path}.intensity`);
  }
  if (Object.hasOwn(lighting, 'position')) {
    if (!Array.isArray(lighting.position) || lighting.position.length !== 3) {
      throw themeTypeError(`${path}.position`, 'three number values', lighting.position);
    }
    for (const [index, position] of lighting.position.entries()) {
      assertThemeCategoryValue(position, 'number', `${path}.position[${index}]`);
    }
  }
}

function assertThemeCategoryValue(
  value: unknown,
  expectedCategory: TileflowThemeTokenCategory,
  path: string,
): void {
  if (!isRecord(value)) {
    assertTokenPrimitive(expectedCategory, value, path);
    return;
  }
  if (value.kind === 'theme-token') {
    assertThemeTokenReferenceNode(value, expectedCategory, path);
    return;
  }
  if (value.kind === 'theme-fixed') {
    assertThemeFixedNode(value, expectedCategory, path);
    return;
  }
  if (value.kind === 'theme-color') {
    if (expectedCategory !== 'color') {
      throw themeTypeError(path, `${expectedCategory} value`, value);
    }
    assertThemeColorOperationNode(value, path);
    return;
  }
  throw themeTypeError(path, `${expectedCategory} value`, value);
}

function assertThemeTokenReferenceNode(
  reference: Readonly<Record<PropertyKey, unknown>>,
  expectedCategory: TileflowThemeTokenCategory,
  path: string,
): void {
  assertExactThemeKeys(reference, path, ['category', 'kind', 'token']);
  assertRequiredThemeKeys(reference, path, ['category', 'kind', 'token']);
  if (!isThemeTokenCategory(reference.category)) {
    throw themeTypeError(`${path}.category`, 'color, font, image, or number', reference.category);
  }
  if (typeof reference.token !== 'string') {
    throw themeTypeError(`${path}.token`, 'token name', reference.token);
  }
  assertTokenName(reference.token, reference.category);
  if (reference.category !== expectedCategory) {
    throw new Error(
      `Tileflow theme token type mismatch at ${path}; expected ${expectedCategory}, received ${reference.category} token "${reference.token}".`,
    );
  }
}

function assertThemeFixedNode(
  fixedValue: Readonly<Record<PropertyKey, unknown>>,
  expectedCategory: TileflowThemeTokenCategory,
  path: string,
): void {
  assertExactThemeKeys(fixedValue, path, ['kind', 'reason', 'value']);
  assertRequiredThemeKeys(fixedValue, path, ['kind', 'reason', 'value']);
  if (typeof fixedValue.reason !== 'string' || !fixedValue.reason.trim()) {
    throw new Error(`Tileflow fixed value at ${path} requires a non-empty reason.`);
  }
  assertTokenPrimitive(expectedCategory, fixedValue.value, `${path}.value`);
}

function assertThemeColorOperationNode(
  operation: Readonly<Record<PropertyKey, unknown>>,
  path: string,
): void {
  if (operation.operation === 'alpha') {
    assertExactThemeKeys(operation, path, ['color', 'kind', 'opacity', 'operation']);
    assertRequiredThemeKeys(operation, path, ['color', 'kind', 'opacity', 'operation']);
    assertThemeCategoryValue(operation.color, 'color', `${path}.color`);
    assertThemeCategoryValue(operation.opacity, 'number', `${path}.opacity`);
    return;
  }
  if (operation.operation === 'mix') {
    assertExactThemeKeys(operation, path, ['amount', 'from', 'kind', 'operation', 'space', 'to']);
    assertRequiredThemeKeys(operation, path, [
      'amount',
      'from',
      'kind',
      'operation',
      'space',
      'to',
    ]);
    if (operation.space !== 'oklch') {
      throw new Error(`Tileflow theme color mix at ${path} must use the oklch color space.`);
    }
    assertThemeCategoryValue(operation.from, 'color', `${path}.from`);
    assertThemeCategoryValue(operation.to, 'color', `${path}.to`);
    assertThemeCategoryValue(operation.amount, 'number', `${path}.amount`);
    return;
  }
  throw themeTypeError(`${path}.operation`, 'alpha or mix', operation.operation);
}

function assertPlainThemeRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw themeTypeError(path, 'plain object', value);
  return value;
}

function assertExactThemeKeys(
  value: Readonly<Record<PropertyKey, unknown>>,
  path: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new Error(`Unknown Tileflow theme field ${JSON.stringify(String(key))} at ${path}.`);
    }
  }
}

function assertRequiredThemeKeys(
  value: Readonly<Record<PropertyKey, unknown>>,
  path: string,
  requiredKeys: readonly string[],
): void {
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`Missing Tileflow theme field ${JSON.stringify(key)} at ${path}.`);
    }
  }
}

function isThemeTokenCategory(value: unknown): value is TileflowThemeTokenCategory {
  return themeTokenCategories.includes(value as TileflowThemeTokenCategory);
}

function assertTokenPrimitive(
  category: TileflowThemeTokenCategory,
  value: unknown,
  path: string,
): asserts value is string | number {
  if (category === 'number') {
    assertFiniteNumber(value, path);
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw themeTypeError(path, category, value);
  }
  if (category === 'color') assertColor(value, path);
  if (category === 'font') assertFontName(value, path);
  if (category === 'image') assertImageName(value, path);
}

function assertThemeNodeResolutionContext(
  value: Readonly<Record<PropertyKey, unknown>>,
  expectedCategory: TileflowThemeTokenCategory | undefined,
  path: string,
): void {
  if (value.kind === 'theme-token') {
    if (!isThemeTokenCategory(value.category)) {
      // Validate exactness and required fields before reporting the invalid category.
      assertExactThemeKeys(value, path, ['category', 'kind', 'token']);
      assertRequiredThemeKeys(value, path, ['category', 'kind', 'token']);
      throw themeTypeError(`${path}.category`, 'color, font, image, or number', value.category);
    }
    assertThemeTokenReferenceNode(value, expectedCategory ?? value.category, path);
    if (!expectedCategory) throwThemeValueOutsideVisualField(path);
    return;
  }

  if (value.kind === 'theme-fixed') {
    assertExactThemeKeys(value, path, ['kind', 'reason', 'value']);
    assertRequiredThemeKeys(value, path, ['kind', 'reason', 'value']);
    if (typeof value.reason !== 'string' || !value.reason.trim()) {
      throw new Error(`Tileflow fixed value at ${path} requires a non-empty reason.`);
    }
    if (!expectedCategory) throwThemeValueOutsideVisualField(path);
    if (!isThemePrimitiveForCategory(value.value, expectedCategory)) {
      throw themeTypeError(path, `${expectedCategory} value`, value.value);
    }
    return;
  }

  if (value.kind === 'theme-color') {
    assertThemeColorOperationNode(value, path);
    if (!expectedCategory) throwThemeValueOutsideVisualField(path);
    if (expectedCategory !== 'color') {
      throw themeTypeError(path, `${expectedCategory} value`, value);
    }
  }
}

function throwThemeValueOutsideVisualField(path: string): never {
  throw new Error(
    `Tileflow theme value at ${path} is outside a categorized visual property; ` +
      'theme values cannot control filters, zoom bounds, visibility, metadata, or structure.',
  );
}

function inferThemeCategoryFromPath(path: string): TileflowThemeTokenCategory | undefined {
  const tokenCategory = path.match(/^theme\.tokens\.(color|font|image|number)(?:\.|$)/u)?.[1];
  if (isThemeTokenCategory(tokenCategory)) return tokenCategory;
  if (/^theme\.lighting\.position(?:\[\d+\])?$/u.test(path)) return 'number';
  const segments = path.replace(/\[\d+\]/g, '').split('.');
  return [...segments]
    .reverse()
    .map((segment) => classifyTileflowVisualProperty(segment))
    .find((category) => category !== undefined);
}

const themeStructuralPathSegments = new Set([
  'after',
  'before',
  'filter',
  'id',
  'maxZoom',
  'maxzoom',
  'metadata',
  'minZoom',
  'minzoom',
  'owner',
  'placement',
  'requires',
  'source',
  'source-layer',
  'sourceLayer',
  'target',
  'type',
  'visibility',
]);

function isThemeStructuralPath(path: string): boolean {
  const segments = path.replace(/\[\d+\]/g, '').split('.');
  const modulesIndex = segments.indexOf('modules');
  const dataIndex = segments.indexOf('data');
  // Data bindings are structural names even when a semantic key ends in a
  // visual suffix such as `shieldTextColor`. Only the bound feature value is
  // visual; the configured source-field name never is.
  if (
    dataIndex >= 0 &&
    segments[dataIndex + 1] === 'schema' &&
    ['fields', 'layers'].includes(segments[dataIndex + 2] ?? '')
  ) {
    return true;
  }
  // POI `color` selects the semantic strategy (`uniform` or `category`); it is not paint.
  // Keep this path structural even though visual leaf styles also use the generic key `color`.
  if (
    modulesIndex >= 0 &&
    segments[modulesIndex + 1] === 'poi' &&
    segments.length === modulesIndex + 3 &&
    segments[modulesIndex + 2] === 'color'
  ) {
    return true;
  }
  const terrainIndex = segments.indexOf('terrain');
  const effectKindIndex = Math.max(segments.lastIndexOf('add'), segments.lastIndexOf('patch'));
  const firstPropertyIndex =
    effectKindIndex >= 0
      ? effectKindIndex + 1
      : modulesIndex >= 0
        ? modulesIndex + 2
        : terrainIndex >= 0
          ? terrainIndex + 1
          : segments[0] === 'map'
            ? 2
            : 0;
  return segments
    .slice(firstPropertyIndex)
    .some((segment) => themeStructuralPathSegments.has(segment));
}

function assertTokenName(name: string, category: TileflowThemeTokenCategory): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(name)) {
    throw new Error(
      `Invalid Tileflow ${category} token ${JSON.stringify(name)}; expected a portable dot-separated semantic name.`,
    );
  }
}

function isThemeName(value: unknown): value is string {
  return isTileflowThemeName(value);
}

function mergeTypography(
  base: TileflowThemeTypography,
  overlay: TileflowThemeTypography | undefined,
): TileflowThemeTypography {
  return {
    ...cloneJson(base),
    ...cloneJson(overlay ?? {}),
    ...mergeOptionalStyle('places', base, overlay),
    ...mergeOptionalStyle('poi', base, overlay),
    ...mergeOptionalStyle('roads', base, overlay),
    ...mergeOptionalStyle('water', base, overlay),
  };
}

function mergeOptionalStyle(
  key: 'places' | 'poi' | 'roads' | 'water',
  base: TileflowThemeTypography,
  overlay: TileflowThemeTypography | undefined,
): Record<string, TileflowThemeTypographyStyle> {
  const value = mergeRecord(base[key] ?? {}, overlay?.[key] ?? {});
  return Object.keys(value).length ? {[key]: value} : {};
}

function mergeRecord<T extends object>(base: T, overlay: Partial<T>): T {
  if (!isPlainRecord(base) || !isPlainRecord(overlay)) {
    throw new Error('Tileflow theme composition accepts only plain JSON objects.');
  }
  return {...cloneJson(base), ...cloneJson(overlay)};
}

type Rgba = {a: number; b: number; g: number; r: number};
type Oklch = {c: number; h: number; l: number};

function mixOklch(from: string, to: string, amount: number): string {
  const a = rgbaToOklch(parseColor(from));
  const b = rgbaToOklch(parseColor(to));
  let hueDelta = b.h - a.h;
  if (hueDelta > 180) hueDelta -= 360;
  if (hueDelta < -180) hueDelta += 360;
  const rgba = oklchToRgba({
    c: interpolate(a.c, b.c, amount),
    h: (a.h + hueDelta * amount + 360) % 360,
    l: interpolate(a.l, b.l, amount),
  });
  const alpha = interpolate(parseColor(from).a, parseColor(to).a, amount);
  return formatColor({...rgba, a: alpha});
}

function applyAlpha(value: string, opacity: number): string {
  const rgba = parseColor(value);
  return formatSrgbColor({...rgba, a: rgba.a * opacity});
}

function parseColor(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3 || hex.length === 4 ? [...hex].map((entry) => entry + entry).join('') : hex;
    if (expanded.length === 6 || expanded.length === 8) {
      return {
        a: expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1,
        b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
        g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
        r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
      };
    }
  }
  const rgb = value.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\)$/i,
  );
  if (rgb) {
    const result = {
      a: Number(rgb[4] ?? 1),
      b: Number(rgb[3]) / 255,
      g: Number(rgb[2]) / 255,
      r: Number(rgb[1]) / 255,
    };
    if (
      Object.values(result).every((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 1)
    ) {
      return result;
    }
  }
  throw new Error(`Invalid Tileflow theme color ${JSON.stringify(value)}.`);
}

function rgbaToOklch({b, g, r}: Rgba): Oklch {
  const linear = [r, g, b].map(srgbToLinear);
  const l = 0.4122214708 * linear[0]! + 0.5363325363 * linear[1]! + 0.0514459929 * linear[2]!;
  const m = 0.2119034982 * linear[0]! + 0.6806995451 * linear[1]! + 0.1073969566 * linear[2]!;
  const s = 0.0883024619 * linear[0]! + 0.2817188376 * linear[1]! + 0.6299787005 * linear[2]!;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  const labA = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const labB = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  return {
    c: Math.hypot(labA, labB),
    h: (Math.atan2(labB, labA) * 180) / Math.PI + 360,
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
  };
}

function oklchToRgba({c, h, l}: Oklch): Rgba {
  const radians = (h * Math.PI) / 180;
  const labA = c * Math.cos(radians);
  const labB = c * Math.sin(radians);
  const lRoot = l + 0.3963377774 * labA + 0.2158037573 * labB;
  const mRoot = l - 0.1055613458 * labA - 0.0638541728 * labB;
  const sRoot = l - 0.0894841775 * labA - 1.291485548 * labB;
  const lLinear = lRoot ** 3;
  const mLinear = mRoot ** 3;
  const sLinear = sRoot ** 3;
  return {
    a: 1,
    b: clamp01(-0.0041960863 * lLinear - 0.7034186147 * mLinear + 1.707614701 * sLinear),
    g: clamp01(-1.2684380046 * lLinear + 2.6097574011 * mLinear - 0.3413193965 * sLinear),
    r: clamp01(4.0767416621 * lLinear - 3.3077115913 * mLinear + 0.2309699292 * sLinear),
  };
}

function formatColor({a, b, g, r}: Rgba): string {
  const channels = [r, g, b].map((entry) => Math.round(linearToSrgb(entry) * 255));
  if (a >= 0.9995) {
    return `#${channels.map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
  }
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${round(a, 4)})`;
}

function formatSrgbColor({a, b, g, r}: Rgba): string {
  const channels = [r, g, b].map((entry) => Math.round(clamp01(entry) * 255));
  if (a >= 0.9995) {
    return `#${channels.map((entry) => entry.toString(16).padStart(2, '0')).join('')}`;
  }
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${round(a, 4)})`;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = clamp01(value);
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function assertColor(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') throw themeTypeError(path, 'color', value);
  try {
    parseColor(value);
  } catch {
    throw new Error(`Invalid Tileflow theme color ${JSON.stringify(value)} at ${path}.`);
  }
}

function isColor(value: string): boolean {
  try {
    parseColor(value);
    return true;
  } catch {
    return false;
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw themeTypeError(path, 'finite number', value);
  }
}

function assertFontName(value: string, path: string): void {
  if (
    value.length > 100 ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    /[\p{Cc}\\]/u.test(value)
  ) {
    throw new Error(
      `Invalid Tileflow font ${JSON.stringify(value)} at ${path}; expected an exact NFC face name without whitespace, controls, or backslashes.`,
    );
  }
}

function assertImageName(value: string, path: string): void {
  if (
    value.length > 128 ||
    value !== value.trim() ||
    value !== value.normalize('NFC') ||
    /[\p{Cc}\\]/u.test(value)
  ) {
    throw new Error(`Invalid Tileflow image token value ${JSON.stringify(value)} at ${path}.`);
  }
}

function assertUnitInterval(value: unknown, path: string): asserts value is number {
  assertFiniteNumber(value, path);
  if (value < 0 || value > 1) {
    throw new Error(`Tileflow theme value at ${path} must be between 0 and 1.`);
  }
}

function themeTypeError(path: string, expected: string, value: unknown): Error {
  return new Error(
    `Invalid Tileflow theme value at ${path}; expected ${expected}, received ${describe(value)}.`,
  );
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function interpolate(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits: number): number {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function cloneJson<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Tileflow themes must be JSON-serializable.');
  return JSON.parse(serialized) as T;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Keep these types discoverable from the theme module without making callers know
// where the JSON AST helpers are implemented.
export type {
  TileflowFixedValue,
  TileflowThemeColorOperation,
  TileflowThemeColorValue,
  TileflowThemeFontValue,
  TileflowThemeImageValue,
  TileflowThemeNumberValue,
  TileflowThemeTokenCategory,
  TileflowThemeTokenReference,
};
