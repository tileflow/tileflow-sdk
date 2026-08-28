import type {
  TileflowAreaStyle,
  TileflowMarkerSymbolStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';

/** Labels anchored inside polygon features; point-feature labels remain on their feature style. */
export type TileflowNauticalAreaLabelStyles = {
  coverage?: TileflowSymbolStyle;
  hazards?: TileflowSymbolStyle;
  navigationAreas?: TileflowSymbolStyle;
  reefs?: TileflowSymbolStyle;
  wrecks?: TileflowSymbolStyle;
};

export type TileflowNauticalModuleOptions = {
  aids?: TileflowMarkerSymbolStyle;
  coverage?: TileflowAreaStyle;
  hazardAreas?: TileflowAreaStyle;
  hazards?: TileflowMarkerSymbolStyle;
  labels?: TileflowNauticalAreaLabelStyles;
  lighthouses?: TileflowMarkerSymbolStyle;
  lights?: TileflowMarkerSymbolStyle;
  navigationAreas?: TileflowAreaStyle;
  reefs?: TileflowAreaStyle;
  soundings?: TileflowMarkerSymbolStyle;
  wreckAreas?: TileflowAreaStyle;
  wrecks?: TileflowMarkerSymbolStyle;
};

export type TileflowNauticalModuleConfig = TileflowNauticalModuleOptions & {type: 'nautical'};

/** Style the semantic objects published by the `nautical-v1` sidecar. */
export function nautical(
  options: TileflowNauticalModuleOptions = {},
): TileflowNauticalModuleConfig {
  return {type: 'nautical', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
