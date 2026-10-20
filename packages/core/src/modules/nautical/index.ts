import type {
  TileflowAreaStyle,
  TileflowLineStyle,
  TileflowMarkerSymbolStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';

/** Labels anchored inside polygon features; point-feature labels remain on their feature style. */
export type TileflowNauticalAreaLabelStyles = {
  /** Provider coverage cells; hidden unless a map makes this style visible. */
  coverage?: TileflowSymbolStyle;
  hazards?: TileflowSymbolStyle;
  navigationAreas?: TileflowSymbolStyle;
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
  /** Fixed beacons and daymarks, coloured by their first colour. */
  beacons?: TileflowMarkerSymbolStyle;
  /** Buoys, light floats, and light vessels, coloured by their first colour. */
  buoys?: TileflowMarkerSymbolStyle;
  /** Submarine cable and pipeline lines. */
  cables?: TileflowLineStyle;
  /** Restrained indication of where a provider publishes marks. */
  coverage?: TileflowAreaStyle;
  /** Harbour and marina points. */
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
  harbours: Object.freeze({default: 'nautical.harbour'}),
  lighthouses: Object.freeze({default: 'nautical.lighthouse'}),
  lights: Object.freeze({default: 'nautical.light'}),
  ports: Object.freeze({default: 'nautical.port'}),
  wrecks: Object.freeze({default: 'nautical.wreck'}),
});

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
