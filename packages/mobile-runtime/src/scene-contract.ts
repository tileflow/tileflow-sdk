import {z} from 'zod';
import {dataReferenceSchema} from './data';

// Requests for the parts of a Tileflow map that the web SDKs drive through Core's controllers: the
// view mode and its rise, the sun, emphasis, style states, Boundaries values, application images,
// depth markers, line progress and camera shots. Larger inputs travel over the data channel.

const finite = z.number().finite();
/** A theme-style transition, in milliseconds, as Core accepts it. */
const duration = finite.min(0).max(5000).default(0);
const unit = finite.min(0).max(1);
const coordinate = z.strictObject({
  longitude: finite.min(-180).max(180),
  latitude: finite.min(-90).max(90),
});
const layerId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
const imageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const themeName = z.string().min(1).max(128);
const color = z.string().regex(/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu);

export const viewModeRequestSchema = z.strictObject({
  viewMode: z.enum(['2d', '3d']),
  /** How long the buildings take to rise or descend; 0 changes at once. */
  duration,
});

/** Dates as milliseconds since 1970, within the range a JavaScript date holds. */
const instant = finite.min(-8.64e15).max(8.64e15);
export const sunRequestSchema = z.strictObject({
  sun: z
    .union([
      z.strictObject({azimuth: finite.min(-360).max(360), altitude: finite.min(-90).max(90)}),
      z.strictObject({date: instant, location: coordinate.optional()}),
    ])
    .nullable(),
  duration,
});

export const emphasisRequestSchema = z.strictObject({
  emphasis: z
    .strictObject({
      recede: z
        .record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u), unit)
        .refine((value) => Object.keys(value).length <= 64)
        .optional(),
      labels: unit.optional(),
      /** A GeoJSON Polygon or MultiPolygon geometry, read from the data channel. */
      keep: dataReferenceSchema.optional(),
    })
    .nullable(),
  duration,
});

export const styleStateRequestSchema = z.strictObject({
  name: z.string().regex(/^\S(?:.{0,126}\S)?$/u),
  value: z.union([z.boolean(), finite, z.string().max(1024), z.null()]),
  duration,
});

export const boundaryValuesRequestSchema = z.strictObject({
  values: z
    .strictObject({
      /** The polygons' feature key the rows are joined by: `id`, or `ref` when the map promotes it. */
      joinBy: z.enum(['id', 'ref']),
      /** JSON `[[key, value], …]`, read from the data channel; a null value removes the row. */
      rows: dataReferenceSchema,
    })
    .nullable(),
  family: z.enum(['boundaries']).default('boundaries'),
  labels: z.boolean().default(false),
  state: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .default('value'),
});

export const imagesRequestSchema = z.strictObject({
  images: z
    .array(
      z.strictObject({
        name: imageName,
        /** A PNG or JPEG image, read from the data channel. */
        data: dataReferenceSchema,
        /** Physical pixels per point of the image. */
        pixelRatio: finite.min(1).max(4).default(1),
        /** The image to show instead while a named theme is on screen, of the same size. */
        variants: z.record(themeName, dataReferenceSchema).optional(),
        /** A signed distance field: layers recolour it with `icon-color` and `icon-halo-color`. */
        sdf: z.boolean().default(false),
      }),
    )
    .max(64)
    .refine((items) => new Set(items.map((item) => item.name)).size === items.length),
});

export const depthMarkersRequestSchema = z.strictObject({
  markers: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u),
        coordinate,
        /** The name of an application image passed with `setImages`. */
        image: imageName,
        /** Points for a screen marker, metres for a ground marker. */
        size: z.tuple([finite.min(0).max(4096), finite.min(0).max(4096)]),
        alignment: z.enum(['screen', 'ground']).default('screen'),
        anchor: z.enum(['center', 'bottom']).default('center'),
        offset: z.tuple([finite.min(-4096).max(4096), finite.min(-4096).max(4096)]).optional(),
        rotation: finite.min(-360).max(360).default(0),
        altitude: finite.min(-1000).max(10_000).default(0),
        opacity: unit.default(1),
        occlude: z.boolean().default(true),
      }),
    )
    .max(128)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});

/** A line's drawn stretch, as shares of its length, and its highlights. */
export const lineProgressStateSchema = z.strictObject({
  start: unit.optional(),
  end: unit.optional(),
  /** Where a light sits along the line; null takes it off. */
  light: unit.nullable().optional(),
  opacity: unit.optional(),
});

export const lineProgressAnimationSchema = z.strictObject({
  /** Application line layers drawn with progress. */
  layers: z
    .array(layerId)
    .min(1)
    .max(16)
    .refine((items) => new Set(items).size === items.length),
  to: lineProgressStateSchema,
  /** Milliseconds, as Core's line progress accepts. */
  duration: finite.min(0).max(60_000),
});

export const shotRequestSchema = z.strictObject({
  keyframes: z
    .array(
      z.strictObject({
        /** Milliseconds from the start: the first is 0 and later ones rise strictly. */
        at: finite.min(0).max(3_600_000),
        camera: z.strictObject({
          longitude: finite.min(-180).max(180),
          latitude: finite.min(-90).max(90),
          zoom: finite.min(0).max(24),
          bearing: finite.min(-360).max(360).default(0),
          pitch: finite.min(0).max(85).default(0),
        }),
        /** The blend position at this keyframe, when the shot blends `themes`. */
        blendPosition: finite.min(0).max(7).optional(),
      }),
    )
    .min(2)
    .max(256)
    .refine(
      (items) =>
        items[0]!.at === 0 &&
        items.every((item, index) => index === 0 || item.at > items[index - 1]!.at),
    ),
  /** Two to eight themes the shot blends between, by each keyframe's `blendPosition`. */
  themes: z.array(themeName).min(2).max(8).optional(),
  easing: z.enum(['linear', 'smooth']).default('smooth'),
  /** Points in the shot at which the host is told, to run its own work in time with it. */
  cues: z
    .array(z.strictObject({at: finite.min(0).max(3_600_000), id: layerId}))
    .max(64)
    .default([]),
});

export const animationIdentifier = z.string().regex(/^a[1-9][0-9]{0,14}$/u);

/** How an application layer is drawn beyond its own colour. */
export const overlayStyleSchema = {
  /** A route ink of the theme on screen, which replaces `color` and follows theme changes. */
  ink: z.enum(['line', 'casing', 'core', 'glow', 'alternative']).optional(),
  /** `top` draws above the whole map; `ground` lies under its labels and 3D content. */
  placement: z.enum(['top', 'ground']).default('top'),
  /** For a line on the ground: how much shows where 3D content hides it, from 0 to 1. */
  occludedOpacity: unit.default(0),
  /** For a line: draws only a stretch of it, with an optional head and light in `highlight`. */
  progress: lineProgressStateSchema.extend({highlight: color.optional()}).optional(),
};

export type ViewModeRequest = z.infer<typeof viewModeRequestSchema>;
export type SunRequest = z.infer<typeof sunRequestSchema>;
export type EmphasisRequest = z.infer<typeof emphasisRequestSchema>;
export type StyleStateRequest = z.infer<typeof styleStateRequestSchema>;
export type BoundaryValuesRequest = z.infer<typeof boundaryValuesRequestSchema>;
export type ImagesRequest = z.infer<typeof imagesRequestSchema>;
export type DepthMarkersRequest = z.infer<typeof depthMarkersRequestSchema>;
export type LineProgressState = z.infer<typeof lineProgressStateSchema>;
export type LineProgressAnimation = z.infer<typeof lineProgressAnimationSchema>;
export type ShotRequest = z.infer<typeof shotRequestSchema>;
