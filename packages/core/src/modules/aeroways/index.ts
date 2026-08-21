import type {
  TileflowAreaStyle,
  TileflowLineStackStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';

export type TileflowAerowaysModuleOptions = {
  area?: TileflowAreaStyle;
  enabled?: boolean;
  runway?: TileflowLineStackStyle;
  runwayRef?: TileflowSymbolStyle;
  taxiway?: TileflowLineStackStyle;
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
