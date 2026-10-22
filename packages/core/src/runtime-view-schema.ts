import type {ManifestSchema, ManifestSchemaOperations} from './manifest-schema-operations';
import type {TileflowViewConfig} from './types';
import {tileflowMaxPitch} from './camera-limits';

/** The view grammar shared by manifest validation and renderer-neutral initial-view inputs. */
export function createTileflowRuntimeViewSchema(
  operations: ManifestSchemaOperations,
): ManifestSchema<TileflowViewConfig> {
  return operations.object<TileflowViewConfig>({
    bearing: operations.optional(operations.number(-180, 180)),
    center: operations.optional(
      operations.tuplePair(operations.number(-180, 180), operations.number(-90, 90)),
    ),
    pitch: operations.optional(operations.number(0, tileflowMaxPitch)),
    zoom: operations.optional(operations.number(0, 24)),
  });
}
