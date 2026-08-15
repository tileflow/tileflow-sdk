import type {TileflowFillStyle, TileflowLineStyle} from '../../cartography/styles';

export type TileflowWaterwayClass = 'canal' | 'other' | 'river' | 'stream';

export type TileflowWaterModuleOptions = {
  bodies?: TileflowFillStyle;
  enabled?: boolean;
  intermittent?: {
    bodies?: TileflowFillStyle;
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
