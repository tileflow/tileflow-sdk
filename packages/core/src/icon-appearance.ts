import {Color} from '@maplibre/maplibre-gl-style-spec';
import {z} from 'zod';
import {tileflowIconLayoutSchema} from './icon-layout';

const color = z
  .string()
  .max(128)
  .refine((value) => Color.parse(value) !== undefined, 'Expected a MapLibre color');

export const tileflowIconAppearanceSchema = z
  .object({
    representation: z.literal('sdf'),
    defaults: z
      .object({
        color,
        haloColor: color,
        haloWidth: z.number().finite().min(0).max(2),
        haloBlur: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .strict();

/** Absent metadata denotes unchanged fixed-color RGBA artwork. */
export type TileflowIconAppearance = z.infer<typeof tileflowIconAppearanceSchema>;

/** Verify the generated representation from decoded pixels, independently of its declaration. */
export function assertTileflowSdfPixels(input: {
  rgba: Uint8Array;
  width: number;
  height: number;
  pixelRatio: 1 | 2;
}): void {
  const {rgba, width, height, pixelRatio} = input;
  if (width !== 24 * pixelRatio || height !== 24 * pixelRatio || rgba.length !== width * height * 4)
    throw new Error('SDF cells must have 24px logical dimensions.');
  let transition = false;
  let interior = false;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const alpha = rgba[offset + 3]!;
      if (alpha && (rgba[offset] !== 255 || rgba[offset + 1] !== 255 || rgba[offset + 2] !== 255))
        throw new Error('SDF pixels must encode distance in alpha with white RGB.');
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && alpha !== 0)
        throw new Error('SDF distance fields must have a transparent outer border.');
      transition ||= alpha > 0 && alpha < 191;
      interior ||= alpha > 191;
    }
  if (!transition || !interior)
    throw new Error('SDF pixels require an interior and a distance transition.');
}

export const tileflowIconMetadataFileName = 'tileflow.icons.json';

export const tileflowIconAuthorMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    icons: z.record(
      z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
      z.union([
        z
          .object({representation: z.literal('rgba'), layout: tileflowIconLayoutSchema.optional()})
          .strict(),
        tileflowIconAppearanceSchema.extend({
          layout: tileflowIconLayoutSchema.optional(),
          defaults: tileflowIconAppearanceSchema.shape.defaults.extend({
            haloColor: color.default('transparent'),
            haloWidth: z.number().finite().min(0).max(2).default(0),
            haloBlur: z.number().finite().min(0).max(1).default(0),
          }),
        }),
      ]),
    ),
  })
  .strict();
