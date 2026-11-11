import {
  defineMap,
  expr,
  field,
  landforms,
  refine,
  renderPass,
  reset,
  resolveMap,
  type TileflowMap,
  type TileflowRenderStackOperation,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  token,
  withRenderStack,
  zoom,
} from '@tileflow/core';
import {streetsIcons, terrainIcons} from '../assets';
import {streets} from './streets';
import {stackOf, withoutStack} from './streets-cartography';
import {streetsVisual} from './streets-themes';
import {terrainThemes, terrainVisual} from './terrain-themes';
import {bindOfficialMapTheme} from './theme-helpers';

const trailWidth = zoom.exponential(1.5, [
  [13, 0.5],
  [14, 1],
  [15, 1],
  [18, 4],
]);
const trailCasingWidth = zoom.exponential(1.5, [
  [15, 2],
  [18, 7],
]);

/** A pale, broken center over a continuous ochre casing keeps paths distinct from contour ink. */
function trail(
  color: typeof terrainVisual.trail,
  minZoom: number,
  dash: readonly number[],
  opacity = 1,
): TileflowRoadClassStyle {
  const fill = {
    cap: 'butt',
    color: terrainVisual.trailHalo,
    dash,
    minZoom,
    opacity,
    width: trailWidth,
  } as const;
  const casing = {
    color,
    dash: [1, 0],
    gapWidth: 0,
    minZoom,
    opacity,
    width: trailCasingWidth,
  } as const;
  return {
    bridge: {casing, fill},
    surface: {casing, fill},
    tunnel: {casing: {visible: false}, fill: {...fill, opacity: 0.45}},
  };
}

const peakName = {
  minZoom: 10,
  priority: 64,
  icon: {image: terrainVisual.peakIcon, size: 0.55, pitchAlignment: 'viewport'},
  text: {
    anchor: 'top',
    color: terrainVisual.peak,
    font: streetsVisual.font.navigation,
    haloColor: terrainVisual.halo,
    haloWidth: 0.65,
    optional: false,
    offset: [0, 0.8],
    size: zoom.linear([
      [10, 10.5],
      [15, 12],
    ]),
  },
} satisfies TileflowSymbolStyle;

const landformName = {
  ...peakName,
  minZoom: 12,
  priority: 40,
  icon: {visible: false},
  text: {
    ...peakName.text,
    anchor: 'center',
    font: streetsVisual.font.water,
    offset: [0, 0],
    size: 11,
  },
} satisfies TileflowSymbolStyle;

/** Streets recolors paths for urban parks; these classes keep their trail ink everywhere. */
const urbanPathRefinement = /^(?:footway|pathway|steps)-(?:bridge|surface)-(?:casing|fill)$/u;

function serviceRoadsOnly(pass: TileflowRenderStackOperation): TileflowRenderStackOperation {
  if (pass?.kind !== 'render-pass' || pass.selector?.kind !== 'all') return pass;
  const selectors = pass.selector.selectors.map((selector) =>
    selector.kind === 'in' && selector.field === 'class'
      ? {...selector, values: ['service']}
      : selector,
  );
  return {...pass, selector: {...pass.selector, selectors}} as TileflowRenderStackOperation;
}

function withTerrainStacks(base: TileflowMap) {
  const source = resolveMap(base);
  const {land, roads} = source.modules ?? {};
  if (!land || !roads) throw new Error('Terrain requires the Streets land and road modules');
  const terrainRoads = {...withoutStack(roads), classes: {...roads.classes}};
  // Preserve the surface filters while separating underground roads at overview scales.
  for (const roadClass of ['motorway', 'trunk', 'primary'] as const) {
    const road = terrainRoads.classes[roadClass];
    terrainRoads.classes[roadClass] = {
      ...road,
      surface: {
        ...road?.surface,
        fill: {
          ...road?.surface?.fill,
          opacity: expr.match(
            expr.get(field('structure')),
            [{labels: ['tunnel'], value: 0}],
            expr.match(expr.get(field('class')), [{labels: ['construction'], value: 0}], 1),
          ),
        },
      },
    };
  }
  return defineMap({
    ...base,
    modules: {
      ...base.modules,
      land: withRenderStack(withoutStack(land), {
        ...stackOf(land),
        protectedEdge: renderPass({
          placement: {above: 'land.landcover.protected.fill'},
          feature: 'landuseOverlay',
          renderer: 'line',
          selector: {field: 'class', kind: 'compare', operator: 'eq', value: 'protected_area'},
          style: {
            color: terrainVisual.protectedEdge,
            dash: [3, 2],
            minZoom: 7,
            opacity: 0.7,
            width: zoom.linear([
              [7, 0.6],
              [14, 1.4],
            ]),
          },
        }),
      }),
      roads: withRenderStack(terrainRoads, {
        ...Object.fromEntries(
          Object.entries(stackOf(roads))
            .filter(([name]) => !urbanPathRefinement.test(name))
            // Streets' pale access roads would sit under every track; here tracks have their ink.
            .map(([name, pass]) => [
              name,
              name === 'accessOverview' ? serviceRoadsOnly(pass) : pass,
            ]),
        ),
      }),
    },
  });
}

/**
 * Contemporary topography with Streets' lettering, road hierarchy, POIs and times of day.
 * Resolve the shared cartography into an independent root before publishing the definition.
 */
export const terrain = bindOfficialMapTheme(
  resolveMap(
    withTerrainStacks(
      defineMap({
        id: 'terrain',
        version: 1,
        name: 'Terrain',
        extends: streets,
        icons: [streetsIcons, terrainIcons],
        themes: terrainThemes,
        timeOfDay: {light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'}},
        defaultTheme: 'light',
        // Valley views need more tilt than Streets; steeper angles can intersect nearby slopes.
        camera: {adaptivePerspective: false, pitchLimit: {maxZoom: 24, maxPitch: 60}},
        systemThemes: {light: 'light', dark: 'dark'},
        terrain: {
          url: 'https://tiles.mapterhorn.com/tilejson.json',
          tileSize: 512,
          maxZoom: 12,
          attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
          contours: {
            demMaxZoom: 12,
            index: {color: terrainVisual.contour, opacity: 0.5, width: 0.8},
            labels: {
              color: terrainVisual.contour,
              font: streetsVisual.font.navigation,
              haloColor: terrainVisual.halo,
              haloWidth: 1,
              minZoom: 12,
              opacity: 1,
              size: 10,
              spacing: 380,
            },
            maxZoom: 14,
            minZoom: 8,
            minor: {color: terrainVisual.contour, opacity: 0.3, width: 0.5},
            overzoom: 2,
            sourceId: 'terrain-contours',
            thresholds: {
              8: [500, 2_500],
              9: [200, 1_000],
              10: [100, 500],
              11: [50, 250],
              12: [50, 250],
              13: [20, 100],
              14: [10, 50],
            },
          },
          encoding: 'terrarium',
          hillshade: {
            accentColor: token.color('terrain.hillshade.accent'),
            exaggeration: 0.34,
            highlightColor: token.color('terrain.hillshade.highlight'),
            illuminationAnchor: 'map',
            illuminationDirection: 315,
            maxZoom: 24,
            minZoom: 4,
            shadowColor: token.color('terrain.hillshade.shadow'),
          },
          mode: '3d',
        },
        modules: {
          boundaries: refine(
            {admin2: {dash: reset()}, admin4: {dash: reset()}},
            {
              admin2: {
                dash: expr.step<readonly number[]>(expr.zoom(), expr.literal([2, 0]), [
                  [7, expr.literal([2, 2, 6, 2])],
                ]),
                width: zoom.linear([
                  [3, 0.5],
                  [12, 2],
                ]),
              },
              admin4: {
                dash: expr.step<readonly number[]>(expr.zoom(), expr.literal([2, 0]), [
                  [7, expr.literal([2, 2, 6, 2])],
                ]),
                width: zoom.linear([
                  [3, 0.3],
                  [12, 1.5],
                ]),
              },
            },
          ),
          transit: refine({
            cableway: {minZoom: 11, width: 0.8, opacity: 0.75},
          }),
          landforms: landforms({
            classes: {
              arete: landformName,
              cliff: {...landformName, minZoom: 14},
              peak: peakName,
              ridge: landformName,
              saddle: {...landformName, minZoom: 12},
              volcano: peakName,
            },
            elevation: false,
          }),
          poi: refine({
            // Businesses give way to what a day outside needs: camps, huts, views, water, shelter.
            categories: ['park-nature', 'landmark', 'lodging', 'visitor-amenity', 'transport'],
            densityByCategory: {
              landmark: 3,
              lodging: 3,
              'park-nature': 3,
              transport: 1,
              'visitor-amenity': 5,
            },
            maxRankByType: {
              atm: 0,
              bank: 0,
              bed_and_breakfast: 0,
              ev_charging_station: 0,
              fueling_station: 0,
              gas_station: 0,
              hotel: 1,
              inn: 0,
              laundry: 0,
              // The landform labels already name the summits.
              mountain: 0,
              playground: 0,
              private_lodging: 0,
              resort: 0,
              visitor_information: 3,
            },
            placement: {iconOnlyTypes: ['drinking_water', 'parking', 'public_restroom']},
          }),
          roads: refine(
            // Replace the whole class styles: patches merge records, and these swap curves for tokens.
            {
              classes: {
                cycleway: reset(),
                footway: reset(),
                pathway: reset(),
                steps: reset(),
                track: reset(),
              },
            },
            {
              classes: {
                // A bore through a mountain must read as underground, even on raised terrain.
                motorway: {
                  tunnel: {
                    fill: {minZoom: 6, dash: [3, 2], opacity: 0.42},
                    casing: {opacity: 0.35},
                  },
                },
                trunk: {
                  tunnel: {
                    fill: {minZoom: 6, dash: [3, 2], opacity: 0.42},
                    casing: {opacity: 0.35},
                  },
                },
                primary: {
                  tunnel: {
                    fill: {minZoom: 6, dash: [3, 2], opacity: 0.42},
                    casing: {opacity: 0.35},
                  },
                },
                cycleway: trail(terrainVisual.track, 13, [1, 0]),
                // Mostly town walkways: they stay behind the mountain paths until close in.
                footway: trail(terrainVisual.trail, 14, [1.75, 0.3], 0.8),
                pathway: trail(terrainVisual.trail, 12, [4, 0.5]),
                steps: trail(terrainVisual.trail, 14, [1, 0.75]),
                track: trail(terrainVisual.track, 12, [5, 0.5]),
              },
              // Streets draws unpaved and restricted ways as solid carriageways; a trail stays a trail.
              modifiers: {unpaved: {enabled: false}},
              mountainBike: reset(),
              pathGround: {opacity: 0},
              restrictions: {access: {enabled: false}},
            },
          ),
        },
        view: {center: [6.87, 45.92], zoom: 12.2, pitch: 52, bearing: -25},
      }),
    ),
  ),
);
