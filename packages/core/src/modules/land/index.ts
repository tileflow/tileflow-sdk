import type {
  TileflowAreaStyle,
  TileflowBackgroundStyle,
  TileflowFillStyle,
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

export type TileflowLandModuleOptions = {
  background?: TileflowBackgroundStyle;
  enabled?: boolean;
  globalLandcover?: TileflowFillStyle;
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
