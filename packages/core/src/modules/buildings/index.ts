import type {TileflowAreaStyle, TileflowExtrusionStyle} from '../../cartography/styles';
import type {TileflowThemeColorValue, TileflowThemeNumberValue} from '../../cartography/values';

export type TileflowBuildingMode = '3d' | 'flat';

/**
 * How Core's 3D buildings renderer draws the map's buildings. Their colour is the map's own 3D
 * building colour (its extrusion), else its roofs'.
 */
export type TileflowBuildingsThreeDimensionalStyle = {
  /** How strongly roof outlines and outer corners catch the light, from 0 (none) to 1, the default. */
  edges?: TileflowThemeNumberValue;
  /** Their own colour, drawn unlit; without it they take the building's colour, lightened. */
  edgeColor?: TileflowThemeColorValue;
  /** How bright the buildings light the street at night, from 0 (none) to 2; defaults to 1. */
  nightLight?: TileflowThemeNumberValue;
  /** Contact shadow at the foot of the walls and in tight corners; defaults to true. */
  occlusion?: boolean;
  /** Shadows from the sun, on the buildings and the flat map; defaults to true. */
  shadows?: boolean;
  /** Invented night windows, lit by rooms: decoration, not data. Defaults to false. */
  windows?: boolean;
};

export type TileflowBuildingsModuleOptions = {
  businessCorridor?: TileflowAreaStyle;
  extrusion?: TileflowExtrusionStyle;
  flat?: TileflowAreaStyle;
  mode?: TileflowBuildingMode;
  threeDimensional?: TileflowBuildingsThreeDimensionalStyle;
};

export type TileflowBuildingsModuleConfig = TileflowBuildingsModuleOptions & {type: 'buildings'};

export function buildings(
  options: TileflowBuildingsModuleOptions = {},
): TileflowBuildingsModuleConfig {
  return {type: 'buildings', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
