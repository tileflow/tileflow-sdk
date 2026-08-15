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
    roads: roads({
      modifiers: {
        construction: {
          surface: {
            casing: {dash: [2, 1], opacity: 0.62},
            fill: {dash: [2, 1], opacity: 0.68},
          },
        },
        ramp: {widthScale: 0.72},
        unpaved: {
          surface: {
            casing: {dash: [2, 1], opacity: 0.72},
            fill: {dash: [2, 1], opacity: 0.82},
          },
        },
      },
      restrictions: {
        access: {
          surface: {
            casing: {dash: [1.5, 1], opacity: 0.48},
            fill: {dash: [1.5, 1], opacity: 0.52},
          },
        },
      },
      serviceTypes: {
        alley: {widthScale: 0.82},
        crossover: {widthScale: 0.62},
        driveway: {widthScale: 0.76},
        parkingAisle: {widthScale: 0.62},
        yard: {widthScale: 0.7},
      },
    }),
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
