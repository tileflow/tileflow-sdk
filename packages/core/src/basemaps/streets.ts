import {mergeTileflowDesign} from '../cartography/merge';
import {addresses, type TileflowAddressesModuleConfig} from '../modules/addresses';
import {aeroways, type TileflowAerowaysModuleConfig} from '../modules/aeroways';
import {boundaries, type TileflowBoundariesModuleConfig} from '../modules/boundaries';
import {buildings, type TileflowBuildingsModuleConfig} from '../modules/buildings';
import {labels} from '../modules/labels';
import {land, type TileflowLandModuleConfig} from '../modules/land';
import {landforms, type TileflowLandformsModuleConfig} from '../modules/landforms';
import {poi} from '../modules/poi';
import {roads} from '../modules/roads';
import {type TileflowTransitModuleConfig, transit} from '../modules/transit';
import {type TileflowVegetationModuleConfig, vegetation} from '../modules/vegetation';
import {type TileflowWaterModuleConfig, water} from '../modules/water';
import type {
  TileflowLabelsModuleConfig,
  TileflowPoiModuleConfig,
  TileflowRoadsModuleConfig,
} from '../types';

export const tileflowStreetsBasemapVersion = 3;

export const tileflowStreetsBasemapDefinition = Object.freeze({
  type: 'streets',
  version: tileflowStreetsBasemapVersion,
} as const);

export const tileflowStreetsPoiIconMapping = Object.freeze({
  coffee: 'cafe',
  culture: 'museum',
  education: 'school',
  food: 'restaurant',
  health: 'hospital',
  lodging: 'hotel',
  services: 'services',
  shopping: 'shopping',
  transit: 'train',
});

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
  addresses?: TileflowAddressesModuleConfig;
  aeroways?: TileflowAerowaysModuleConfig;
  boundaries?: TileflowBoundariesModuleConfig;
  buildings?: TileflowBuildingsModuleConfig;
  labels?: TileflowLabelsModuleConfig;
  land?: TileflowLandModuleConfig;
  landforms?: TileflowLandformsModuleConfig;
  poi?: TileflowPoiModuleConfig;
  roads?: TileflowRoadsModuleConfig;
  transit?: TileflowTransitModuleConfig;
  vegetation?: TileflowVegetationModuleConfig;
  water?: TileflowWaterModuleConfig;
};

export type TileflowStreetsModuleName = keyof TileflowStreetsModules;

const tileflowStreetsDefaultModules = {
  addresses: addresses(),
  aeroways: aeroways(),
  boundaries: boundaries(),
  buildings: buildings(),
  labels: labels(),
  land: land(),
  landforms: landforms(),
  poi: poi({icons: 'essential'}),
  roads: roads({
    modifiers: {
      construction: {
        surface: {
          casing: {dash: [2, 1], opacity: 0.62},
          fill: {dash: [2, 1], opacity: 0.68},
        },
      },
      expressway: {widthScale: 1.06},
      indoor: {
        surface: {
          casing: {dash: [1, 1], opacity: 0.28},
          fill: {dash: [1, 1], opacity: 0.42},
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
  vegetation: vegetation({mode: '3d'}),
  water: water(),
} satisfies Required<TileflowStreetsModules>;

export const tileflowStreetsRecipe = Object.freeze({
  id: 'streets',
  version: tileflowStreetsBasemapVersion,
  modules: Object.freeze(tileflowStreetsDefaultModules),
});

export const tileflowStreetsModuleNames = Object.freeze(
  (Object.keys(tileflowStreetsDefaultModules) as TileflowStreetsModuleName[]).sort(),
);

export function streets(options: TileflowStreetsOptions = {}): TileflowStreetsBasemapConfig {
  return {
    type: tileflowStreetsBasemapDefinition.type,
    basemapVersion: tileflowStreetsBasemapDefinition.version,
    variant: options.variant ?? 'light',
  };
}

export function resolveStreetsModules(
  overrides: TileflowStreetsModules | undefined,
): Required<TileflowStreetsModules> {
  return Object.fromEntries(
    tileflowStreetsModuleNames.map((domain) => [
      domain,
      mergeTileflowDesign(tileflowStreetsRecipe.modules[domain], overrides?.[domain]),
    ]),
  ) as Required<TileflowStreetsModules>;
}
