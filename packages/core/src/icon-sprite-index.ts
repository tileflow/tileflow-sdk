import {z} from 'zod';
import {tileflowIconIdSchema, tileflowIconPackageLimits} from './icon-package';

/** Portable generated-index shape; geometry and pixel integrity require paired artifact verification. */
export const tileflowIconSpriteIndexEntrySchema = z
  .object({
    height: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    width: z.number().int().positive().max(tileflowIconPackageLimits.maxAtlasDimension),
    pixelRatio: z.union([z.literal(1), z.literal(2)]),
    x: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
    y: z.number().int().nonnegative().max(tileflowIconPackageLimits.maxAtlasDimension),
  })
  .strict();

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
