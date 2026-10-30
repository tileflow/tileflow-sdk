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
import {
  tileflowNauticalLightEclipseOpacity,
  tileflowNauticalLightStateRead,
} from '../../nautical-lights';
import type {TileflowResolvedModuleConfig} from '../resolved';
import {
  type TileflowNauticalModuleConfig,
  tileflowNauticalFacilityIcons,
  tileflowNauticalImageRoles,
} from './index';

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
/** Navigation-area classes drawn by their own groups instead of as generic navigation areas. */
const ownAreaClasses = ['berth', 'bridge', 'facility', 'harbour'] as const;
/** Aid classes drawn by their own groups instead of as other aids. */
const ownAidClasses = ['distance-mark', 'notice'] as const;
/** Harbour subclasses that make a harbour a marina. */
const marinaSubclasses = ['marina', 'marina-no-facilities'] as const;
/**
 * Notice boards follow the CEVNI sign colours: red-bordered prohibitions, regulations and
 * restrictions, green recommendations, and blue information.
 */
const noticeFunctionColours = Object.freeze({
  information: markColours.blue!,
  prohibition: markColours.red!,
  recommendation: markColours.green!,
  regulation: markColours.red!,
  restriction: markColours.red!,
});
const distanceUnits = Object.freeze({
  hectometres: 'hm',
  kilometres: 'km',
  metres: 'm',
  'nautical-miles': 'NM',
  'statute-miles': 'mi',
});
/** Alternating lights show at most this many colours from their `color` list. */
const maxAlternatingColours = 3;

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
  const animateLights = request?.animateLights !== false;
  // An alternating light shows the colour its runtime state selects; steady lights show the first.
  const flareColour = expression<string>(
    colourMatch(
      animateLights
        ? nthColour(fields.color, tileflowNauticalLightStateRead('colour', 0))
        : firstColour(fields.color),
      lightColours,
      lightColours.white!,
    ),
  );
  const iconPaint = {color: markColour, haloColor: ink, haloWidth: 1};
  const noticeColours = [
    'match',
    ['get', fields.subclass],
    ...Object.entries(noticeFunctionColours).flat(),
    ink,
  ];
  const noticeColour = expression<string>(noticeColours);
  const distanceOpacity = (installed: number, notInstalled: number) =>
    expression<number>([
      'match',
      ['get', fields.category],
      'not-installed',
      notInstalled,
      installed,
    ]);
  const isGuestBerth = listIncludes(fields.subclass, 'guest');

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
    harbourAreas: {
      fill: {color: ink, minZoom: 10, opacity: 0.05},
      outline: {
        color: ink,
        minZoom: 10,
        opacity: zoom.linear([
          [10, 0.35],
          [14, 0.6],
        ]),
        width: zoom.linear([
          [10, 0.5],
          [16, 1],
        ]),
      },
    },
    berths: {
      fill: {color: ink, minZoom: 13, opacity: 0.06},
      outline: {
        color: ink,
        minZoom: 13,
        opacity: expression<number>(['case', isGuestBerth, 0.95, 0.5]),
        width: expression<number>([
          'interpolate',
          ['linear'],
          ['zoom'],
          13,
          ['case', isGuestBerth, 1.2, 0.6],
          16,
          ['case', isGuestBerth, 2.4, 1.2],
        ]),
      },
    },
    bridges: {
      fill: {color: colors.land, minZoom: 12, opacity: 0.9},
      outline: {
        color: ink,
        minZoom: 12,
        opacity: 0.85,
        width: zoom.linear([
          [12, 0.8],
          [16, 1.8],
        ]),
      },
    },
    overheadCables: {
      color: accent,
      dash: [6, 2, 1, 2],
      minZoom: 10,
      opacity: 0.75,
      width: zoom.linear([
        [10, 0.7],
        [16, 1.3],
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
      ...rankPriority,
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
    notices: {
      minZoom: 12,
      placement: 'point',
      ...rankPriority,
      ...(images.notices
        ? {
            icon: {
              color: noticeColour,
              haloColor: halo,
              haloWidth: 1,
              image: images.notices,
              padding: 1,
              size: zoom.linear([
                [12, 0.8],
                [16, 1.2],
              ]),
            },
          }
        : {
            marker: {
              color: expression<string>([
                'match',
                ['get', fields.subclass],
                ['prohibition', 'recommendation', 'information'],
                noticeColours,
                halo,
              ]),
              radius: zoom.linear([
                [12, 1.8],
                [16, 3.2],
              ]),
              strokeColor: expression<string>([
                'match',
                ['get', fields.subclass],
                ['prohibition', 'recommendation', 'information'],
                halo,
                noticeColours,
              ]),
              strokeWidth: 1,
            },
          }),
      text: {
        ...markText,
        ...sideLabel,
        field: expression<string>([
          'step',
          ['zoom'],
          '',
          14,
          ['to-string', ['coalesce', ['get', fields.information], '']],
        ]),
        padding: 2,
        size: 9,
      },
    },
    distanceMarks: {
      minZoom: 11,
      placement: 'point',
      ...rankPriority,
      ...(images.distanceMarks
        ? {
            icon: {
              color: ink,
              haloColor: halo,
              haloWidth: 1,
              image: images.distanceMarks,
              opacity: distanceOpacity(1, 0.6),
              size: zoom.linear([
                [11, 0.7],
                [16, 1],
              ]),
            },
          }
        : {
            marker: {
              color: ink,
              opacity: distanceOpacity(1, 0.6),
              radius: zoom.linear([
                [11, 1.2],
                [16, 2.2],
              ]),
              strokeColor: halo,
              strokeWidth: 0.8,
            },
          }),
      text: {
        ...markText,
        ...sideLabel,
        field: expression<string>([
          'step',
          ['zoom'],
          '',
          13,
          [
            'case',
            ['has', fields.distance],
            [
              'concat',
              ['to-string', ['get', fields.distance]],
              [
                'match',
                ['get', fields.distanceUnit],
                ...Object.entries(distanceUnits).flatMap(([unit, label]) => [unit, ` ${label}`]),
                '',
              ],
            ],
            '',
          ],
        ]),
        opacity: distanceOpacity(1, 0.75),
        padding: 2,
        size: zoom.linear([
          [13, 8.5],
          [16, 10],
        ]),
      },
    },
    facilities: {
      minZoom: 13,
      placement: 'point',
      ...(images.facilities
        ? {
            icon: {
              color: ink,
              haloColor: halo,
              haloWidth: 1,
              image: images.facilities,
              padding: 1,
              size: zoom.linear([
                [13, 0.8],
                [16, 1.15],
              ]),
            },
          }
        : {
            marker: {
              color: halo,
              radius: zoom.linear([
                [13, 1.8],
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
      bridges: {
        minZoom: 13,
        placement: 'point',
        text: {
          ...markText,
          field: expression<string>(bridgeClearance()),
          padding: 2,
          size: zoom.linear([
            [13, 8.5],
            [16, 10],
          ]),
        },
      },
      overheadCables: {
        minZoom: 12,
        placement: 'point',
        spacing: 360,
        text: {
          ...markText,
          color: accent,
          field: expression<string>(cableClearance()),
          maxAngle: 30,
          padding: 2,
          size: 8.5,
        },
      },
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
  const ofClass = (value: string) => ['==', ['get', fields.class], value];

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
    filter: ['all', polygons, ['match', ['get', fields.class], [...ownAreaClasses], false, true]],
    id: 'tileflow-nautical-navigation-areas',
    localOrder: 390,
    sourceLayer: layers.navigationAreas,
    style: config.navigationAreas,
    target: 'nautical.navigationAreas',
  });
  add({
    filter: ['all', polygons, ofClass('harbour')],
    id: 'tileflow-nautical-harbour-areas',
    localOrder: 392,
    sourceLayer: layers.navigationAreas,
    style: config.harbourAreas,
    target: 'nautical.harbourAreas',
  });
  add({
    filter: ['all', polygons, ofClass('berth')],
    id: 'tileflow-nautical-berths',
    localOrder: 394,
    outlineFilter: ['all', linesOrPolygons, ofClass('berth')],
    sourceLayer: layers.navigationAreas,
    style: config.berths,
    target: 'nautical.berths',
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
    filter: linesOf(['overhead-cable']),
    id: 'tileflow-nautical-overhead-cables',
    line: true,
    localOrder: 408,
    sourceLayer: layers.navigationAreas,
    style: config.overheadCables,
    target: 'nautical.overheadCables',
  });
  add({
    filter: polygons,
    id: 'tileflow-nautical-hazard-areas',
    localOrder: 410,
    outlineFilter: linesOrPolygons,
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
  add({
    // Bridges draw over the water and the areas below them.
    filter: ['all', polygons, ofClass('bridge')],
    id: 'tileflow-nautical-bridges',
    localOrder: 424,
    outlineFilter: ['all', linesOrPolygons, ofClass('bridge')],
    sourceLayer: layers.navigationAreas,
    style: config.bridges,
    target: 'nautical.bridges',
  });

  for (const [key, id, sourceLayer, localOrder, filter] of [
    [
      'coverage',
      'tileflow-nautical-coverage-labels',
      layers.coverage,
      560,
      ['has', fields.provider],
    ],
    [
      'navigationAreas',
      'tileflow-nautical-navigation-area-labels',
      layers.navigationAreas,
      562,
      // Harbours, facilities and bridges carry their own symbols and labels.
      [
        'all',
        ['has', fields.name],
        ['match', ['get', fields.class], ['bridge', 'facility', 'harbour'], false, true],
      ],
    ],
    ['reefs', 'tileflow-nautical-reef-labels', layers.reefs, 564, ['has', fields.name]],
    ['hazards', 'tileflow-nautical-hazard-area-labels', layers.hazards, 566, ['has', fields.name]],
    ['wrecks', 'tileflow-nautical-wreck-area-labels', layers.wrecks, 568, ['has', fields.name]],
  ] as const) {
    add({
      filter: ['all', polygons, filter],
      id,
      localOrder,
      sourceLayer,
      style: config.labels?.[key],
      target: `nautical.labels.${key}`,
    });
  }
  add({
    filter: [
      'all',
      ofClass('bridge'),
      [
        'any',
        ['has', fields.verticalClearance],
        ['has', fields.verticalClearanceClosed],
        ['has', fields.verticalClearanceOpen],
      ],
    ],
    id: 'tileflow-nautical-bridge-labels',
    lines: {localOrder: 557, placement: 'line-center'},
    localOrder: 556,
    sourceLayer: layers.navigationAreas,
    style: config.labels?.bridges,
    target: 'nautical.labels.bridges',
  });
  add({
    filter: [
      'all',
      ofClass('overhead-cable'),
      ['any', ['has', fields.verticalClearanceSafe], ['has', fields.verticalClearance]],
    ],
    id: 'tileflow-nautical-overhead-cable-labels',
    lines: {localOrder: 559, placement: 'line'},
    localOrder: 558,
    sourceLayer: layers.navigationAreas,
    style: config.labels?.overheadCables,
    target: 'nautical.labels.overheadCables',
  });

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
    filter: ofClass('facility'),
    id: 'tileflow-nautical-facilities',
    lines: {localOrder: 580, placement: 'line-center'},
    localOrder: 576,
    markerFilter: points,
    sourceLayer: layers.navigationAreas,
    style: config.facilities,
    target: 'nautical.facilities',
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
    // Harbour polygons, such as marinas, carry their symbol and name at their centre.
    filter: ['all', pointsOrPolygons, ofClass('harbour')],
    id: 'tileflow-nautical-harbours',
    localOrder: 582,
    markerFilter: points,
    sourceLayer: layers.navigationAreas,
    style: config.harbours,
    target: 'nautical.harbours',
  });
  add({
    filter: ['all', points, ofClass('distance-mark')],
    id: 'tileflow-nautical-distance-marks',
    localOrder: 584,
    sourceLayer: layers.aids,
    style: config.distanceMarks,
    target: 'nautical.distanceMarks',
  });
  add({
    filter: [
      'all',
      points,
      [
        'match',
        ['get', fields.class],
        [...floatingAidClasses, ...fixedAidClasses, ...ownAidClasses, 'lighthouse'],
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
    filter: ['all', points, ofClass('notice')],
    id: 'tileflow-nautical-notices',
    localOrder: 588,
    sourceLayer: layers.aids,
    style: config.notices,
    target: 'nautical.notices',
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
    flash: animateLights,
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
    filter: ['all', points, ofClass('lighthouse')],
    id: 'tileflow-nautical-lighthouses',
    localOrder: 602,
    sourceLayer: layers.aids,
    style: config.lighthouses,
    target: 'nautical.lighthouses',
  });
  add({
    filter: ['all', points, ofClass('port')],
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
const lines = ['==', ['geometry-type'], 'LineString'];
const pointsOrPolygons = ['match', ['geometry-type'], ['Point', 'Polygon'], true, false];
const linesOrPolygons = ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false];

function linesOf(classes: readonly string[]): unknown[] {
  return ['all', lines, ['match', ['get', fields.class], [...classes], true, false]];
}

/** Whether a comma-separated list field names `item` exactly. */
function listIncludes(field: string, item: string): unknown[] {
  return ['in', `,${item},`, ['concat', ',', ['to-string', ['coalesce', ['get', field], '']], ',']];
}

/** A feature appears from its own `min_zoom`, never earlier than its producer intended. */
const fromFeatureMinZoom = ['>=', ['zoom'], ['to-number', ['get', fields.minZoom], 0]];

type NauticalLayerOptions = {
  filter: unknown[];
  /** Light layers multiply their opacity by the light's runtime intensity. */
  flash?: boolean;
  id: string;
  /** The style is one line style rather than an area, point, or label style. */
  line?: boolean;
  /**
   * Symbols for line features in a sibling layer with a line placement; the main symbol layer
   * then keeps points and polygons.
   */
  lines?: {localOrder: number; placement: 'line' | 'line-center'};
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
    const marker = applyCircleStyle(
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
    );
    contributions.push(
      nauticalContribution(
        `${options.target}.marker`,
        options.localOrder,
        options.flash ? flashing(marker, ['circle-opacity', 'circle-stroke-opacity']) : marker,
        'symbols',
      ),
    );
  }

  const hasText = Boolean(point.text && point.text.visible !== false);
  const hasIcon = Boolean(point.icon && point.icon.visible !== false);
  if (!hasText && !hasIcon) return;
  const symbolFilter = [
    options.filter,
    ...(options.symbolFilter ? [options.symbolFilter] : []),
    ...(options.lines ? [['!=', ['geometry-type'], 'LineString']] : []),
  ];
  const symbol = applySymbolStyle(
    base(
      options.id,
      'symbol',
      symbolFilter.length === 1 ? (symbolFilter[0]! as unknown[]) : ['all', ...symbolFilter],
    ),
    withoutMarker(point),
  );
  contributions.push(
    nauticalContribution(
      isLabel ? options.target : `${options.target}.symbol`,
      options.localOrder + (isLabel ? 0 : 1),
      options.flash && hasIcon ? flashing(symbol, ['icon-opacity']) : symbol,
      'symbols',
    ),
  );
  if (options.lines) {
    contributions.push(
      nauticalContribution(
        `${options.target}.lines`,
        options.lines.localOrder,
        applySymbolStyle(
          base(`${options.id}-lines`, 'symbol', [
            'all',
            options.filter,
            ...(options.symbolFilter ? [options.symbolFilter] : []),
            lines,
          ]),
          {...withoutMarker(point), placement: options.lines.placement},
        ),
        'symbols',
      ),
    );
  }
}

/**
 * Multiply the opacities of a light layer by the light's runtime intensity: an eclipsed light
 * keeps a faint trace, and a light without runtime state shows exactly as it is styled.
 */
function flashing(layer: Layer, properties: readonly string[]): Layer {
  const paint = {...((layer.paint as Record<string, unknown> | undefined) ?? {})};
  const factor = [
    'interpolate',
    ['linear'],
    tileflowNauticalLightStateRead('intensity', 1),
    0,
    tileflowNauticalLightEclipseOpacity,
    1,
    1,
  ];
  for (const property of properties) {
    const value = paint[property];
    if (property !== 'circle-opacity' && property !== 'icon-opacity' && value === undefined) {
      continue;
    }
    paint[property] = scaleOutputs(value ?? 1, factor);
  }
  return {...layer, paint};
}

/** Multiply a paint value by `factor`, inside each output of a top-level zoom curve. */
function scaleOutputs(value: unknown, factor: unknown[]): unknown {
  if (Array.isArray(value) && isZoomCurve(value)) {
    const firstOutput = value[0] === 'step' ? 2 : 4;
    return value.map((entry, index) =>
      index >= firstOutput && (index - firstOutput) % 2 === 0 ? ['*', entry, factor] : entry,
    );
  }
  return ['*', value, factor];
}

function isZoomCurve(value: readonly unknown[]): boolean {
  const isZoom = (input: unknown) => Array.isArray(input) && input[0] === 'zoom';
  if (value[0] === 'step') return isZoom(value[1]);
  return (
    (value[0] === 'interpolate' ||
      value[0] === 'interpolate-hcl' ||
      value[0] === 'interpolate-lab') &&
    isZoom(value[2])
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
  const notice = images.notices;
  if (typeof notice === 'string') {
    const variants = (
      ['information', 'prohibition', 'recommendation', 'regulation', 'restriction'] as const
    ).flatMap((role) => [role, context.images[roles.notices[role]] ?? notice]);
    images.notices = expression<string>(['match', ['get', fields.subclass], ...variants, notice]);
  }
  const facility = images.facilities;
  if (typeof facility === 'string') {
    // The first listed category with its own icon, in the order of the priority list.
    const cases = tileflowNauticalFacilityIcons.flatMap((category) => {
      const image = context.images[roles.facilities[category]];
      if (!image || image === facility) return [];
      const categories =
        category === 'visitor-berth' ? ['visitor-berth', 'visitors-mooring'] : [category];
      return [['any', ...categories.map((name) => listIncludes(fields.subclass, name))], image];
    });
    if (cases.length > 0) images.facilities = expression<string>(['case', ...cases, facility]);
  }
  const harbour = images.harbours;
  const marina = context.images[roles.harbours.marina];
  if (typeof harbour === 'string' && marina && marina !== harbour) {
    images.harbours = expression<string>([
      'case',
      ['any', ...marinaSubclasses.map((name) => listIncludes(fields.subclass, name))],
      marina,
      harbour,
    ]);
  }
  return images;
}

/** `vertical_clearance`, or the clearance closed and open of an opening bridge, in metres. */
function bridgeClearance(): unknown[] {
  const metres = (field: string) => ['concat', ['to-string', ['get', field]], ' m'];
  const closed = fields.verticalClearanceClosed;
  const open = fields.verticalClearanceOpen;
  return [
    'case',
    ['any', ['has', closed], ['has', open]],
    [
      'concat',
      ['case', ['has', closed], ['concat', 'closed ', metres(closed)], ''],
      ['case', ['all', ['has', closed], ['has', open]], ' · ', ''],
      ['case', ['has', open], ['concat', 'open ', metres(open)], ''],
    ],
    ['has', fields.verticalClearance],
    ['concat', 'clearance ', metres(fields.verticalClearance)],
    '',
  ];
}

/** The safe vertical clearance of an overhead cable, or its clearance, in metres. */
function cableClearance(): unknown[] {
  return [
    'case',
    ['has', fields.verticalClearanceSafe],
    ['concat', 'safe clearance ', ['to-string', ['get', fields.verticalClearanceSafe]], ' m'],
    ['has', fields.verticalClearance],
    ['concat', 'clearance ', ['to-string', ['get', fields.verticalClearance]], ' m'],
    '',
  ];
}

/**
 * The colour name at `index` in a comma-separated S-57 colour list, falling back to the first
 * name; `index` is an expression such as an alternating light's runtime colour.
 */
function nthColour(field: string, index: unknown[]): unknown[] {
  const list = ['var', 'nauticalColours'];
  const cases: unknown[] = [];
  for (let position = 1; position < maxAlternatingColours; position += 1) {
    cases.push(['==', ['var', 'nauticalColourIndex'], position], nthName(list, position));
  }
  return [
    'let',
    'nauticalColours',
    ['to-string', ['coalesce', ['get', field], '']],
    'nauticalColourIndex',
    index,
    ['case', ...cases, leadingName(list)],
  ];
}

/** The name at `position` in a comma-separated list, or an empty string. */
function nthName(list: unknown[], position: number): unknown[] {
  if (position === 0) return leadingName(list);
  const rest = `nauticalRest${position}`;
  return [
    'let',
    rest,
    [
      'let',
      'nauticalComma',
      ['index-of', ',', list],
      [
        'case',
        ['<', ['var', 'nauticalComma'], 0],
        '',
        ['slice', list, ['+', ['var', 'nauticalComma'], 1]],
      ],
    ],
    nthName(['var', rest], position - 1),
  ];
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
