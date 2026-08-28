import type {TileflowCircleStyle} from '../../cartography/styles';
import type {TileflowThemeColorValue, TileflowThemeNumberValue} from '../../cartography/values';

export type TileflowVegetationMode = '3d' | 'flat';

export type TileflowVegetationThreeDimensionalStyle = {
  barkColor?: TileflowThemeColorValue;
  broadleafColors?: readonly TileflowThemeColorValue[];
  coniferColors?: readonly TileflowThemeColorValue[];
  crownScale?: TileflowThemeNumberValue;
  heightScale?: TileflowThemeNumberValue;
};

export type TileflowVegetationModuleOptions = {
  enabled?: boolean;
  flat?: TileflowCircleStyle;
  minZoom?: number;
  mode?: TileflowVegetationMode;
  threeDimensional?: TileflowVegetationThreeDimensionalStyle;
};

export type TileflowVegetationModuleConfig = TileflowVegetationModuleOptions & {
  type: 'vegetation';
};

export function vegetation(
  options: TileflowVegetationModuleOptions = {},
): TileflowVegetationModuleConfig {
  return {type: 'vegetation', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
