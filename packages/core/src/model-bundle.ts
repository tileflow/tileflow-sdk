// A hosted map's own building models travel as one model bundle: the prepared model files of the
// map's model directories and a canonical manifest whose SHA-256 is the bundle's identity. The CLI
// uploads a bundle before it publishes the map's styles, and the styles name each file at the
// address the upload returns. It has no DOM dependency.
import {z} from 'zod';
import {compareCodeUnits, serializeCanonicalJson, sha256Hex} from './icon-package';
import {tileflowModelContentType} from './models-3d-file';
import {tileflowModelLimits} from './models-3d-model';

export const tileflowModelBundleLimits = {
  /** Models in one bundle, as a map prepares them. */
  maxModelCount: 64,
  /** Bytes of one prepared model file. */
  maxModelFileBytes: tileflowModelLimits.bytes,
  /** Bytes of the canonical manifest. */
  maxManifestBytes: 64 * 1024,
  /** Bytes of every file of the bundle together. */
  maxPackageBytes: 32 * 1024 * 1024,
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const modelIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export const tileflowModelBundleContentHashSchema = sha256Schema;

const modelSchema = z
  .object({
    byteLength: z.number().int().positive().max(tileflowModelBundleLimits.maxModelFileBytes),
    contentType: z.literal(tileflowModelContentType),
    file: z
      .string()
      .max(128)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[a-f0-9]{16}\.glb$/u),
    id: modelIdSchema,
    sha256: sha256Schema,
  })
  .strict();

export const tileflowModelBundleManifestSchema = z
  .object({
    format: z.literal('tileflow-model-bundle-v1'),
    models: z.array(modelSchema).min(1).max(tileflowModelBundleLimits.maxModelCount),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sorted = [...manifest.models].sort((left, right) => compareCodeUnits(left.id, right.id));
    if (
      sorted.some((model, index) => model.id !== manifest.models[index]?.id) ||
      new Set(manifest.models.map((model) => model.id)).size !== manifest.models.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Model bundle models must be unique and sorted by id',
        path: ['models'],
      });
    }
    for (const [index, model] of manifest.models.entries()) {
      if (model.file !== tileflowModelBundleFileName(model.id, model.sha256)) {
        context.addIssue({
          code: 'custom',
          message: 'A model file is named by its id and the first 16 hex digits of its SHA-256',
          path: ['models', index, 'file'],
        });
      }
    }
    const totalBytes = manifest.models.reduce((total, model) => total + model.byteLength, 0);
    if (totalBytes > tileflowModelBundleLimits.maxPackageBytes) {
      context.addIssue({
        code: 'custom',
        message: `Model bundle exceeds ${tileflowModelBundleLimits.maxPackageBytes} bytes`,
        path: ['models'],
      });
    }
  });

export type TileflowModelBundleManifest = z.infer<typeof tileflowModelBundleManifestSchema>;
export type TileflowModelBundleModel = TileflowModelBundleManifest['models'][number];

/** The name of a prepared model file: `<id>-<first 16 hex digits of its SHA-256>.glb`. */
export function tileflowModelBundleFileName(id: string, sha256: string): string {
  return `${id}-${sha256.slice(0, 16)}.glb`;
}

export function serializeTileflowModelBundleManifest(input: TileflowModelBundleManifest): string {
  const manifest = tileflowModelBundleManifestSchema.parse(input);
  const serialized = serializeCanonicalJson(manifest);
  if (
    new TextEncoder().encode(serialized).byteLength > tileflowModelBundleLimits.maxManifestBytes
  ) {
    throw new Error('Model bundle manifest exceeds its safe byte limit');
  }
  return serialized;
}

export async function hashTileflowModelBundleManifest(
  input: TileflowModelBundleManifest,
): Promise<string> {
  return sha256Hex(serializeTileflowModelBundleManifest(input));
}
