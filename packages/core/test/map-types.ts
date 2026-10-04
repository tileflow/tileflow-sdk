import {defineMap} from '../src/maps/define';
import type {TileflowMapScene, TileflowStandaloneMap} from '../src/maps/types';

type IsNever<T> = [T] extends [never] ? true : false;
type Assert<T extends true> = T;
type StandaloneMapWithUnknownKey = TileflowStandaloneMap & {basemap: unknown};
type StandaloneMapWithLegacyRoot = TileflowStandaloneMap & {root: unknown};
type StandaloneMapWithExplicitSceneMap = TileflowStandaloneMap & {
  scenes: {
    proof: TileflowMapScene & {map: string};
  };
};
type StandaloneMapUnknownKeyArgument = Parameters<typeof defineMap<StandaloneMapWithUnknownKey>>[0];
type StandaloneMapLegacyRootArgument = Parameters<typeof defineMap<StandaloneMapWithLegacyRoot>>[0];
type StandaloneMapExplicitSceneMapArgument = Parameters<
  typeof defineMap<StandaloneMapWithExplicitSceneMap>
>[0];

/** Compile-time contract tests: unknown authoring keys must resolve to `never`. */
export type DefineMapExactKeyTests = [
  Assert<IsNever<StandaloneMapUnknownKeyArgument['basemap']>>,
  Assert<IsNever<StandaloneMapLegacyRootArgument['root']>>,
  Assert<IsNever<StandaloneMapExplicitSceneMapArgument['scenes']['proof']['map']>>,
];
