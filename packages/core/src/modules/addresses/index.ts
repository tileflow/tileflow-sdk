import type {TileflowSymbolStyle} from '../../cartography/styles';

export type TileflowAddressesModuleOptions = {
  enabled?: boolean;
  /** Styling for OpenMapTiles point house-number labels. */
  labels?: TileflowSymbolStyle;
};

export type TileflowAddressesModuleConfig = TileflowAddressesModuleOptions & {
  type: 'addresses';
};

export function addresses(
  options: TileflowAddressesModuleOptions = {},
): TileflowAddressesModuleConfig {
  return {type: 'addresses', ...cloneJson(options)};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
