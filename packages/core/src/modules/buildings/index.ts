import type {TileflowFillStyle, TileflowLineStyle} from '../../cartography/styles';
import type {TileflowStyleValue} from '../../cartography/values';

export type TileflowBuildingMode = '3d' | 'flat';

export type TileflowBuildingsModuleOptions = {
  enabled?: boolean;
  extrusion?: TileflowFillStyle & {
    base?: TileflowStyleValue<number>;
    height?: TileflowStyleValue<number>;
  };
  fill?: TileflowFillStyle;
  mode?: TileflowBuildingMode;
  outline?: TileflowLineStyle;
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
