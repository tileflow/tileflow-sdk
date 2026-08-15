import type {TileflowLineStyle} from '../../cartography/styles';

export type TileflowTransitModuleOptions = {
  cableway?: TileflowLineStyle;
  enabled?: boolean;
  ferry?: TileflowLineStyle;
  rail?: TileflowLineStyle;
  railHatching?: TileflowLineStyle;
  serviceRail?: TileflowLineStyle;
};

export type TileflowTransitModuleConfig = TileflowTransitModuleOptions & {type: 'transit'};

export function transit(options: TileflowTransitModuleOptions = {}): TileflowTransitModuleConfig {
  return {type: 'transit', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
