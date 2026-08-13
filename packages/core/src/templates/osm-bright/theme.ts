import type {ResolvedTileflowTypography, TileflowTypographyDomain} from '../../compiler';
import type {ResolvedTileflowTheme, TileflowResolvedColors} from '../../themes';
import {textFont} from '../../themes';

export function applyOsmBrightTheme(
  layers: Array<Record<string, unknown>>,
  colors: TileflowResolvedColors,
  theme: ResolvedTileflowTheme,
  typography: ResolvedTileflowTypography,
  typographyOverridden = theme.typographyOverridden,
): Array<Record<string, unknown>> {
  if (!theme.custom && theme.name === 'light' && !typographyOverridden) {
    return layers;
  }

  return layers.map((layer) => {
    const type = stringValue(layer.type);
    const sourceLayer = stringValue(layer['source-layer']);
    const id = stringValue(layer.id);
    const nextLayer = {...layer};
    const paint = isRecord(layer.paint) ? {...layer.paint} : {};
    const layout = isRecord(layer.layout) ? {...layer.layout} : {};
    let paintChanged = false;
    let layoutChanged = false;

    if (type === 'background' && hasBaseColor(theme, ['background', 'canvas'])) {
      paint['background-color'] = colors.background;
      paintChanged = true;
    }

    if (type === 'fill') {
      const fillColor = osmBrightFillColor(id, sourceLayer, colors, theme);

      if (fillColor) {
        paint['fill-color'] = fillColor;
        paintChanged = true;
      }
    }

    if (type === 'line') {
      const lineColor = osmBrightLineColor(id, sourceLayer, colors, theme);

      if (lineColor) {
        paint['line-color'] = lineColor;
        paintChanged = true;
      }
    }

    if (type === 'symbol') {
      const textColor = osmBrightTextColor(id, sourceLayer, colors, theme);

      if (textColor && ('text-color' in paint || id.includes('label') || id.includes('name'))) {
        paint['text-color'] = textColor;
        paintChanged = true;
      }

      if ('text-halo-color' in paint && shouldThemeLabelHalo(theme)) {
        paint['text-halo-color'] = colors.labels.halo;
        paintChanged = true;
      }

      if (typographyOverridden && 'text-font' in layout) {
        layout['text-font'] = textFont(typography, typographyDomain(id, sourceLayer));
        layoutChanged = true;
      }
    }

    if (paintChanged) {
      nextLayer.paint = paint;
    }

    if (layoutChanged) {
      nextLayer.layout = layout;
    }

    return nextLayer;
  });
}

function typographyDomain(id: string, sourceLayer: string): TileflowTypographyDomain {
  if (sourceLayer === 'poi' || id.startsWith('poi-')) return 'poi';
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

function osmBrightFillColor(
  id: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  theme: ResolvedTileflowTheme,
): string | undefined {
  if (sourceLayer === 'water' || id.includes('water')) {
    return hasBaseColor(theme, ['water']) || hasNestedModuleColor(theme, 'hydro', 'water')
      ? colors.hydro.water
      : undefined;
  }

  if (sourceLayer === 'building') {
    return hasBaseColor(theme, ['building']) || hasNestedModuleColor(theme, 'buildings', 'fill')
      ? colors.buildings.fill
      : undefined;
  }

  if (sourceLayer === 'landcover' || id.includes('park') || id.includes('wood')) {
    if (id.includes('wood') || id.includes('forest')) {
      return shouldThemeLandcoverColor(theme, 'wood') ? colors.landcover.wood : undefined;
    }

    if (id.includes('grass')) {
      return shouldThemeLandcoverColor(theme, 'grass') ? colors.landcover.grass : undefined;
    }

    if (id.includes('sand') || id.includes('beach')) {
      return shouldThemeLandcoverColor(theme, 'sand') ? colors.landcover.sand : undefined;
    }

    if (id.includes('ice') || id.includes('glacier')) {
      return shouldThemeLandcoverColor(theme, 'ice') ? colors.landcover.ice : undefined;
    }

    return shouldThemeLandcoverColor(theme, 'park') ? colors.landcover.park : undefined;
  }

  if (sourceLayer === 'landuse' || id.includes('landuse')) {
    if (id.includes('commercial') || id.includes('retail')) {
      return shouldThemeLanduseColor(theme, 'commercial') ? colors.landuse.commercial : undefined;
    }

    if (id.includes('industrial')) {
      return shouldThemeLanduseColor(theme, 'industrial') ? colors.landuse.industrial : undefined;
    }

    if (id.includes('cemetery')) {
      return shouldThemeLanduseColor(theme, 'cemetery') ? colors.landuse.cemetery : undefined;
    }

    if (id.includes('hospital') || id.includes('school') || id.includes('civic')) {
      return shouldThemeLanduseColor(theme, 'civic') ? colors.landuse.civic : undefined;
    }

    return shouldThemeLanduseColor(theme, 'residential') ? colors.landuse.residential : undefined;
  }

  return undefined;
}

function osmBrightLineColor(
  id: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  theme: ResolvedTileflowTheme,
): string | undefined {
  if (sourceLayer === 'transportation') {
    return osmBrightRoadLineColor(id, colors, theme);
  }

  if (sourceLayer === 'waterway') {
    return hasBaseColor(theme, ['water']) || hasNestedModuleColor(theme, 'hydro', 'waterway')
      ? colors.hydro.waterway
      : undefined;
  }

  if (sourceLayer === 'boundary') {
    const boundaryKey = boundaryColorKey(id);

    return hasBaseColor(theme, ['boundary']) ||
      hasNestedModuleColor(theme, 'boundaries', boundaryKey)
      ? colors.boundaries[boundaryKey]
      : undefined;
  }

  return undefined;
}

function osmBrightTextColor(
  id: string,
  sourceLayer: string,
  colors: TileflowResolvedColors,
  theme: ResolvedTileflowTheme,
): string | undefined {
  if (sourceLayer === 'water_name' || id.includes('water')) {
    if (hasNestedModuleColor(theme, 'labels', 'water')) {
      return colors.labels.water;
    }

    if (hasNestedModuleColor(theme, 'hydro', 'label')) {
      return colors.hydro.label;
    }

    return hasBaseColor(theme, ['water']) || shouldThemeLabels(theme)
      ? colors.labels.water
      : undefined;
  }

  if (sourceLayer === 'transportation_name') {
    return shouldThemeLabelColor(theme, 'road') ? colors.labels.road : undefined;
  }

  if (sourceLayer === 'poi' || id.includes('poi')) {
    if (hasNestedModuleColor(theme, 'poi', 'label')) {
      return colors.poi.label;
    }

    return shouldThemeLabelColor(theme, 'poi') ? colors.labels.poi : undefined;
  }

  if (id.includes('country')) {
    return shouldThemeLabelColor(theme, 'country') ? colors.labels.country : undefined;
  }

  if (sourceLayer === 'place' || id.includes('place')) {
    return shouldThemeLabelColor(theme, 'settlement') ? colors.labels.settlement : undefined;
  }

  return shouldThemeLabelColor(theme, 'primary') ? colors.labels.primary : undefined;
}

function osmBrightRoadLineColor(
  id: string,
  colors: TileflowResolvedColors,
  theme: ResolvedTileflowTheme,
): string | undefined {
  const moduleColor = osmBrightModuleRoadLineColor(id, colors, theme);

  if (moduleColor) {
    return moduleColor;
  }

  if (isNonRoadThemeTarget(id)) {
    return undefined;
  }

  if (isRoadCasing(id)) {
    return hasBaseColor(theme, ['roadCasing']) ? colors.roads.casing : undefined;
  }

  if (isMajorRoad(id)) {
    return hasBaseColor(theme, ['roadMajor']) ? colors.roads.primary : undefined;
  }

  if (isMinorRoad(id)) {
    return hasBaseColor(theme, ['road']) ? colors.roads.minor : undefined;
  }

  return undefined;
}

function osmBrightModuleRoadLineColor(
  id: string,
  colors: TileflowResolvedColors,
  theme: ResolvedTileflowTheme,
): string | undefined {
  const roadColor = (key: keyof TileflowResolvedColors['roads']): string | undefined =>
    hasNestedModuleColor(theme, 'roads', key) ? colors.roads[key] : undefined;

  if (isRoadCasing(id)) {
    const casing = roadColor('casing');

    if (casing) {
      return casing;
    }
  }

  if (id.includes('ferry')) {
    return roadColor('ferry');
  }

  if (id.includes('rail')) {
    const rail = roadColor('rail');

    if (rail) {
      return rail;
    }
  }

  if (id.includes('path') || id.includes('track') || id.includes('steps')) {
    const path = roadColor('path');

    if (path) {
      return path;
    }
  }

  if (id.includes('bridge')) {
    const bridge = roadColor('bridge');

    if (bridge) {
      return bridge;
    }
  }

  if (id.includes('tunnel')) {
    const tunnel = roadColor('tunnel');

    if (tunnel) {
      return tunnel;
    }
  }

  if (id.includes('motorway')) {
    return roadColor('motorway');
  }

  if (id.includes('trunk-primary')) {
    return roadColor('trunk') ?? roadColor('primary');
  }

  if (id.includes('trunk')) {
    return roadColor('trunk');
  }

  if (id.includes('primary')) {
    return roadColor('primary');
  }

  if (id.includes('secondary') || id.includes('tertiary')) {
    return roadColor('secondary');
  }

  if (id.includes('link')) {
    return roadColor('primary');
  }

  if (id.includes('minor') || id.includes('service')) {
    return roadColor('minor');
  }

  return undefined;
}

function boundaryColorKey(id: string): keyof TileflowResolvedColors['boundaries'] {
  if (id.includes('water') || id.includes('maritime')) {
    return 'maritime';
  }

  if (id.includes('disputed')) {
    return 'disputed';
  }

  return id.includes('country') || id.includes('admin') || id.includes('level-2')
    ? 'major'
    : 'admin';
}

function isRoadCasing(id: string): boolean {
  return id.includes('case') || id.includes('casing');
}

function isMajorRoad(id: string): boolean {
  return (
    id.includes('motorway') ||
    id.includes('trunk') ||
    id.includes('primary') ||
    id.includes('secondary') ||
    id.includes('tertiary') ||
    id.includes('highway-link') ||
    id.includes('bridge-link') ||
    id.includes('tunnel-link')
  );
}

function isMinorRoad(id: string): boolean {
  return id.includes('minor') || id.includes('service') || id.includes('track');
}

function isNonRoadThemeTarget(id: string): boolean {
  return (
    id.includes('rail') ||
    id.includes('ferry') ||
    id.includes('cablecar') ||
    id.includes('path') ||
    id.includes('steps') ||
    id.includes('pier') ||
    id.includes('area')
  );
}

function shouldThemeLandcoverColor(
  theme: ResolvedTileflowTheme,
  key: keyof TileflowResolvedColors['landcover'],
): boolean {
  return (
    hasBaseColor(theme, ['park', 'greenspace', 'nature']) ||
    hasNestedModuleColor(theme, 'landcover', key)
  );
}

function shouldThemeLanduseColor(
  theme: ResolvedTileflowTheme,
  key: keyof TileflowResolvedColors['landuse'],
): boolean {
  return hasBaseColor(theme, ['land']) || hasNestedModuleColor(theme, 'landuse', key);
}

function shouldThemeLabels(theme: ResolvedTileflowTheme): boolean {
  return hasBaseColor(theme, ['text', 'textMuted']);
}

function shouldThemeLabelHalo(theme: ResolvedTileflowTheme): boolean {
  return (
    hasBaseColor(theme, ['background', 'canvas', 'textHalo']) ||
    hasNestedModuleColor(theme, 'labels', 'halo')
  );
}

function shouldThemeLabelColor(
  theme: ResolvedTileflowTheme,
  key: keyof TileflowResolvedColors['labels'],
): boolean {
  return shouldThemeLabels(theme) || hasNestedModuleColor(theme, 'labels', key);
}

function hasBaseColor(theme: ResolvedTileflowTheme, keys: readonly string[]): boolean {
  return keys.some(
    (key) => typeof theme.colorOverrides[key as keyof typeof theme.colorOverrides] === 'string',
  );
}

function hasNestedModuleColor(theme: ResolvedTileflowTheme, group: string, key: string): boolean {
  const value = theme.moduleOverrides[group as keyof typeof theme.moduleOverrides];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return typeof (value as Record<string, unknown>)[key] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
