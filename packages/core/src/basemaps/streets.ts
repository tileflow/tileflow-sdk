import {mergeTileflowDesign} from '../cartography/merge';
import {aeroways, type TileflowAerowaysModuleConfig} from '../modules/aeroways';
import {boundaries, type TileflowBoundariesModuleConfig} from '../modules/boundaries';
import {buildings, type TileflowBuildingsModuleConfig} from '../modules/buildings';
import {labels} from '../modules/labels';
import {land, type TileflowLandModuleConfig} from '../modules/land';
import {poi} from '../modules/poi';
import {roads} from '../modules/roads';
import {type TileflowTransitModuleConfig, transit} from '../modules/transit';
import {type TileflowWaterModuleConfig, water} from '../modules/water';
import type {
  TileflowLabelsModuleConfig,
  TileflowPoiModuleConfig,
  TileflowRoadsModuleConfig,
} from '../types';

export const tileflowStreetsBasemapVersion = 1;

export type TileflowStreetsVariant = 'dark' | 'light';

export type TileflowStreetsBasemapConfig = {
  type: 'streets';
  basemapVersion: typeof tileflowStreetsBasemapVersion;
  variant: TileflowStreetsVariant;
};

export type TileflowStreetsOptions = {
  variant?: TileflowStreetsVariant;
};

export type TileflowStreetsModules = {
  aeroways?: TileflowAerowaysModuleConfig;
  boundaries?: TileflowBoundariesModuleConfig;
  buildings?: TileflowBuildingsModuleConfig;
  labels?: TileflowLabelsModuleConfig;
  land?: TileflowLandModuleConfig;
  poi?: TileflowPoiModuleConfig;
  roads?: TileflowRoadsModuleConfig;
  transit?: TileflowTransitModuleConfig;
  water?: TileflowWaterModuleConfig;
};

export const tileflowStreetsRecipe = Object.freeze({
  id: 'streets',
  version: tileflowStreetsBasemapVersion,
  modules: Object.freeze({
    aeroways: aeroways(),
    boundaries: boundaries(),
    buildings: buildings(),
    labels: labels(),
    land: land(),
    poi: poi({icons: false}),
    roads: roads(),
    transit: transit(),
    water: water(),
  }),
});

export function streets(options: TileflowStreetsOptions = {}): TileflowStreetsBasemapConfig {
  return {
    type: 'streets',
    basemapVersion: tileflowStreetsBasemapVersion,
    variant: options.variant ?? 'light',
  };
}

export function resolveStreetsModules(
  overrides: TileflowStreetsModules | undefined,
): Required<TileflowStreetsModules> {
  return Object.fromEntries(
    Object.entries(tileflowStreetsRecipe.modules).map(([domain, request]) => [
      domain,
      mergeTileflowDesign(request, overrides?.[domain as keyof TileflowStreetsModules]),
    ]),
  ) as Required<TileflowStreetsModules>;
}
