import {z} from 'zod';
import {type TileflowAnnotation, tileflowAnnotationsSchema} from '@tileflow/interactions';
import {dataReferenceSchema} from './data';

/**
 * An application layer. Its GeoJSON travels over the data channel and is validated by the
 * runtime after the transfer, so its size is bounded by bytes rather than by message limits.
 */
export const overlaySchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  data: dataReferenceSchema,
  kind: z.enum(['circle', 'line', 'fill']),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu)
    .default('#e9573f'),
  size: z.number().finite().min(0).max(64).default(6),
  opacity: z.number().finite().min(0).max(1).default(1),
});
export const contentSchema = z.strictObject({
  annotations: z.custom<TileflowAnnotation[]>(
    (value) =>
      Array.isArray(value) &&
      value.length <= 128 &&
      tileflowAnnotationsSchema.safeParse(value).success &&
      value.every(
        (item: TileflowAnnotation) =>
          item.popup === undefined &&
          item.tooltip === undefined &&
          item.marker?.content === undefined,
      ) &&
      new Set(value.map((item: TileflowAnnotation) => item.id)).size === value.length,
  ),
  overlays: z
    .array(overlaySchema)
    .max(16)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});
export type MapContent = z.infer<typeof contentSchema>;
export type Overlay = z.infer<typeof overlaySchema>;
