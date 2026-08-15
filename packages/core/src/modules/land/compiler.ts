import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyFillStyle, applyLayerRange} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {toMapLibreStyleValue} from '../../cartography/values';
import type {TileflowLandcoverClass, TileflowLandModuleConfig, TileflowLanduseClass} from './index';

const landuseClasses: Record<TileflowLanduseClass, readonly string[]> = {
  cemetery: ['cemetery'],
  civic: ['school', 'university', 'hospital', 'civic'],
  commercial: ['commercial', 'retail'],
  industrial: ['industrial'],
  railway: ['railway'],
  residential: ['residential'],
};

const landcoverClasses: Record<TileflowLandcoverClass, readonly string[]> = {
  farmland: ['farmland'],
  grass: ['grass'],
  ice: ['ice', 'glacier'],
  park: ['park'],
  protected: ['protected_area'],
  sand: ['sand', 'beach'],
  scrub: ['scrub'],
  wood: ['wood', 'forest'],
};

export function compileLand(
  request: TileflowLandModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const colors = context.colors;
  const config = mergeTileflowDesign<TileflowLandModuleConfig>(
    {
      type: 'land',
      enabled: true,
      background: {color: colors.background},
      landuse: {
        cemetery: {color: colors.landuse.cemetery, opacity: 0.62},
        civic: {color: colors.landuse.civic, opacity: 0.62},
        commercial: {color: colors.landuse.commercial, opacity: 0.62},
        industrial: {color: colors.landuse.industrial, opacity: 0.62},
        railway: {color: colors.landuse.industrial, opacity: 0.62},
        residential: {color: colors.landuse.residential, opacity: 0.62},
      },
      landcover: {
        farmland: {color: colors.landcover.protected, opacity: 0.88},
        grass: {color: colors.landcover.grass, opacity: 0.88},
        ice: {color: colors.landcover.ice, opacity: 0.88},
        park: {color: colors.landcover.park, opacity: 0.78},
        protected: {color: colors.landcover.protected, opacity: 0.88},
        sand: {color: colors.landcover.sand, opacity: 0.88},
        scrub: {color: colors.landcover.protected, opacity: 0.88},
        wood: {color: colors.landcover.wood, opacity: 0.88},
      },
    },
    request,
  );

  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const schema = context.data.schema;
  const classField = schema.fields.class;
  const contributions: TileflowLayerContribution[] = [];

  if (config.background?.visible !== false) {
    const background = config.background ?? {};
    contributions.push({
      kind: 'layer',
      layer: applyLayerRange(
        {
          id: 'streets-background',
          type: 'background',
          paint: {
            ...(background.color === undefined
              ? {}
              : {'background-color': toMapLibreStyleValue(background.color)}),
            ...(background.opacity === undefined
              ? {}
              : {'background-opacity': toMapLibreStyleValue(background.opacity)}),
            ...(background.pattern === undefined
              ? {}
              : {'background-pattern': toMapLibreStyleValue(background.pattern)}),
          },
        },
        background,
      ),
      localOrder: 0,
      owner: 'land',
      slot: 'background',
      target: 'land.background',
    });
  }

  let localOrder = 100;
  for (const [name, classes] of Object.entries(landuseClasses) as Array<
    [TileflowLanduseClass, readonly string[]]
  >) {
    const style = config.landuse?.[name];
    if (!style || style.visible === false) continue;
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: `streets-landuse-${name}`,
          type: 'fill',
          source,
          'source-layer': schema.layers.landuse,
          filter: classFilter(classField, classes),
        },
        style,
      ),
      localOrder: localOrder++,
      owner: 'land',
      slot: 'land',
      target: `land.landuse.${name}`,
    });
  }

  for (const [name, classes] of Object.entries(landcoverClasses) as Array<
    [TileflowLandcoverClass, readonly string[]]
  >) {
    const style = config.landcover?.[name];
    if (!style || style.visible === false) continue;
    const sourceLayer = name === 'park' ? schema.layers.park : schema.layers.landcover;
    contributions.push({
      kind: 'layer',
      layer: applyFillStyle(
        {
          id: `streets-landcover-${name}`,
          type: 'fill',
          source,
          'source-layer': sourceLayer,
          ...(name === 'park' ? {} : {filter: classFilter(classField, classes)}),
        },
        style,
      ),
      localOrder: localOrder++,
      owner: 'land',
      slot: 'land',
      target: `land.landcover.${name}`,
    });
  }

  return contributions;
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}
