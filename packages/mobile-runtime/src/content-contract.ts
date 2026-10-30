import {z} from 'zod';
import {
  type TileflowAnnotation,
  tileflowAnnotationsSchema,
  type TileflowInteractionJsonValue,
  tileflowInteractionJsonValueSchema,
} from '@tileflow/interactions';

const number = z.number().finite();
const position = z.union([
  z.tuple([number.min(-180).max(180), number.min(-90).max(90)]),
  z.tuple([number.min(-180).max(180), number.min(-90).max(90), number]),
]);
// RFC 7946 allows a bounding box on every GeoJSON object.
const bbox = z
  .union([
    z.tuple([number, number, number, number]),
    z.tuple([number, number, number, number, number, number]),
  ])
  .optional();
const line = z.array(position).min(2).max(4000);
const ring = z
  .array(position)
  .min(4)
  .max(4000)
  .refine((points) => JSON.stringify(points[0]) === JSON.stringify(points.at(-1)));
const polygon = z.array(ring).min(1).max(128);
const geometry = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('Point'), coordinates: position, bbox}),
  z.strictObject({type: z.literal('MultiPoint'), coordinates: z.array(position).max(2000), bbox}),
  z.strictObject({type: z.literal('LineString'), coordinates: line, bbox}),
  z.strictObject({type: z.literal('MultiLineString'), coordinates: z.array(line).max(128), bbox}),
  z.strictObject({type: z.literal('Polygon'), coordinates: polygon, bbox}),
  z.strictObject({type: z.literal('MultiPolygon'), coordinates: z.array(polygon).max(128), bbox}),
]);
const jsonValue = z.custom<TileflowInteractionJsonValue>(
  (value) => tileflowInteractionJsonValueSchema.safeParse(value).success,
);
const feature = z.strictObject({
  type: z.literal('Feature'),
  id: z.union([z.string().max(128), number.int()]).optional(),
  geometry: geometry.nullable(),
  properties: z.record(z.string().max(128), jsonValue).nullable(),
  bbox,
});
export const overlaySchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
  data: z.strictObject({
    type: z.literal('FeatureCollection'),
    features: z.array(feature).max(2000),
    bbox,
  }),
  kind: z.enum(['circle', 'line', 'fill']),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu)
    .default('#e9573f'),
  size: number.min(0).max(64).default(6),
  opacity: number.min(0).max(1).default(1),
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
