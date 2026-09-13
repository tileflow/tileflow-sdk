import {isExpression, validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import specification from '@maplibre/maplibre-gl-style-spec/dist/latest.json' with {type: 'json'};
import {z} from 'zod';
import {resolveTileflowNativeResourceUrl, TileflowNativeUrlError} from './native';
import {serializeCanonicalJson} from './icon-package';
import type {MapLibreStyle} from './types';
import {isBoundedNativeJson, nativePointer as pointer, supportsNativeVersions, tileflowNativeProfileLimits} from './native-profile-helpers';
export {tileflowNativeProfileLimits} from './native-profile-helpers';

import {
  tileflowNativeProfile,
  tileflowNativeProfileIdSchema,
  tileflowRendererSchema,
  type TileflowRenderer,
} from './native-profile-definition';
export {
  tileflowNativeProfile,
  tileflowNativeProfileIdSchema,
  tileflowNativeProfileSchema,
  tileflowRendererSchema,
} from './native-profile-definition';
export type {TileflowNativeProfile, TileflowRenderer} from './native-profile-definition';


export const tileflowNativeDiagnosticCodeSchema = z.enum([
  'NATIVE_UNSUPPORTED_STYLE',
  'NATIVE_UNSUPPORTED_SOURCE',
  'NATIVE_FONT_UNAVAILABLE',
  'NATIVE_MANIFEST_REQUIRED',
  'NATIVE_RENDERER_UNSUPPORTED',
]);
export type TileflowNativeDiagnosticCode = z.infer<typeof tileflowNativeDiagnosticCodeSchema>;

/** Uses the command diagnostic fields; renderer/profile are bounded additional context. */
export const tileflowNativeDiagnosticSchema = z.object({
  code: tileflowNativeDiagnosticCodeSchema,
  phase: z.literal('native-compatibility'),
  severity: z.literal('error'),
  path: z.string().max(300).regex(/^(?:\/(?:[^~]|~[01])*)?$/u),
  renderer: z.literal('native'),
  profile: tileflowNativeProfileIdSchema,
  message: z.string().max(300),
  suggestion: z.string().max(300),
}).strict();
export type TileflowNativeDiagnostic = z.infer<typeof tileflowNativeDiagnosticSchema>;


const descriptions: Record<TileflowNativeDiagnosticCode, [string, string]> = {
  NATIVE_UNSUPPORTED_STYLE: [
    'This style value is outside the native-v1 artifact profile.',
    'Use a property and expression supported by both pinned native engines, or select web.',
  ],
  NATIVE_UNSUPPORTED_SOURCE: [
    'This source or resource URL is outside the native-v1 artifact profile.',
    'Use HTTP(S) resources without browser protocols; resolve local PMTiles outside this build.',
  ],
  NATIVE_FONT_UNAVAILABLE: [
    'The native text provider is missing, incompatible, or incomplete.',
    'Use a glyph URL with fontstack/range placeholders or prepared, licensed TTF/OTF faces.',
  ],
  NATIVE_MANIFEST_REQUIRED: [
    'An explicit document URL is required to validate relative native resources.',
    'Pass the absolute URL of the declaring document; do not infer a browser or Metro origin.',
  ],
  NATIVE_RENDERER_UNSUPPORTED: [
    'The requested renderer, profile, or native delivery target is unavailable.',
    'Select web or native-v1 local artifact preparation; Hosted native delivery is not supported.',
  ],
};

export function createTileflowNativeDiagnostic(
  code: TileflowNativeDiagnosticCode,
  path = '',
): TileflowNativeDiagnostic {
  const [message, suggestion] = descriptions[code];
  while (path.length > 300) path = path.slice(0, path.lastIndexOf('/'));
  return {
    code, phase: 'native-compatibility', severity: 'error',
    path, renderer: 'native', profile: 'native-v1', message, suggestion,
  };
}

export class TileflowNativeCompatibilityError extends Error {
  readonly phase = 'native-compatibility' as const;
  readonly issues: readonly TileflowNativeDiagnostic[];
  readonly code: TileflowNativeDiagnosticCode;

  constructor(issues: readonly TileflowNativeDiagnostic[]) {
    super('Native artifact validation failed.');
    this.name = 'TileflowNativeCompatibilityError';
    this.issues = Object.freeze(normalizeNativeDiagnostics(issues).map((issue) => Object.freeze(issue)));
    this.code = this.issues[0]?.code ?? 'NATIVE_UNSUPPORTED_STYLE';
  }
}

export function resolveTileflowRenderer(value: unknown = 'web'): TileflowRenderer {
  const parsed = tileflowRendererSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new TileflowNativeCompatibilityError([
    createTileflowNativeDiagnostic('NATIVE_RENDERER_UNSUPPORTED', '/renderer'),
  ]);
}

export type TileflowNativeStyleValidationOptions = {
  profile?: 'native-v1';
  /** Used only for URL syntax resolution; no request or authority is implied. */
  documentUrl?: string;
  developmentOrigin?: string;
  /** Build preflight may defer font closure until the existing font pipeline has run. */
  deferFontClosure?: boolean;
};

type JsonRecord = Record<string, unknown>;
type SpecProperty = {
  type?: string;
  transition?: boolean;
  values?: Record<string, SpecProperty>;
  'sdk-support'?: Record<string, Record<string, unknown>>;
};
const spec = specification as unknown as Record<string, Record<string, SpecProperty>>;
const expressionDefinitions = (specification as unknown as {
  expression_name?: {values?: Record<string, SpecProperty>};
}).expression_name?.values;
const sourceKinds = new Set(['vector', 'raster', 'raster-dem', 'geojson', 'image']);
const layerKinds = new Set([
  'background', 'fill', 'line', 'symbol', 'raster', 'circle', 'fill-extrusion', 'heatmap', 'hillshade',
]);
const unsupportedRoots = new Set(['terrain', 'sky', 'state', 'roll', 'centerAltitude']);
const rootStructure = new Set([
  'version', 'name', 'metadata', 'center', 'zoom', 'bearing', 'pitch', 'sources', 'layers',
  'sprite', 'glyphs', 'font-faces', 'light', 'transition', 'projection',
]);

/** Validate bounded JSON and the common native engine surface without executing a renderer. */
export function validateTileflowNativeStyle(
  input: unknown,
  options: TileflowNativeStyleValidationOptions = {},
): TileflowNativeDiagnostic[] {
  const issues: TileflowNativeDiagnostic[] = [];
  const add = (code: TileflowNativeDiagnosticCode, path: string) => {
    if (issues.length < tileflowNativeProfileLimits.maximumIssues) {
      issues.push(createTileflowNativeDiagnostic(code, path));
    }
  };
  if (!record(options) || !plainOptions(options)) {
    return [createTileflowNativeDiagnostic('NATIVE_RENDERER_UNSUPPORTED', '/profile')];
  }
  if (
    (options.profile !== undefined && options.profile !== 'native-v1') ||
    !expressionDefinitions
  ) {
    return [createTileflowNativeDiagnostic('NATIVE_RENDERER_UNSUPPORTED', '/profile')];
  }
  if (!isBoundedNativeJson(input) || !record(input)) {
    return [createTileflowNativeDiagnostic('NATIVE_UNSUPPORTED_STYLE')];
  }
  const style = input;
  for (const key of Object.keys(style).sort()) {
    if (!rootStructure.has(key) || unsupportedRoots.has(key)) {
      add('NATIVE_UNSUPPORTED_STYLE', pointer('', key));
    }
  }
  if (
    style.pitch !== undefined &&
    (typeof style.pitch !== 'number' || style.pitch < 0 || style.pitch > 85)
  ) {
    add('NATIVE_UNSUPPORTED_STYLE', '/pitch');
  }
  if (style.projection !== undefined) {
    const projection = style.projection;
    if (!record(projection) || projection.type !== 'mercator' || Object.keys(projection).length !== 1) {
      add('NATIVE_UNSUPPORTED_STYLE', '/projection');
    }
  }
  if (record(style.metadata)) {
    for (const key of Object.keys(style.metadata).sort()) {
      if (/^tileflow:(?:contour|pmtiles)/iu.test(key)) {
        add('NATIVE_UNSUPPORTED_SOURCE', pointer('/metadata', key));
      }
      if (key === 'tileflow:fontFaces' && !options.deferFontClosure) {
        add('NATIVE_FONT_UNAVAILABLE', pointer('/metadata', key));
      }
    }
  }
  const checkUrl = (value: unknown, path: string, template?: 'tile' | 'glyphs') => {
    if (typeof value !== 'string') {add('NATIVE_UNSUPPORTED_SOURCE', path); return;}
    if (/^[a-z][a-z\d+.-]*:/iu.test(value) && !/^https?:\/\//iu.test(value)) {
      add('NATIVE_UNSUPPORTED_SOURCE', path); return;
    }
    if (!options.documentUrl && !/^https?:\/\//iu.test(value)) {
      add('NATIVE_MANIFEST_REQUIRED', path); return;
    }
    try {
      resolveTileflowNativeResourceUrl(value, {
        documentUrl: options.documentUrl ?? `${new URL(value).origin}/`,
        developmentOrigin: options.developmentOrigin,
        template,
      });
    } catch (error) {
      const code = error instanceof TileflowNativeUrlError && error.code === 'NATIVE_URL_ABSOLUTE_REQUIRED' && error.field === 'documentUrl'
        ? 'NATIVE_MANIFEST_REQUIRED' : 'NATIVE_UNSUPPORTED_SOURCE';
      add(code, path);
    }
  };
  if (style.sprite !== undefined) {
    // The existing icon pipeline emits one effective sprite with independent 1x/2x images.
    if (typeof style.sprite !== 'string') add('NATIVE_UNSUPPORTED_STYLE', '/sprite');
    else checkUrl(style.sprite, '/sprite');
  }
  if (style.glyphs !== undefined) {
    if (typeof style.glyphs !== 'string' || !style.glyphs.includes('{fontstack}') || !style.glyphs.includes('{range}')) {
      add('NATIVE_FONT_UNAVAILABLE', '/glyphs');
    } else checkUrl(style.glyphs, '/glyphs', 'glyphs');
  }
  const sources = record(style.sources) ? style.sources : {};
  if (Object.keys(sources).length > tileflowNativeProfileLimits.maximumSources) {
    add('NATIVE_UNSUPPORTED_SOURCE', '/sources');
  }
  for (const id of Object.keys(sources).sort().slice(0, tileflowNativeProfileLimits.maximumSources)) {
    const source = sources[id];
    const path = pointer('/sources', id);
    if (!record(source) || typeof source.type !== 'string' || !sourceKinds.has(source.type)) {
      add('NATIVE_UNSUPPORTED_SOURCE', path); continue;
    }
    properties(source, spec[`source_${source.type.replaceAll('-', '_')}`], path, add, 'NATIVE_UNSUPPORTED_SOURCE');
    if (source.clusterProperties !== undefined) {
      if (record(source.clusterProperties)) {
        for (const key of Object.keys(source.clusterProperties).sort()) {
          const values = source.clusterProperties[key];
          if (Array.isArray(values)) values.forEach((value, i) => expressions(value, `${pointer(`${path}/clusterProperties`, key)}/${i}`, add));
        }
      }
    }
    if (source.url !== undefined) checkUrl(source.url, pointer(path, 'url'));
    if (Array.isArray(source.tiles)) source.tiles.forEach((url, i) => checkUrl(url, `${path}/tiles/${i}`, 'tile'));
    if (source.type === 'geojson' && typeof source.data === 'string') checkUrl(source.data, `${path}/data`);
    if (source.type === 'raster-dem' && source.encoding !== undefined && !['mapbox', 'terrarium'].includes(String(source.encoding))) {
      add('NATIVE_UNSUPPORTED_SOURCE',
        `${path}/encoding`);
    }
    if (['vector', 'raster', 'raster-dem'].includes(source.type) && source.url === undefined && (!Array.isArray(source.tiles) || !source.tiles.length)) {
      add('NATIVE_UNSUPPORTED_SOURCE', path);
    }
  }
  const faces = style['font-faces'];
  if (faces !== undefined) {
    const support = spec.$root?.['font-faces']?.['sdk-support']?.['basic functionality'];
    if (!support || !supportsBoth(support)) add('NATIVE_FONT_UNAVAILABLE', '/font-faces');
    if (!record(faces) || Object.keys(faces).length > tileflowNativeProfileLimits.maximumFontFaces) {
      add('NATIVE_FONT_UNAVAILABLE', '/font-faces');
    } else {
      for (const name of Object.keys(faces).sort()) {
        const path = pointer('/font-faces', name);
        const url = faces[name];
        // This artifact profile emits one complete sfnt face per exact OpenType full name.
        if (typeof url !== 'string' || !/\.(?:ttf|otf)(?:\?[^#]*)?$/iu.test(url)) {
          add('NATIVE_FONT_UNAVAILABLE', path);
        } else checkUrl(url, path);
      }
    }
  }
  const layers = Array.isArray(style.layers) ? style.layers : [];
  if (layers.length > tileflowNativeProfileLimits.maximumLayers) add('NATIVE_UNSUPPORTED_STYLE', '/layers');
  layers.slice(0, tileflowNativeProfileLimits.maximumLayers).forEach((layer: unknown, i: number) => {
    const path = `/layers/${i}`;
    if (!record(layer) || typeof layer.type !== 'string' || !layerKinds.has(layer.type) || layer.ref !== undefined) {
      add('NATIVE_UNSUPPORTED_STYLE', path); return;
    }
    properties(layer, spec.layer, path, add);
    for (const group of ['layout', 'paint']) {
      const values = layer[group];
      if (!record(values)) continue;
      properties(values, spec[`${group}_${layer.type}`], `${path}/${group}`, add, 'NATIVE_UNSUPPORTED_STYLE', true);
      for (const key of Object.keys(values).sort()) {
        expressions(values[key], pointer(`${path}/${group}`, key), add);
      }
    }
    expressions(layer.filter, `${path}/filter`, add);
    if (!options.deferFontClosure && record(layer.layout) && layer.layout['text-field'] !== undefined) {
      const fonts = layer.layout['text-font'];
      if (style.glyphs === undefined) {
        if (!fontStackAvailable(fonts, faces)) add('NATIVE_FONT_UNAVAILABLE',
          `${path}/layout/text-font`);
        inlineFontStacks(layer.layout['text-field'], `${path}/layout/text-field`, faces, add);
      }
    }
  });
  for (const key of ['light', 'transition']) {
    if (record(style[key])) {
      properties(style[key], spec[key], `/${key}`, add);
      for (const [property, value] of Object.entries(style[key])) expressions(value, pointer(`/${key}`, property), add);
    }
  }
  // Use the same pinned parser as compilation; compatibility metadata comes from its unminified JSON.
  try {
    const canonical = JSON.parse(serializeCanonicalJson(style)) as Parameters<typeof validateStyleMin>[0];
    for (const issue of validateStyleMin(canonical)) {
      const prefix = issue.message.split(': ')[0] ?? '';
      const path = parserIssuePointer(prefix, style);
      add('NATIVE_UNSUPPORTED_STYLE', path);
    }
  } catch {
    add('NATIVE_UNSUPPORTED_STYLE', '');
  }
  return normalizeNativeDiagnostics(issues);
}

type AddDiagnostic = (code: TileflowNativeDiagnosticCode, path: string) => void;

function properties(
  values: JsonRecord,
  definitions: Record<string, SpecProperty> | undefined,
  path: string,
  add: AddDiagnostic,
  code: TileflowNativeDiagnosticCode = 'NATIVE_UNSUPPORTED_STYLE',
  checkFeatureSupport = false,
): void {
  if (!definitions) {add(code, path); return;}
  for (const key of Object.keys(values).sort()) {
    if (key === 'metadata') continue;
    const definition = definitions[key];
    if (!definition) {
      if (key.endsWith('-transition') && definitions[key.slice(0, -11)]?.transition) continue;
      add(code, pointer(path, key)); continue;
    }
    const basic = definition['sdk-support']?.['basic functionality'];
    if (basic && !supportsBoth(basic)) add(code, pointer(path, key));
    const value = values[key];
    if (checkFeatureSupport && record(value) && Object.hasOwn(value, 'stops')) add(code, pointer(path, key));
    if (typeof value === 'string') {
      const enumSupport = definition.values?.[value]?.['sdk-support']?.['basic functionality'];
      if (enumSupport && !supportsBoth(enumSupport)) add(code, pointer(path, key));
    }
    if (isExpression(value)) {
      const support = definition['sdk-support']?.['data-driven styling'];
      if (checkFeatureSupport && usesFeatureInput(value) && (!support || !supportsBoth(support))) add(code, pointer(path, key));
    }
  }
}

function supportsBoth(support: Record<string, unknown>): boolean {
  return supportsNativeVersions(support, tileflowNativeProfile);
}

function expressions(value: unknown, path: string, add: AddDiagnostic): void {
  if (!Array.isArray(value) || !isExpression(value)) return;
  const operator = value[0] as string;
  const support = expressionDefinitions?.[operator]?.['sdk-support']?.['basic functionality'];
  if (!support || !supportsBoth(support)) add('NATIVE_UNSUPPORTED_STYLE', `${path}/0`);
  if (operator === 'literal') return;
  value.forEach((child, index) => {
    if (index === 0) return;
    if (operator === 'match' && index >= 2 && index < value.length - 1 && index % 2 === 0) return;
    if (operator.startsWith('interpolate') && index === 1) return;
    if (record(child)) {
      for (const key of Object.keys(child).sort()) expressions(child[key], pointer(`${path}/${index}`, key), add);
    } else expressions(child, `${path}/${index}`, add);
  });
}

function fontStackAvailable(value: unknown, faces: unknown): boolean {
  const stack = Array.isArray(value) && value.length === 2 && value[0] === 'literal' ? value[1] : value;
  return Array.isArray(stack) && stack.length > 0 && record(faces) && stack.every((name) => typeof name === 'string' && Object.hasOwn(faces, name));
}

function inlineFontStacks(value: unknown, path: string, faces: unknown, add: AddDiagnostic): void {
  if (!Array.isArray(value) || !isExpression(value) || value[0] === 'literal') return;
  value.forEach((child, index) => {
    if (index === 0 || (value[0] === 'match' && index >= 2 && index < value.length - 1 && index % 2 === 0)) return;
    if (value[0] === 'format' && record(child) && child['text-font'] !== undefined && !fontStackAvailable(child['text-font'], faces)) {
      add('NATIVE_FONT_UNAVAILABLE', `${path}/${index}/text-font`);
    }
    inlineFontStacks(child, `${path}/${index}`, faces, add);
  });
}

/** Upstream keys use dotted/bracket notation. Stop at the owner when literal keys are ambiguous. */
function parserIssuePointer(key: string, style: JsonRecord): string {
  let value: unknown = style;
  let rest = key;
  let path = '';
  while (rest) {
    if (Array.isArray(value)) {
      const match = /^\[(\d+)\]/u.exec(rest);
      if (!match || Number(match[1]) >= value.length) return path;
      path = pointer(path, match[1]!);
      value = value[Number(match[1])];
      rest = rest.slice(match[0].length).replace(/^\./u, '');
    } else if (record(value)) {
      const matches = Object.keys(value).filter((name) => rest === name || rest.startsWith(`${name}.`) || rest.startsWith(`${name}[`));
      if (matches.length !== 1) return path;
      const name = matches[0]!;
      path = pointer(path, name);
      value = value[name];
      rest = rest.slice(name.length).replace(/^\./u, '');
    } else return path;
  }
  return path;
}

function usesFeatureInput(value: unknown): boolean {
  if (!Array.isArray(value) || !isExpression(value) || value[0] === 'literal') return false;
  return ['get', 'has', 'id', 'properties', 'geometry-type', 'feature-state'].includes(String(value[0])) || value.slice(1).some(usesFeatureInput);
}

function plainOptions(value: JsonRecord): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return false;
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (!('value' in descriptor)) return false;
    }
    return value.deferFontClosure === undefined || typeof value.deferFontClosure === 'boolean';
  } catch {
    return false;
  }
}

function record(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeNativeDiagnostics(input: readonly TileflowNativeDiagnostic[]): TileflowNativeDiagnostic[] {
  const sorted = [...input].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  return sorted.filter((item, i) => i === 0 || item.path !== sorted[i - 1]!.path || item.code !== sorted[i - 1]!.code).slice(0, tileflowNativeProfileLimits.maximumIssues);
}

export function assertTileflowNativeStyle(style: unknown, options: TileflowNativeStyleValidationOptions = {}): asserts style is MapLibreStyle {
  const issues = validateTileflowNativeStyle(style, options);
  if (issues.length) throw new TileflowNativeCompatibilityError(issues);
}

export {
  createTileflowNativeBuildRecord,
  tileflowNativeBuildRecordFileName,
  tileflowNativeBuildRecordSchema,
} from './native-build-record';
export type {TileflowNativeBuildRecord} from './native-build-record';
