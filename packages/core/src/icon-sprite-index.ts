import {z} from 'zod';
import {tileflowIconAppearanceSchema} from './icon-appearance';
import {
  assertTileflowIconLayoutBounds,
  readTileflowIconLayout,
  tileflowIconLayoutFields,
} from './icon-layout';
import {tileflowIconIdSchema, tileflowIconPackageLimits} from './icon-package';

/** Portable generated-index shape; geometry and pixel integrity require paired artifact verification. */
export const tileflowIconSpriteIndexEntrySchema = z
  .object({
    ...tileflowIconLayoutFields,
    height: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    width: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    pixelRatio: z.union([z.literal(1), z.literal(2)]),
    x: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
    y: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
    sdf: z.literal(true).optional(),
    tileflow: tileflowIconAppearanceSchema.optional(),
  })
  .strict()
  .refine(
    (entry) => (entry.sdf === true) === (entry.tileflow !== undefined),
    'SDF entries require verified Tileflow appearance metadata',
  )
  .superRefine((entry, context) => {
    try {
      const layout = readTileflowIconLayout(entry);
      if (layout) assertTileflowIconLayoutBounds(layout, entry.width, entry.height);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid icon layout',
      });
    }
  });

export const tileflowIconSpriteIndexSchema = z
  .record(tileflowIconIdSchema, tileflowIconSpriteIndexEntrySchema)
  .refine(
    (index) =>
      Object.keys(index).length > 0 &&
      Object.keys(index).length <= tileflowIconPackageLimits.maxIconCount,
    'A generated sprite index must contain 1 through 256 icons',
  );

export type TileflowIconSpriteIndexEntry = z.infer<typeof tileflowIconSpriteIndexEntrySchema>;
export type TileflowIconSpriteIndex = z.infer<typeof tileflowIconSpriteIndexSchema>;
