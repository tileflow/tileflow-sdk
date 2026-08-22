export type TileflowVegetationMode = '3d' | 'flat';

export type TileflowVegetationModuleOptions = {
  enabled?: boolean;
  minZoom?: number;
  mode?: TileflowVegetationMode;
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
