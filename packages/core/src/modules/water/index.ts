import type {TileflowAreaStyle, TileflowLineStyle} from '../../cartography/styles';

export type TileflowWaterwayClass = 'canal' | 'other' | 'river' | 'stream';

export type TileflowWaterModuleOptions = {
  bodies?: TileflowAreaStyle;
  enabled?: boolean;
  intermittent?: {
    bodies?: TileflowAreaStyle;
    waterways?: TileflowLineStyle;
  };
  waterways?: Partial<Record<TileflowWaterwayClass, TileflowLineStyle>>;
};

export type TileflowWaterModuleConfig = TileflowWaterModuleOptions & {type: 'water'};

export function water(options: TileflowWaterModuleOptions = {}): TileflowWaterModuleConfig {
  return {type: 'water', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
