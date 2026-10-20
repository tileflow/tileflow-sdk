import {type TileflowDomainCompileContext, typographyTextStyle} from '../../cartography/context';
import type {TileflowLayerContribution} from '../../cartography/contributions';
import {
  applyCircleStyle,
  applyFillStyle,
  applyLineStyle,
  applySymbolStyle,
} from '../../cartography/layer-style';
import {mergeTileflowDesign} from '../../cartography/merge';
import type {
  TileflowAreaStyle,
  TileflowLineStyle,
  TileflowMarkerSymbolStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';
import {expression, type TileflowExpression, zoom} from '../../cartography/values';
import {tileflowNauticalV1Schema} from '../../marine';
import type {TileflowResolvedModuleConfig} from '../resolved';
import {type TileflowNauticalModuleConfig, tileflowNauticalImageRoles} from './index';

type Layer = Record<string, unknown> & {id: string; type: string};

const {fields, layers} = tileflowNauticalV1Schema;

/** Display colours for S-57 colour names. Marks keep their conventional colours in every theme. */
const markColours: Readonly<Record<string, string>> = Object.freeze({
  amber: '#F2A10A',
  black: '#1F2328',
  blue: '#2D6CDF',
  brown: '#8A5A2E',
  green: '#1E9E57',
  grey: '#8C939A',
  magenta: '#C2398F',
  orange: '#EF7D1A',
  pink: '#EE8AB8',
  red: '#D3313A',
  violet: '#8456C9',
  white: '#FFFFFF',
  yellow: '#F5C518',
});

/** Light flares follow electronic-chart practice: a white light is drawn as a warm yellow. */
const lightColours: Readonly<Record<string, string>> = Object.freeze({
  ...markColours,
  white: '#F7D046',
});

const floatingAidClasses = ['buoy', 'light-float', 'light-vessel'] as const;
const fixedAidClasses = ['beacon', 'daymark'] as const;
const portLateralCategories = ['port', 'preferred-channel-port', 'waterway-left'] as const;
const starboardLateralCategories = [
  'preferred-channel-starboard',
  'starboard',
  'waterway-right',
] as const;
/** Rocks that show at some state of the tide are drawn as a star, submerged rocks as a cross. */
const exposedWaterLevels = ['above-mean-water', 'awash', 'covers', 'dry'] as const;
const dangerousWreckClasses = ['dangerous', 'hull-showing', 'mast-showing'] as const;
/** Areas whose dashed outline carries operational meaning, drawn in the theme's chart accent. */
const operationalAreaClasses = [
  'anchor-berth',
  'anchorage',
  'dumping-ground',
  'military',
  'restricted',
  'traffic-separation',
] as const;
const routeClasses = ['route', 'traffic-separation'] as const;
const cableClasses = ['cable', 'cable-area', 'pipeline', 'pipeline-area'] as const;
const portSizes = ['large', 'medium', 'small', 'very-small'] as const;

export function compileNautical(
  request: TileflowResolvedModuleConfig<TileflowNauticalModuleConfig> | undefined,
  context: TileflowDomainCompileContext,
): TileflowLayerContribution[] {
  const nauticalSource = context.marine?.nautical;
  if (!nauticalSource || request?.enabled === false) return [];

  const colors = context.colors;
  const ink = colors.hydro.label;
  const halo = colors.hydro.water;
  const accent = colors.poi.transport;
  const chartText = {
    ...typographyTextStyle(context.typography.water),
    color: ink,
    haloColor: halo,
    haloWidth: 1.2,
  };
  const markText = {
    ...typographyTextStyle(context.typography.poi),
    color: ink,
    haloColor: halo,
    haloWidth: 1.2,
    transform: 'none' as const,
  };
  const images = themedImages(context);
  const rankPriority = {
    priority: expression<number>(['coalesce', ['get', fields.rank], 9]),
    priorityOrder: 'lower-first' as const,
  };
  const nameFrom = (minZoom: number) =>
    expression<string>(['step', ['zoom'], '', minZoom, ['coalesce', ['get', fields.name], '']]);
  const sideLabel = {anchor: 'left' as const, offset: [0.85, 0] as const, optional: true};
  const belowLabel = {anchor: 'top' as const, offset: [0, 0.75] as const, optional: true};

  const markColour = expression<string>(colourMatch(firstColour(fields.color), markColours, ink));
  const markStroke = expression<string>(colourMatch(secondColour(fields.color), markColours, ink));
  const flareColour = expression<string>(
    colourMatch(firstColour(fields.color), lightColours, lightColours.white!),
  );
  const iconPaint = {color: markColour, haloColor: ink, haloWidth: 1};

  const defaults: TileflowResolvedModuleConfig<TileflowNauticalModuleConfig> = {
    type: 'nautical',
    enabled: true,
    // Coverage cells are square tiles; a faint seamless tint before marks appear avoids a grid.
    coverage: {
      fill: {
        antialias: false,
        color: ink,
        maxZoom: 8,
        opacity: zoom.linear([
          [0, 0.06],
          [5, 0.045],
          [8, 0],
        ]),
      },
    },
    navigationAreas: {
      fill: {
        color: accent,
        minZoom: 7,
        opacity: expression<number>([
          'match',
          ['get', fields.class],
          'traffic-separation',
          0.08,
          ['military', 'restricted', 'dumping-ground'],
          0.05,
          0,
        ]),
      },
      outline: {
        color: expression<string>([
          'match',
          ['get', fields.class],
          [...operationalAreaClasses],
          accent,
          ink,
        ]),
        dash: [4, 2],
        minZoom: 7,
        opacity: expression<number>([
          'interpolate',
          ['linear'],
          ['zoom'],
          7,
          ['match', ['get', fields.class], [...operationalAreaClasses], 0.55, 0],
          10,
          ['match', ['get', fields.class], [...operationalAreaClasses], 0.75, 0],
          12,
          ['match', ['get', fields.class], [...operationalAreaClasses], 0.85, 0.4],
        ]),
        width: zoom.linear([
          [7, 0.6],
          [14, 1.2],
        ]),
      },
    },
    reefs: {
      fill: {color: colors.landcover.sand, minZoom: 6, opacity: 0.32},
      outline: {color: ink, dash: [1.5, 1.5], minZoom: 6, opacity: 0.6, width: 0.8},
    },
    cables: {
      color: accent,
      dash: [2, 2],
      minZoom: 8,
      opacity: zoom.linear([
        [8, 0.3],
        [12, 0.6],
      ]),
      width: zoom.linear([
        [8, 0.6],
        [14, 1],
      ]),
    },
    routes: {
      color: expression<string>([
        'match',
        ['get', fields.class],
        'traffic-separation',
        accent,
        ink,
      ]),
      dash: [5, 3],
      minZoom: 8,
      opacity: 0.72,
      width: zoom.linear([
        [8, 0.6],
        [14, 1.3],
      ]),
    },
    hazardAreas: {
      fill: {color: accent, minZoom: 10, opacity: 0.08},
      outline: {color: accent, dash: [1, 1], minZoom: 10, opacity: 0.7, width: 0.8},
    },
    wreckAreas: {
      fill: {color: ink, minZoom: 11, opacity: 0.08},
      outline: {color: ink, dash: [2, 1], minZoom: 11, opacity: 0.6, width: 0.75},
    },
    soundings: {
      minZoom: 12,
      placement: 'point',
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
        transform: 'none',
      },
    },
    hazards: {
      minZoom: 8,
      placement: 'point',
      marker: {
        color: expression<string>([
          'match',
          ['get', fields.class],
          'offshore-platform',
          ink,
          'rgba(0, 0, 0, 0)',
        ]),
        radius: zoom.linear([
          [8, 2.2],
          [16, 3.6],
        ]),
        strokeColor: ink,
        strokeWidth: 1.1,
      },
      text: {
        ...markText,
        field: expression<string>([
          'match',
          ['get', fields.waterLevel],
          [...exposedWaterLevels],
          '*',
          '+',
        ]),
        haloWidth: 1,
        offset: expression<number[]>([
          'match',
          ['get', fields.waterLevel],
          [...exposedWaterLevels],
          ['literal', [0, 0.25]],
          ['literal', [0, 0]],
        ]),
        optional: false,
        padding: 1,
        size: zoom.linear([
          [12, 11],
          [16, 14],
        ]),
      },
    },
    wrecks: {
      minZoom: 11,
      placement: 'point',
      ...(images.wrecks
        ? {
            icon: {
              color: ink,
              haloColor: halo,
              haloWidth: 1,
              image: images.wrecks,
              opacity: expression<number>([
                'match',
                ['get', fields.class],
                [...dangerousWreckClasses],
                1,
                0.65,
              ]),
              size: zoom.linear([
                [11, 1],
                [16, 1.4],
              ]),
            },
            text: {...markText, ...sideLabel, field: nameFrom(14), padding: 4, size: 9},
          }
        : {
            text: {
              ...markText,
              color: expression<string>([
                'match',
                ['get', fields.class],
                [...dangerousWreckClasses],
                accent,
                ink,
              ]),
              field: 'Wk',
              optional: false,
              padding: 3,
              size: 10,
            },
          }),
    },
    harbours: {
      minZoom: 11,
      placement: 'point',
      ...(images.harbours
        ? {
            icon: {
              color: ink,
              haloColor: halo,
              haloWidth: 1,
              image: images.harbours,
              size: zoom.linear([
                [11, 0.9],
                [16, 1.3],
              ]),
            },
          }
        : {
            marker: {
              color: ink,
              radius: zoom.linear([
                [11, 2.2],
                [16, 3.6],
              ]),
              strokeColor: halo,
              strokeWidth: 1,
            },
          }),
      text: {...markText, ...belowLabel, field: nameFrom(12), padding: 4, size: 10},
    },
    aids: {
      minZoom: 11,
      placement: 'point',
      ...rankPriority,
      ...(images.aids
        ? {
            icon: {
              ...iconPaint,
              image: images.aids,
              size: zoom.linear([
                [11, 0.8],
                [16, 1.2],
              ]),
            },
          }
        : {
            marker: {
              color: halo,
              radius: zoom.linear([
                [11, 1.8],
                [16, 3],
              ]),
              strokeColor: ink,
              strokeWidth: 1,
            },
          }),
      text: {...markText, ...sideLabel, field: nameFrom(15), padding: 3, size: 9},
    },
    beacons: {
      minZoom: 11,
      placement: 'point',
      ...rankPriority,
      ...(images.beacons
        ? {
            icon: {
              ...iconPaint,
              image: images.beacons,
              size: zoom.linear([
                [11, 0.8],
                [16, 1.2],
              ]),
            },
          }
        : {
            marker: {
              color: markColour,
              radius: zoom.linear([
                [11, 1.8],
                [16, 3.4],
              ]),
              strokeColor: markStroke,
              strokeWidth: 1,
            },
          }),
      text: {...markText, ...sideLabel, field: nameFrom(14), padding: 3, size: 9},
    },
    lights: {
      minZoom: 6,
      placement: 'point',
      ...rankPriority,
      ...(images.lights
        ? {
            icon: {
              allowOverlap: true,
              color: flareColour,
              haloColor: halo,
              haloWidth: 0.5,
              ignorePlacement: true,
              image: images.lights,
              opacity: 0.9,
              size: byClassAndZoom([
                [6, 0.9, 0.65],
                [14, 1.6, 1.15],
              ]),
            },
          }
        : {
            marker: {
              color: flareColour,
              opacity: 0.55,
              radius: byClassAndZoom([
                [6, 3.2, 1.8],
                [14, 7, 4.5],
              ]),
            },
          }),
      text: {
        ...markText,
        ...sideLabel,
        field: expression<string>([
          'step',
          ['zoom'],
          '',
          10,
          [
            'case',
            ['==', ['get', fields.class], 'major'],
            ['coalesce', ['get', fields.label], ''],
            '',
          ],
          13,
          ['coalesce', ['get', fields.label], ''],
        ]),
        padding: 3,
        size: zoom.linear([
          [10, 9],
          [16, 10.5],
        ]),
      },
    },
    buoys: {
      minZoom: 8,
      placement: 'point',
      ...rankPriority,
      ...(images.buoys
        ? {
            icon: {
              ...iconPaint,
              // Dense harbours thin out by rank at low zooms instead of piling up.
              image: images.buoys,
              padding: 1,
              size: zoom.linear([
                [11, 1],
                [16, 1.5],
              ]),
            },
          }
        : {
            marker: {
              color: markColour,
              radius: zoom.linear([
                [8, 2.4],
                [16, 4.6],
              ]),
              strokeColor: markStroke,
              strokeWidth: 1.4,
            },
          }),
      text: {...markText, ...sideLabel, field: nameFrom(14), padding: 3, size: 9},
    },
    lighthouses: {
      minZoom: 8,
      placement: 'point',
      ...rankPriority,
      ...(images.lighthouses
        ? {
            icon: {
              allowOverlap: true,
              color: ink,
              haloColor: halo,
              haloWidth: 1,
              image: images.lighthouses,
              size: zoom.linear([
                [8, 1],
                [16, 1.6],
              ]),
            },
          }
        : {
            marker: {
              color: ink,
              radius: zoom.linear([
                [8, 2.6],
                [16, 4.8],
              ]),
              strokeColor: halo,
              strokeWidth: 1.2,
            },
          }),
      text: {
        ...markText,
        ...belowLabel,
        field: nameFrom(10),
        padding: 4,
        size: zoom.linear([
          [10, 9.5],
          [16, 11.5],
        ]),
      },
    },
    ports: {
      minZoom: 3,
      placement: 'point',
      ...rankPriority,
      ...(images.ports
        ? {
            icon: {
              color: ink,
              haloColor: halo,
              haloWidth: 1,
              image: images.ports,
              size: byPortSizeAndZoom([
                [3, [1.05, 0.95, 0.85, 0.75]],
                [12, [1.45, 1.35, 1.25, 1.15]],
              ]),
            },
          }
        : {
            marker: {
              color: ink,
              radius: byPortSizeAndZoom([
                [3, [3.2, 2.8, 2.4, 2]],
                [12, [5, 4.5, 4, 3.5]],
              ]),
              strokeColor: halo,
              strokeWidth: 1.2,
            },
          }),
      text: {
        ...markText,
        ...belowLabel,
        field: expression<string>(['coalesce', ['get', fields.name], '']),
        padding: 6,
        size: byPortSizeAndZoom([
          [3, [11, 10, 9.5, 9]],
          [12, [12.5, 11.5, 11, 10.5]],
        ]),
      },
    },
    labels: {
      coverage: {
        maxZoom: 9,
        minZoom: 4,
        placement: 'point',
        visible: false,
        text: {...chartText, field: expression<string>(['get', fields.provider]), size: 8},
      },
      hazards: {
        minZoom: 11,
        placement: 'point',
        text: {...markText, color: accent, field: expression<string>(['get', fields.name])},
      },
      navigationAreas: {
        minZoom: 11,
        placement: 'point',
        text: {
          ...markText,
          color: expression<string>([
            'match',
            ['get', fields.class],
            [...operationalAreaClasses],
            accent,
            ink,
          ]),
          field: expression<string>(['get', fields.name]),
          optional: true,
          padding: 8,
          size: 9.5,
        },
      },
      reefs: {
        minZoom: 11,
        placement: 'point',
        text: {...chartText, field: expression<string>(['get', fields.name]), size: 9},
      },
      wrecks: {
        minZoom: 12,
        placement: 'point',
        text: {...markText, field: expression<string>(['get', fields.name]), size: 9},
      },
    },
  };
  const config = mergeTileflowDesign<TileflowResolvedModuleConfig<TileflowNauticalModuleConfig>>(
    defaults,
    request,
  );

  const source = nauticalSource.sourceId;
  const contributions: TileflowLayerContribution[] = [];
  const add = (options: Omit<NauticalLayerOptions, 'source'>) =>
    appendNauticalLayer(contributions, {...options, source});

  add({
    // Only coverage that speaks for every family; lists of lights alone would double the tint.
    filter: ['all', polygons, ['in', layers.aids, ['coalesce', ['get', fields.families], '']]],
    id: 'tileflow-nautical-coverage',
    localOrder: 380,
    sourceLayer: layers.coverage,
    style: config.coverage,
    target: 'nautical.coverage',
  });
  add({
    filter: polygons,
    id: 'tileflow-nautical-navigation-areas',
    localOrder: 390,
    sourceLayer: layers.navigationAreas,
    style: config.navigationAreas,
    target: 'nautical.navigationAreas',
  });
  add({
    filter: polygons,
    id: 'tileflow-nautical-reefs',
    localOrder: 400,
    sourceLayer: layers.reefs,
    style: config.reefs,
    target: 'nautical.reefs',
  });
  add({
    filter: linesOf(cableClasses),
    id: 'tileflow-nautical-cables',
    line: true,
    localOrder: 404,
    sourceLayer: layers.navigationAreas,
    style: config.cables,
    target: 'nautical.cables',
  });
  add({
    filter: linesOf(routeClasses),
    id: 'tileflow-nautical-routes',
    line: true,
    localOrder: 406,
    sourceLayer: layers.navigationAreas,
    style: config.routes,
    target: 'nautical.routes',
  });
  add({
    filter: polygons,
    id: 'tileflow-nautical-hazard-areas',
    localOrder: 410,
    outlineFilter: ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false],
    sourceLayer: layers.hazards,
    style: config.hazardAreas,
    target: 'nautical.hazardAreas',
  });
  add({
    filter: polygons,
    id: 'tileflow-nautical-wreck-areas',
    localOrder: 420,
    sourceLayer: layers.wrecks,
    style: config.wreckAreas,
    target: 'nautical.wreckAreas',
  });

  for (const [key, id, sourceLayer, localOrder] of [
    ['coverage', 'tileflow-nautical-coverage-labels', layers.coverage, 560],
    ['navigationAreas', 'tileflow-nautical-navigation-area-labels', layers.navigationAreas, 562],
    ['reefs', 'tileflow-nautical-reef-labels', layers.reefs, 564],
    ['hazards', 'tileflow-nautical-hazard-area-labels', layers.hazards, 566],
    ['wrecks', 'tileflow-nautical-wreck-area-labels', layers.wrecks, 568],
  ] as const) {
    add({
      filter: ['all', polygons, ['has', key === 'coverage' ? fields.provider : fields.name]],
      id,
      localOrder,
      sourceLayer,
      style: config.labels?.[key],
      target: `nautical.labels.${key}`,
    });
  }

  add({
    filter: ['all', points, ['has', fields.depth]],
    id: 'tileflow-nautical-soundings',
    localOrder: 570,
    sourceLayer: layers.soundings,
    style: config.soundings,
    target: 'nautical.soundings',
  });
  add({
    filter: points,
    id: 'tileflow-nautical-hazards',
    localOrder: 574,
    markerFilter: ['!=', ['get', fields.class], 'rock'],
    sourceLayer: layers.hazards,
    style: config.hazards,
    symbolFilter: ['==', ['get', fields.class], 'rock'],
    target: 'nautical.hazards',
  });
  add({
    filter: points,
    id: 'tileflow-nautical-wrecks',
    localOrder: 578,
    sourceLayer: layers.wrecks,
    style: config.wrecks,
    target: 'nautical.wrecks',
  });
  add({
    filter: ['all', points, ['==', ['get', fields.class], 'harbour']],
    id: 'tileflow-nautical-harbours',
    localOrder: 582,
    sourceLayer: layers.navigationAreas,
    style: config.harbours,
    target: 'nautical.harbours',
  });
  add({
    filter: [
      'all',
      points,
      [
        'match',
        ['get', fields.class],
        [...floatingAidClasses, ...fixedAidClasses, 'lighthouse'],
        false,
        true,
      ],
    ],
    id: 'tileflow-nautical-aids',
    localOrder: 586,
    sourceLayer: layers.aids,
    style: config.aids,
    target: 'nautical.aids',
  });
  add({
    filter: ['all', points, ['match', ['get', fields.class], [...fixedAidClasses], true, false]],
    id: 'tileflow-nautical-beacons',
    localOrder: 590,
    sourceLayer: layers.aids,
    style: config.beacons,
    target: 'nautical.beacons',
  });
  add({
    filter: points,
    id: 'tileflow-nautical-lights',
    localOrder: 594,
    sourceLayer: layers.lights,
    style: config.lights,
    target: 'nautical.lights',
  });
  add({
    filter: ['all', points, ['match', ['get', fields.class], [...floatingAidClasses], true, false]],
    id: 'tileflow-nautical-buoys',
    localOrder: 598,
    sourceLayer: layers.aids,
    style: config.buoys,
    target: 'nautical.buoys',
  });
  add({
    filter: ['all', points, ['==', ['get', fields.class], 'lighthouse']],
    id: 'tileflow-nautical-lighthouses',
    localOrder: 602,
    sourceLayer: layers.aids,
    style: config.lighthouses,
    target: 'nautical.lighthouses',
  });
  add({
    filter: ['all', points, ['==', ['get', fields.class], 'port']],
    id: 'tileflow-nautical-ports',
    localOrder: 606,
    sourceLayer: layers.navigationAreas,
    style: config.ports,
    target: 'nautical.ports',
  });
  return contributions;
}

const points = ['==', ['geometry-type'], 'Point'];
const polygons = ['==', ['geometry-type'], 'Polygon'];

function linesOf(classes: readonly string[]): unknown[] {
  return [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['match', ['get', fields.class], [...classes], true, false],
  ];
}

/** A feature appears from its own `min_zoom`, never earlier than its producer intended. */
const fromFeatureMinZoom = ['>=', ['zoom'], ['to-number', ['get', fields.minZoom], 0]];

type NauticalLayerOptions = {
  filter: unknown[];
  id: string;
  /** The style is one line style rather than an area, point, or label style. */
  line?: boolean;
  localOrder: number;
  /** Narrows a point group's circle marker. */
  markerFilter?: unknown[];
  /** Replaces an area's filter for its outline, which may also stroke lines. */
  outlineFilter?: unknown[];
  source: string;
  sourceLayer: string;
  style: TileflowAreaStyle | TileflowLineStyle | TileflowMarkerSymbolStyle | undefined;
  /** Narrows a point group's icon and text. */
  symbolFilter?: unknown[];
  target: string;
};

function appendNauticalLayer(
  contributions: TileflowLayerContribution[],
  options: NauticalLayerOptions,
): void {
  const style = options.style;
  if (!style) return;
  const base = (id: string, type: string, filter: unknown[]): Layer => ({
    id,
    type,
    source: options.source,
    'source-layer': options.sourceLayer,
    filter: ['all', filter, fromFeatureMinZoom],
  });

  if (options.line) {
    const line = style as TileflowLineStyle;
    if (line.visible === false) return;
    contributions.push(
      nauticalContribution(
        options.target,
        options.localOrder,
        applyLineStyle(base(options.id, 'line', options.filter), line),
        'hydro',
      ),
    );
    return;
  }

  if ('fill' in style || 'outline' in style) {
    const area = style as TileflowAreaStyle;
    if (area.fill && area.fill.visible !== false) {
      contributions.push(
        nauticalContribution(
          `${options.target}.fill`,
          options.localOrder,
          applyFillStyle(base(options.id, 'fill', options.filter), area.fill),
          'hydro',
        ),
      );
    }
    if (area.outline && area.outline.visible !== false) {
      contributions.push(
        nauticalContribution(
          `${options.target}.outline`,
          options.localOrder + 1,
          applyLineStyle(
            base(`${options.id}-outline`, 'line', options.outlineFilter ?? options.filter),
            area.outline,
          ),
          'hydro',
        ),
      );
    }
    return;
  }

  const point = style as TileflowMarkerSymbolStyle;
  if (point.visible === false) return;
  const isLabel = options.target.startsWith('nautical.labels.');
  if (!isLabel && point.marker && point.marker.visible !== false) {
    contributions.push(
      nauticalContribution(
        `${options.target}.marker`,
        options.localOrder,
        applyCircleStyle(
          base(
            `${options.id}-marker`,
            'circle',
            options.markerFilter ? ['all', options.filter, options.markerFilter] : options.filter,
          ),
          mergeTileflowDesign(
            {
              ...(point.maxZoom === undefined ? {} : {maxZoom: point.maxZoom}),
              ...(point.minZoom === undefined ? {} : {minZoom: point.minZoom}),
            },
            point.marker,
          ),
        ),
        'symbols',
      ),
    );
  }

  const hasText = Boolean(point.text && point.text.visible !== false);
  const hasIcon = Boolean(point.icon && point.icon.visible !== false);
  if (!hasText && !hasIcon) return;
  contributions.push(
    nauticalContribution(
      isLabel ? options.target : `${options.target}.symbol`,
      options.localOrder + (isLabel ? 0 : 1),
      applySymbolStyle(
        base(
          options.id,
          'symbol',
          options.symbolFilter ? ['all', options.filter, options.symbolFilter] : options.filter,
        ),
        withoutMarker(point),
      ),
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
  layer: Layer,
  slot: 'hydro' | 'symbols',
): TileflowLayerContribution {
  return {kind: 'layer', layer, localOrder, owner: 'nautical', slot, target};
}

type NauticalImages = Partial<
  Record<keyof typeof tileflowNauticalImageRoles, TileflowExpression<string> | string>
>;

/** Icon selections for the groups whose image tokens the selected theme declares. */
function themedImages(context: TileflowDomainCompileContext): NauticalImages {
  const roles = tileflowNauticalImageRoles;
  const images: NauticalImages = {};
  for (const group of Object.keys(roles) as (keyof typeof roles)[]) {
    const image = context.images[roles[group].default];
    if (image) images[group] = image;
  }
  const buoy = images.buoys;
  if (typeof buoy === 'string') {
    const port = context.images[roles.buoys.port] ?? buoy;
    const starboard = context.images[roles.buoys.starboard] ?? buoy;
    const cardinal = context.images[roles.buoys.cardinal] ?? buoy;
    images.buoys = expression<string>([
      'case',
      ['==', ['get', fields.subclass], 'cardinal'],
      cardinal,
      [
        'match',
        ['get', fields.category],
        [...portLateralCategories],
        port,
        [...starboardLateralCategories],
        starboard,
        buoy,
      ],
    ]);
  }
  return images;
}

/** The first name in a comma-separated S-57 colour list, or an empty string. */
function firstColour(field: string): unknown[] {
  return [
    'let',
    'nauticalColours',
    ['to-string', ['coalesce', ['get', field], '']],
    leadingName(['var', 'nauticalColours']),
  ];
}

/** The second name in a comma-separated S-57 colour list, or an empty string. */
function secondColour(field: string): unknown[] {
  return [
    'let',
    'nauticalColours',
    ['to-string', ['coalesce', ['get', field], '']],
    [
      'let',
      'nauticalComma',
      ['index-of', ',', ['var', 'nauticalColours']],
      [
        'case',
        ['<', ['var', 'nauticalComma'], 0],
        '',
        [
          'let',
          'nauticalRest',
          ['slice', ['var', 'nauticalColours'], ['+', ['var', 'nauticalComma'], 1]],
          leadingName(['var', 'nauticalRest']),
        ],
      ],
    ],
  ];
}

function leadingName(list: unknown[]): unknown[] {
  return [
    'let',
    'nauticalEnd',
    ['index-of', ',', list],
    ['case', ['<', ['var', 'nauticalEnd'], 0], list, ['slice', list, 0, ['var', 'nauticalEnd']]],
  ];
}

function colourMatch(
  name: unknown[],
  palette: Readonly<Record<string, string>>,
  fallback: string,
): unknown[] {
  return [
    'match',
    name,
    ...Object.entries(palette).flatMap(([colourName, value]) => [colourName, value]),
    fallback,
  ];
}

/** Major lights draw larger than minor lights at every zoom stop. */
function byClassAndZoom(
  stops: readonly (readonly [number, number, number])[],
): TileflowExpression<number> {
  return expression<number>([
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap(([stop, major, minor]) => [
      stop,
      ['match', ['get', fields.class], 'major', major, minor],
    ]),
  ]);
}

/** Port values in `large`, `medium`, `small`, `very-small` order at each zoom stop. */
function byPortSizeAndZoom(
  stops: readonly (readonly [number, readonly [number, number, number, number]])[],
): TileflowExpression<number> {
  return expression<number>([
    'interpolate',
    ['linear'],
    ['zoom'],
    ...stops.flatMap(([stop, values]) => [
      stop,
      [
        'match',
        ['get', fields.size],
        ...portSizes.flatMap((size, index) => [size, values[index]!]),
        values[3]!,
      ],
    ]),
  ]);
}
