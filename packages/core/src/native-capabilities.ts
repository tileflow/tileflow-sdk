import {z} from 'zod';
import {strictNativeObject} from './native-zod-object';

/**
 * The parts of a Tileflow map that a native map can show differently from the web, or not at all.
 * Native preparation removes or replaces each one, records it, and keeps drawing the rest of the
 * map: every map opens in native apps. Mobile SDKs warn once per map and theme; Gallery, editor
 * and the public compatibility table read the same records. They are information, never a block.
 *
 * `fallback` says what native maps show instead; `none` means they leave the feature out.
 * `detection` says who finds it: `artifact` capabilities are recorded by native preparation in the
 * artifact; `runtime` capabilities depend on the device and are reported by the SDK when they occur.
 */
export const tileflowNativeCapabilities = Object.freeze({
  scene3d: Object.freeze({
    detection: 'artifact',
    reason: 'web-runtime',
    fallback: 'extrusions',
    description:
      'The 3D building scene (roofs, scene lighting, shadows, contact shading and surfaces) is drawn as plain building extrusions.',
  }),
  models3d: Object.freeze({
    detection: 'artifact',
    reason: 'engine-unsupported',
    fallback: 'extrusions',
    description:
      'Tileflow landmarks and building models are not drawn; the building extrusions under them remain.',
  }),
  trees3d: Object.freeze({
    detection: 'artifact',
    reason: 'web-runtime',
    // A record states the map's own fallback for maps without 3D: `flat` or `none`.
    fallback: 'flat',
    description:
      "3D trees are not drawn; vegetation shows the map's own fallback for maps without 3D, flat trees or none.",
  }),
  streetLights: Object.freeze({
    detection: 'artifact',
    reason: 'web-runtime',
    fallback: 'none',
    description: 'Street lights are not drawn.',
  }),
  terrain3d: Object.freeze({
    detection: 'artifact',
    reason: 'engine-unsupported',
    fallback: 'flat',
    description: 'The map is drawn flat, without terrain displacement; hillshading remains.',
  }),
  globe: Object.freeze({
    detection: 'artifact',
    reason: 'engine-unsupported',
    fallback: 'mercator',
    description: 'The globe projection is drawn in Web Mercator.',
  }),
  sky: Object.freeze({
    detection: 'artifact',
    reason: 'engine-unsupported',
    fallback: 'none',
    description: 'The sky, atmosphere and fog above the horizon are not drawn.',
  }),
  pitchAbove60: Object.freeze({
    detection: 'runtime',
    reason: 'engine-unsupported',
    fallback: 'capped',
    description: "The camera is tilted no further than the native engine's maximum pitch.",
  }),
  deviceContours: Object.freeze({
    detection: 'artifact',
    reason: 'web-runtime',
    fallback: 'none',
    description:
      'Contour lines and their labels are generated from elevation tiles in the browser; native maps do not draw them.',
  }),
  nauticalLightRhythm: Object.freeze({
    detection: 'artifact',
    reason: 'web-runtime',
    fallback: 'steady',
    description: 'Nautical lights shine steadily instead of flashing in their rhythm.',
  }),
  symbolOverlap: Object.freeze({
    detection: 'artifact',
    reason: 'engine-unsupported',
    fallback: 'allow-overlap',
    description:
      'Cooperative label and icon overlap is drawn as allowed overlap, so these symbols no longer give way to others.',
  }),
  reliefResampling: Object.freeze({
    detection: 'artifact',
    reason: 'engine-unsupported',
    fallback: 'engine-default',
    description:
      "Hillshade and colour-relief layers use the engine's default resampling instead of the map's.",
  }),
} as const);

export type TileflowNativeCapability = keyof typeof tileflowNativeCapabilities;
export const tileflowNativeCapabilitySchema = z.enum(
  Object.keys(tileflowNativeCapabilities) as [
    TileflowNativeCapability,
    ...TileflowNativeCapability[],
  ],
);

/** Why native maps cannot show a capability as the web does. */
export const tileflowNativeDegradationReasonSchema = z.enum([
  /** The pinned MapLibre Native engines have no equivalent. */
  'engine-unsupported',
  /** Tileflow's browser runtime draws it (WebGL layers, browser workers or animations). */
  'web-runtime',
]);

/** What a native map shows in place of a capability. */
export const tileflowNativeFallbackSchema = z.enum([
  'allow-overlap',
  'capped',
  'engine-default',
  'extrusions',
  'flat',
  'mercator',
  'none',
  'steady',
]);

const layerIdSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/\p{Cc}/u.test(value), 'Expected a layer ID without control characters');

export const tileflowNativeDegradationLimits = Object.freeze({
  maximumDegradations: 64,
  maximumLayers: 256,
});

/**
 * One capability of one theme that native preparation removed or replaced. `id` is stable for the
 * same map revision: it names the capability and, where a map can hold several, its subject (for
 * example the contour source). `layers` lists the web style's layer IDs that native maps leave out
 * or draw differently, in style order; a capability drawn outside the style's layers lists none.
 */
export const tileflowNativeDegradationSchema = strictNativeObject({
  id: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9]+(?::[A-Za-z0-9][A-Za-z0-9_.-]*)?$/u),
  feature: tileflowNativeCapabilitySchema,
  reason: tileflowNativeDegradationReasonSchema,
  fallback: tileflowNativeFallbackSchema,
  layers: z.array(layerIdSchema).max(tileflowNativeDegradationLimits.maximumLayers),
}).superRefine((record, context) => {
  if (record.id !== record.feature && !record.id.startsWith(`${record.feature}:`))
    context.addIssue({code: 'custom', message: 'A degradation ID starts with its capability'});
  if (record.reason !== tileflowNativeCapabilities[record.feature].reason)
    context.addIssue({code: 'custom', message: 'A degradation keeps its capability reason'});
  if (new Set(record.layers).size !== record.layers.length)
    context.addIssue({code: 'custom', message: 'Expected unique layer IDs'});
});
export type TileflowNativeDegradation = z.infer<typeof tileflowNativeDegradationSchema>;

/** The degradations of one theme, ordered by ID. */
export const tileflowNativeDegradationsSchema = z
  .array(tileflowNativeDegradationSchema)
  .max(tileflowNativeDegradationLimits.maximumDegradations)
  .superRefine((records, context) => {
    for (let index = 1; index < records.length; index++) {
      if (records[index - 1]!.id >= records[index]!.id)
        context.addIssue({code: 'custom', path: [index], message: 'Expected ordered unique IDs'});
    }
  });

/** Style metadata key under which a native style lists its theme's degradations. */
export const tileflowNativeDegradationsMetadataKey = 'tileflow:nativeDegradations' as const;

/** Create one validated record; the reason comes from the capability vocabulary. */
export function createTileflowNativeDegradation(
  feature: TileflowNativeCapability,
  options: Readonly<{
    subject?: string;
    fallback?: TileflowNativeDegradation['fallback'];
    layers?: readonly string[];
  }> = {},
): TileflowNativeDegradation {
  const capability = tileflowNativeCapabilities[feature];
  const fallback = options.fallback ?? capability.fallback;
  return tileflowNativeDegradationSchema.parse({
    id: options.subject === undefined ? feature : `${feature}:${options.subject}`,
    feature,
    reason: capability.reason,
    fallback,
    layers: [...(options.layers ?? [])],
  });
}

/** Records ordered by ID; duplicate IDs are merged by their layers. */
export function normalizeTileflowNativeDegradations(
  records: readonly TileflowNativeDegradation[],
): TileflowNativeDegradation[] {
  const merged = new Map<string, TileflowNativeDegradation>();
  for (const record of records) {
    const previous = merged.get(record.id);
    if (!previous) {
      merged.set(record.id, {...record, layers: [...record.layers]});
      continue;
    }
    if (previous.feature !== record.feature || previous.fallback !== record.fallback)
      throw new TypeError('Native degradations with one ID must describe one capability.');
    previous.layers = [...new Set([...previous.layers, ...record.layers])];
  }
  return tileflowNativeDegradationsSchema.parse(
    [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/** Read a native style's degradation records; malformed metadata reads as none. */
export function readTileflowNativeDegradations(metadata: unknown): TileflowNativeDegradation[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const parsed = tileflowNativeDegradationsSchema.safeParse(
    (metadata as Record<string, unknown>)[tileflowNativeDegradationsMetadataKey],
  );
  return parsed.success ? parsed.data : [];
}
