import type {
  TileflowAreaStyle,
  TileflowFillStyle,
  TileflowLineStyle,
  TileflowSymbolStyle,
} from '../../cartography/styles';

export type TileflowWaterwayClass = 'canal' | 'other' | 'river' | 'stream';

export type TileflowWaterModuleOptions = {
  bathymetry?: TileflowFillStyle;
  /** Opt-in approximate contours traced from discrete bathymetry polygon band edges. */
  bathymetryContours?: TileflowLineStyle;
  /** Opt-in labels for bathymetry polygon band floors, not measured survey soundings. */
  bathymetryLabels?: TileflowSymbolStyle;
  bodies?: TileflowAreaStyle;
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
