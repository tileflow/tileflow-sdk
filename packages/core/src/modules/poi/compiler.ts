import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {labelOrder} from '../../cartography/label-placement';
import {applyCircleStyle, applySymbolStyle} from '../../cartography/layer-style';
import {labelField, labelNameFields} from '../../cartography/localization';
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
  TileflowPoiCategory,
  TileflowPoiCategoryStyle,
  TileflowPoiModuleConfig,
} from '../../types';
import type {TileflowResolvedModuleConfig} from '../resolved';
import {type ResolvedPoiModuleOptions, resolvePoi, tileflowPoiImageRoles} from './index';
import {mergePoiCategoryLayers} from './placement';

type Layer = Record<string, unknown> & {id: string; type: string};
type PoiRepresentation = 'combined' | 'icon' | 'label' | 'marker';

/** One category's share of a representation, before categories are combined. */
type CategoryPart = {
  category: TileflowPoiCategory;
  layer: Layer;
  representation: PoiRepresentation;
};

/** Paint order inside the POI module: markers below the symbols that name them. */
const representationOrder: Readonly<Record<PoiRepresentation, number>> = {
  marker: 0,
  combined: 1,
  icon: 1,
  label: 2,
};

/**
 * Compiles the POI module. By default every category shares one placement layer per
 * representation, so World's importance ranks order the whole module: a station is placed before
 * a cash machine whatever their categories. With `placement.prominentRank`, the most important
 * ranks form a tier placed before road and place labels. `placement.order: 'categories'` instead
 * keeps one layer per category and places the categories in the order they are listed.
 */
export function compilePoi(
  request: TileflowResolvedModuleConfig<TileflowPoiModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
  language: TileflowLabelLanguage = 'auto',
): TileflowLayerContribution[] {
  if (request?.enabled === false) return [];
  const semantics = resolvePoi(request);
  const selection = createPoiSelection(semantics, context, language);
  const parts = semantics.categories.flatMap((category) =>
    compileCategory(category, request, semantics, context, language, selection),
  );

  if (semantics.placement.order === 'categories') {
    return parts.map((part) => {
      // MapLibre places the topmost layer first, so the first category listed is drawn on top.
      const rank = semantics.categories.length - 1 - semantics.categories.indexOf(part.category);
      const suffix = part.representation === 'combined' ? '' : `.${part.representation}`;
      return poiContribution(
        `${part.category}${suffix}`,
        rank * 4 + representationOrder[part.representation],
        {
          ...part.layer,
          id: `tileflow-poi-${part.category}${suffix.replace('.', '-')}`,
          filter: selection.filter([part.category], part.representation),
        },
      );
    });
  }

  const {prominentRank} = semantics.placement;
  const filterRank = numericPoiField(context.data.schema.fields.poiFilterRank, 6);
  return (['marker', 'combined', 'icon', 'label'] as const).flatMap((representation) => {
    const entries = parts.filter((part) => part.representation === representation);
    if (entries.length === 0) return [];
    const suffix = representation === 'combined' ? '' : `.${representation}`;
    const filter = selection.filter(
      entries.map(({category}) => category),
      representation,
    );
    const layer = mergePoiCategoryLayers(entries, {
      categoryField: context.data.schema.fields.poiCategory,
      filter,
      id: `tileflow-poi${suffix.replace('.', '-')}`,
    });
    // Markers do not collide, so only symbols need a prominent tier.
    if (prominentRank === undefined || representation === 'marker') {
      return [poiContribution(suffix.slice(1), representationOrder[representation], layer)];
    }
    // The most important ranks are placed before road and place labels. Splitting by rank keeps
    // the one importance order: every prominent POI sorts before every other POI.
    return [
      poiContribution(suffix.slice(1), representationOrder[representation], {
        ...layer,
        filter: [...filter, ['>', filterRank, prominentRank]],
      }),
      poiContribution(
        `prominent${suffix}`,
        labelOrder.prominentPoi - labelOrder.poi + representationOrder[representation],
        {
          ...layer,
          id: `tileflow-poi-prominent${suffix.replace('.', '-')}`,
          filter: [...filter, ['<=', filterRank, prominentRank]],
        },
      ),
    ];
  });
}

function compileCategory(
  category: TileflowPoiCategory,
  request: TileflowResolvedModuleConfig<TileflowPoiModuleConfig> | undefined,
  semantics: ResolvedPoiModuleOptions,
  context: TileflowDomainCompileContext,
  language: TileflowLabelLanguage,
  selection: PoiSelection,
): CategoryPart[] {
  const {sourceId: source, schema} = context.data;
  const coupled = semantics.placement.coupleIconAndLabel;
  const categoryColor =
    semantics.color === 'category'
      ? (context.colors.poi[category as keyof typeof context.colors.poi] ??
        context.colors.poi.label)
      : context.colors.poi.label;
  const defaults = {
    icon: {
      optional: !coupled,
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
      // A coupled POI is its pictogram and its name: it is placed only when both fit.
      optional: !coupled,
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
  >(defaults, request?.styles?.[category] ?? {});
  const markerStyle = style.marker ? resolveMarkerStyle(style) : undefined;
  // A hidden category draws nothing; it is not a constant layer property shared with the others.
  const hidden = style.visible === false;
  const showText = !hidden && semantics.labels && style.text.visible !== false;
  const showIcon = !hidden && semantics.icons && style.icon.visible !== false;
  style = {
    ...withoutVisibility(style),
    icon: withoutVisibility(style.icon),
    text: withoutVisibility(style.text),
  };
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
  const base = (): Layer => ({
    id: `tileflow-poi-${category}`,
    type: 'symbol',
    source,
    'source-layer': schema.layers.poi,
    minzoom: semantics.minZoom,
    layout: {'symbol-sort-key': poiSortKey(schema.fields.poiFilterRank, schema.fields.poiSizeRank)},
  });
  const parts: CategoryPart[] = [];
  selection.register(category, {icon: showIcon, text: showText});

  if (!hidden && markerStyle && markerStyle.visible !== false) {
    const markerBase = base();
    parts.push({
      category,
      representation: 'marker',
      layer: applyCircleStyle(
        {
          ...markerBase,
          type: 'circle',
          layout: {
            'circle-sort-key': poiSortKey(schema.fields.poiFilterRank, schema.fields.poiSizeRank),
          },
        },
        markerStyle,
      ),
    });
  }

  // Shared placement keeps a category in the combined layer even when one of its parts is hidden,
  // so that every category stays in one importance order: an empty image or name draws nothing.
  const combined =
    coupled &&
    (semantics.placement.order === 'importance'
      ? semantics.icons && semantics.labels && (showIcon || showText)
      : showIcon && showText);
  if (combined) {
    const combinedStyle: TileflowSymbolStyle = {
      ...symbolStyle,
      icon: showIcon ? symbolStyle.icon : {image: ''},
      text: showText
        ? {...symbolStyle.text, field: selection.textField(symbolStyle.text.field)}
        : {field: ''},
    };
    parts.push({
      category,
      representation: 'combined',
      layer: applySymbolStyle(base(), combinedStyle),
    });
    return parts;
  }

  if (showIcon) {
    parts.push({
      category,
      representation: 'icon',
      layer: applySymbolStyle(base(), {...symbolStyle, text: undefined}),
    });
  }
  if (showText) {
    parts.push({
      category,
      representation: 'label',
      layer: applySymbolStyle(base(), {...symbolStyle, icon: undefined}),
    });
  }
  return parts;
}

type PoiSelection = {
  filter: (
    categories: readonly TileflowPoiCategory[],
    representation: PoiRepresentation,
  ) => unknown[];
  register: (category: TileflowPoiCategory, parts: {icon: boolean; text: boolean}) => void;
  textField: (field: TileflowTextStyle['field']) => TileflowTextStyle['field'];
};

/**
 * Which ranked POIs a layer draws. A POI with a pictogram also needs a name, because an unnamed
 * disc says only its category; the exceptions are the types whose pictogram says everything
 * (`placement.iconOnlyTypes`), which are drawn as a pictogram without their name.
 */
function createPoiSelection(
  semantics: ResolvedPoiModuleOptions,
  context: TileflowDomainCompileContext,
  language: TileflowLabelLanguage,
): PoiSelection {
  const {fields} = context.data.schema;
  const typeRankCaps = Object.entries(semantics.maxRankByType).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const shown = new Map<TileflowPoiCategory, {icon: boolean; text: boolean}>();
  const iconOnlyTypes = [...new Set(semantics.placement.iconOnlyTypes)];
  const iconOnly = (): unknown[] =>
    iconOnlyTypes.length
      ? ['match', ['get', fields.poiType], iconOnlyTypes, true, false]
      : ['literal', false];
  const inCategories = (categories: readonly TileflowPoiCategory[]): unknown[] =>
    categories.length === 1
      ? ['==', ['get', fields.poiCategory], categories[0]]
      : ['match', ['get', fields.poiCategory], [...categories], true, false];
  const named = (): unknown[] => [
    'any',
    ...labelNameFields(language, context).map((field) => ['has', field]),
  ];

  return {
    register(category, parts) {
      shown.set(category, parts);
    },
    textField(field) {
      if (!iconOnlyTypes.length || field === undefined) return field;
      return expression<string>([
        'match',
        ['get', fields.poiType],
        iconOnlyTypes,
        '',
        fieldValue(field),
      ]);
    },
    filter(categories, representation) {
      const filterRank = numericPoiField(fields.poiFilterRank, 6);
      const sizeRank = numericPoiField(fields.poiSizeRank, 17);
      const result: unknown[] = [
        'all',
        inCategories(categories),
        ['has', fields.poiFilterRank],
        ['>=', filterRank, 0],
        ['<=', filterRank, poiRankThreshold(semantics, fields.poiCategory)],
        ['has', fields.poiSizeRank],
        ['>=', sizeRank, 0],
        ['<=', sizeRank, 16],
      ];
      if (typeRankCaps.length) {
        result.push([
          'match',
          ['get', fields.poiType],
          ...typeRankCaps.flatMap(([type, rank]) => [type, ['<=', filterRank, rank]]),
          true,
        ]);
      }
      if (!semantics.icons || !semantics.labels) return result;
      const textless = categories.filter((category) => !shown.get(category)?.text);
      const iconless = categories.filter((category) => !shown.get(category)?.icon);
      if (representation === 'label') {
        // Without a pictogram, the name is the only thing left to draw.
        if (iconless.length === categories.length || !iconOnlyTypes.length) return result;
        const keep: unknown[] = ['!', iconOnly()];
        return [...result, iconless.length ? ['any', inCategories(iconless), keep] : keep];
      }
      if (textless.length === categories.length) return result;
      return [
        ...result,
        [
          'any',
          named(),
          ...(iconOnlyTypes.length ? [iconOnly()] : []),
          ...(textless.length ? [inCategories(textless)] : []),
        ],
      ];
    },
  };
}

function fieldValue(field: NonNullable<TileflowTextStyle['field']>): unknown {
  return typeof field === 'object' &&
    field !== null &&
    'kind' in field &&
    field.kind === 'expression'
    ? field.value
    : field;
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

/**
 * The highest `filter_rank` a density shows at each zoom. Tileflow World's last zoom with POI data
 * is z15 and its ranks are spaced for that zoom; higher zooms overzoom the same tiles with more
 * room, so the threshold rises one rank at z16 and two at detailZoom (z17 by default).
 * MapLibre collision keeps the eligible features that fit.
 */
function poiRankThreshold(semantics: ResolvedPoiModuleOptions, categoryField: string): unknown[] {
  const overrides = Object.entries(semantics.densityByCategory).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const density = overrides.length
    ? [
        'match',
        ['get', categoryField],
        ...overrides.flatMap(([category, value]) => [category, value]),
        semantics.density,
      ]
    : semantics.density;
  return ['+', ['step', ['zoom'], 0, 16, 1, semantics.detailZoom, 2], density];
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
  layer: Layer,
): TileflowLayerContribution {
  return {
    kind: 'layer',
    layer,
    localOrder: labelOrder.poi + localOrder,
    owner: 'poi',
    slot: 'symbols',
    target: target ? `poi.${target}` : 'poi',
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

function withoutMarker(style: TileflowMarkerSymbolStyle): TileflowSymbolStyle & {
  icon: NonNullable<TileflowSymbolStyle['icon']>;
  text: NonNullable<TileflowSymbolStyle['text']>;
} {
  const result = {...style};
  delete result.marker;
  return result as TileflowSymbolStyle & {
    icon: NonNullable<TileflowSymbolStyle['icon']>;
    text: NonNullable<TileflowSymbolStyle['text']>;
  };
}

function withoutVisibility<T extends {visible?: boolean}>(value: T): T {
  const {visible: _visible, ...rest} = value;
  return rest as T;
}
