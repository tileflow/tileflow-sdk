import type {TileflowLineStyle} from '../../cartography/styles';

export type TileflowBoundariesModuleOptions = {
  admin2?: TileflowLineStyle;
  admin4?: TileflowLineStyle;
  disputed?: TileflowLineStyle;
  enabled?: boolean;
  maritime?: TileflowLineStyle;
};

export type TileflowBoundariesModuleConfig = TileflowBoundariesModuleOptions & {
  type: 'boundaries';
};

export function boundaries(
  options: TileflowBoundariesModuleOptions = {},
): TileflowBoundariesModuleConfig {
  return {type: 'boundaries', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
