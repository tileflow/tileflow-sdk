import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyCircleStyle, applySymbolStyle, createAreaLayers} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {
  TileflowAreaStyle,
  TileflowMarkerSymbolStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';
import {expression, zoom} from '../../cartography/values';
import {tileflowNauticalV1Schema} from '../../marine';
import type {TileflowResolvedModuleConfig} from '../resolved';
import type {TileflowNauticalModuleConfig} from './index';

export function compileNautical(
  request: TileflowResolvedModuleConfig<TileflowNauticalModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const nauticalSource = context.marine?.nautical;
  if (!nauticalSource || request?.enabled === false) return [];

  const colors = context.colors;
  const {fields, layers} = tileflowNauticalV1Schema;
  const chartText = {
    ...typographyTextStyle(context.typography.water),
    color: colors.hydro.label,
    haloColor: colors.hydro.water,
    haloWidth: 1.2,
  };
  const config = mergeTileflowDesign<TileflowResolvedModuleConfig<TileflowNauticalModuleConfig>>(
    {
      type: 'nautical',
      enabled: true,
      soundings: {
        minZoom: 12,
        placement: 'point',
        priority: 92,
        text: {
          ...chartText,
          allowOverlap: false,
          field: expression<string>(['to-string', ['get', fields.depth]]),
          optional: false,
          padding: 5,
          size: zoom.linear([
            [12, 9],
            [16, 11],
          ]),
        },
      },
      aids: {
        minZoom: 10,
        placement: 'point',
        priority: 98,
        marker: {
          color: colors.hydro.water,
          radius: zoom.linear([
            [10, 2.6],
            [16, 4.2],
          ]),
          strokeColor: colors.hydro.label,
          strokeWidth: 1.2,
        },
        text: {
          ...chartText,
          field: expression<string>([
            'coalesce',
            ['get', fields.name],
            ['get', fields.subclass],
            ['get', fields.class],
          ]),
          offset: [0, 1.1],
          optional: true,
          padding: 4,
          size: 10,
        },
      },
      lighthouses: {
        minZoom: 10,
        placement: 'point',
        priority: 99,
        marker: {
          color: colors.hydro.water,
          radius: zoom.linear([
            [10, 3],
            [16, 4.6],
          ]),
          strokeColor: colors.hydro.label,
          strokeWidth: 1.4,
        },
        text: {
          ...chartText,
          field: expression<string>([
            'case',
            ['has', fields.name],
            ['to-string', ['get', fields.name]],
            'Lighthouse',
          ]),
          offset: [0, 1.2],
          optional: true,
          padding: 4,
          size: 10,
        },
      },
      lights: {
        minZoom: 11,
        placement: 'point',
        priority: 96,
        marker: {
          color: colors.poi.transport,
          opacity: 0.24,
          radius: zoom.linear([
            [11, 4],
            [16, 7],
          ]),
          strokeColor: colors.poi.transport,
          strokeWidth: 1,
        },
        text: {
          ...chartText,
          color: colors.poi.transport,
          field: lightLabel(fields),
          offset: [0, 1.25],
          optional: true,
          padding: 5,
          size: 9,
        },
      },
      hazards: {
        minZoom: 11,
        placement: 'point',
        priority: 95,
        text: {
          ...chartText,
          color: colors.poi.transport,
          field: nameAndDepthWithPrefix(fields.name, fields.depth, 'X'),
          optional: false,
          padding: 5,
          size: 12,
        },
      },
      wrecks: {
        minZoom: 11,
        placement: 'point',
        priority: 94,
        text: {
          ...chartText,
          field: nameAndDepthWithPrefix(fields.name, fields.depth, 'Wrk'),
          optional: false,
          padding: 5,
          size: 9,
        },
      },
      reefs: {
        fill: {color: colors.landcover.sand, minZoom: 7, opacity: 0.34},
        outline: {
          color: colors.hydro.label,
          dash: [1.5, 1.5],
          minZoom: 7,
          opacity: 0.62,
          width: 0.8,
        },
      },
      hazardAreas: {
        fill: {color: colors.poi.transport, minZoom: 11, opacity: 0.1},
        outline: {
          color: colors.poi.transport,
          dash: [1, 1],
          minZoom: 11,
          opacity: 0.72,
          width: 0.8,
        },
      },
      wreckAreas: {
        fill: {color: colors.hydro.label, minZoom: 11, opacity: 0.08},
        outline: {
          color: colors.hydro.label,
          dash: [2, 1],
          minZoom: 11,
          opacity: 0.62,
          width: 0.75,
        },
      },
      navigationAreas: {
        fill: {color: colors.poi.transport, minZoom: 8, opacity: 0.06},
        outline: {
          color: colors.poi.transport,
          dash: [4, 2],
          minZoom: 8,
          opacity: 0.62,
          width: 0.8,
        },
      },
      coverage: {
        outline: {
          color: colors.poi.transport,
          dash: [2, 3],
          maxZoom: 9,
          minZoom: 4,
          opacity: 0.34,
          width: 0.6,
        },
      },
      labels: {
        coverage: {
          maxZoom: 9,
          minZoom: 4,
          placement: 'point',
          priority: 70,
          text: {
            ...chartText,
            color: colors.poi.transport,
            field: expression<string>(['coalesce', ['get', fields.name], ['get', fields.provider]]),
            optional: true,
            padding: 12,
            size: 8,
          },
        },
        hazards: {
          minZoom: 11,
          placement: 'point',
          priority: 93,
          text: {
            ...chartText,
            color: colors.poi.transport,
            field: nameAndDepthWithPrefix(fields.name, fields.depth, 'X'),
            optional: true,
            padding: 6,
            size: 9,
          },
        },
        navigationAreas: {
          minZoom: 10,
          placement: 'point',
          priority: 78,
          text: {
            ...chartText,
            color: colors.poi.transport,
            field: expression<string>(['coalesce', ['get', fields.name], ['get', fields.class]]),
            optional: true,
            padding: 8,
            size: 9,
          },
        },
        reefs: {
          minZoom: 12,
          placement: 'point',
          priority: 89,
          text: {
            ...chartText,
            field: nameAndDepthWithPrefix(fields.name, fields.depth, 'Reef'),
            optional: true,
            padding: 7,
            size: 9,
          },
        },
        wrecks: {
          minZoom: 11,
          placement: 'point',
          priority: 92,
          text: {
            ...chartText,
            field: nameAndDepthWithPrefix(fields.name, fields.depth, 'Wrk'),
            optional: true,
            padding: 6,
            size: 9,
          },
        },
      },
    },
    request,
  );

  const source = nauticalSource.sourceId;
  const contributions: TileflowLayerContribution[] = [];
  appendAreaFeature(contributions, {
    id: 'tileflow-nautical-coverage',
    localOrder: 380,
    source,
    sourceLayer: layers.coverage,
    style: config.coverage,
    target: 'nautical.coverage',
  });
  appendAreaFeature(contributions, {
    id: 'tileflow-nautical-navigation-areas',
    localOrder: 390,
    source,
    sourceLayer: layers.navigationAreas,
    style: config.navigationAreas,
    target: 'nautical.navigationAreas',
  });
  appendAreaFeature(contributions, {
    id: 'tileflow-nautical-reefs',
    localOrder: 400,
    source,
    sourceLayer: layers.reefs,
    style: config.reefs,
    target: 'nautical.reefs',
  });
  appendAreaFeature(contributions, {
    id: 'tileflow-nautical-hazard-areas',
    localOrder: 410,
    source,
    sourceLayer: layers.hazards,
    style: config.hazardAreas,
    target: 'nautical.hazardAreas',
  });
  appendAreaFeature(contributions, {
    id: 'tileflow-nautical-wreck-areas',
    localOrder: 420,
    source,
    sourceLayer: layers.wrecks,
    style: config.wreckAreas,
    target: 'nautical.wreckAreas',
  });

  appendPolygonLabel(contributions, {
    featureFilter: ['any', ['has', fields.name], ['has', fields.provider]],
    id: 'tileflow-nautical-coverage-labels',
    localOrder: 1060,
    source,
    sourceLayer: layers.coverage,
    style: config.labels?.coverage,
    target: 'nautical.labels.coverage',
  });
  appendPolygonLabel(contributions, {
    featureFilter: ['any', ['has', fields.name], ['has', fields.class]],
    id: 'tileflow-nautical-navigation-area-labels',
    localOrder: 1070,
    source,
    sourceLayer: layers.navigationAreas,
    style: config.labels?.navigationAreas,
    target: 'nautical.labels.navigationAreas',
  });
  appendPolygonLabel(contributions, {
    id: 'tileflow-nautical-reef-labels',
    localOrder: 1080,
    source,
    sourceLayer: layers.reefs,
    style: config.labels?.reefs,
    target: 'nautical.labels.reefs',
  });
  appendPolygonLabel(contributions, {
    id: 'tileflow-nautical-hazard-area-labels',
    localOrder: 1090,
    source,
    sourceLayer: layers.hazards,
    style: config.labels?.hazards,
    target: 'nautical.labels.hazards',
  });
  appendPolygonLabel(contributions, {
    id: 'tileflow-nautical-wreck-area-labels',
    localOrder: 1095,
    source,
    sourceLayer: layers.wrecks,
    style: config.labels?.wrecks,
    target: 'nautical.labels.wrecks',
  });

  appendPointFeature(contributions, {
    id: 'tileflow-nautical-soundings',
    localOrder: 1100,
    source,
    sourceLayer: layers.soundings,
    style: config.soundings,
    target: 'nautical.soundings',
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['has', fields.depth]],
  });
  appendPointFeature(contributions, {
    id: 'tileflow-nautical-aids',
    localOrder: 1110,
    source,
    sourceLayer: layers.aids,
    style: config.aids,
    target: 'nautical.aids',
    filter: [
      'all',
      ['==', ['geometry-type'], 'Point'],
      ['!=', ['get', fields.class], 'lighthouse'],
    ],
  });
  appendPointFeature(contributions, {
    id: 'tileflow-nautical-lighthouses',
    localOrder: 1115,
    source,
    sourceLayer: layers.aids,
    style: config.lighthouses,
    target: 'nautical.lighthouses',
    filter: [
      'all',
      ['==', ['geometry-type'], 'Point'],
      ['==', ['get', fields.class], 'lighthouse'],
    ],
  });
  appendPointFeature(contributions, {
    id: 'tileflow-nautical-lights',
    localOrder: 1120,
    source,
    sourceLayer: layers.lights,
    style: config.lights,
    target: 'nautical.lights',
    filter: ['==', ['geometry-type'], 'Point'],
  });
  appendPointFeature(contributions, {
    id: 'tileflow-nautical-hazards',
    localOrder: 1130,
    source,
    sourceLayer: layers.hazards,
    style: config.hazards,
    target: 'nautical.hazards',
    filter: ['==', ['geometry-type'], 'Point'],
  });
  appendPointFeature(contributions, {
    id: 'tileflow-nautical-wrecks',
    localOrder: 1140,
    source,
    sourceLayer: layers.wrecks,
    style: config.wrecks,
    target: 'nautical.wrecks',
    filter: ['==', ['geometry-type'], 'Point'],
  });
  return contributions;
}

function appendPolygonLabel(
  contributions: TileflowLayerContribution[],
  options: {
    featureFilter?: unknown[];
    id: string;
    localOrder: number;
    source: string;
    sourceLayer: string;
    style: TileflowSymbolStyle | undefined;
    target: string;
  },
): void {
  const style = options.style;
  if (
    !style ||
    style.visible === false ||
    ((!style.text || style.text.visible === false) && (!style.icon || style.icon.visible === false))
  ) {
    return;
  }
  contributions.push(
    nauticalContribution(
      options.target,
      options.localOrder,
      applySymbolStyle(
        {
          id: options.id,
          type: 'symbol',
          source: options.source,
          'source-layer': options.sourceLayer,
          filter: options.featureFilter
            ? ['all', ['==', ['geometry-type'], 'Polygon'], options.featureFilter]
            : ['==', ['geometry-type'], 'Polygon'],
        },
        style,
      ),
      'symbols',
    ),
  );
}

function appendAreaFeature(
  contributions: TileflowLayerContribution[],
  options: {
    id: string;
    localOrder: number;
    source: string;
    sourceLayer: string;
    style: TileflowAreaStyle | undefined;
    target: string;
  },
): void {
  if (!options.style) return;
  for (const area of createAreaLayers(
    {
      id: options.id,
      type: 'fill',
      source: options.source,
      'source-layer': options.sourceLayer,
      filter: ['==', ['geometry-type'], 'Polygon'],
    },
    options.style,
  )) {
    contributions.push(
      nauticalContribution(
        `${options.target}.${area.phase}`,
        options.localOrder + (area.phase === 'fill' ? 0 : 1),
        area.layer,
        'hydro',
      ),
    );
  }
}

function appendPointFeature(
  contributions: TileflowLayerContribution[],
  options: {
    filter: unknown[];
    id: string;
    localOrder: number;
    source: string;
    sourceLayer: string;
    style: TileflowMarkerSymbolStyle | undefined;
    target: string;
  },
): void {
  const style = options.style;
  if (!style || style.visible === false) return;
  const symbolStyle = withoutMarker(style);
  const base = {
    id: options.id,
    type: 'symbol',
    source: options.source,
    'source-layer': options.sourceLayer,
    filter: options.filter,
  };

  if (style.marker && style.marker.visible !== false) {
    contributions.push(
      nauticalContribution(
        `${options.target}.marker`,
        options.localOrder,
        applyCircleStyle(
          {...base, id: `${options.id}-marker`, type: 'circle'},
          mergeTileflowDesign(
            {
              ...(style.maxZoom === undefined ? {} : {maxZoom: style.maxZoom}),
              ...(style.minZoom === undefined ? {} : {minZoom: style.minZoom}),
            },
            style.marker,
          ),
        ),
        'symbols',
      ),
    );
  }

  const hasText = Boolean(style.text && style.text.visible !== false);
  const hasIcon = Boolean(style.icon && style.icon.visible !== false);
  if (!hasText && !hasIcon) return;
  contributions.push(
    nauticalContribution(
      `${options.target}.symbol`,
      options.localOrder + 1,
      applySymbolStyle(base, symbolStyle),
      'symbols',
    ),
  );
}

function withoutMarker(style: TileflowMarkerSymbolStyle): TileflowSymbolStyle {
  const result = {...style};
  delete result.marker;
  return result;
}

function nauticalContribution(
  target: string,
  localOrder: number,
  layer: Record<string, unknown> & {id: string; type: string},
  slot: 'hydro' | 'symbols',
): TileflowLayerContribution {
  return {kind: 'layer', layer, localOrder, owner: 'nautical', slot, target};
}

function nameAndDepthWithPrefix(nameField: string, depthField: string, prefix: string) {
  return expression<string>([
    'concat',
    prefix,
    ['case', ['has', nameField], ['concat', ' ', ['to-string', ['get', nameField]]], ''],
    ['case', ['has', depthField], ['concat', ' ', ['to-string', ['get', depthField]], 'm'], ''],
  ]);
}

function lightLabel(fields: typeof tileflowNauticalV1Schema.fields) {
  return expression<string>([
    'concat',
    ['case', ['has', fields.character], ['to-string', ['get', fields.character]], 'Lt'],
    [
      'case',
      ['has', fields.rangeNm],
      ['concat', ' ', ['to-string', ['get', fields.rangeNm]], 'M'],
      '',
    ],
    [
      'case',
      ['has', fields.direction],
      ['concat', ' ', ['to-string', ['get', fields.direction]], '°'],
      '',
    ],
    ['case', ['has', fields.name], ['concat', ' ', ['to-string', ['get', fields.name]]], ''],
  ]);
}
