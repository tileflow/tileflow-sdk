import {z} from 'zod';

export const tileflowWorldGeneration = 'v1' as const;
export const tileflowWorldTileUrl = 'https://world.tileflow.dev/world/v1/{z}/{x}/{y}.pbf' as const;

export type WorldDataDescriptor = {
  attribution: string;
  bounds: [number, number, number, number];
  maxzoom: number;
  minzoom: number;
  schemaVersion: 1;
  tileEncoding: {
    compression: 'gzip';
    extent: 4096;
    format: 'mvt';
    scheme: 'xyz';
  };
  vectorSchema: {id: string; sha256: string};
};

export type WorldGenerationDescriptor = WorldDataDescriptor & {
  assetSet: {
    glyphs: string;
    id: string;
    spriteBase: string;
  };
  generation: typeof tileflowWorldGeneration;
  tileUrl: typeof tileflowWorldTileUrl;
};

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const assetSetIdSchema = z.string().regex(/^a1-[0-9a-f]{16}$/);
const containsUnsafeAttributionCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 || character === '<' || character === '>';
  });
const boundedAttributionSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value === value.trim(), 'attribution must not have surrounding whitespace')
  .refine(
    (value) => !containsUnsafeAttributionCharacter(value),
    'attribution must not contain control characters or active markup',
  );

const worldDataDescriptorShape = {
  schemaVersion: z.literal(1),
  vectorSchema: z.object({id: z.string().min(1).max(128), sha256: sha256Schema}).strict(),
  tileEncoding: z
    .object({
      format: z.literal('mvt'),
      compression: z.literal('gzip'),
      scheme: z.literal('xyz'),
      extent: z.literal(4096),
    })
    .strict(),
  minzoom: z.number().int().min(0).max(30),
  maxzoom: z.number().int().min(0).max(30),
  bounds: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
  attribution: boundedAttributionSchema,
};

export const worldGenerationDescriptorSchema = z
  .object({
    ...worldDataDescriptorShape,
    generation: z.literal(tileflowWorldGeneration),
    tileUrl: z.literal(tileflowWorldTileUrl),
    assetSet: z
      .object({
        id: assetSetIdSchema,
        glyphs: z.string().url(),
        spriteBase: z.string().url(),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.minzoom <= value.maxzoom, 'minzoom must not exceed maxzoom')
  .refine(
    (value) => value.bounds[0] < value.bounds[2] && value.bounds[1] < value.bounds[3],
    'bounds must have increasing axes',
  )
  .superRefine((value, context) => {
    const prefix = `https://assets.tileflow.dev/base/${value.assetSet.id}`;
    if (value.assetSet.glyphs !== `${prefix}/glyphs/{fontstack}/{range}.pbf`) {
      context.addIssue({
        code: 'custom',
        message: 'glyph URL must match the content-identified asset set',
        path: ['assetSet', 'glyphs'],
      });
    }
    if (value.assetSet.spriteBase !== `${prefix}/sprites/base`) {
      context.addIssue({
        code: 'custom',
        message: 'sprite URL must match the content-identified asset set',
        path: ['assetSet', 'spriteBase'],
      });
    }
  });

export function parseWorldGenerationDescriptor(value: unknown): WorldGenerationDescriptor {
  return worldGenerationDescriptorSchema.parse(value) as WorldGenerationDescriptor;
}
