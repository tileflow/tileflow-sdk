import type {TileflowFillStyle, TileflowLineStyle} from '../../cartography/styles';

export type TileflowAerowaysModuleOptions = {
  area?: TileflowFillStyle;
  enabled?: boolean;
  runway?: {
    casing?: TileflowLineStyle;
    fill?: TileflowLineStyle;
  };
  taxiway?: {
    casing?: TileflowLineStyle;
    fill?: TileflowLineStyle;
  };
};

export type TileflowAerowaysModuleConfig = TileflowAerowaysModuleOptions & {type: 'aeroways'};

export function aeroways(
  options: TileflowAerowaysModuleOptions = {},
): TileflowAerowaysModuleConfig {
  return {type: 'aeroways', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
