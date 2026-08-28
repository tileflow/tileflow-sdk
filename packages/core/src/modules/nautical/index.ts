import type {TileflowAreaStyle, TileflowSymbolStyle} from '../../cartography/styles';

/** Labels anchored inside polygon features; point-feature labels remain on their feature style. */
export type TileflowNauticalAreaLabelStyles = {
  coverage?: TileflowSymbolStyle;
  hazards?: TileflowSymbolStyle;
  navigationAreas?: TileflowSymbolStyle;
  reefs?: TileflowSymbolStyle;
  wrecks?: TileflowSymbolStyle;
};

export type TileflowNauticalModuleOptions = {
  aids?: TileflowSymbolStyle;
  coverage?: TileflowAreaStyle;
  enabled?: boolean;
  hazardAreas?: TileflowAreaStyle;
  hazards?: TileflowSymbolStyle;
  labels?: TileflowNauticalAreaLabelStyles;
  lighthouses?: TileflowSymbolStyle;
  lights?: TileflowSymbolStyle;
  navigationAreas?: TileflowAreaStyle;
  reefs?: TileflowAreaStyle;
  soundings?: TileflowSymbolStyle;
  wreckAreas?: TileflowAreaStyle;
  wrecks?: TileflowSymbolStyle;
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
