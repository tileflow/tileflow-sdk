import {z} from 'zod';
import {tileflowNativeProfile, tileflowNativeProfileIdSchema} from './native-profile-definition';

/** Separate build evidence; never an extension of the strict runtime manifest. */
export const tileflowNativeBuildRecordFileName = 'native-build.json' as const;
export const tileflowNativeBuildRecordSchema = z.object({
  kind: z.literal('tileflow-renderer-build'),
  schemaVersion: z.literal(1),
  renderer: z.literal('native'),
  profile: tileflowNativeProfileIdSchema,
  validation: z.literal('static-artifacts'),
  engines: z.object({android: z.literal('13.2.0'), ios: z.literal('6.26.0')}).strict(),
  validatorStyleSpec: z.literal('24.8.5'),
  runtimeManifest: z.literal('manifest.json'),
  buildManifest: z.literal('build-manifest.json'),
  buildManifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type TileflowNativeBuildRecord = z.infer<typeof tileflowNativeBuildRecordSchema>;

export function createTileflowNativeBuildRecord(buildManifestSha256: string): TileflowNativeBuildRecord {
  return tileflowNativeBuildRecordSchema.parse({
    kind: 'tileflow-renderer-build', schemaVersion: 1, renderer: 'native',
    profile: tileflowNativeProfile.id, validation: 'static-artifacts',
    engines: {android: tileflowNativeProfile.android, ios: tileflowNativeProfile.ios},
    validatorStyleSpec: tileflowNativeProfile.validatorStyleSpec,
    runtimeManifest: 'manifest.json', buildManifest: 'build-manifest.json', buildManifestSha256,
  });
}
