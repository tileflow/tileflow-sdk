import {
  defineMap,
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
import {outdoorsIcons, streetsIcons} from '../assets';
import {outdoorsThemes, outdoorsVisual} from './outdoors-themes';
import {streets} from './streets';
import {stackOf, withoutStack} from './streets-cartography';
import {streetsVisual} from './streets-themes';
import {bindOfficialMapTheme} from './theme-helpers';

const trailWidth = zoom.linear([
  [11, 0.7],
  [13, 1.25],
  [15, 1.9],
  [18, 3.2],
]);
const trailHaloWidth = zoom.linear([
  [13, 2.2],
  [16, 3.6],
  [18, 5],
]);

/** A trail or track: a dashed ink over a soft halo that keeps it legible across relief and cover. */
function trail(
  color: typeof outdoorsVisual.trail,
  minZoom: number,
  dash: readonly number[],
  opacity = 1,
): TileflowRoadClassStyle {
  const fill = {cap: 'butt', color, dash, minZoom, opacity, width: trailWidth} as const;
  const halo = {
    color: outdoorsVisual.trailHalo,
    dash: [1, 0],
    gapWidth: 0,
    minZoom: 13,
    opacity: 0.72,
    width: trailHaloWidth,
  } as const;
  return {
    bridge: {casing: halo, fill},
    surface: {casing: halo, fill},
    tunnel: {casing: {visible: false}, fill: {...fill, opacity: 0.45}},
  };
}

const peakName = {
  minZoom: 10,
  priority: 64,
  icon: {image: outdoorsVisual.peakIcon, size: 1},
  text: {
    anchor: 'top',
    color: outdoorsVisual.peak,
    font: streetsVisual.font.places,
    haloColor: outdoorsVisual.halo,
    haloWidth: 1.2,
    offset: [0, 0.55],
    size: zoom.linear([
      [10, 10.5],
      [15, 13],
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

function withOutdoorsStacks(base: TileflowMap) {
  const source = resolveMap(base);
  const {land, roads} = source.modules ?? {};
  if (!land || !roads) throw new Error('Outdoors requires the Streets land and road modules');
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
            color: outdoorsVisual.protectedEdge,
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
      roads: withRenderStack(
        withoutStack(roads),
        Object.fromEntries(
          Object.entries(stackOf(roads))
            .filter(([name]) => !urbanPathRefinement.test(name))
            // Streets' pale access roads would sit under every track; here tracks have their ink.
            .map(([name, pass]) => [
              name,
              name === 'accessOverview' ? serviceRoadsOnly(pass) : pass,
            ]),
        ),
      ),
    },
  });
}

/**
 * Streets' roads, labels, sky and lighting on natural ground, with Siegfried's contour and
 * landform treatment, for hiking and field applications.
 */
export const outdoors = bindOfficialMapTheme(
  withOutdoorsStacks(
    defineMap({
      id: 'outdoors',
      version: 1,
      name: 'Outdoors',
      extends: streets,
      icons: [streetsIcons, outdoorsIcons],
      themes: outdoorsThemes,
      timeOfDay: {light: {day: 'light', dawn: 'dawn', dusk: 'dusk', night: 'dark'}},
      defaultTheme: 'light',
      systemThemes: {light: 'light', dark: 'dark'},
      terrain: {
        attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
        contours: {
          demMaxZoom: 12,
          index: {color: outdoorsVisual.contour, opacity: 0.6, width: 0.9},
          labels: {
            color: outdoorsVisual.contour,
            font: streetsVisual.font.regular,
            haloColor: outdoorsVisual.halo,
            haloWidth: 1,
            minZoom: 13,
            opacity: 1,
            size: 10,
            spacing: 380,
          },
          maxZoom: 15,
          minZoom: 10,
          minor: {color: outdoorsVisual.contour, opacity: 0.38, width: 0.45},
          overzoom: 2,
          sourceId: 'outdoors-contours',
          thresholds: {
            10: [200, 1_000],
            11: [100, 500],
            12: [50, 250],
            13: [20, 100],
          },
        },
        encoding: 'terrarium',
        hillshade: {
          accentColor: token.color('terrain.hillshade.accent'),
          exaggeration: 0.34,
          highlightColor: token.color('terrain.hillshade.highlight'),
          illuminationAnchor: 'map',
          illuminationDirection: 315,
          maxZoom: 16,
          minZoom: 5,
          shadowColor: token.color('terrain.hillshade.shadow'),
        },
        mode: 'hillshade',
      },
      modules: {
        landforms: landforms({
          classes: {
            arete: landformName,
            cliff: {...landformName, minZoom: 14},
            peak: peakName,
            ridge: landformName,
            saddle: {...landformName, minZoom: 12},
            volcano: peakName,
          },
          elevation: true,
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
              cycleway: trail(outdoorsVisual.track, 13, [4, 2]),
              // Mostly town walkways: they stay behind the mountain paths until close in.
              footway: trail(outdoorsVisual.trail, 14, [2, 1.8], 0.62),
              pathway: trail(outdoorsVisual.trail, 12, [2.5, 1.5]),
              steps: trail(outdoorsVisual.trail, 14, [1, 1]),
              track: trail(outdoorsVisual.track, 12, [4, 1.5]),
            },
            // Streets draws unpaved and restricted ways as solid carriageways; a trail stays a trail.
            modifiers: {unpaved: {enabled: false}},
            mountainBike: reset(),
            pathGround: {opacity: 0},
            restrictions: {access: {enabled: false}},
          },
        ),
      },
      view: {center: [6.8694, 45.9237], zoom: 12.5},
    }),
  ),
);
