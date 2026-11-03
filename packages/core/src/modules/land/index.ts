import type {
  TileflowAreaStyle,
  TileflowBackgroundStyle,
  TileflowFillStyle,
  TileflowLineStyle,
  TileflowNumberStyleValue,
} from '../../cartography/styles';

export type TileflowLanduseClass =
  | 'cemetery'
  | 'civic'
  | 'commercial'
  | 'education'
  | 'government'
  | 'industrial'
  | 'medical'
  | 'military'
  | 'parking'
  | 'railway'
  | 'recreation'
  | 'residential';
export type TileflowLandcoverClass =
  | 'farmland'
  | 'flowerbed'
  | 'grass'
  | 'ice'
  | 'meadow'
  | 'protected'
  | 'recreationGround'
  | 'rock'
  | 'sand'
  | 'scrub'
  | 'urbanPark'
  | 'villageGreen'
  | 'wetland'
  | 'wood';

/** The barriers of the data's barrier layer (World's `traffic_control`) the land module draws. */
export type TileflowBarrierClass = 'fence' | 'hedge' | 'wall';

/**
 * A barrier's line, a shadow line drawn under it (usually offset with `translate`), and the fill of
 * those mapped as areas, such as broad hedges.
 */
export type TileflowBarrierStyle = {
  area?: TileflowFillStyle;
  shadow?: TileflowLineStyle;
  line?: TileflowLineStyle;
};

export type TileflowLandModuleOptions = {
  background?: TileflowBackgroundStyle;
  /**
   * Hedges, fences and walls, drawn at the top of the land band with hedges uppermost. A barrier
   * without a style is not drawn, and neither is any when the data has no barrier layer.
   */
  barriers?: Partial<Record<TileflowBarrierClass, TileflowBarrierStyle>>;
  globalLandcover?: TileflowFillStyle;
  /** Georeferenced image below global cover; useful for continuous physical context. */
  globalLandcoverUnderlay?: {
    url: string;
    coordinates: readonly [
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
      readonly [number, number],
    ];
    attribution: string;
    opacity?: TileflowNumberStyleValue;
    minZoom?: number;
    maxZoom?: number;
  };
  landcover?: Partial<Record<TileflowLandcoverClass, TileflowAreaStyle>>;
  landuse?: Partial<Record<TileflowLanduseClass, TileflowAreaStyle>>;
};

export type TileflowLandModuleConfig = TileflowLandModuleOptions & {type: 'land'};

export function land(options: TileflowLandModuleOptions = {}): TileflowLandModuleConfig {
  return {type: 'land', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
