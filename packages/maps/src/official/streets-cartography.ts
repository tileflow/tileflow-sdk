import {
  defineMap,
  expr,
  field,
  refineRenderTarget,
  renderPass,
  resolveMap,
  type TileflowMap,
  type TileflowNamedRenderStack,
  type TileflowThemeNumberValue,
  type TileflowVegetationModuleConfig,
  token,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {streetsClimateImage} from './streets-climate-image';
import {
  streetsAccessOverview,
  streetsAgriculturalColor,
  streetsGroundBackground,
} from './streets-ground-and-access';
import {streetsOverviewRoads} from './streets-network-overview';

const visibleBuilding = {
  kind: 'all',
  selectors: [
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: true},
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: 1},
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: '1'},
    {field: 'hide3d', kind: 'compare', operator: 'ne', value: 'true'},
  ],
} as const;

function buildingColor(outline = false, raised = false) {
  return expr.match(
    expr.get(field('buildingTone')),
    [
      {
        labels: ['commercial', 'active'],
        value: token.color(`buildings.flat.${outline ? 'activeOutline' : 'active'}`),
      },
    ],
    token.color(
      raised
        ? 'buildings.raised.neutral'
        : `buildings.flat.${outline ? 'neutralOutline' : 'neutral'}`,
    ),
  );
}

/** Shared cartography for every Streets consumer. Resources and camera scenes belong to the consumer. */
export function withStreetsCartography(base: TileflowMap) {
  const source = resolveMap(base);
  const {land, buildings, poi, vegetation} = source.modules ?? {};
  if (!land || !buildings || !poi || !vegetation)
    throw new Error('Streets requires land, buildings, POI and vegetation');
  const vegetationAppearance: TileflowVegetationModuleConfig = {
    ...vegetation,
    flat: {...vegetation.flat, strokeColor: token.color('vegetation.tree.outline')},
  };
  const landStack = stackOf(land);
  const buildingStack = stackOf(buildings);
  const extrusion = buildingStack.extrusion;
  if (extrusion?.kind !== 'render-pass' || extrusion.renderer !== 'extrusion')
    throw new Error('Streets requires its building extrusion pass');
  const {renderStack: roadsStack, ...overviewRoads} = streetsOverviewRoads(source.modules?.roads);
  return defineMap({
    ...base,
    modules: {
      ...source.modules,
      roads: withRenderStack(
        {
          ...overviewRoads,
          pathGround: {
            greenColor: token.color('roads.path.green'),
            groundColor: token.color('roads.path.ground'),
            opacity: token.number('roads.path.groundOpacity'),
            widthScale: 0.92,
          },
        },
        {
          ...roadsStack,
          accessOverview: streetsAccessOverview,
        },
      ),
      land: withRenderStack(
        {
          ...withoutStack(land),
          globalLandcoverUnderlay: {
            url: streetsClimateImage,
            coordinates: [
              [-180, 85.0511287798066],
              [180, 85.0511287798066],
              [180, -85.0511287798066],
              [-180, -85.0511287798066],
            ],
            attribution:
              'Climate context: <a href="https://doi.org/10.1038/s41597-023-02549-6">Beck et al. (2023)</a>, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>; colours and smoothing adapted by Tileflow',
            maxZoom: 11,
            opacity: zoom.linear<TileflowThemeNumberValue>([
              [0, token.number('land.climate.opacity')],
              [7, token.number('land.climate.opacity')],
              [8, token.number('land.climate.opacity85')],
              [9, token.number('land.climate.opacity78')],
              [10, token.number('land.climate.opacity')],
              [10.5, token.number('land.climate.opacity55')],
              [10.75, token.number('land.climate.opacity25')],
              [11, 0],
            ]),
          },
          background: {...land.background, color: streetsGroundBackground},
          landcover: {
            ...land.landcover,
            farmland: {
              ...land.landcover?.farmland,
              fill: {...land.landcover?.farmland?.fill, color: streetsAgriculturalColor},
            },
          },
        },
        {
          ...landStack,
          businessArea: renderPass({
            placement: {above: 'land.landuse.residential.fill'},
            feature: 'landuse',
            renderer: 'fill',
            selector: {field: 'class', kind: 'compare', operator: 'eq', value: 'business_area'},
            style: {
              color: token.color('landuse.businessCorridor'),
              minZoom: 11,
              opacity: zoom.linear([
                [15, 1],
                [15.5, 0.75],
                [16.25, 0],
              ]),
            },
          }),
        },
      ),
      buildings: withRenderStack(
        {
          ...withoutStack(buildings),
          flat: {
            fill: {
              color: buildingColor(),
              minZoom: 15.25,
              opacity: zoom.linear([
                [15.25, 0],
                [15.5, 0.75],
                [15.75, 1],
              ]),
            },
            outline: {
              color: buildingColor(true),
              minZoom: 16,
              opacity: zoom.linear([
                [16, 0],
                [16.5, 0.4],
                [18, 0.58],
                [20, 0.68],
              ]),
              width: zoom.linear([
                [16, 0.35],
                [16.5, 0.5],
                [18, 0.65],
                [20, 0.8],
              ]),
            },
          },
        },
        {
          ...buildingStack,
          visibleFlatFill: refineRenderTarget({
            target: 'buildings.flat.fill',
            renderer: 'fill',
            selector: visibleBuilding,
            style: {},
          }),
          visibleFlatOutline: refineRenderTarget({
            target: 'buildings.flat.outline',
            renderer: 'line',
            selector: visibleBuilding,
            style: {},
          }),
          extrusion: {...extrusion, style: {...extrusion.style, color: buildingColor(false, true)}},
          flatShadow: renderPass({
            selector: visibleBuilding,
            placement: {below: 'buildings.flat.fill'},
            feature: 'building',
            renderer: 'line',
            style: {
              blur: 2,
              color: token.color('buildings.shadow'),
              minZoom: 17.5,
              opacity: zoom.linear([
                [17.5, 0],
                [19, 0.035],
                [20, 0.04],
              ]),
              translate: [0.5, 0.75],
              translateAnchor: 'viewport',
              width: zoom.linear([
                [17.5, 0.5],
                [19, 1.5],
                [20, 2],
              ]),
            },
          }),
        },
      ),
      vegetation: vegetationAppearance,
      poi: {...poi, maxRankByType: {...poi.maxRankByType, garden: 1}},
    },
  });
}

function stackOf(module: object): TileflowNamedRenderStack {
  return 'renderStack' in module ? (module.renderStack as TileflowNamedRenderStack) : {};
}
function withoutStack<T extends object>(module: T): T & {readonly renderStack?: undefined} {
  const result = {...module};
  if ('renderStack' in result) delete result.renderStack;
  return result as T & {readonly renderStack?: undefined};
}
