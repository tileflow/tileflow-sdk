import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyExtrusionStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression} from '../../cartography/values';
import type {TileflowBuildingsModuleConfig} from './index';

export function compileBuildings(
  request: TileflowBuildingsModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const {colors} = context;
  const heightOutput = buildingHeightExpression(context);
  const baseOutput = buildingBaseExpression(context, heightOutput);
  const semanticColor = expression<string>(buildingColorExpression(context));
  const config = mergeTileflowDesign<TileflowBuildingsModuleConfig>(
    {
      type: 'buildings',
      enabled: true,
      businessCorridor: {
        fill: {
          color: colors.buildings.businessCorridor,
          minZoom: 12,
          opacity: expression<number>([
            'interpolate',
            ['linear'],
            ['to-number', ['coalesce', ['get', context.data.schema.fields.activityScore], 0], 0],
            0.32,
            0.08,
            1,
            0.22,
          ]),
        },
        outline: {
          color: colors.buildings.businessCorridorOutline,
          minZoom: 14,
          opacity: 0.16,
          width: 0.5,
        },
      },
      mode: 'flat',
      flat: {
        fill: {color: semanticColor, minZoom: 15, opacity: 0.5},
        outline: {color: colors.buildings.outline, minZoom: 15, opacity: 0.24, width: 0.6},
      },
      extrusion: {
        base: expression<number>(baseOutput),
        color: semanticColor,
        height: expression<number>(heightOutput),
        minZoom: 14,
        opacity: 0.72,
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const sourceLayer = context.data.schema.layers.building;
  const visibilityFilter = buildingVisibilityFilter();
  const contributions: TileflowLayerContribution[] = [];

  const corridorLayer = context.data.schema.layers.businessCorridor;
  if (corridorLayer && config.businessCorridor) {
    for (const area of createAreaLayers(
      {
        id: 'streets-business-corridor',
        type: 'fill',
        source,
        'source-layer': corridorLayer,
        filter: businessCorridorVisibilityFilter(context),
      },
      config.businessCorridor,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: area.phase === 'fill' ? -20 : -19,
        owner: 'buildings',
        slot: 'building-areas',
        target: `buildings.businessCorridor.${area.phase}`,
      });
    }
  }

  if (config.mode === '3d') {
    const style = config.extrusion ?? {};
    contributions.push({
      kind: 'layer',
      layer: applyExtrusionStyle(
        {
          id: 'streets-buildings-3d',
          type: 'fill-extrusion',
          source,
          'source-layer': sourceLayer,
          filter: [
            'all',
            visibilityFilter,
            ['!=', ['get', context.data.schema.fields.hide3d], true],
            ['!=', ['get', context.data.schema.fields.hide3d], 1],
            ['!=', ['get', context.data.schema.fields.hide3d], '1'],
          ],
        },
        style,
      ),
      localOrder: 0,
      owner: 'buildings',
      slot: 'buildings',
      target: 'buildings.extrusion',
    });
    return contributions;
  }

  for (const area of createAreaLayers(
    {
      id: 'streets-buildings-fill',
      type: 'fill',
      source,
      'source-layer': sourceLayer,
      filter: visibilityFilter,
    },
    config.flat ?? {},
  )) {
    contributions.push({
      kind: 'layer',
      layer: area.layer,
      localOrder: area.phase === 'fill' ? 0 : 1,
      owner: 'buildings',
      slot: 'buildings',
      target: `buildings.flat.${area.phase}`,
    });
  }
  return contributions;
}

function buildingColorExpression(context: TileflowDomainCompileContext): unknown[] {
  const fields = context.data.schema.fields;
  const colors = context.colors.buildings;
  return [
    'case',
    ['==', ['coalesce', ['get', fields.buildingTone], ''], 'active'],
    colors.active,
    ['==', ['coalesce', ['get', fields.buildingTone], ''], 'destination'],
    colors.destination,
    ['==', ['coalesce', ['get', fields.buildingTone], ''], 'commercial'],
    colors.commercial,
    // Defensive compatibility for immutable V8.9 archives. New candidates emit building_tone.
    [
      'any',
      ['==', ['get', fields.hasBusiness], true],
      ['==', ['get', fields.hasBusiness], 1],
      ['==', ['get', fields.hasBusiness], '1'],
      ['==', ['coalesce', ['get', fields.buildingKind], 'generic'], 'commercial'],
    ],
    colors.commercial,
    colors.generic,
  ];
}

function buildingVisibilityFilter(): unknown[] {
  // Building existence is geometric, not semantic. Layer minzoom and this fixed guard stay in
  // sync even when a compatible archive has no optional classification fields.
  return ['>=', ['zoom'], 15];
}

function businessCorridorVisibilityFilter(context: TileflowDomainCompileContext): unknown[] {
  return [
    '>=',
    ['zoom'],
    ['to-number', ['coalesce', ['get', context.data.schema.fields.minZoom], 12], 12],
  ];
}

function buildingHeightExpression(context: TileflowDomainCompileContext): unknown[] {
  const fields = context.data.schema.fields;
  return [
    'max',
    0,
    [
      'to-number',
      [
        'coalesce',
        ['get', fields.renderHeight],
        // V8.14 materializes this fallback in the tile. Keep the defensive
        // value only for malformed or legacy third-party sources.
        5,
      ],
      5,
    ],
  ];
}

function buildingBaseExpression(
  context: TileflowDomainCompileContext,
  height: unknown[],
): unknown[] {
  const fields = context.data.schema.fields;
  return [
    'max',
    0,
    ['min', ['to-number', ['coalesce', ['get', fields.renderMinHeight], 0], 0], height],
  ];
}
