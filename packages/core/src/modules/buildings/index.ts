import type {TileflowAreaStyle, TileflowExtrusionStyle} from '../../cartography/styles';

export type TileflowBuildingMode = '3d' | 'flat';

export type TileflowBuildingsModuleOptions = {
  businessCorridor?: TileflowAreaStyle;
  enabled?: boolean;
  extrusion?: TileflowExtrusionStyle;
  flat?: TileflowAreaStyle;
  mode?: TileflowBuildingMode;
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
