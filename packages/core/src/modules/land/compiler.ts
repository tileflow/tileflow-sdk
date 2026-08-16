import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyBackgroundStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
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
        cemetery: {fill: {color: colors.landuse.cemetery, opacity: 0.62}},
        civic: {fill: {color: colors.landuse.civic, opacity: 0.62}},
        commercial: {fill: {color: colors.landuse.commercial, opacity: 0.62}},
        industrial: {fill: {color: colors.landuse.industrial, opacity: 0.62}},
        railway: {fill: {color: colors.landuse.industrial, opacity: 0.62}},
        residential: {fill: {color: colors.landuse.residential, opacity: 0.62}},
      },
      landcover: {
        farmland: {fill: {color: colors.landcover.protected, opacity: 0.88}},
        grass: {fill: {color: colors.landcover.grass, opacity: 0.88}},
        ice: {fill: {color: colors.landcover.ice, opacity: 0.88}},
        park: {fill: {color: colors.landcover.park, opacity: 0.78}},
        protected: {fill: {color: colors.landcover.protected, opacity: 0.88}},
        sand: {fill: {color: colors.landcover.sand, opacity: 0.88}},
        scrub: {fill: {color: colors.landcover.protected, opacity: 0.88}},
        wood: {fill: {color: colors.landcover.wood, opacity: 0.88}},
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
      layer: applyBackgroundStyle(
        {
          id: 'streets-background',
          type: 'background',
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
    if (!style) continue;
    for (const area of createAreaLayers(
      {
        id: `streets-landuse-${name}`,
        type: 'fill',
        source,
        'source-layer': schema.layers.landuse,
        filter: classFilter(classField, classes),
      },
      style,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.landuse.${name}.${area.phase}`,
      });
    }
  }

  for (const [name, classes] of Object.entries(landcoverClasses) as Array<
    [TileflowLandcoverClass, readonly string[]]
  >) {
    const style = config.landcover?.[name];
    if (!style) continue;
    const sourceLayer = name === 'park' ? schema.layers.park : schema.layers.landcover;
    for (const area of createAreaLayers(
      {
        id: `streets-landcover-${name}`,
        type: 'fill',
        source,
        'source-layer': sourceLayer,
        ...(name === 'park' ? {} : {filter: classFilter(classField, classes)}),
      },
      style,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: localOrder++,
        owner: 'land',
        slot: 'land',
        target: `land.landcover.${name}.${area.phase}`,
      });
    }
  }

  return contributions;
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}
