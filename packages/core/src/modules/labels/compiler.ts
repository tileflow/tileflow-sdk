import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyTextStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {TileflowTextStyle} from '../../cartography/styles';
import {expression, zoom} from '../../cartography/values';
import {textFont} from '../../themes';
import type {
  TileflowLabelLanguage,
  TileflowLabelsModuleConfig,
  TileflowPlaceLabelClass,
  TileflowRoadClass,
  TileflowRoadsModuleConfig,
  TileflowWaterLabelClass,
} from '../../types';
import {resolveRoads} from '../roads';
import {tileflowRoadClasses, tileflowRoadClassFilter} from '../roads/semantics';
import {resolveLabels, visibleRoadLabelClasses} from './index';

const placeClasses: Record<TileflowPlaceLabelClass, readonly string[]> = {
  continent: ['continent'],
  country: ['country'],
  state: ['state', 'province'],
  city: ['city'],
  town: ['town'],
  village: ['village'],
  neighborhood: ['suburb', 'neighbourhood', 'quarter'],
  other: ['hamlet', 'isolated_dwelling'],
};

export function compileLabels(
  request: TileflowLabelsModuleConfig | undefined,
  roadRequest: TileflowRoadsModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolveLabels(request);
  const roads = resolveRoads(roadRequest);
  const {colors} = context;
  const defaults = {
    places: {
      continent: textStyle(context, 'places', {
        minZoom: 0,
        size: zoom.linear([
          [0, 11],
          [4, 15],
        ]),
      }),
      country: textStyle(context, 'places', {
        minZoom: 1,
        size: zoom.linear([
          [1, 10],
          [6, 16],
        ]),
      }),
      state: textStyle(context, 'places', {
        minZoom: 3,
        size: zoom.linear([
          [3, 10],
          [8, 14],
        ]),
      }),
      city: textStyle(context, 'places', {
        minZoom: 4,
        size: zoom.linear([
          [4, 11],
          [12, 18],
        ]),
      }),
      town: textStyle(context, 'places', {
        minZoom: 7,
        size: zoom.linear([
          [7, 10],
          [14, 16],
        ]),
      }),
      village: textStyle(context, 'places', {
        minZoom: 10,
        size: zoom.linear([
          [10, 10],
          [16, 14],
        ]),
      }),
      neighborhood: textStyle(context, 'places', {
        color: colors.labels.neighborhood,
        minZoom: 12,
        size: zoom.linear([
          [12, 10],
          [17, 13],
        ]),
      }),
      other: textStyle(context, 'places', {
        minZoom: 12,
        size: zoom.linear([
          [12, 9],
          [17, 12],
        ]),
      }),
    },
    roads: Object.fromEntries(
      tileflowRoadClasses.map((roadClass) => [
        roadClass,
        textStyle(context, 'roads', {
          color: colors.labels.road,
          minZoom: ['motorway', 'trunk', 'primary'].includes(roadClass)
            ? 10
            : ['pathway', 'footway', 'cycleway', 'steps', 'pedestrian'].includes(roadClass)
              ? 15
              : 13,
          placement: 'line',
          size: zoom.linear([
            [10, 10],
            [16, 14],
          ]),
          spacing: 280,
        }),
      ]),
    ) as Partial<Record<TileflowRoadClass, TileflowTextStyle>>,
    shields: textStyle(context, 'roads', {
      color: colors.labels.road,
      minZoom: 8,
      placement: 'line',
      size: 10,
      spacing: 240,
    }),
    water: {
      ocean: textStyle(context, 'water', {
        minZoom: 2,
        size: zoom.linear([
          [2, 12],
          [8, 18],
        ]),
      }),
      other: textStyle(context, 'water', {
        minZoom: 5,
        size: zoom.linear([
          [5, 11],
          [14, 15],
        ]),
      }),
      line: textStyle(context, 'water', {
        minZoom: 7,
        placement: 'line',
        size: 13,
        spacing: 320,
      }),
      waterway: textStyle(context, 'water', {
        minZoom: 10,
        placement: 'line',
        size: 12,
        spacing: 320,
      }),
    },
    aerodrome: textStyle(context, 'places', {
      minZoom: 9,
      size: zoom.linear([
        [9, 10],
        [16, 14],
      ]),
    }),
  } satisfies NonNullable<TileflowLabelsModuleConfig['styles']>;
  const styles = mergeTileflowDesign(defaults, request?.styles);
  const result: TileflowLayerContribution[] = [];
  const {sourceId: source, schema} = context.data;
  const field = labelField(semantics.language, context);
  let order = 0;

  const visiblePlaceClasses =
    semantics.places === 'none'
      ? []
      : semantics.places === 'major'
        ? (['continent', 'country', 'state', 'city', 'town'] as const)
        : (Object.keys(placeClasses) as TileflowPlaceLabelClass[]);
  for (const placeClass of visiblePlaceClasses) {
    const style = styles.places?.[placeClass];
    if (!style || style.visible === false) continue;
    const id = `streets-label-place-${placeClass}`;
    result.push(
      symbolContribution(
        `labels.places.${placeClass}`,
        order++,
        applyTextStyle(
          {
            id,
            type: 'symbol',
            source,
            'source-layer': schema.layers.place,
            filter: [
              'all',
              ['has', schema.fields.name],
              classFilter(schema.fields.class, placeClasses[placeClass]),
            ],
          },
          mergeTileflowDesign(style, {field}),
        ),
      ),
    );
  }

  const visibleRoads = visibleRoadLabelClasses(semantics.roads, roads, semantics.roadClasses);
  for (const roadClass of visibleRoads as TileflowRoadClass[]) {
    const style = styles.roads?.[roadClass];
    if (!style || style.visible === false) continue;
    const id = `streets-label-road-${roadClass}`;
    result.push(
      symbolContribution(
        `labels.roads.${roadClass}`,
        200 + order++,
        applyTextStyle(
          {
            id,
            type: 'symbol',
            source,
            'source-layer': schema.layers.roadName,
            filter: [
              'all',
              ['has', schema.fields.name],
              tileflowRoadClassFilter(schema.fields, roadClass),
            ],
          },
          mergeTileflowDesign(style, {field}),
        ),
      ),
    );
  }

  if (
    visibleRoads.some((roadClass) =>
      ['motorway', 'trunk', 'primary', 'secondary'].includes(roadClass),
    )
  ) {
    result.push(
      symbolContribution(
        'labels.shields',
        400,
        applyTextStyle(
          {
            id: 'streets-label-road-shield',
            type: 'symbol',
            source,
            'source-layer': schema.layers.roadName,
            filter: ['has', schema.fields.ref],
          },
          mergeTileflowDesign(styles.shields, {
            field: expression<string>(['get', schema.fields.ref]),
          }),
        ),
      ),
    );
  }

  if (semantics.water !== 'none') {
    const waterTargets: Array<{
      filter: unknown[];
      name: TileflowWaterLabelClass;
      sourceLayer: string;
    }> = [
      {
        name: 'ocean',
        sourceLayer: schema.layers.waterName,
        filter: classFilter(schema.fields.class, ['ocean', 'sea']),
      },
      {
        name: 'other',
        sourceLayer: schema.layers.waterName,
        filter: classFilter(schema.fields.class, ['lake', 'reservoir', 'bay']),
      },
      {
        name: 'line',
        sourceLayer: schema.layers.waterName,
        filter: ['==', ['geometry-type'], 'LineString'],
      },
      {
        name: 'waterway',
        sourceLayer: schema.layers.waterway,
        filter: ['has', schema.fields.name],
      },
    ];
    const visibleTargets =
      semantics.water === 'major'
        ? waterTargets.filter((target) => target.name !== 'waterway')
        : waterTargets;
    for (const target of visibleTargets) {
      const style = styles.water?.[target.name];
      if (!style || style.visible === false) continue;
      result.push(
        symbolContribution(
          `labels.water.${target.name}`,
          500 + order++,
          applyTextStyle(
            {
              id: `streets-label-water-${target.name}`,
              type: 'symbol',
              source,
              'source-layer': target.sourceLayer,
              filter: target.filter,
            },
            mergeTileflowDesign(style, {field}),
          ),
        ),
      );
    }
  }

  if (styles.aerodrome?.visible !== false) {
    result.push(
      symbolContribution(
        'labels.aerodrome',
        700,
        applyTextStyle(
          {
            id: 'streets-label-aerodrome',
            type: 'symbol',
            source,
            'source-layer': schema.layers.aerodromeLabel,
            filter: ['has', schema.fields.name],
          },
          mergeTileflowDesign(styles.aerodrome, {field}),
        ),
      ),
    );
  }

  return result;
}

function textStyle(
  context: TileflowDomainCompileContext,
  domain: 'places' | 'roads' | 'water',
  overrides: TileflowTextStyle,
): TileflowTextStyle {
  return mergeTileflowDesign(
    {
      allowOverlap: false,
      color: domain === 'water' ? context.colors.labels.water : context.colors.labels.primary,
      font: textFont(context.typography, domain),
      haloColor: context.colors.labels.halo,
      haloWidth: 1.2,
      optional: true,
      padding: 4,
    },
    overrides,
  );
}

function labelField(language: TileflowLabelLanguage, context: TileflowDomainCompileContext) {
  const fields = context.data.schema.fields;
  if (language === 'local') {
    return expression<string>([
      'coalesce',
      ['get', fields.name],
      ['get', fields.nameLatin],
      ['get', fields.nameEnglish],
    ]);
  }
  if (language === 'auto') {
    return expression<string>([
      'coalesce',
      ['get', fields.nameLatin],
      ['get', fields.name],
      ['get', fields.nameEnglish],
    ]);
  }
  return expression<string>([
    'coalesce',
    ['get', `name:${language}`],
    ['get', fields.nameLatin],
    ['get', fields.name],
  ]);
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}

function symbolContribution(
  target: string,
  localOrder: number,
  layer: Record<string, unknown> & {id: string; type: string},
): TileflowLayerContribution {
  return {kind: 'layer', layer, localOrder, owner: 'labels', slot: 'symbols', target};
}
