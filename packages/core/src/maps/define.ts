import type {TileflowDerivedMap, TileflowMapScene, TileflowRootMap} from './types';

type ExactTileflowMap<TContract, TMap extends TContract> = TMap &
  Record<Exclude<keyof TMap, keyof TContract>, never>;

type ExactTileflowMapScenes<TMap> = TMap extends {
  scenes: infer TScenes extends Record<string, TileflowMapScene>;
}
  ? {
      scenes: {
        [TName in keyof TScenes]: ExactTileflowMap<TileflowMapScene, TScenes[TName]>;
      };
    }
  : unknown;

/** Preserve the exact inferred type of a compiler-root map. */
export function defineRootMap<const TMap extends TileflowRootMap>(
  map: ExactTileflowMap<TileflowRootMap, TMap> & ExactTileflowMapScenes<TMap>,
): TMap {
  return map;
}

/** Preserve the exact inferred type of a map that extends another map object. */
export function defineMap<const TMap extends TileflowDerivedMap>(
  map: ExactTileflowMap<TileflowDerivedMap, TMap> & ExactTileflowMapScenes<TMap>,
): TMap {
  return map;
}

type IsNever<T> = [T] extends [never] ? true : false;
type Assert<T extends true> = T;
type RootMapWithUnknownKey = TileflowRootMap & {basemap: unknown};
type DerivedMapWithUnknownKey = TileflowDerivedMap & {sprite: unknown};
type RootMapWithExplicitSceneMap = TileflowRootMap & {
  scenes: {
    proof: TileflowMapScene & {map: string};
  };
};
type RootMapUnknownKeyArgument = Parameters<typeof defineRootMap<RootMapWithUnknownKey>>[0];
type DerivedMapUnknownKeyArgument = Parameters<typeof defineMap<DerivedMapWithUnknownKey>>[0];
type RootMapExplicitSceneMapArgument = Parameters<
  typeof defineRootMap<RootMapWithExplicitSceneMap>
>[0];

/** Compile-time contract tests: unknown authoring keys must resolve to `never`. */
type DefineMapExactKeyTests = [
  Assert<IsNever<RootMapUnknownKeyArgument['basemap']>>,
  Assert<IsNever<DerivedMapUnknownKeyArgument['sprite']>>,
  Assert<IsNever<RootMapExplicitSceneMapArgument['scenes']['proof']['map']>>,
];
