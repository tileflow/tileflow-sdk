import type {
  TileflowAreaStyle,
  TileflowFillStyle,
  TileflowLineStyle,
  TileflowSymbolPlacement,
  TileflowSymbolStyle,
} from '../../cartography/styles';

export type TileflowWaterwayClass = 'canal' | 'other' | 'river' | 'stream';

/** Explicit placement for every geometry family in a declared Bathymetry name layer. */
export type TileflowBathymetryNamePlacement = {
  point: 'point';
  line: TileflowSymbolPlacement;
  polygon: TileflowSymbolPlacement;
};

export type TileflowBathymetryNameStyle = TileflowSymbolStyle & {
  /** Overrides scalar placement for these names; omission preserves scalar placement. */
  placementByGeometry?: TileflowBathymetryNamePlacement;
};

export type TileflowWaterModuleOptions = {
  bathymetry?: TileflowFillStyle;
  /** Contour lines when declared by Bathymetry; otherwise approximate polygon band edges. */
  bathymetryContours?: TileflowLineStyle;
  /** Contour-depth or legacy band-floor labels, not measured survey soundings. */
  bathymetryLabels?: TileflowSymbolStyle;
  /** Names from an explicitly declared seafloor_landform layer. */
  bathymetryLandforms?: TileflowBathymetryNameStyle;
  /** Names from an explicitly declared water_name layer. */
  bathymetryWaterNames?: TileflowBathymetryNameStyle;
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
