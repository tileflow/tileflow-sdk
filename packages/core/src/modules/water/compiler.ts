import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {
  applyFillStyle,
  applyLineStyle,
  applySymbolStyle,
  createAreaLayers,
} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {
  TileflowFillStyle,
  TileflowLineStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';
import {expression, zoom} from '../../cartography/values';
import type {ResolvedBathymetryRelief, TileflowBathymetryReliefConfig} from '../../marine';
import {alpha, mix} from '../../themes';
import type {TileflowWaterModuleConfig, TileflowWaterwayClass} from './index';

const waterwayClasses: Record<TileflowWaterwayClass, readonly string[]> = {
  canal: ['canal'],
  other: ['ditch', 'drain'],
  river: ['river'],
  stream: ['stream'],
};

export function compileWater(
  request: TileflowWaterModuleConfig | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const config = mergeTileflowDesign<TileflowWaterModuleConfig>(
    {
      type: 'water',
      enabled: true,
      bodies: {fill: {color: context.colors.hydro.water, opacity: 1}},
      intermittent: {
        bodies: {fill: {color: context.colors.hydro.water, opacity: 0.68}},
        waterways: {color: context.colors.hydro.waterway, opacity: 0.65, dash: [2, 1]},
      },
      waterways: {
        canal: {
          color: context.colors.hydro.waterway,
          minZoom: 8,
          width: zoom.linear([
            [8, 0.3],
            [16, 2.2],
          ]),
        },
        other: {
          color: context.colors.hydro.waterway,
          minZoom: 12,
          width: zoom.linear([
            [12, 0.25],
            [16, 1.2],
          ]),
        },
        river: {
          color: context.colors.hydro.waterway,
          minZoom: 6,
          width: zoom.linear([
            [6, 0.4],
            [16, 3.2],
          ]),
        },
        stream: {
          color: context.colors.hydro.waterway,
          minZoom: 10,
          width: zoom.linear([
            [10, 0.25],
            [16, 1.8],
          ]),
        },
      },
    },
    request,
  );
  if (config.enabled === false) return [];

  const source = context.data.sourceId;
  const {fields, layers} = context.data.schema;
  const contributions: TileflowLayerContribution[] = [];
  if (config.bodies) {
    for (const area of createAreaLayers(
      {
        id: 'streets-water',
        type: 'fill',
        source,
        'source-layer': layers.water,
        filter: ['!=', ['get', fields.intermittent], 1],
      },
      config.bodies,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: area.phase === 'fill' ? 0 : 1,
        owner: 'water',
        slot: 'hydro',
        target: `water.bodies.${area.phase}`,
      });
    }
  }

  if (config.intermittent?.bodies) {
    for (const area of createAreaLayers(
      {
        id: 'streets-water-intermittent',
        type: 'fill',
        source,
        'source-layer': layers.water,
        filter: ['==', ['get', fields.intermittent], 1],
      },
      config.intermittent.bodies,
    )) {
      contributions.push({
        kind: 'layer',
        layer: area.layer,
        localOrder: area.phase === 'fill' ? 5 : 6,
        owner: 'water',
        slot: 'hydro',
        target: `water.intermittent.bodies.${area.phase}`,
      });
    }
  }

  const bathymetryProduct = context.marine?.bathymetry;
  const sidecarBathymetry = bathymetryProduct?.vector;
  const usePrimaryBathymetryFallback = context.marine === undefined;
  const bathymetrySource = sidecarBathymetry?.sourceId ?? source;
  const bathymetryLayer = sidecarBathymetry
    ? 'bathymetry'
    : usePrimaryBathymetryFallback
      ? layers.bathymetry
      : undefined;
  const bathymetryDepthField = sidecarBathymetry
    ? 'min_depth'
    : usePrimaryBathymetryFallback
      ? fields.bathymetryMinDepth
      : undefined;
  const bathymetrySortField = sidecarBathymetry
    ? 'sort_key'
    : usePrimaryBathymetryFallback
      ? fields.bathymetrySortKey
      : undefined;
  if (bathymetryLayer && bathymetryDepthField && bathymetrySortField) {
    const depth = context.colors.hydro.depth;
    const depthStops = bathymetryDepthStops(depth);
    const productBands = bathymetryProduct?.bands;
    const bandOverrides =
      productBands === false
        ? ({visible: false} satisfies TileflowFillStyle)
        : mergeTileflowDesign<TileflowFillStyle>(productBands ?? {}, config.bathymetry);
    const bathymetry = mergeTileflowDesign(
      {
        antialias: false,
        color: expression<string>([
          'interpolate',
          ['linear'],
          ['to-number', ['get', bathymetryDepthField], 0],
          ...depthStops,
        ]),
        maxZoom: 10,
        minZoom: 0,
        opacity: zoom.linear([
          [0, 0.84],
          [7, 0.76],
          [9, 0.56],
          [10, 0],
        ]),
        visible: config.bodies?.fill?.visible !== false,
      },
      bandOverrides,
    );
    if (bathymetry.visible !== false) {
      contributions.push({
        kind: 'layer',
        layer: applyFillStyle(
          {
            id: 'streets-bathymetry',
            type: 'fill',
            source: bathymetrySource,
            'source-layer': bathymetryLayer,
            layout: {
              'fill-sort-key': ['to-number', ['get', bathymetrySortField], 0],
            },
          },
          bathymetry,
        ),
        localOrder: 2,
        owner: 'water',
        slot: 'hydro',
        target: 'water.bathymetry',
      });
    }
  }

  if (bathymetryProduct?.relief) {
    appendBathymetryRelief(contributions, bathymetryProduct.relief, context);
  }

  const productContours = bathymetryProduct?.contours;
  const contourRequest =
    productContours === false
      ? undefined
      : productContours === undefined
        ? request?.bathymetryContours
        : mergeTileflowDesign<TileflowLineStyle>(productContours, request?.bathymetryContours);
  if (contourRequest !== undefined && bathymetryLayer && bathymetryDepthField) {
    const bathymetryContours = mergeTileflowDesign<TileflowLineStyle>(
      {
        color: context.colors.hydro.label,
        join: 'round',
        maxZoom: 10,
        minZoom: 3,
        opacity: 0.34,
        width: zoom.linear([
          [3, 0.3],
          [9, 0.7],
        ]),
      },
      contourRequest,
    );
    if (bathymetryContours.visible !== false) {
      contributions.push({
        kind: 'layer',
        layer: applyLineStyle(
          {
            id: 'streets-bathymetry-contours',
            type: 'line',
            source: bathymetrySource,
            'source-layer': bathymetryLayer,
            filter: [
              'all',
              ['==', ['geometry-type'], 'Polygon'],
              ['has', bathymetryDepthField],
              ['<', ['to-number', ['get', bathymetryDepthField], 0], 0],
            ],
          },
          bathymetryContours,
        ),
        localOrder: 7,
        owner: 'water',
        slot: 'hydro',
        target: 'water.bathymetryContours',
      });
    }
  }

  const productLabels = bathymetryProduct?.labels;
  const labelRequest =
    productLabels === false
      ? undefined
      : productLabels === undefined
        ? request?.bathymetryLabels
        : mergeTileflowDesign<TileflowSymbolStyle>(productLabels, request?.bathymetryLabels);
  if (labelRequest !== undefined && bathymetryLayer && bathymetryDepthField) {
    const bathymetryLabels = mergeTileflowDesign<TileflowSymbolStyle>(
      {
        maxZoom: 10,
        minZoom: 3,
        placement: 'point',
        priority: 5,
        text: {
          allowOverlap: false,
          color: context.colors.hydro.label,
          field: expression<string>([
            'to-string',
            ['abs', ['to-number', ['get', bathymetryDepthField], 0]],
          ]),
          ...typographyTextStyle(context.typography.water),
          haloColor: context.colors.hydro.water,
          haloWidth: 1,
          opacity: 0.72,
          optional: true,
          padding: 18,
          size: 9,
        },
      },
      labelRequest,
    );
    if (bathymetryLabels.visible !== false && bathymetryLabels.text?.visible !== false) {
      contributions.push({
        kind: 'layer',
        layer: applySymbolStyle(
          {
            id: 'streets-bathymetry-labels',
            type: 'symbol',
            source: bathymetrySource,
            'source-layer': bathymetryLayer,
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['has', bathymetryDepthField]],
          },
          bathymetryLabels,
        ),
        localOrder: 480,
        owner: 'water',
        slot: 'symbols',
        target: 'water.bathymetryLabels',
      });
    }
  }

  let localOrder = 10;
  for (const [name, classes] of Object.entries(waterwayClasses) as Array<
    [TileflowWaterwayClass, readonly string[]]
  >) {
    const style = config.waterways?.[name];
    if (!style || style.visible === false) continue;
    contributions.push({
      kind: 'layer',
      layer: applyLineStyle(
        {
          id: `streets-waterway-${name}`,
          type: 'line',
          source,
          'source-layer': layers.waterway,
          filter: [
            'all',
            classFilter(fields.class, classes),
            ['!=', ['get', fields.intermittent], 1],
          ],
        },
        style,
      ),
      localOrder: localOrder++,
      owner: 'water',
      slot: 'hydro',
      target: `water.waterways.${name}`,
    });

    const intermittent = config.intermittent?.waterways;
    if (intermittent?.visible === false) continue;
    contributions.push({
      kind: 'layer',
      layer: applyLineStyle(
        {
          id: `streets-waterway-${name}-intermittent`,
          type: 'line',
          source,
          'source-layer': layers.waterway,
          filter: [
            'all',
            classFilter(fields.class, classes),
            ['==', ['get', fields.intermittent], 1],
          ],
        },
        mergeTileflowDesign(style, intermittent),
      ),
      localOrder: localOrder++,
      owner: 'water',
      slot: 'hydro',
      target: `water.intermittent.waterways.${name}`,
    });
  }

  return contributions;
}

function appendBathymetryRelief(
  contributions: TileflowLayerContribution[],
  relief: ResolvedBathymetryRelief,
  context: TileflowDomainCompileContext,
): void {
  const {sourceId, style} = relief;
  const opacity = resolvedNumber(style.opacity, 0.22, 'bathymetry relief opacity');
  if (opacity <= 0 || style.visible === false) return;

  const depth = context.colors.hydro.depth;
  const depthStops = bathymetryDepthStops(depth);
  const transparentWater = alpha(context.colors.hydro.water, 0);
  contributions.push({
    kind: 'layer',
    layer: applyReliefRange(
      {
        id: 'streets-bathymetry-color-relief',
        type: 'color-relief',
        source: sourceId,
        paint: {
          'color-relief-color': [
            'interpolate',
            ['linear'],
            ['elevation'],
            ...depthStops.slice(0, -2),
            -0.01,
            depth.m0,
            0,
            transparentWater,
            1,
            transparentWater,
          ],
          'color-relief-opacity': opacity,
          resampling: 'linear',
        },
      },
      style,
    ),
    localOrder: 3,
    owner: 'water',
    slot: 'hydro',
    target: 'water.bathymetryRelief.color',
  });

  const multidirectional = style.multidirectional === true;
  const direction = resolvedNumber(
    style.illuminationDirection,
    multidirectional ? 270 : 335,
    'bathymetry relief illumination direction',
  );
  const altitude = resolvedNumber(
    style.illuminationAltitude,
    45,
    'bathymetry relief illumination altitude',
  );
  const directions = multidirectional
    ? [direction, direction + 45, direction + 90, direction + 135].map(
        (value) => ((value % 360) + 360) % 360,
      )
    : direction;
  const altitudes = multidirectional ? [altitude, altitude, altitude, altitude] : altitude;
  const accent = resolvedColor(
    style.accentColor,
    context.colors.hydro.label,
    'bathymetry relief accent color',
  );
  const highlight = resolvedColor(
    style.highlightColor,
    context.colors.hydro.water,
    'bathymetry relief highlight color',
  );
  const shadow = resolvedColor(
    style.shadowColor,
    context.colors.hydro.label,
    'bathymetry relief shadow color',
  );
  contributions.push({
    kind: 'layer',
    layer: applyReliefRange(
      {
        id: 'streets-bathymetry-relief',
        type: 'hillshade',
        source: sourceId,
        paint: {
          'hillshade-accent-color': alpha(accent, opacity),
          'hillshade-exaggeration': resolvedNumber(
            style.exaggeration,
            0.18,
            'bathymetry relief exaggeration',
          ),
          'hillshade-highlight-color': alpha(highlight, opacity),
          'hillshade-illumination-altitude': altitudes,
          'hillshade-illumination-anchor': style.illuminationAnchor ?? 'map',
          'hillshade-illumination-direction': directions,
          'hillshade-method': multidirectional ? 'multidirectional' : 'igor',
          'hillshade-shadow-color': alpha(shadow, opacity),
          resampling: 'linear',
        },
      },
      style,
    ),
    localOrder: 4,
    owner: 'water',
    slot: 'hydro',
    target: 'water.bathymetryRelief.hillshade',
  });
}

function applyReliefRange<TLayer extends Record<string, unknown> & {id: string; type: string}>(
  layer: TLayer,
  style: TileflowBathymetryReliefConfig,
): TLayer {
  return {
    ...layer,
    ...(style.minZoom === undefined ? {} : {minzoom: style.minZoom}),
    ...(style.maxZoom === undefined ? {} : {maxzoom: style.maxZoom}),
  };
}

function resolvedNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Expected resolved numeric ${label}.`);
  }
  return value;
}

function resolvedColor(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new TypeError(`Expected resolved ${label}.`);
  return value;
}

function bathymetryDepthStops(depth: {
  m0: string;
  m200: string;
  m2000: string;
  m7000: string;
}): Array<number | string> {
  return [
    -11_000,
    depth.m7000,
    -8_000,
    mix(depth.m2000, depth.m7000, 2 / 3),
    -6_000,
    mix(depth.m2000, depth.m7000, 4 / 9),
    -4_000,
    mix(depth.m2000, depth.m7000, 2 / 9),
    -2_000,
    depth.m2000,
    -1_000,
    mix(depth.m200, depth.m2000, 4 / 9),
    -500,
    mix(depth.m200, depth.m2000, 1 / 6),
    -200,
    depth.m200,
    -100,
    mix(depth.m0, depth.m200, 1 / 2),
    -50,
    mix(depth.m0, depth.m200, 1 / 4),
    -20,
    mix(depth.m0, depth.m200, 1 / 10),
    -10,
    mix(depth.m0, depth.m200, 1 / 20),
    0,
    depth.m0,
  ];
}

function classFilter(field: string, classes: readonly string[]): unknown[] {
  return ['match', ['get', field], classes, true, false];
}
