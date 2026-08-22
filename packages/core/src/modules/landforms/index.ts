import type {TileflowSymbolStyle} from '../../cartography/styles';

export const tileflowLandformClasses = [
  'peak',
  'volcano',
  'saddle',
  'ridge',
  'cliff',
  'arete',
] as const;

export type TileflowLandformClass = (typeof tileflowLandformClasses)[number];

export type TileflowLandformsModuleOptions = {
  classes?: Partial<Record<TileflowLandformClass, TileflowSymbolStyle>>;
  enabled?: boolean;
  /** Append source elevation in metres when the feature provides it. */
  elevation?: boolean;
};

export type TileflowLandformsModuleConfig = TileflowLandformsModuleOptions & {
  type: 'landforms';
};

export function landforms(
  options: TileflowLandformsModuleOptions = {},
): TileflowLandformsModuleConfig {
  return {type: 'landforms', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
