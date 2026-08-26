import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {resolveTileflowData, type TileflowDataConfig} from '../data';
import {
  type ResolvedTileflowMap,
  resolveMap,
  type TileflowMap,
  type TileflowMapRoot,
} from '../maps';
import {compileAddresses} from '../modules/addresses/compiler';
import {compileAeroways} from '../modules/aeroways/compiler';
import {compileBoundaries} from '../modules/boundaries/compiler';
import {compileBuildings} from '../modules/buildings/compiler';
import {resolveLabels} from '../modules/labels';
import {compileLabels} from '../modules/labels/compiler';
import {compileLand} from '../modules/land/compiler';
import {compileLandforms} from '../modules/landforms/compiler';
import {compilePoi} from '../modules/poi/compiler';
import {compileRoads} from '../modules/roads/compiler';
import {compileTransit} from '../modules/transit/compiler';
import {compileVegetation} from '../modules/vegetation/compiler';
import {compileWater} from '../modules/water/compiler';
import {parseResolvedTileflowMap} from '../resolved-map-schema';
import {compileTerrainContributions, resolveTerrain} from '../terrain';
import {resolveColors, resolveTheme, resolveTypography} from '../themes';
import type {MapLibreStyle} from '../types';
import {tileflowCompilerMetadataKeys, type TileflowLayerContribution} from './contributions';
import {assembleTileflowLayers} from './graph';
import {
  assertTileflowInteractionManifestLayers,
  createTileflowInteractionManifest,
  tileflowInteractionManifestMetadataKey,
} from './interaction-manifest';
import {
  applyTileflowModuleEffects,
  bindSemanticReferences,
  getResolvedModuleEffects,
  tileflowModuleEffectMetadataKey,
} from './module-effects';
import {optimizeTileflowLayers} from './optimizer';
import {resolveStreetsModules, type TileflowStreetsModules} from './streets-recipe';

export type TileflowStreetsMapConfig = ResolvedTileflowMap;

export type TileflowPreparedMapAssets = {
  icons?: {
    ids: readonly string[];
    sprite: string;
  };
};

export type TileflowStreetsCompileOptions = {
  apiBaseUrl?: string;
  /** Resolved authoring identity. Internal build orchestration supplies this. */
  map?: {
    id: string;
    lineage?: readonly string[];
    root: TileflowMapRoot;
    version: number;
  };
  /** Build-owned assets prepared from the authoring directories. */
  preparedAssets?: TileflowPreparedMapAssets;
};

export function createStreetsStyle(
  config: TileflowMap,
  options: TileflowStreetsCompileOptions = {},
): MapLibreStyle {
  const parsed = parseResolvedTileflowMap(resolveMap(config));
  return compileStreetsStyle(parsed, options);
}

/** Compile an already validated Streets map. Internal orchestration should use this entry point. */
export function compileStreetsStyle(
  config: TileflowStreetsMapConfig,
  options: TileflowStreetsCompileOptions = {},
): MapLibreStyle {
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const data = resolveTileflowData(config.data, {apiBaseUrl});
  const theme = resolveTheme(config.theme);
  const colors = resolveColors({}, theme.colors, {}, theme.modules);
  const typography = resolveTypography({}, theme.typography);
  const context = {colors, data, typography};
  const modules = resolveStreetsModules(config.modules);
  const labelLanguage = resolveLabels(modules.labels).language;
  // Bind semantic data references only after each domain compiler has omitted
  // branches whose optional source capabilities are absent. Binding the raw
  // authoring modules eagerly would reject a valid generic OpenMapTiles source
  // merely because an unused optional recipe (for example bathymetry) names a
  // field that the source deliberately does not provide.
  const contributions = bindSemanticReferences<TileflowLayerContribution[]>(
    [
      ...compileLand(modules.land, context),
      ...compileWater(modules.water, context),
      ...compileBuildings(modules.buildings, context),
      ...compileVegetation(modules.vegetation, context),
      ...compileRoads(modules.roads, context),
      ...compileTransit(modules.transit, context),
      ...compileAeroways(modules.aeroways, context),
      ...compileBoundaries(modules.boundaries, context),
      ...compileLabels(modules.labels, modules.roads, context),
      ...compileLandforms(modules.landforms, labelLanguage, context),
      ...compileAddresses(modules.addresses, context),
      ...compilePoi(modules.poi, context, labelLanguage),
    ],
    data,
  );
  const terrain = resolveTerrain(config.terrain, apiBaseUrl);
  const terrainSources = [terrain?.raster, terrain?.contours].filter(
    (source): source is NonNullable<typeof source> => source !== undefined,
  );
  const terrainSourceIds = new Set<string>();
  for (const source of terrainSources) {
    if (source.sourceId === data.sourceId) {
      throw new Error(
        `Terrain source ID "${source.sourceId}" conflicts with the primary vector source.`,
      );
    }
    if (terrainSourceIds.has(source.sourceId)) {
      throw new Error(
        `Terrain source ID "${source.sourceId}" conflicts with another terrain source.`,
      );
    }
    terrainSourceIds.add(source.sourceId);
  }
  if (terrain) contributions.push(...compileTerrainContributions(terrain, context));
  const activeOwners = new Set(
    Object.entries(modules)
      .filter(([, module]) => !isRecord(module) || module.enabled !== false)
      .map(([owner]) => owner),
  );
  const moduleEffects = getResolvedModuleEffects(config).filter(
    (effect) =>
      activeOwners.has(effect.owner) &&
      (effect.requires ?? []).every((owner) => activeOwners.has(owner)),
  );
  const optimizedLayers = optimizeTileflowLayers(
    applyTileflowModuleEffects(assembleTileflowLayers(contributions), moduleEffects, data),
  );
  const interactionManifest = createTileflowInteractionManifest(optimizedLayers, {
    class: data.schema.fields.class,
    name: data.schema.fields.name,
    rank: data.schema.fields.rank,
    subclass: data.schema.fields.subclass,
  });
  const layers = finalizeTileflowLayers(optimizedLayers);
  assertTileflowInteractionManifestLayers(interactionManifest, layers);
  const glyphs = resolveGlyphs(config);
  const sprite = options.preparedAssets?.icons?.sprite;

  const primarySource: Record<string, unknown> = {
    type: 'vector',
    ...(data.url !== undefined ? {url: data.url} : {tiles: data.tiles}),
    attribution: data.attribution,
    ...(data.bounds ? {bounds: data.bounds} : {}),
    ...(data.maxzoom === undefined ? {} : {maxzoom: data.maxzoom}),
    ...(data.minzoom === undefined ? {} : {minzoom: data.minzoom}),
  };

  const mapMetadata = options.map ?? {
    id: config.id,
    root: config.root,
    version: config.version,
  };

  const style: MapLibreStyle = {
    version: 8,
    name: config.name ?? 'Streets',
    ...(glyphs ? {glyphs} : {}),
    ...(config.light ? {light: config.light} : {}),
    ...(config.projection ? {projection: {type: config.projection}} : {}),
    ...(sprite ? {sprite} : {}),
    sources: {
      [data.sourceId]: primarySource,
      ...(terrain?.raster ? {[terrain.raster.sourceId]: terrain.raster.source} : {}),
      ...(terrain?.contours ? {[terrain.contours.sourceId]: terrain.contours.source} : {}),
    },
    layers,
    ...(terrain?.mode === '3d' && terrain.raster
      ? {terrain: {exaggeration: terrain.exaggeration, source: terrain.raster.sourceId}}
      : {}),
    metadata: {
      ...(mapMetadata
        ? {
            'tileflow:map': mapMetadata.id,
            'tileflow:mapVersion': mapMetadata.version,
            'tileflow:root': mapMetadata.root.compiler,
            'tileflow:rootCompilerVersion': mapMetadata.root.compilerVersion,
            ...(mapMetadata.lineage && mapMetadata.lineage.length > 1
              ? {'tileflow:extends': mapMetadata.lineage.slice(1)}
              : {}),
          }
        : {}),
      'tileflow:variant': theme.mode,
      'tileflow:data': data.identity,
      ...(interactionManifest
        ? {[tileflowInteractionManifestMetadataKey]: interactionManifest}
        : {}),
      'tileflow:modules': Object.entries(modules)
        .filter(([, module]) => !isRecord(module) || module.enabled !== false)
        .map(([name]) => name)
        .sort(),
      ...(config.view ? {'tileflow:view': config.view} : {}),
    },
  };
  assertPreparedIconReferences(style, config, options.preparedAssets);
  assertTextAssets(style, config);
  assertGlyphFontStacks(style, config);
  assertMapLibreStyle(style, config.id);
  return style;
}

function finalizeTileflowLayers(
  input: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  const ids = new Set<string>();
  return input
    .map((layer, index) => {
      const id = typeof layer.id === 'string' ? layer.id : '';
      if (!id) throw new Error(`Compiled Tileflow layer at index ${index} has no ID.`);
      if (ids.has(id)) throw new Error(`Duplicate compiled Tileflow layer ID: ${id}`);
      ids.add(id);

      const minimum = layer.minzoom;
      const maximum = layer.maxzoom;
      for (const [name, value] of [
        ['minzoom', minimum],
        ['maxzoom', maximum],
      ] as const) {
        if (value === undefined) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) {
          throw new Error(`Compiled Tileflow layer ${id} has invalid ${name}: ${String(value)}`);
        }
      }
      if (typeof minimum === 'number' && typeof maximum === 'number' && minimum > maximum) {
        throw new Error(`Compiled Tileflow layer ${id} requires minzoom <= maxzoom.`);
      }

      const metadata = isRecord(layer.metadata) ? {...layer.metadata} : undefined;
      if (metadata) {
        delete metadata[tileflowModuleEffectMetadataKey];
        for (const key of Object.values(tileflowCompilerMetadataKeys)) delete metadata[key];
      }
      return {
        ...layer,
        ...(metadata && Object.keys(metadata).length > 0 ? {metadata} : {}),
        ...(metadata && Object.keys(metadata).length === 0 ? {metadata: undefined} : {}),
      };
    })
    .map((layer) => {
      if (layer.metadata !== undefined) return layer;
      const {metadata: _metadata, ...withoutMetadata} = layer;
      return withoutMetadata;
    });
}

function assertMapLibreStyle(style: MapLibreStyle, mapId: string): void {
  const errors = validateStyleMin(style as never);
  if (errors.length === 0) return;
  const details = errors
    .slice(0, 8)
    .map((error) => error.message)
    .join('; ');
  const remaining = errors.length > 8 ? `; ${errors.length - 8} more` : '';
  throw new Error(`Compiled Tileflow map "${mapId}" is not MapLibre-valid: ${details}${remaining}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveGlyphs(config: ResolvedTileflowMap): string | undefined {
  if (config.fonts !== undefined) return undefined;
  return config.glyphs?.url;
}

function assertPreparedIconReferences(
  style: MapLibreStyle,
  config: ResolvedTileflowMap,
  prepared: TileflowPreparedMapAssets | undefined,
): void {
  const references = collectStyleImageReferences(style);
  if (references.size === 0) return;
  const available = new Set(prepared?.icons?.ids ?? []);
  const missing = [...references].filter((id) => !available.has(id)).sort();
  if (missing.length === 0 && prepared?.icons?.sprite) return;
  const authoring = config.icons?.length
    ? 'Run the Node build so map.icons directories are prepared.'
    : 'Declare map.icons with directories containing those canonical filenames.';
  throw new Error(
    `Tileflow map "${config.id}" references missing images: ${missing.join(', ') || '<sprite>'}. ${authoring}`,
  );
}

function collectStyleImageReferences(style: MapLibreStyle): Set<string> {
  const result = new Set<string>();
  for (const layer of style.layers) {
    const layout = isRecord(layer.layout) ? layer.layout : {};
    const paint = isRecord(layer.paint) ? layer.paint : {};
    const layerId = typeof layer.id === 'string' ? layer.id : '<unknown>';
    for (const [property, value] of [
      ['icon-image', layout['icon-image']],
      ['background-pattern', paint['background-pattern']],
      ['fill-pattern', paint['fill-pattern']],
      ['line-pattern', paint['line-pattern']],
      ['fill-extrusion-pattern', paint['fill-extrusion-pattern']],
    ] as const) {
      if (value !== undefined) collectStaticImageOutputs(value, result, `${layerId}.${property}`);
    }
  }
  return result;
}

function collectStaticImageOutputs(value: unknown, result: Set<string>, path: string): void {
  if (typeof value === 'string') {
    result.add(value);
    return;
  }
  if (!Array.isArray(value) || typeof value[0] !== 'string') {
    throw new Error(`Tileflow image reference ${path} must resolve to enumerable sprite IDs.`);
  }

  const operator = value[0];
  switch (operator) {
    case 'image': {
      if (value.length !== 2 || typeof value[1] !== 'string') {
        throw dynamicImageExpression(path, operator);
      }
      result.add(value[1]);
      return;
    }
    case 'coalesce': {
      for (const output of value.slice(1)) collectStaticImageOutputs(output, result, path);
      return;
    }
    case 'case': {
      for (let index = 2; index < value.length - 1; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      collectStaticImageOutputs(value.at(-1), result, path);
      return;
    }
    case 'match': {
      for (let index = 3; index < value.length - 1; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      collectStaticImageOutputs(value.at(-1), result, path);
      return;
    }
    case 'step': {
      collectStaticImageOutputs(value[2], result, path);
      for (let index = 4; index < value.length; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      return;
    }
    case 'interpolate': {
      for (let index = 4; index < value.length; index += 2) {
        collectStaticImageOutputs(value[index], result, path);
      }
      return;
    }
    case 'literal': {
      if (value.length !== 2 || typeof value[1] !== 'string') {
        throw dynamicImageExpression(path, operator);
      }
      result.add(value[1]);
      return;
    }
    default:
      throw dynamicImageExpression(path, operator);
  }
}

function dynamicImageExpression(path: string, operator: string): Error {
  return new Error(
    `Tileflow image reference ${path} uses dynamic ${JSON.stringify(operator)} output; every possible sprite ID must be statically enumerable with literal, image, case, match, step, interpolate, or coalesce outputs.`,
  );
}

function assertGlyphFontStacks(style: MapLibreStyle, config: ResolvedTileflowMap): void {
  if (!config.glyphs) return;
  const declared = new Set(config.glyphs.fontStacks);
  const missing = new Set<string>();
  for (const layer of style.layers) {
    const layout = isRecord(layer.layout) ? layer.layout : undefined;
    const font = layout?.['text-font'];
    if (!Array.isArray(font) || !font.every((entry) => typeof entry === 'string')) continue;
    const stack = font.join(',');
    if (stack && !declared.has(stack)) missing.add(stack);
  }
  if (missing.size > 0) {
    throw new Error(
      `Tileflow map "${config.id}" uses undeclared glyph font stacks: ${[...missing].sort().join(', ')}.`,
    );
  }
}

function assertTextAssets(style: MapLibreStyle, config: ResolvedTileflowMap): void {
  const textLayers: string[] = [];
  for (const layer of style.layers) {
    const layout = isRecord(layer.layout) ? layer.layout : undefined;
    if (layout?.['text-field'] === undefined) continue;
    textLayers.push(typeof layer.id === 'string' ? layer.id : '<unknown>');
    const font = layout['text-font'];
    if (
      !Array.isArray(font) ||
      font.length === 0 ||
      font.some((entry) => typeof entry !== 'string' || entry.length === 0)
    ) {
      throw new Error(
        `Tileflow map "${config.id}" text layer "${typeof layer.id === 'string' ? layer.id : '<unknown>'}" requires a static non-empty text-font array of exact face names.`,
      );
    }
  }
  if (textLayers.length === 0) return;
  if (config.fonts !== undefined) {
    if (config.fonts.length > 0) return;
    throw new Error(
      `Tileflow map "${config.id}" contains text but declares an empty fonts directory array.`,
    );
  }
  if (config.glyphs !== undefined && style.glyphs) return;
  throw new Error(
    `Tileflow map "${config.id}" contains text but declares neither fonts nor glyphs.`,
  );
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? 'https://api.tileflow.dev').replace(/\/+$/, '');
}
