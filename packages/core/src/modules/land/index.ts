import type {TileflowAreaStyle, TileflowBackgroundStyle} from '../../cartography/styles';

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
  | 'grass'
  | 'ice'
  | 'park'
  | 'protected'
  | 'rock'
  | 'sand'
  | 'scrub'
  | 'wetland'
  | 'wood';

export type TileflowLandModuleOptions = {
  background?: TileflowBackgroundStyle;
  enabled?: boolean;
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
