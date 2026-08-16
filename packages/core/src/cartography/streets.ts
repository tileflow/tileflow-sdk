import {
  resolveStreetsModules,
  type TileflowStreetsBasemapConfig,
  type TileflowStreetsModules,
} from '../basemaps';
import {resolveTileflowData, type TileflowDataConfig} from '../data';
import {compileAeroways} from '../modules/aeroways/compiler';
import {compileBoundaries} from '../modules/boundaries/compiler';
import {compileBuildings} from '../modules/buildings/compiler';
import {compileLabels} from '../modules/labels/compiler';
import {compileLand} from '../modules/land/compiler';
import {compilePoi} from '../modules/poi/compiler';
import {compileRoads} from '../modules/roads/compiler';
import {compileTransit} from '../modules/transit/compiler';
import {compileWater} from '../modules/water/compiler';
import {resolveTerrain} from '../terrain';
import {resolveColors, resolveTheme, resolveTypography} from '../themes';
import type {
  MapLibreStyle,
  TileflowIconSet,
  TileflowProjectIconSets,
  TileflowProjectThemes,
  TileflowTerrain,
  TileflowTheme,
  TileflowThemeConfig,
  TileflowViewConfig,
} from '../types';
import type {TileflowLayerContribution} from './contributions';
import {assembleTileflowLayers} from './graph';
import {applyTileflowRawOverrides, type TileflowRawOverride} from './overrides';

export type TileflowStreetsMapConfig = {
  allowedOrigins?: string[];
  basemap: TileflowStreetsBasemapConfig;
  data?: TileflowDataConfig;
  glyphs?: string;
  icons?: TileflowIconSet;
  modules?: TileflowStreetsModules;
  name?: string;
  overrides?: readonly TileflowRawOverride[];
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
  const poiModule =
    !config.icons && !config.sprite && config.modules?.poi?.icons === undefined
      ? {...modules.poi, icons: false as const}
      : modules.poi;
  const contributions: TileflowLayerContribution[] = [
    ...compileLand(modules.land, context),
    ...compileWater(modules.water, context),
    ...compileBuildings(modules.buildings, context),
    ...compileRoads(modules.roads, context),
    ...compileTransit(modules.transit, context),
    ...compileAeroways(modules.aeroways, context),
    ...compileBoundaries(modules.boundaries, context),
    ...compileLabels(modules.labels, modules.roads, context),
    ...compilePoi(poiModule, context),
  ];
  const terrain = resolveTerrain(config.terrain, apiBaseUrl);
  if (terrain?.sourceId === data.sourceId) {
    throw new Error(
      `Terrain source ID "${terrain.sourceId}" conflicts with the primary vector source.`,
    );
  }
  if (terrain) contributions.push(terrainContribution(terrain));
  const layers = applyTileflowRawOverrides(
    assembleTileflowLayers(contributions),
    config.overrides ?? [],
  );
  const glyphs = config.glyphs ?? `${apiBaseUrl}/fonts/{fontstack}/{range}.pbf`;
  const sprite = config.sprite ?? icons?.sprite;

  return {
    version: 8,
    name: config.name ?? 'Tileflow Streets',
    glyphs,
    ...(sprite ? {sprite} : {}),
    sources: {
      [data.sourceId]: {
        type: 'vector',
        url: data.url,
        attribution: data.attribution,
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
      'tileflow:modules': Object.keys(modules).sort(),
      ...(config.view ? {'tileflow:view': config.view} : {}),
    },
  };
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
      maxzoom: 15,
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
