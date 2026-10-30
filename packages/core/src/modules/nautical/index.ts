import type {
  TileflowAreaStyle,
  TileflowLineStyle,
  TileflowMarkerSymbolStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';

/**
 * Labels anchored inside polygon features, and the clearance labels of bridges and overhead cables;
 * other point-feature labels remain on their feature style.
 */
export type TileflowNauticalAreaLabelStyles = {
  /**
   * Vertical clearance of bridges, or their clearance closed and open, at bridge points and inside
   * bridge polygons; bridge lines carry it at their centre.
   */
  bridges?: TileflowSymbolStyle;
  /** Provider coverage cells; hidden unless a map makes this style visible. */
  coverage?: TileflowSymbolStyle;
  hazards?: TileflowSymbolStyle;
  navigationAreas?: TileflowSymbolStyle;
  /** Safe vertical clearance of overhead cables, at cable points and along cable lines. */
  overheadCables?: TileflowSymbolStyle;
  reefs?: TileflowSymbolStyle;
  wrecks?: TileflowSymbolStyle;
};

/**
 * One style per semantic group of `nautical-v1` objects. Point groups draw a circle `marker`, an
 * `icon` from the theme's nautical image tokens, and `text`; area groups draw a `fill` and an
 * `outline`; line groups draw one stroke. Every group respects each feature's `min_zoom`, and
 * point groups place more important features (lower `rank`) first.
 */
export type TileflowNauticalModuleOptions = {
  /** Other aids: moorings, fog signals, racons, radio and signal stations, and virtual aids. */
  aids?: TileflowMarkerSymbolStyle;
  /**
   * Flash each light in its rhythm where a browser runtime animates the map. Defaults to `true`.
   * `false` keeps every light steady, as do reduced motion, capture, and native renderers.
   */
  animateLights?: boolean;
  /** Fixed beacons and daymarks, coloured by their first colour. */
  beacons?: TileflowMarkerSymbolStyle;
  /** Berth polygons; the outline also strokes berth lines and emphasises guest berths. */
  berths?: TileflowAreaStyle;
  /** Bridge polygons; the outline also strokes bridge lines. */
  bridges?: TileflowAreaStyle;
  /** Buoys, light floats, and light vessels, coloured by their first colour. */
  buoys?: TileflowMarkerSymbolStyle;
  /** Submarine cable and pipeline lines. */
  cables?: TileflowLineStyle;
  /** Restrained indication of where a provider publishes marks. */
  coverage?: TileflowAreaStyle;
  /** Waterway distance marks with their distance and unit. */
  distanceMarks?: TileflowMarkerSymbolStyle;
  /**
   * Small-craft facilities such as fuel, water, slipways, pump-out, visitor berths, boat hoists,
   * and boatyards, at facility points, inside facility polygons, and at the centre of their lines.
   */
  facilities?: TileflowMarkerSymbolStyle;
  /** Harbour and marina polygons. */
  harbourAreas?: TileflowAreaStyle;
  /** Harbour and marina points, and their symbol and name inside harbour polygons. */
  harbours?: TileflowMarkerSymbolStyle;
  /** Hazard areas; the outline also strokes linear hazards such as booms. */
  hazardAreas?: TileflowAreaStyle;
  /** Rocks by water level, obstructions, and offshore platforms. */
  hazards?: TileflowMarkerSymbolStyle;
  labels?: TileflowNauticalAreaLabelStyles;
  lighthouses?: TileflowMarkerSymbolStyle;
  /** Light flares coloured by the light's first colour, with the chart light label. */
  lights?: TileflowMarkerSymbolStyle;
  /** Restricted, military, anchorage, traffic-separation, and other navigation areas. */
  navigationAreas?: TileflowAreaStyle;
  /** Inland notice boards coloured by function, with the information they show. */
  notices?: TileflowMarkerSymbolStyle;
  /** Overhead cable lines. */
  overheadCables?: TileflowLineStyle;
  /** Ports, sized by `size` and placed by `rank` from low zooms. */
  ports?: TileflowMarkerSymbolStyle;
  reefs?: TileflowAreaStyle;
  /** Traffic-separation lines and recommended routes, tracks, and ferry routes. */
  routes?: TileflowLineStyle;
  soundings?: TileflowMarkerSymbolStyle;
  wreckAreas?: TileflowAreaStyle;
  wrecks?: TileflowMarkerSymbolStyle;
};

export type TileflowNauticalModuleConfig = TileflowNauticalModuleOptions & {type: 'nautical'};

/**
 * Theme image tokens for nautical point symbols. When the selected theme declares a group's token,
 * that group draws the image as its icon instead of the default circle marker. Buoy variants fall
 * back to `nautical.buoy`. Declare every token of one group with the same icon representation; SDF
 * icons take the mark's colour.
 */
export const tileflowNauticalImageRoles = Object.freeze({
  aids: Object.freeze({default: 'nautical.aid'}),
  beacons: Object.freeze({default: 'nautical.beacon'}),
  buoys: Object.freeze({
    cardinal: 'nautical.buoy.cardinal',
    default: 'nautical.buoy',
    port: 'nautical.buoy.port',
    starboard: 'nautical.buoy.starboard',
  }),
  distanceMarks: Object.freeze({default: 'nautical.distance-mark'}),
  /**
   * A facility that lists several categories shows the first of `tileflowNauticalFacilityIcons`
   * it lists; facilities without a variant token fall back to `nautical.facility`.
   */
  facilities: Object.freeze({
    'boat-hoist': 'nautical.facility.boat-hoist',
    boatyard: 'nautical.facility.boatyard',
    default: 'nautical.facility',
    'fuel-station': 'nautical.facility.fuel-station',
    'pump-out': 'nautical.facility.pump-out',
    slipway: 'nautical.facility.slipway',
    'visitor-berth': 'nautical.facility.visitor-berth',
    'water-tap': 'nautical.facility.water-tap',
  }),
  /** Harbours whose `subclass` lists a marina use `nautical.marina` when the theme declares it. */
  harbours: Object.freeze({default: 'nautical.harbour', marina: 'nautical.marina'}),
  lighthouses: Object.freeze({default: 'nautical.lighthouse'}),
  lights: Object.freeze({default: 'nautical.light'}),
  /** Notice boards by function; a board without a variant token uses `nautical.notice`. */
  notices: Object.freeze({
    default: 'nautical.notice',
    information: 'nautical.notice.information',
    prohibition: 'nautical.notice.prohibition',
    recommendation: 'nautical.notice.recommendation',
    regulation: 'nautical.notice.regulation',
    restriction: 'nautical.notice.restriction',
  }),
  ports: Object.freeze({default: 'nautical.port'}),
  wrecks: Object.freeze({default: 'nautical.wreck'}),
});

/**
 * Facility categories with their own icon, in the order that picks one for a facility listing
 * several. `visitors-mooring` shares the visitor-berth icon.
 */
export const tileflowNauticalFacilityIcons = Object.freeze([
  'fuel-station',
  'slipway',
  'boat-hoist',
  'pump-out',
  'water-tap',
  'visitor-berth',
  'boatyard',
] as const);

/** The fixed notice every map that draws `nautical-v1` objects declares in its style. */
export const tileflowNauticalNotice = Object.freeze({
  id: 'nautical-not-for-navigation',
  text: 'Not for navigation',
});

/** Style the semantic objects published by the `nautical-v1` sidecar. */
export function nautical(
  options: TileflowNauticalModuleOptions = {},
): TileflowNauticalModuleConfig {
  return {type: 'nautical', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
