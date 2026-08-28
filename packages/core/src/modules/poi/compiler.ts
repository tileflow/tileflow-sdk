import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyCircleStyle, applySymbolStyle} from '../../cartography/layer-style';
import {labelField} from '../../cartography/localization';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {
  TileflowCircleStyle,
  TileflowMarkerSymbolStyle,
  TileflowSymbolStyle,
  TileflowTextStyle,
} from '../../cartography/styles';
import {expression, zoom} from '../../cartography/values';
import type {
  TileflowLabelLanguage,
  TileflowPoiCategoryStyle,
  TileflowPoiModuleConfig,
} from '../../types';
import type {TileflowResolvedModuleConfig} from '../resolved';
import {type ResolvedPoiModuleOptions, resolvePoi, tileflowPoiImageRoles} from './index';

export function compilePoi(
  request: TileflowResolvedModuleConfig<TileflowPoiModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
  language: TileflowLabelLanguage = 'auto',
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolvePoi(request);
  const result: TileflowLayerContribution[] = [];
  const {sourceId: source, schema} = context.data;

  for (const [index, category] of semantics.categories.entries()) {
    const categoryColor =
      semantics.color === 'category'
        ? (context.colors.poi[category as keyof typeof context.colors.poi] ??
          context.colors.poi.label)
        : context.colors.poi.label;
    const defaults = {
      icon: {
        optional: !semantics.placement.coupleIconAndLabel,
        padding: semantics.placement.iconPadding,
        size:
          semantics.minZoom < 17
            ? zoom.linear([
                [semantics.minZoom, 0.85],
                [17, 1],
              ])
            : 1,
      },
      text: poiTextStyle(context, {
        color: categoryColor,
        field: labelField(language, context),
        padding: semantics.placement.textPadding,
        size:
          semantics.minZoom < 17
            ? zoom.linear([
                [semantics.minZoom, 10],
                [17, 12],
              ])
            : 12,
      }),
    };
    let style = mergeTileflowDesign<
      TileflowPoiCategoryStyle & {
        icon: NonNullable<TileflowSymbolStyle['icon']>;
        text: NonNullable<TileflowSymbolStyle['text']>;
      }
    >(defaults, request?.styles?.[category]);
    const markerStyle = style.marker ? resolveMarkerStyle(style) : undefined;
    const showText = semantics.labels && style.text.visible !== false;
    const showIcon = semantics.icons && style.icon.visible !== false;
    if (showIcon && style.icon.image === undefined) {
      style = {
        ...style,
        icon: {
          ...style.icon,
          image: resolvePoiImage(category, context, schema.fields.poiIcon),
        },
      };
    }
    style = withPoiTextClearance(style, showText && showIcon);
    const symbolStyle = withoutMarker(style);

    if (markerStyle && markerStyle.visible !== false) {
      const base = createPoiLayer({
        category,
        categoryField: schema.fields.poiCategory,
        density: semantics.density,
        filterRankField: schema.fields.poiFilterRank,
        id: `tileflow-poi-${category}-marker`,
        minZoom: semantics.minZoom,
        sizeRankField: schema.fields.poiSizeRank,
        source,
        sourceLayer: schema.layers.poi,
      });
      const markerLayer = applyCircleStyle(
        {
          ...base,
          type: 'circle',
          layout: {
            'circle-sort-key': poiSortKey(schema.fields.poiFilterRank, schema.fields.poiSizeRank),
          },
        },
        markerStyle,
      );
      result.push(poiContribution(`${category}.marker`, index * 4, markerLayer));
    }

    if (semantics.placement.coupleIconAndLabel && showText && showIcon) {
      let layer = createPoiLayer({
        category,
        categoryField: schema.fields.poiCategory,
        density: semantics.density,
        filterRankField: schema.fields.poiFilterRank,
        id: `tileflow-poi-${category}`,
        minZoom: semantics.minZoom,
        sizeRankField: schema.fields.poiSizeRank,
        source,
        sourceLayer: schema.layers.poi,
      });
      layer = applySymbolStyle(layer, symbolStyle);
      result.push(poiContribution(category, index * 4 + 1, layer));
      continue;
    }

    if (showIcon) {
      const layer = applySymbolStyle(
        createPoiLayer({
          category,
          categoryField: schema.fields.poiCategory,
          density: semantics.density,
          filterRankField: schema.fields.poiFilterRank,
          id: `tileflow-poi-${category}-icon`,
          minZoom: semantics.minZoom,
          sizeRankField: schema.fields.poiSizeRank,
          source,
          sourceLayer: schema.layers.poi,
        }),
        {...symbolStyle, text: undefined},
      );
      result.push(poiContribution(`${category}.icon`, index * 4 + 1, layer));
    }

    if (showText) {
      const layer = applySymbolStyle(
        createPoiLayer({
          category,
          categoryField: schema.fields.poiCategory,
          density: semantics.density,
          filterRankField: schema.fields.poiFilterRank,
          id: `tileflow-poi-${category}-label`,
          minZoom: semantics.minZoom,
          sizeRankField: schema.fields.poiSizeRank,
          source,
          sourceLayer: schema.layers.poi,
        }),
        {...symbolStyle, icon: undefined},
      );
      result.push(poiContribution(`${category}.label`, index * 4 + 2, layer));
    }
  }

  return result;
}

function resolvePoiImage(
  category: keyof typeof tileflowPoiImageRoles,
  context: TileflowDomainCompileContext,
  iconField: string,
) {
  const role = `poi.${category}`;
  const themed = context.images[role];
  const fallback = themed ?? tileflowPoiImageRoles[category].fallback;
  return expression<string>([
    'case',
    ['has', iconField],
    ['coalesce', ['image', ['get', iconField]], ['image', fallback]],
    ['image', fallback],
  ]);
}

function resolveMarkerStyle(style: TileflowMarkerSymbolStyle): TileflowCircleStyle {
  return mergeTileflowDesign(
    {
      ...(style.maxZoom === undefined ? {} : {maxZoom: style.maxZoom}),
      ...(style.minZoom === undefined ? {} : {minZoom: style.minZoom}),
      ...(style.visible === undefined ? {} : {visible: style.visible}),
    },
    style.marker,
  );
}

function createPoiLayer(options: {
  category: string;
  categoryField: string;
  density: ResolvedPoiModuleOptions['density'];
  filterRankField: string;
  id: string;
  minZoom: number;
  sizeRankField: string;
  source: string;
  sourceLayer: string;
}): Record<string, unknown> & {id: string; type: string} {
  const filterRank = numericPoiField(options.filterRankField, 6);
  const sizeRank = numericPoiField(options.sizeRankField, 17);
  return {
    id: options.id,
    type: 'symbol',
    source: options.source,
    'source-layer': options.sourceLayer,
    minzoom: options.minZoom,
    filter: [
      'all',
      ['==', ['get', options.categoryField], options.category],
      ['has', options.filterRankField],
      ['>=', filterRank, 0],
      ['<=', filterRank, options.density],
      ['has', options.sizeRankField],
      ['>=', sizeRank, 0],
      ['<=', sizeRank, 16],
    ],
    layout: {'symbol-sort-key': poiSortKey(options.filterRankField, options.sizeRankField)},
  };
}

function numericPoiField(field: string, fallback: number): unknown[] {
  return ['to-number', ['get', field], fallback];
}

function poiSortKey(filterRankField: string, sizeRankField: string): unknown[] {
  return ['+', ['*', numericPoiField(filterRankField, 6), 17], numericPoiField(sizeRankField, 17)];
}

function poiContribution(
  target: string,
  localOrder: number,
  layer: Record<string, unknown> & {id: string; type: string},
): TileflowLayerContribution {
  return {
    kind: 'layer',
    layer,
    localOrder: 1000 + localOrder,
    owner: 'poi',
    slot: 'symbols',
    target: `poi.${target}`,
  };
}

function poiTextStyle(
  context: TileflowDomainCompileContext,
  overrides: TileflowTextStyle,
): TileflowTextStyle {
  return mergeTileflowDesign(
    {
      allowOverlap: false,
      color: context.colors.poi.label,
      ...typographyTextStyle(context.typography.poi),
      haloColor: context.colors.poi.halo,
      haloWidth: 1,
      optional: true,
    },
    overrides,
  );
}

function withPoiTextClearance<
  T extends TileflowMarkerSymbolStyle & {text: NonNullable<TileflowSymbolStyle['text']>},
>(style: T, besideIcon: boolean): T {
  if (
    !besideIcon ||
    style.text.anchor !== undefined ||
    style.text.offset !== undefined ||
    style.text.radialOffset !== undefined ||
    style.text.variableAnchors !== undefined
  ) {
    return style;
  }
  return {
    ...style,
    text: {
      ...style.text,
      radialOffset: 1.1,
      variableAnchors: ['top', 'bottom', 'right', 'left'],
    },
  };
}

function withoutMarker(style: TileflowMarkerSymbolStyle): TileflowSymbolStyle {
  const result = {...style};
  delete result.marker;
  return result;
}
