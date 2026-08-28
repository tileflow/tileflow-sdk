import type {TileflowInspectedStyle} from './cartography/compiler-inspection';
import {
  compileStreetsStyleWithInspection,
  type TileflowStreetsMapConfig,
} from './cartography/streets';
import {collectMapLineage, parseTileflowMap, type TileflowStyleOptions} from './map';
import {type TileflowMap, tileflowStreetsCompilerVersion} from './maps';

export {
  tileflowStyleInspectionSchemaVersion,
  type TileflowInspectedStyle,
  type TileflowStyleInspection,
  type TileflowStyleInspectionContribution,
  type TileflowStyleInspectionEffect,
  type TileflowStyleInspectionLayer,
} from './cartography/compiler-inspection';

/**
 * Compile the ordinary MapLibre Style and a separate build-only inspection sidecar.
 * The sidecar never enters the Style object or runtime manifest.
 */
export function createStyleWithInspection(
  config: TileflowMap,
  options: TileflowStyleOptions = {},
): TileflowInspectedStyle {
  const compiled = parseTileflowMap(config);
  const compileOptions: TileflowStyleOptions = {
    ...options,
    map:
      options.map ??
      ({
        id: compiled.id,
        lineage: collectMapLineage(config),
        root: compiled.root,
        version: compiled.version,
      } satisfies NonNullable<TileflowStyleOptions['map']>),
  };
  return compileTileflowMapWithInspection(compiled, compileOptions);
}

function compileTileflowMapWithInspection(
  config: TileflowStreetsMapConfig,
  options: TileflowStyleOptions,
): TileflowInspectedStyle {
  switch (config.root.compiler) {
    case 'streets': {
      if (config.root.compilerVersion !== tileflowStreetsCompilerVersion) {
        throw new Error(
          `Unsupported Streets compiler version: ${String(config.root.compilerVersion)}`,
        );
      }
      return compileStreetsStyleWithInspection(config, options);
    }
  }
}
