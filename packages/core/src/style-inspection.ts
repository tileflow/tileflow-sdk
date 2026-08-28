import type {TileflowInspectedStyle} from './cartography/compiler-inspection';
import {
  compileSemanticStyleWithInspection,
  type TileflowSemanticMapConfig,
} from './cartography/streets';
import {collectMapLineage, parseTileflowMap, type TileflowStyleOptions} from './map';
import type {TileflowMap} from './maps';

export {
  tileflowStyleInspectionSchemaVersion,
  type TileflowInspectedStyle,
  type TileflowStyleInspection,
  type TileflowStyleInspectionContribution,
  type TileflowStyleInspectionRenderOperation,
  type TileflowStyleInspectionLayer,
} from './cartography/compiler-inspection';

/**
 * Compile the ordinary MapLibre Style and a separate read-only physical-output sidecar.
 * Its physical IDs are diagnostic observations, never authoring targets. The sidecar never enters
 * the Style object or runtime manifest.
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
        version: compiled.version,
      } satisfies NonNullable<TileflowStyleOptions['map']>),
  };
  return compileTileflowMapWithInspection(compiled, compileOptions);
}

function compileTileflowMapWithInspection(
  config: TileflowSemanticMapConfig,
  options: TileflowStyleOptions,
): TileflowInspectedStyle {
  return compileSemanticStyleWithInspection(config, options);
}
