import {
  resolveStreetsModules,
  type TileflowStreetsBasemapConfig,
  type TileflowStreetsModules,
} from '../basemaps';
import {resolveTileflowData, type TileflowDataConfig} from '../data';
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
import {parseTileflowMap} from '../schema-v2';
import {resolveTerrain} from '../terrain';
import {resolveColors, resolveTheme, resolveTypography} from '../themes';
import type {
  MapLibreStyle,
  TileflowIconSet,
  TileflowLight,
  TileflowProjectIconSets,
  TileflowProjection,
  TileflowProjectThemes,
  TileflowTerrain,
  TileflowTheme,
  TileflowThemeConfig,
  TileflowViewConfig,
} from '../types';
import type {TileflowLayerContribution} from './contributions';
import {assembleTileflowLayers} from './graph';
import {optimizeTileflowLayers} from './optimizer';
import {
  applyTileflowRawOverrides,
  type TileflowRawOverride,
  tileflowRawOverrideMetadataKey,
} from './overrides';

export type TileflowStreetsMapConfig = {
  allowedOrigins?: string[];
  basemap: TileflowStreetsBasemapConfig;
  data?: TileflowDataConfig;
  glyphs?: string;
  icons?: TileflowIconSet;
  light?: TileflowLight;
  modules?: TileflowStreetsModules;
  name?: string;
  overrides?: readonly TileflowRawOverride[];
  projection?: TileflowProjection;
  sprite?: string;
  terrain?: TileflowTerrain;
  theme?: TileflowTheme | string | TileflowThemeConfig;
  view?: TileflowViewConfig;
};

export type TileflowStreetsCompileOptions = {
  apiBaseUrl?: string;
  iconSets?: TileflowProjectIconSets;
  themes?: TileflowProjectThemes;
};

export function createStreetsStyle(
  config: TileflowStreetsMapConfig,
  options: TileflowStreetsCompileOptions = {},
): MapLibreStyle {
  const parsed = parseTileflowMap(config, {icons: options.iconSets, themes: options.themes});
  return compileStreetsStyle(parsed, options);
}

/** Compile an already validated Streets map. Internal orchestration should use this entry point. */
export function compileStreetsStyle(
  config: TileflowStreetsMapConfig,
  options: TileflowStreetsCompileOptions = {},
): MapLibreStyle {
  if (config.basemap.type !== 'streets') {
    throw new Error('Tileflow Streets compiler requires basemap: streets().');
  }
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const data = resolveTileflowData(config.data, {apiBaseUrl});
  const theme = resolveTheme(config.theme ?? config.basemap.variant, options.themes);
  const colors = resolveColors({}, theme.colors, {}, theme.modules);
  const typography = resolveTypography({}, theme.typography);
  const icons = resolveIconSet(config.icons, options.iconSets);
  const context = {colors, data, ...(icons ? {icons} : {}), typography};
  const modules = resolveStreetsModules(config.modules);
  const labelLanguage = resolveLabels(modules.labels).language;
  const poiModule =
    !config.icons && !config.sprite && config.modules?.poi?.icons === undefined
      ? {...modules.poi, icons: false as const}
      : modules.poi;
  const contributions: TileflowLayerContribution[] = [
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
    ...compilePoi(poiModule, context, labelLanguage),
  ];
  const terrain = resolveTerrain(config.terrain, apiBaseUrl);
  if (terrain?.sourceId === data.sourceId) {
    throw new Error(
      `Terrain source ID "${terrain.sourceId}" conflicts with the primary vector source.`,
    );
  }
  if (terrain) contributions.push(terrainContribution(terrain));
  const layers = finalizeTileflowLayers(
    optimizeTileflowLayers(
      applyTileflowRawOverrides(assembleTileflowLayers(contributions), config.overrides ?? []),
    ),
  );
  const glyphs = config.glyphs ?? `${apiBaseUrl}/fonts/{fontstack}/{range}.pbf`;
  const sprite = config.sprite ?? icons?.sprite;

  return {
    version: 8,
    name: config.name ?? 'Tileflow Streets',
    glyphs,
    ...(config.light ? {light: config.light} : {}),
    ...(config.projection ? {projection: {type: config.projection}} : {}),
    ...(sprite ? {sprite} : {}),
    sources: {
      [data.sourceId]: {
        type: 'vector',
        url: data.url,
        ...(data.attribution ? {attribution: data.attribution} : {}),
      },
      ...(terrain ? {[terrain.sourceId]: terrain.source} : {}),
    },
    layers,
    ...(terrain?.mode === '3d'
      ? {terrain: {exaggeration: terrain.exaggeration, source: terrain.sourceId}}
      : {}),
    metadata: {
      'tileflow:basemap': 'streets',
      'tileflow:basemapVersion': config.basemap.basemapVersion,
      'tileflow:variant': theme.mode,
      'tileflow:theme': theme.name,
      'tileflow:data': data.identity,
      'tileflow:modules': Object.entries(modules)
        .filter(([, module]) => !isRecord(module) || module.enabled !== false)
        .map(([name]) => name)
        .sort(),
      ...(config.view ? {'tileflow:view': config.view} : {}),
    },
  };
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
      if (metadata) delete metadata[tileflowRawOverrideMetadataKey];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveIconSet(
  request: TileflowIconSet | undefined,
  iconSets: TileflowProjectIconSets | undefined,
  seen: readonly string[] = [],
): {mapping?: Record<string, string>; sprite?: string} | undefined {
  if (!request) return undefined;
  if (typeof request === 'string') {
    const referenced = iconSets?.[request];
    if (!referenced) return isUrlReference(request) ? {sprite: request} : undefined;
    if (seen.includes(request)) {
      throw new Error(`Circular Tileflow icon set extends: ${[...seen, request].join(' -> ')}`);
    }
    return resolveIconSet(referenced, iconSets, [...seen, request]);
  }
  const inherited = request.extends ? resolveIconSet(request.extends, iconSets, seen) : undefined;
  return {
    ...inherited,
    ...(request.sprite ? {sprite: request.sprite} : {}),
    ...(inherited?.mapping || request.mapping
      ? {mapping: {...inherited?.mapping, ...request.mapping}}
      : {}),
  };
}

function isUrlReference(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function terrainContribution(
  terrain: NonNullable<ReturnType<typeof resolveTerrain>>,
): TileflowLayerContribution {
  return {
    kind: 'layer',
    layer: {
      id: 'streets-terrain-hillshade',
      type: 'hillshade',
      source: terrain.sourceId,
      paint: {
        'hillshade-accent-color': 'rgba(255, 255, 255, 0.18)',
        'hillshade-exaggeration': terrain.mode === '3d' ? 0.24 : 0.42,
        'hillshade-highlight-color': 'rgba(255, 255, 255, 0.28)',
        'hillshade-shadow-color': 'rgba(38, 44, 50, 0.34)',
      },
    },
    localOrder: 0,
    owner: 'land',
    slot: 'terrain',
    target: 'terrain.hillshade',
  };
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? 'https://api.tileflow.dev').replace(/\/+$/, '');
}
