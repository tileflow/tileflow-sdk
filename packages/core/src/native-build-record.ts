import {z} from 'zod';
import {tileflowNativeProfile} from './native-profile-definition';
import {tileflowNativeProfileLimits} from './native-profile-helpers';
import {tileflowPortableIdSchema, tileflowThemeNameSchema} from './portable-identity';

export const tileflowNativeBuildRecordFileName = 'native-build.json';
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const layerCountSchema = z.number().int().min(0).max(tileflowNativeProfileLimits.maximumLayers);
const layerTransformationSchema = z.object({
  inputLayer: layerCountSchema,
  outputStart: layerCountSchema,
  outputCount: z.number().int().min(1).max(32),
  properties: z.array(z.enum(['line-cap', 'line-dasharray'])).min(1).max(2)
    .refine((properties) => properties.length === 1 ||
      (properties[0] === 'line-cap' && properties[1] === 'line-dasharray'), 'Expected unique, ordered properties'),
}).strict();

export const tileflowNativeStyleTransformationSchema = z.object({
  map: tileflowPortableIdSchema,
  theme: tileflowThemeNameSchema,
  inputStyleSha256: hashSchema,
  loweredStyleSha256: hashSchema,
  inputLayers: layerCountSchema,
  outputLayers: layerCountSchema,
  projection: z.enum(['none', 'mercator-to-implicit', 'globe-to-mercator']),
  layers: z.array(layerTransformationSchema).max(tileflowNativeProfileLimits.maximumLayers),
}).strict().superRefine((style, context) => {
  let previous = -1;
  let added = 0;
  for (const [index, layer] of style.layers.entries()) {
    if (layer.inputLayer <= previous || layer.inputLayer >= style.inputLayers ||
      layer.outputStart !== layer.inputLayer + added ||
      layer.outputStart + layer.outputCount > style.outputLayers) {
      context.addIssue({code: 'custom', path: ['layers', index], message: 'Invalid physical layer span'});
    }
    previous = layer.inputLayer;
    added += layer.outputCount - 1;
  }
  if (style.outputLayers !== style.inputLayers + added) {
    context.addIssue({code: 'custom', path: ['outputLayers'], message: 'Layer counts do not match transformation spans'});
  }
});
export type TileflowNativeStyleTransformation = z.infer<typeof tileflowNativeStyleTransformationSchema>;

/** Version 2 adds explicit preparation evidence. The runtime manifest remains version 1. */
export const tileflowNativeBuildRecordSchema = z.object({
  schemaVersion: z.literal(2),
  renderer: z.literal('native'),
  profile: z.literal('native-v1'),
  validation: z.literal('static-artifacts'),
  preparationVersion: z.literal('native-lowering-v1'),
  engines: z.object({android: z.literal('13.2.0'), ios: z.literal('6.26.0')}).strict(),
  buildManifestSha256: hashSchema,
  transformations: z.array(tileflowNativeStyleTransformationSchema).max(4096),
}).strict().superRefine((record, context) => {
  let previous = '';
  for (const [index, item] of record.transformations.entries()) {
    const name = `${item.map}/${item.theme}`;
    if (name <= previous) context.addIssue({
      code: 'custom', path: ['transformations', index], message: 'Expected unique map/theme order',
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
    schemaVersion: 2, renderer: 'native', profile: tileflowNativeProfile.id,
    validation: 'static-artifacts', preparationVersion: 'native-lowering-v1',
    engines: {android: tileflowNativeProfile.android, ios: tileflowNativeProfile.ios},
    buildManifestSha256,
    transformations: [...transformations].sort((left, right) => {
      const a = `${left.map}/${left.theme}`;
      const b = `${right.map}/${right.theme}`;
      return a < b ? -1 : a > b ? 1 : 0;
    }),
  });
}
