import type {ResolvedLabelsModuleOptions} from '../../modules/labels';
import {labelTextField, roadLabelClasses, visibleRoadLabelClasses} from '../../modules/labels';
import type {ResolvedPoiModuleOptions} from '../../modules/poi';
import {
  poiCategoryColorExpression,
  poiCategoryFilter,
  poiDensityFilter,
  poiIconImageExpression,
  poiPriorityExpression,
} from '../../modules/poi';
import {
  type ResolvedRoadsModuleOptions,
  roadClassWidthScaleExpression,
  roadStyleMetrics,
} from '../../modules/roads';
import type {TileflowResolvedColors} from '../../themes';

export function applyOsmBrightControls(
  layers: Array<Record<string, unknown>>,
  options: {
    customIconMapping?: Record<string, string>;
    customIconSpriteId?: string;
    colors: TileflowResolvedColors;
    labels: ResolvedLabelsModuleOptions;
    poi: ResolvedPoiModuleOptions;
    roads?: ResolvedRoadsModuleOptions;
  },
): Array<Record<string, unknown>> {
  return layers.map((layer) => {
    const id = stringValue(layer.id);
    const sourceLayer = stringValue(layer['source-layer']);
    const type = stringValue(layer.type);

    if (options.roads && sourceLayer === 'transportation') {
      return applyRoadLayerControls(layer, options.roads);
    }

    if (type !== 'symbol') {
      return layer;
    }

    if (isPoiLayer(id, sourceLayer)) {
      return applyPoiLayerControls(
        layer,
        options.poi,
        options.colors,
        options.customIconSpriteId,
        options.customIconMapping,
      );
    }

    if (isLabelLayer(id, sourceLayer)) {
      return applyLabelLayerControls(layer, options.labels, options.roads);
    }

    return layer;
  });
}

type OsmBrightRoadGroup = 'highways' | 'major' | 'streets' | 'service' | 'paths' | 'rail' | 'ferry';

function applyRoadLayerControls(
  layer: Record<string, unknown>,
  roads: ResolvedRoadsModuleOptions,
): Record<string, unknown> {
  const id = stringValue(layer.id);
  const type = stringValue(layer.type);
  const group = osmBrightRoadGroup(id);
  const isCasing = id.includes('casing');
  const showsSharedHighwayLink = roads.detail === 'highways' && isSharedMajorLinkLayer(id);

  if (
    (!isRoadLayerVisible(group, roads) && !showsSharedHighwayLink) ||
    (isCasing && roads.outline === 'none')
  ) {
    return setLayerVisibility(layer, 'none');
  }

  const metrics = roadStyleMetrics(roads);
  const nextLayer = setLayerVisibility(layer, 'visible');
  const paint = isRecord(nextLayer.paint) ? {...nextLayer.paint} : {};
  const widthScale =
    metrics.weightScale *
    (group === 'highways' || group === 'major' ? metrics.majorWidthScale : metrics.minorWidthScale);
  const opacityScale = isCasing
    ? metrics.outlineOpacity
    : group === 'highways' || group === 'major'
      ? metrics.majorOpacity
      : group === 'ferry'
        ? metrics.majorOpacity * 0.8
        : group === 'paths'
          ? metrics.minorOpacity * 0.77
          : group === 'rail'
            ? metrics.minorOpacity * 0.65
            : metrics.minorOpacity;

  if (type === 'line') {
    paint['line-opacity'] = scaleStyleValue(paint['line-opacity'], opacityScale, 1);
    const scaledWidth = scaleStyleValue(paint['line-width'], widthScale, 1);
    paint['line-width'] = roads.widthScale
      ? multiplyStyleValue(scaledWidth, roadClassWidthScaleExpression(roads.widthScale))
      : scaledWidth;
    nextLayer.paint = paint;
  }

  if (type === 'fill') {
    paint['fill-opacity'] = scaleStyleValue(paint['fill-opacity'], opacityScale, 1);
    nextLayer.paint = paint;
  }

  if (roads.detail === 'highways' && (group === 'highways' || showsSharedHighwayLink)) {
    nextLayer.filter = combineFilters(nextLayer.filter, ['in', 'class', 'motorway', 'trunk']);
  }

  if (group === 'streets' && id.includes('minor')) {
    nextLayer.minzoom = Math.max(numberValue(nextLayer.minzoom) ?? 0, 12);

    if (roads.detail === 'streets') {
      nextLayer.filter = combineFilters(nextLayer.filter, ['==', 'class', 'minor']);
    }
  }

  if (group === 'service') {
    nextLayer.minzoom = Math.max(numberValue(nextLayer.minzoom) ?? 0, 14);
  }

  return nextLayer;
}

function multiplyStyleValue(value: unknown, multiplier: unknown): unknown[] {
  return ['*', legacyCameraFunctionExpression(value), multiplier];
}

function legacyCameraFunctionExpression(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.stops)) return value;

  const stops = value.stops.filter(
    (stop): stop is [number, unknown] =>
      Array.isArray(stop) && stop.length >= 2 && typeof stop[0] === 'number',
  );
  if (stops.length === 0) return typeof value.default === 'number' ? value.default : 1;

  return [
    'interpolate',
    ['exponential', typeof value.base === 'number' ? value.base : 1],
    ['zoom'],
    ...stops.flatMap(([zoom, output]) => [zoom, output]),
  ];
}

function isRoadLayerVisible(group: OsmBrightRoadGroup, roads: ResolvedRoadsModuleOptions): boolean {
  if (roads.detail === 'none') return false;
  if (group === 'paths') return roads.extras.paths;
  if (group === 'rail') return roads.extras.rail;
  if (group === 'ferry') return roads.extras.ferry;
  if (group === 'service') return roads.detail === 'all';
  if (group === 'streets') return roads.detail === 'streets' || roads.detail === 'all';
  if (group === 'major') return roads.detail !== 'highways';

  return true;
}

function osmBrightRoadGroup(id: string): OsmBrightRoadGroup {
  if (id === 'ferry') return 'ferry';
  if (id.includes('railway') || id.includes('cablecar')) return 'rail';
  if (id.includes('path') || id.includes('steps')) return 'paths';
  if (id.includes('service') || id.includes('track')) return 'service';
  if (id.includes('motorway') || id.includes('trunk')) return 'highways';
  if (
    id.includes('primary') ||
    id.includes('secondary') ||
    id.includes('tertiary') ||
    id.includes('link')
  ) {
    return 'major';
  }

  return 'streets';
}

function isSharedMajorLinkLayer(id: string): boolean {
  return id.includes('-link') && !id.includes('motorway-link');
}

function scaleStyleValue(value: unknown, scale: number, fallback: number): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value * scale;
  }

  if (Array.isArray(value)) {
    return ['*', value, scale];
  }

  if (isRecord(value) && Array.isArray(value.stops)) {
    return {
      ...value,
      ...(typeof value.default === 'number' ? {default: value.default * scale} : {}),
      stops: value.stops.map((stop) => {
        if (!Array.isArray(stop) || stop.length < 2 || typeof stop[1] !== 'number') {
          return stop;
        }

        return [stop[0], stop[1] * scale];
      }),
    };
  }

  return fallback * scale;
}

function applyLabelLayerControls(
  layer: Record<string, unknown>,
  labels: ResolvedLabelsModuleOptions,
  roads: ResolvedRoadsModuleOptions | undefined,
): Record<string, unknown> {
  const id = stringValue(layer.id);
  const sourceLayer = stringValue(layer['source-layer']);
  const group = labelGroup(id, sourceLayer);
  const detail = labelGroupDetail(labels, group);

  if (detail === 'none' || (detail === 'major' && isMinorLabelLayer(id, group))) {
    return setLayerVisibility(layer, 'none');
  }

  const nextLayer = setLayerVisibility(layer, 'visible');
  const layout = isRecord(nextLayer.layout) ? {...nextLayer.layout} : {};

  if ('text-field' in layout && !isHighwayShieldLayer(id)) {
    layout['text-field'] = labelTextField(labels.language);
  }

  if (group === 'roads') {
    const allowedClasses = (
      roads
        ? visibleRoadLabelClasses(detail, roads, labels.roadClasses)
        : roadLabelClasses(detail).filter(
            (roadClass) => !labels.roadClasses || labels.roadClasses.includes(roadClass as never),
          )
    ).filter((roadClass) => roadLabelLayerClasses(id).includes(roadClass));

    if (allowedClasses.length === 0) {
      return setLayerVisibility(layer, 'none');
    }

    nextLayer.filter = combineFilters(nextLayer.filter, ['in', 'class', ...allowedClasses]);
  }

  if (group === 'water' && detail === 'major') {
    if (sourceLayer === 'waterway') {
      nextLayer.filter = combineFilters(nextLayer.filter, ['==', 'class', 'river']);
    } else if (id === 'water-name-other') {
      nextLayer.filter = combineFilters(nextLayer.filter, ['in', 'class', 'sea', 'lake']);
    }
  }

  nextLayer.layout = layout;

  return nextLayer;
}

function applyPoiLayerControls(
  layer: Record<string, unknown>,
  poi: ResolvedPoiModuleOptions,
  colors: TileflowResolvedColors,
  customIconSpriteId: string | undefined,
  customIconMapping: Record<string, string> | undefined,
): Record<string, unknown> {
  if (poi.mode === 'none') {
    return setLayerVisibility(layer, 'none');
  }

  const nextLayer = setLayerVisibility(layer, 'visible');
  const layout = isRecord(nextLayer.layout) ? {...nextLayer.layout} : {};
  const paint = isRecord(nextLayer.paint) ? {...nextLayer.paint} : {};

  nextLayer.minzoom = Math.max(numberValue(nextLayer.minzoom) ?? 0, poi.minZoom);

  if (poi.categories && sourceLayerValue(nextLayer) === 'poi') {
    nextLayer.filter = combineFilters(
      nextLayer.filter,
      poiCategoryFilter(poi.categories, poi.classMapping),
    );
  }

  if (poi.density && sourceLayerValue(nextLayer) === 'poi') {
    const densityFilter = poiDensityFilter(poi.density, poi.classMapping);
    if (densityFilter) nextLayer.filter = combineFilters(nextLayer.filter, densityFilter);
    layout['symbol-sort-key'] = poiPriorityExpression(poi.classMapping);
  }

  if (poi.labels === 'none') {
    delete layout['text-field'];
  } else if ('text-field' in layout) {
    layout['text-field'] = labelTextField('auto');
  }

  if (poi.icons === false) {
    delete layout['icon-image'];
  } else if ('icon-image' in layout || customIconSpriteId) {
    layout['icon-image'] = poiIconImageExpression(
      customIconSpriteId,
      customIconMapping,
      poi.classMapping,
    );
    layout['icon-optional'] = !poi.placement.coupleIconAndLabel;
    layout['icon-padding'] = poi.placement.iconPadding;
  }

  layout['text-padding'] = poi.placement.textPadding;
  if (poi.placement.coupleIconAndLabel) layout['text-optional'] = false;

  if (poi.color === 'category' && 'text-color' in paint) {
    paint['text-color'] = poiCategoryColorExpression(colors, poi.classMapping);
  }

  nextLayer.layout = layout;
  nextLayer.paint = paint;

  return nextLayer;
}

function labelGroupDetail(
  labels: ResolvedLabelsModuleOptions,
  group: 'places' | 'roads' | 'water',
) {
  if (group === 'roads') return labels.roads;
  if (group === 'water') return labels.water;

  return labels.places;
}

function labelGroup(id: string, sourceLayer: string): 'places' | 'roads' | 'water' {
  if (
    sourceLayer === 'transportation_name' ||
    id.includes('highway-name') ||
    id.includes('highway-shield')
  ) {
    return 'roads';
  }

  if (sourceLayer === 'water_name' || sourceLayer === 'waterway' || id.includes('water-name')) {
    return 'water';
  }

  return 'places';
}

function isMinorLabelLayer(id: string, group: 'places' | 'roads' | 'water'): boolean {
  if (group === 'places') return id === 'place-other' || id === 'place-village';
  if (group === 'roads') return id.includes('path') || id.includes('minor');

  return false;
}

function roadLabelLayerClasses(id: string): string[] {
  if (id.includes('path')) return ['path'];
  if (id.includes('minor')) return ['minor', 'service', 'track'];

  return ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
}

function isLabelLayer(id: string, sourceLayer: string): boolean {
  return (
    sourceLayer === 'place' ||
    sourceLayer === 'transportation_name' ||
    sourceLayer === 'water_name' ||
    sourceLayer === 'waterway' ||
    id.includes('highway-name') ||
    id.includes('highway-shield') ||
    id.includes('water-name')
  );
}

function isPoiLayer(id: string, sourceLayer: string): boolean {
  return sourceLayer === 'poi' || id.startsWith('poi-');
}

function isHighwayShieldLayer(id: string): boolean {
  return id.includes('highway-shield');
}

function setLayerVisibility(
  layer: Record<string, unknown>,
  visibility: 'none' | 'visible',
): Record<string, unknown> {
  const layout = isRecord(layer.layout) ? {...layer.layout} : {};
  layout.visibility = visibility;

  return {
    ...layer,
    layout,
  };
}

function combineFilters(first: unknown, second: unknown): unknown[] {
  if (!first) {
    return second as unknown[];
  }

  return ['all', first, second];
}

function sourceLayerValue(layer: Record<string, unknown>): string {
  return stringValue(layer['source-layer']);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
