import {addresses, type TileflowAddressesModuleConfig} from '../modules/addresses';
import {compileAddresses} from '../modules/addresses/compiler';
import {aeroways, type TileflowAerowaysModuleConfig} from '../modules/aeroways';
import {compileAeroways} from '../modules/aeroways/compiler';
import {boundaries, type TileflowBoundariesModuleConfig} from '../modules/boundaries';
import {compileBoundaries} from '../modules/boundaries/compiler';
import {buildings, type TileflowBuildingsModuleConfig} from '../modules/buildings';
import {compileBuildings} from '../modules/buildings/compiler';
import {labels, resolveLabels} from '../modules/labels';
import {compileLabels} from '../modules/labels/compiler';
import {land, type TileflowLandModuleConfig} from '../modules/land';
import {compileLand} from '../modules/land/compiler';
import {landforms, type TileflowLandformsModuleConfig} from '../modules/landforms';
import {compileLandforms} from '../modules/landforms/compiler';
import {nautical, type TileflowNauticalModuleConfig} from '../modules/nautical';
import {compileNautical} from '../modules/nautical/compiler';
import {poi} from '../modules/poi';
import {compilePoi} from '../modules/poi/compiler';
import type {TileflowResolvedModuleConfig} from '../modules/resolved';
import {roads} from '../modules/roads';
import {compileRoads} from '../modules/roads/compiler';
import {type TileflowTransitModuleConfig, transit} from '../modules/transit';
import {compileTransit} from '../modules/transit/compiler';
import {type TileflowVegetationModuleConfig, vegetation} from '../modules/vegetation';
import {compileVegetation} from '../modules/vegetation/compiler';
import {type TileflowWaterModuleConfig, water} from '../modules/water';
import {compileWater} from '../modules/water/compiler';
import type {
  TileflowLabelLanguage,
  TileflowLabelsModuleConfig,
  TileflowPoiModuleConfig,
  TileflowRoadsModuleConfig,
} from '../types';
import type {TileflowDomainCompileContext} from './context';
import type {TileflowLayerContribution} from './contributions';
import {mergeTileflowDesign} from './merge';

export type TileflowSemanticModules = {
  addresses?: TileflowAddressesModuleConfig;
  aeroways?: TileflowAerowaysModuleConfig;
  boundaries?: TileflowBoundariesModuleConfig;
  buildings?: TileflowBuildingsModuleConfig;
  labels?: TileflowLabelsModuleConfig;
  land?: TileflowLandModuleConfig;
  landforms?: TileflowLandformsModuleConfig;
  nautical?: TileflowNauticalModuleConfig;
  poi?: TileflowPoiModuleConfig;
  roads?: TileflowRoadsModuleConfig;
  transit?: TileflowTransitModuleConfig;
  vegetation?: TileflowVegetationModuleConfig;
  water?: TileflowWaterModuleConfig;
};

export type TileflowSemanticModuleName = keyof TileflowSemanticModules;

export type TileflowResolvedSemanticModuleOverrides = {
  readonly [TName in TileflowSemanticModuleName]?: TileflowResolvedModuleConfig<
    NonNullable<TileflowSemanticModules[TName]>
  >;
};

export type TileflowResolvedSemanticModules = {
  readonly [TName in TileflowSemanticModuleName]-?: NonNullable<
    TileflowResolvedSemanticModuleOverrides[TName]
  >;
};

export type TileflowDomainService = {
  readonly language: TileflowLabelLanguage;
};

export type TileflowDomainDependencyMetadata = {
  readonly modules: readonly TileflowSemanticModuleName[];
  readonly services: readonly (keyof TileflowDomainService)[];
};

export type TileflowDomainRegistryMetadata = {
  readonly dependencies: TileflowDomainDependencyMetadata;
  readonly name: TileflowSemanticModuleName;
  readonly order: number;
  readonly provides: readonly (keyof TileflowDomainService)[];
};

export type TileflowCompiledDomain = {
  readonly contributionCount: number;
  readonly contributions: readonly TileflowLayerContribution[];
  readonly name: TileflowSemanticModuleName;
  readonly status: 'emitted' | 'suppressed';
  readonly suppressionReason?: 'disabled' | 'no-contributions';
  readonly targets: readonly string[];
};

export type TileflowCompiledDomains = {
  readonly contributions: readonly TileflowLayerContribution[];
  readonly domains: readonly TileflowCompiledDomain[];
};

type DependencyDeclaration = {
  readonly modules?: readonly TileflowSemanticModuleName[];
  readonly services?: readonly (keyof TileflowDomainService)[];
};

type ModuleDependencyName<TDependencies extends DependencyDeclaration> = TDependencies extends {
  readonly modules: readonly (infer TName)[];
}
  ? Extract<TName, TileflowSemanticModuleName>
  : never;

type ServiceDependencyName<TDependencies extends DependencyDeclaration> = TDependencies extends {
  readonly services: readonly (infer TName)[];
}
  ? Extract<TName, keyof TileflowDomainService>
  : never;

type DomainDependencyReader<TDependencies extends DependencyDeclaration> = {
  module<TName extends ModuleDependencyName<TDependencies>>(
    name: TName,
  ): TileflowResolvedSemanticModules[TName];
  service<TName extends ServiceDependencyName<TDependencies>>(
    name: TName,
  ): TileflowDomainService[TName];
};

type DomainDefinition<
  TName extends TileflowSemanticModuleName,
  TDependencies extends DependencyDeclaration,
> = {
  readonly compile: (input: {
    readonly context: TileflowDomainCompileContext;
    readonly dependencies: DomainDependencyReader<TDependencies>;
    readonly module: TileflowResolvedSemanticModules[TName];
  }) => readonly TileflowLayerContribution[];
  readonly defaultModule: TileflowResolvedSemanticModules[TName];
  readonly dependencies: TDependencies;
  readonly name: TName;
  readonly provides?: readonly (keyof TileflowDomainService)[];
  readonly resolveServices?: (input: {
    readonly context: TileflowDomainCompileContext;
    readonly module: TileflowResolvedSemanticModules[TName];
  }) => Partial<TileflowDomainService>;
};

type RuntimeDomainDefinition<TName extends TileflowSemanticModuleName> = {
  readonly compileResolved: (
    modules: TileflowResolvedSemanticModules,
    context: TileflowDomainCompileContext,
    services: Partial<TileflowDomainService>,
  ) => readonly TileflowLayerContribution[];
  readonly defaultEntry: () => readonly [TName, TileflowResolvedSemanticModules[TName]];
  readonly dependencies: TileflowDomainDependencyMetadata;
  readonly isEnabled: (modules: TileflowResolvedSemanticModules) => boolean;
  readonly name: TName;
  readonly provides: readonly (keyof TileflowDomainService)[];
  readonly resolveEntry: (
    overrides: TileflowResolvedSemanticModuleOverrides | undefined,
  ) => readonly [TName, TileflowResolvedSemanticModules[TName]];
  readonly resolveServices: (
    modules: TileflowResolvedSemanticModules,
    context: TileflowDomainCompileContext,
  ) => Partial<TileflowDomainService>;
};

function defineDomain<
  const TName extends TileflowSemanticModuleName,
  const TDependencies extends DependencyDeclaration,
>(definition: DomainDefinition<TName, TDependencies>): RuntimeDomainDefinition<TName> {
  const dependencies = Object.freeze({
    modules: Object.freeze([...(definition.dependencies.modules ?? [])]),
    services: Object.freeze([...(definition.dependencies.services ?? [])]),
  });
  const provides = Object.freeze([...(definition.provides ?? [])]);
  return Object.freeze({
    compileResolved(
      modules: TileflowResolvedSemanticModules,
      context: TileflowDomainCompileContext,
      services: Partial<TileflowDomainService>,
    ) {
      const dependencyReader: DomainDependencyReader<TDependencies> = {
        module<TDependencyName extends ModuleDependencyName<TDependencies>>(
          name: TDependencyName,
        ): TileflowResolvedSemanticModules[TDependencyName] {
          return modules[name];
        },
        service<TServiceName extends ServiceDependencyName<TDependencies>>(
          name: TServiceName,
        ): TileflowDomainService[TServiceName] {
          const service = services[name];
          if (service === undefined) {
            throw new Error(
              `Tileflow domain ${definition.name} requires unavailable service ${String(name)}.`,
            );
          }
          return service;
        },
      };
      return definition.compile({
        context,
        dependencies: dependencyReader,
        module: modules[definition.name],
      });
    },
    defaultEntry() {
      return [definition.name, definition.defaultModule] as const;
    },
    dependencies,
    isEnabled(modules: TileflowResolvedSemanticModules) {
      return modules[definition.name].enabled !== false;
    },
    name: definition.name,
    provides,
    resolveEntry(overrides: TileflowResolvedSemanticModuleOverrides | undefined) {
      return [
        definition.name,
        mergeTileflowDesign(definition.defaultModule, overrides?.[definition.name]),
      ] as const;
    },
    resolveServices(modules, context) {
      return definition.resolveServices?.({context, module: modules[definition.name]}) ?? {};
    },
  });
}

export const tileflowSemanticDomainRegistry = Object.freeze([
  defineDomain({
    compile: ({context, module}) => compileLand(module, context),
    defaultModule: land(),
    dependencies: {},
    name: 'land',
  }),
  defineDomain({
    compile: ({context, module}) => compileWater(module, context),
    defaultModule: water(),
    dependencies: {},
    name: 'water',
  }),
  defineDomain({
    compile: ({context, module}) => compileNautical(module, context),
    defaultModule: nautical(),
    dependencies: {},
    name: 'nautical',
  }),
  defineDomain({
    compile: ({context, module}) => compileBuildings(module, context),
    defaultModule: buildings(),
    dependencies: {},
    name: 'buildings',
  }),
  defineDomain({
    compile: ({context, module}) => compileVegetation(module, context),
    defaultModule: vegetation({mode: '3d'}),
    dependencies: {},
    name: 'vegetation',
  }),
  defineDomain({
    compile: ({context, module}) => compileRoads(module, context),
    defaultModule: roads({
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
    dependencies: {},
    name: 'roads',
  }),
  defineDomain({
    compile: ({context, module}) => compileTransit(module, context),
    defaultModule: transit(),
    dependencies: {},
    name: 'transit',
  }),
  defineDomain({
    compile: ({context, module}) => compileAeroways(module, context),
    defaultModule: aeroways(),
    dependencies: {},
    name: 'aeroways',
  }),
  defineDomain({
    compile: ({context, module}) => compileBoundaries(module, context),
    defaultModule: boundaries(),
    dependencies: {},
    name: 'boundaries',
  }),
  defineDomain({
    compile: ({context, dependencies, module}) =>
      compileLabels(module, dependencies.module('roads'), context),
    defaultModule: labels(),
    dependencies: {modules: ['roads']},
    name: 'labels',
    provides: ['language'],
    resolveServices: ({module}) => ({language: resolveLabels(module).language}),
  }),
  defineDomain({
    compile: ({context, dependencies, module}) =>
      compileLandforms(module, dependencies.service('language'), context),
    defaultModule: landforms(),
    dependencies: {services: ['language']},
    name: 'landforms',
  }),
  defineDomain({
    compile: ({context, module}) => compileAddresses(module, context),
    defaultModule: addresses(),
    dependencies: {},
    name: 'addresses',
  }),
  defineDomain({
    compile: ({context, dependencies, module}) =>
      compilePoi(module, context, dependencies.service('language')),
    defaultModule: poi({icons: true}),
    dependencies: {services: ['language']},
    name: 'poi',
  }),
]);

assertRegistryIsValid();

export const tileflowSemanticModuleNames = Object.freeze(
  tileflowSemanticDomainRegistry.map(({name}) => name).sort(compareCodeUnits),
);

export const tileflowSemanticDomainMetadata: readonly TileflowDomainRegistryMetadata[] =
  Object.freeze(
    tileflowSemanticDomainRegistry.map(({dependencies, name, provides}, order) =>
      Object.freeze({dependencies, name, order, provides}),
    ),
  );

export const tileflowSemanticDefaultModules = Object.freeze(
  checkedModuleRecord(tileflowSemanticDomainRegistry.map((domain) => domain.defaultEntry())),
);

export function resolveSemanticModules(
  overrides: TileflowResolvedSemanticModuleOverrides | undefined,
): TileflowResolvedSemanticModules {
  return checkedModuleRecord(
    tileflowSemanticDomainRegistry.map((domain) => domain.resolveEntry(overrides)),
  );
}

export function compileSemanticDomains(
  modules: TileflowResolvedSemanticModules,
  context: TileflowDomainCompileContext,
): TileflowCompiledDomains {
  const services: Partial<TileflowDomainService> = {};
  const domains = tileflowSemanticDomainRegistry.map((domain): TileflowCompiledDomain => {
    const contributions = domain.compileResolved(modules, context, services);
    const providedServices = domain.resolveServices(modules, context);
    assertProvidedServices(domain, providedServices);
    Object.assign(services, providedServices);
    const targets = [...new Set(contributions.map(({target}) => target))].sort(compareCodeUnits);
    const emitted = contributions.length > 0;
    return {
      contributionCount: contributions.length,
      contributions,
      name: domain.name,
      status: emitted ? 'emitted' : 'suppressed',
      ...(!emitted
        ? {suppressionReason: domain.isEnabled(modules) ? 'no-contributions' : 'disabled'}
        : {}),
      targets,
    };
  });
  return {contributions: domains.flatMap(({contributions}) => contributions), domains};
}

function assertProvidedServices(
  domain: (typeof tileflowSemanticDomainRegistry)[number],
  services: Partial<TileflowDomainService>,
): void {
  const declared = new Set<string>(domain.provides);
  const actual = Object.keys(services);
  if (
    actual.length !== declared.size ||
    actual.some((service) => !declared.has(service)) ||
    domain.provides.some((service) => services[service] === undefined)
  ) {
    throw new Error(`Tileflow domain ${domain.name} did not provide its declared services.`);
  }
}

function checkedModuleRecord(
  entries: readonly (readonly [
    TileflowSemanticModuleName,
    TileflowResolvedSemanticModules[TileflowSemanticModuleName],
  ])[],
): TileflowResolvedSemanticModules {
  const record = Object.fromEntries(entries);
  const actual = Object.keys(record).sort(compareCodeUnits);
  if (
    actual.length !== tileflowSemanticDomainRegistry.length ||
    actual.some(
      (name, index) =>
        name !==
        [...tileflowSemanticDomainRegistry.map(({name}) => name)].sort(compareCodeUnits)[index],
    )
  ) {
    throw new Error(
      'Tileflow semantic domain registry did not produce one value for every module.',
    );
  }
  // Object.fromEntries cannot retain the key/value correlation established by each typed entry.
  // The exhaustive runtime check above makes this the registry's only structural assertion.
  return record as TileflowResolvedSemanticModules;
}

function assertRegistryIsValid(): void {
  const names = new Set<TileflowSemanticModuleName>();
  const services = new Set<keyof TileflowDomainService>();
  for (const domain of tileflowSemanticDomainRegistry) {
    if (names.has(domain.name)) throw new Error(`Duplicate Tileflow domain: ${domain.name}`);
    for (const dependency of domain.dependencies.modules) {
      if (!names.has(dependency)) {
        throw new Error(
          `Tileflow domain ${domain.name} requires later or unknown module ${dependency}.`,
        );
      }
    }
    for (const dependency of domain.dependencies.services) {
      if (!services.has(dependency)) {
        throw new Error(
          `Tileflow domain ${domain.name} requires unavailable service ${dependency}.`,
        );
      }
    }
    names.add(domain.name);
    for (const service of domain.provides) services.add(service);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
