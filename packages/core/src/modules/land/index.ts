import type {TileflowAreaStyle, TileflowBackgroundStyle} from '../../cartography/styles';

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
