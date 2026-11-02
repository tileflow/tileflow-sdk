import {z} from 'zod';
import {tileflowNativeProfile} from './native-profile-definition';
import {tileflowNativeProfileLimits} from './native-profile-helpers';
import {strictNativeObject} from './native-zod-object';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';

export const tileflowNativeBuildRecordFileName = 'native-build.json';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const layerCountSchema = z.number().int().min(0).max(tileflowNativeProfileLimits.maximumLayers);
const layerTransformationSchema = strictNativeObject({
  inputLayer: layerCountSchema,
  outputStart: layerCountSchema,
  outputCount: z.number().int().min(1).max(32),
  properties: z
    .array(z.enum(['line-cap', 'line-dasharray']))
    .min(1)
    .max(2)
    .refine(
      (properties) =>
        properties.length === 1 ||
        (properties[0] === 'line-cap' && properties[1] === 'line-dasharray'),
      'Expected unique, ordered properties',
    ),
});

/** A symbol layer whose overlap modes became `*-allow-overlap` values in place. */
const symbolOverlapTransformationSchema = strictNativeObject({
  inputLayer: layerCountSchema,
  properties: z
    .array(z.enum(['icon-overlap', 'text-overlap']))
    .min(1)
    .max(2)
    .refine(
      (properties) =>
        properties.length === 1 ||
        (properties[0] === 'icon-overlap' && properties[1] === 'text-overlap'),
      'Expected unique, ordered properties',
    ),
});

const ascendingIndexesSchema = z
  .array(layerCountSchema)
  .max(tileflowNativeProfileLimits.maximumLayers)
  .refine(
    (indexes) => indexes.every((value, index) => index === 0 || value > indexes[index - 1]!),
    'Expected ascending unique layer indexes',
  );

export const tileflowNativeStyleTransformationSchema = strictNativeObject({
  map: tileflowPortableIdSchema,
  theme: tileflowThemeNameSchema,
  inputStyleSha256: hashSchema,
  loweredStyleSha256: hashSchema,
  inputLayers: layerCountSchema,
  outputLayers: layerCountSchema,
  projection: z.enum(['none', 'mercator-to-implicit', 'globe-to-mercator']),
  /** Present when preparation removed a browser sky, which Native does not draw. */
  sky: z.literal('removed').optional(),
  /** Input layer indexes that a degradation left out of the native style. */
  removedLayers: ascendingIndexesSchema,
  /** Output layer indexes that preparation added, such as building extrusions. */
  insertedLayers: ascendingIndexesSchema,
  /** Input layers whose line cap or dash decisions became physical layers in the output. */
  layers: z.array(layerTransformationSchema).max(tileflowNativeProfileLimits.maximumLayers),
  symbolOverlap: z
    .array(symbolOverlapTransformationSchema)
    .max(tileflowNativeProfileLimits.maximumLayers),
  /** IDs of the degradations recorded in the native style's metadata, ordered. */
  degradations: z
    .array(z.string().min(1).max(160))
    .max(64)
    .refine(
      (ids) => ids.every((id, index) => index === 0 || id > ids[index - 1]!),
      'Expected ordered unique degradation IDs',
    ),
}).superRefine((style, context) => {
  // Walk input layers in order: a removed layer has no output, a partitioned one has its span,
  // any other one output; inserted outputs take their own positions in between.
  const removed = new Set(style.removedLayers);
  const inserted = new Set(style.insertedLayers);
  const spans = new Map(style.layers.map((layer) => [layer.inputLayer, layer]));
  let previous = -1;
  for (const [index, layer] of style.layers.entries()) {
    if (
      layer.inputLayer <= previous ||
      layer.inputLayer >= style.inputLayers ||
      removed.has(layer.inputLayer)
    )
      context.addIssue({
        code: 'custom',
        path: ['layers', index],
        message: 'Invalid physical layer span',
      });
    previous = layer.inputLayer;
  }
  if (style.removedLayers.some((index) => index >= style.inputLayers))
    context.addIssue({code: 'custom', path: ['removedLayers'], message: 'Outside the input'});
  let output = 0;
  const skipInserted = () => {
    while (inserted.has(output)) output++;
  };
  for (let input = 0; input < style.inputLayers; input++) {
    skipInserted();
    if (removed.has(input)) continue;
    const span = spans.get(input);
    if (span && span.outputStart !== output)
      context.addIssue({
        code: 'custom',
        path: ['layers', style.layers.indexOf(span)],
        message: 'Invalid physical layer span',
      });
    output += span?.outputCount ?? 1;
  }
  skipInserted();
  if (style.outputLayers !== output || style.insertedLayers.some((index) => index >= output)) {
    context.addIssue({
      code: 'custom',
      path: ['outputLayers'],
      message: 'Layer counts do not match transformation spans',
    });
  }
  // Only line layers are partitioned and only symbol layers carry overlap modes.
  const partitioned = new Set(style.layers.map(({inputLayer}) => inputLayer));
  previous = -1;
  for (const [index, layer] of style.symbolOverlap.entries()) {
    if (
      layer.inputLayer <= previous ||
      layer.inputLayer >= style.inputLayers ||
      partitioned.has(layer.inputLayer) ||
      removed.has(layer.inputLayer)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['symbolOverlap', index],
        message: 'Invalid symbol overlap layer',
      });
    }
    previous = layer.inputLayer;
  }
});
export type TileflowNativeStyleTransformation = z.infer<
  typeof tileflowNativeStyleTransformationSchema
>;

/**
 * Version 3 records degradations: removed and inserted layers and the degradation IDs of each
 * style. The runtime manifest remains version 1.
 */
export const tileflowNativeBuildRecordSchema = strictNativeObject({
  schemaVersion: z.literal(3),
  renderer: z.literal('native'),
  profile: z.literal('native-v1'),
  validation: z.literal('static-artifacts'),
  preparationVersion: z.literal('native-lowering-v2'),
  engines: strictNativeObject({android: z.literal('13.7.1'), ios: z.literal('7.0.0')}),
  buildManifestSha256: hashSchema,
  transformations: z.array(tileflowNativeStyleTransformationSchema).max(4096),
}).superRefine((record, context) => {
  let previous = '';
  for (const [index, item] of record.transformations.entries()) {
    const name = `${item.map}/${item.theme}`;
    if (name <= previous)
      context.addIssue({
        code: 'custom',
        path: ['transformations', index],
        message: 'Expected unique map/theme order',
      });
    previous = name;
  }
});
export type TileflowNativeBuildRecord = z.infer<typeof tileflowNativeBuildRecordSchema>;

export function createTileflowNativeBuildRecord(
  buildManifestSha256: string,
  transformations: readonly TileflowNativeStyleTransformation[] = [],
): TileflowNativeBuildRecord {
  return tileflowNativeBuildRecordSchema.parse({
    schemaVersion: 3,
    renderer: 'native',
    profile: tileflowNativeProfile.id,
    validation: 'static-artifacts',
    preparationVersion: 'native-lowering-v2',
    engines: {android: tileflowNativeProfile.android, ios: tileflowNativeProfile.ios},
    buildManifestSha256,
    transformations: [...transformations].sort((left, right) => {
      const a = `${left.map}/${left.theme}`;
      const b = `${right.map}/${right.theme}`;
      return a < b ? -1 : a > b ? 1 : 0;
    }),
  });
}
