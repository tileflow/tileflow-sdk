import type {TileflowDomainCompileContext} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {applyCircleStyle, applySymbolStyle} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {
  TileflowCircleStyle,
  TileflowSymbolStyle,
  TileflowTextStyle,
} from '../../cartography/styles';
import {expression, zoom} from '../../cartography/values';
import type {
  TileflowLabelLanguage,
  TileflowPoiCategoryStyle,
  TileflowPoiModuleConfig,
} from '../../types';
import {labelField} from '../labels/language';
import {type ResolvedPoiModuleOptions, resolvePoi} from './index';

export function compilePoi(
  request: TileflowPoiModuleConfig | undefined,
  context: TileflowDomainCompileContext,
  language: TileflowLabelLanguage = 'auto',
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolvePoi(request);
  if (semantics.mode === 'none') return [];
  const categories = [...new Set(semantics.categories ?? Object.keys(semantics.classMapping))];
  const result: TileflowLayerContribution[] = [];
  const {sourceId: source, schema} = context.data;
  const claimedClasses = new Set<string>();

  for (const [index, category] of categories.entries()) {
    const mappedClasses = [...new Set(semantics.classMapping[category] ?? [category])];
    const excludedClasses = [...claimedClasses];
    const classes = mappedClasses.filter((value) => !claimedClasses.has(value));
    for (const value of mappedClasses) claimedClasses.add(value);
    if (classes.length === 0) continue;
    const defaultSemanticIcon = semanticIcon(category);
    const mappedIcon =
      context.icons?.mapping?.[category] ?? context.icons?.mapping?.[defaultSemanticIcon];
    const categoryColor =
      semantics.color === 'category'
        ? (context.colors.poi[category as keyof typeof context.colors.poi] ??
          context.colors.poi.label)
        : context.colors.poi.label;
    const defaults = {
      icon: {
        image: expression<string>([
          'coalesce',
          ...(mappedIcon ? [['image', mappedIcon]] : []),
          ['image', `${defaultSemanticIcon}_11`],
          ['image', 'marker_11'],
        ]),
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
    const showText = semantics.labels !== 'none' && style.text.visible !== false;
    const showIcon = Boolean(semantics.icons) && style.icon.visible !== false;
    style = withPoiTextClearance(style, showText && showIcon);
    const densityRank = style.maxRank ?? densityRankLimit(semantics.density);
    const textRank = showText ? (style.maxRank ?? labelRankLimit(semantics.labels)) : 0;
    const iconRank = showIcon ? (style.maxRank ?? iconRankLimit(semantics.icons)) : 0;

    if (markerStyle && markerStyle.visible !== false) {
      const base = createPoiLayer({
        classes,
        classField: schema.fields.class,
        excludedClasses,
        id: `streets-poi-${category}-marker`,
        minZoom: semantics.minZoom,
        rankField: schema.fields.rank,
        rankLimit: densityRank,
        source,
        sourceLayer: schema.layers.poi,
        subclassField: schema.fields.subclass,
      });
      const markerLayer = applyCircleStyle(
        {
          ...base,
          type: 'circle',
          layout: {'circle-sort-key': rankSortKey(schema.fields.rank)},
        },
        markerStyle,
      );
      result.push(poiContribution(`${category}.marker`, index * 4, markerLayer));
    }

    if (semantics.placement.coupleIconAndLabel && showText && showIcon) {
      let layer = createPoiLayer({
        classes,
        classField: schema.fields.class,
        excludedClasses,
        id: `streets-poi-${category}`,
        minZoom: semantics.minZoom,
        rankField: schema.fields.rank,
        rankLimit: minimumRankLimit(densityRank, textRank, iconRank),
        source,
        sourceLayer: schema.layers.poi,
        subclassField: schema.fields.subclass,
      });
      layer = applySymbolStyle(layer, style);
      result.push(poiContribution(category, index * 4 + 1, layer));
      continue;
    }

    if (showIcon) {
      const layer = applySymbolStyle(
        createPoiLayer({
          classes,
          classField: schema.fields.class,
          excludedClasses,
          id: `streets-poi-${category}-icon`,
          minZoom: semantics.minZoom,
          rankField: schema.fields.rank,
          rankLimit: minimumRankLimit(densityRank, iconRank),
          source,
          sourceLayer: schema.layers.poi,
          subclassField: schema.fields.subclass,
        }),
        {...style, text: undefined},
      );
      result.push(poiContribution(`${category}.icon`, index * 4 + 1, layer));
    }

    if (showText) {
      const layer = applySymbolStyle(
        createPoiLayer({
          classes,
          classField: schema.fields.class,
          excludedClasses,
          id: `streets-poi-${category}-label`,
          minZoom: semantics.minZoom,
          rankField: schema.fields.rank,
          rankLimit: minimumRankLimit(densityRank, textRank),
          source,
          sourceLayer: schema.layers.poi,
          subclassField: schema.fields.subclass,
        }),
        {...style, icon: undefined},
      );
      result.push(poiContribution(`${category}.label`, index * 4 + 2, layer));
    }
  }

  return result;
}

function resolveMarkerStyle(style: TileflowSymbolStyle): TileflowCircleStyle {
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
  classes: readonly string[];
  classField: string;
  excludedClasses: readonly string[];
  id: string;
  minZoom: number;
  rankField: string;
  rankLimit: number | undefined;
  source: string;
  sourceLayer: string;
  subclassField: string;
}): Record<string, unknown> & {id: string; type: string} {
  const includedFilter = [
    'any',
    ['match', ['get', options.classField], options.classes, true, false],
    ['match', ['get', options.subclassField], options.classes, true, false],
  ];
  const categoryFilter =
    options.excludedClasses.length === 0
      ? includedFilter
      : [
          'all',
          includedFilter,
          [
            '!',
            [
              'any',
              ['match', ['get', options.classField], options.excludedClasses, true, false],
              ['match', ['get', options.subclassField], options.excludedClasses, true, false],
            ],
          ],
        ];
  const rankSortKeyExpression = rankSortKey(options.rankField);
  return {
    id: options.id,
    type: 'symbol',
    source: options.source,
    'source-layer': options.sourceLayer,
    minzoom: options.minZoom,
    filter:
      options.rankLimit === undefined
        ? categoryFilter
        : ['all', categoryFilter, ['<=', rankSortKeyExpression, options.rankLimit]],
    layout: {'symbol-sort-key': rankSortKeyExpression},
  };
}

function rankSortKey(field: string): unknown[] {
  return ['to-number', ['get', field], 999];
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

function densityRankLimit(density: ResolvedPoiModuleOptions['density']): number | undefined {
  if (density === 'sparse') return 14;
  if (density === 'balanced') return 80;
  return undefined;
}

function labelRankLimit(labels: ResolvedPoiModuleOptions['labels']): number | undefined {
  if (labels === 'minimal') return 14;
  if (labels === 'balanced') return 80;
  return undefined;
}

function iconRankLimit(icons: ResolvedPoiModuleOptions['icons']): number | undefined {
  return icons === 'essential' ? 14 : undefined;
}

function minimumRankLimit(...limits: Array<number | undefined>): number | undefined {
  const defined = limits.filter((limit): limit is number => limit !== undefined);
  return defined.length === 0 ? undefined : Math.min(...defined);
}

function poiTextStyle(
  context: TileflowDomainCompileContext,
  overrides: TileflowTextStyle,
): TileflowTextStyle {
  return mergeTileflowDesign(
    {
      allowOverlap: false,
      color: context.colors.poi.label,
      font: context.typography.poi.font,
      haloColor: context.colors.poi.halo,
      haloWidth: 1,
      optional: true,
      weight: context.typography.poi.weight,
    },
    overrides,
  );
}

function withPoiTextClearance<
  T extends TileflowSymbolStyle & {text: NonNullable<TileflowSymbolStyle['text']>},
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

function semanticIcon(category: string): string {
  return (
    {
      coffee: 'cafe',
      culture: 'museum',
      education: 'school',
      food: 'restaurant',
      health: 'hospital',
      lodging: 'lodging',
      shopping: 'shop',
      transit: 'railway',
    }[category] ?? 'marker'
  );
}
