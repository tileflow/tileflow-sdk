import type {TileflowFillStyle} from '../../cartography/styles';

export type TileflowLanduseClass =
  | 'cemetery'
  | 'civic'
  | 'commercial'
  | 'industrial'
  | 'railway'
  | 'residential';
export type TileflowLandcoverClass =
  | 'farmland'
  | 'grass'
  | 'ice'
  | 'park'
  | 'protected'
  | 'sand'
  | 'scrub'
  | 'wood';

export type TileflowLandModuleOptions = {
  background?: TileflowFillStyle;
  enabled?: boolean;
  landcover?: Partial<Record<TileflowLandcoverClass, TileflowFillStyle>>;
  landuse?: Partial<Record<TileflowLanduseClass, TileflowFillStyle>>;
};

export type TileflowLandModuleConfig = TileflowLandModuleOptions & {type: 'land'};

export function land(options: TileflowLandModuleOptions = {}): TileflowLandModuleConfig {
  return {type: 'land', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
