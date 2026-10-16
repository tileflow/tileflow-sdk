import type {ManifestSchema, ManifestSchemaOperations} from './manifest-schema-operations';
import type {TileflowTimeOfDayVariants} from './time-of-day';

/** The authoring and both runtime parsers use the same finite, JSON-safe catalog grammar. */
export function createTileflowTimeOfDaySchema(
  operations: ManifestSchemaOperations,
  themeName: ManifestSchema<string>,
): ManifestSchema<TileflowTimeOfDayVariants> {
  return operations.record(
    themeName,
    operations.object({
      day: operations.optional(themeName),
      dawn: operations.optional(themeName),
      dusk: operations.optional(themeName),
      night: operations.optional(themeName),
    }),
  );
}
