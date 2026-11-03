import type {TileflowDomainCompileContext} from '../../cartography/context';
import {tileflowNativeBuildingsLayerId} from '../../building-layer-ids';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyExtrusionStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import {expression} from '../../cartography/values';
import type {TileflowResolvedModuleConfig} from '../resolved';
import type {TileflowModeSpecificTarget} from '../../cartography/render-stack';
import type {TileflowBuildingMode, TileflowBuildingsModuleConfig} from './index';

export function compileBuildings(
  request: TileflowResolvedModuleConfig<TileflowBuildingsModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const {colors} = context;
  const heightOutput = buildingHeightExpression(context);
  const baseOutput = buildingBaseExpression(context, heightOutput);
  const color = buildingColorExpression(context);
  const semanticColor = Array.isArray(color) ? expression<string>(color) : (color as string);
  const config = mergeTileflowDesign<TileflowResolvedModuleConfig<TileflowBuildingsModuleConfig>>(
    {
      type: 'buildings',
      enabled: true,
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

  if (config.mode === '3d') {
    const style = config.extrusion ?? {};
    contributions.push({
      kind: 'layer',
      layer: applyExtrusionStyle(
        {
          id: tileflowNativeBuildingsLayerId,
          type: 'fill-extrusion',
          source,
          'source-layer': sourceLayer,
          // A footprint whose parts draw it in 3D says `extrude: false`.
          filter: [
            'all',
            visibilityFilter,
            ['!=', ['get', context.data.schema.fields.extrude], false],
          ],
        },
        style,
      ),
      // Ground street names belong above flat footprints but below raised geometry.
      localOrder: 1000,
      owner: 'buildings',
      slot: 'buildings',
      target: 'buildings.extrusion',
    });
    return contributions;
  }

  for (const area of createAreaLayers(
    {
      id: 'tileflow-buildings-fill',
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

/** The semantic targets each mode draws. */
const buildingTargetsByMode = {
  flat: ['buildings.flat.fill', 'buildings.flat.outline'],
  '3d': ['buildings.extrusion'],
} as const satisfies Record<TileflowBuildingMode, readonly string[]>;

/** The targets a map's buildings do not draw because it selects another mode. */
export function buildingTargetsOfOtherModes(
  request: TileflowResolvedModuleConfig<TileflowBuildingsModuleConfig> | undefined,
): ReadonlyMap<string, TileflowModeSpecificTarget> {
  const activeMode = request?.mode ?? 'flat';
  const targets = new Map<string, TileflowModeSpecificTarget>();
  for (const [mode, modeTargets] of Object.entries(buildingTargetsByMode)) {
    if (mode === activeMode) continue;
    for (const target of modeTargets) {
      targets.set(target, {activeMode, mode, owner: 'buildings'});
    }
  }
  return targets;
}

function buildingColorExpression(context: TileflowDomainCompileContext): unknown {
  const fields = context.data.schema.fields;
  const colors = context.colors.buildings;
  // Without a tone, World's `use`: housing, shops and offices, public buildings and works each
  // take their theme colour; a shed, a garage or an unknown use the generic one.
  const byUse = fields.use
    ? [
        'match',
        ['coalesce', ['get', fields.use], ''],
        'residential',
        colors.residential,
        'commercial',
        colors.commercial,
        [
          'civic',
          'education',
          'entertainment',
          'medical',
          'military',
          'religious',
          'transportation',
        ],
        colors.civic,
        ['agricultural', 'industrial', 'service'],
        colors.industrial,
        colors.generic,
      ]
    : colors.generic;
  if (!fields.tone) return byUse;
  return [
    'case',
    ['==', ['coalesce', ['get', fields.tone], ''], 'active'],
    colors.active,
    ['==', ['coalesce', ['get', fields.tone], ''], 'destination'],
    colors.destination,
    ['==', ['coalesce', ['get', fields.tone], ''], 'commercial'],
    colors.commercial,
    byUse,
  ];
}

function buildingVisibilityFilter(): unknown[] {
  // Building existence is geometric, not semantic. Layer minzoom and this fixed guard stay in
  // sync even when a compatible archive has no optional classification fields.
  return ['>=', ['zoom'], 15];
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
        ['get', fields.height],
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
  return ['max', 0, ['min', ['to-number', ['coalesce', ['get', fields.minHeight], 0], 0], height]];
}
