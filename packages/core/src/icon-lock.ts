import {z} from 'zod';
import {parseTileflowIconJson} from './icon-json';
import {
  compareCodeUnits,
  hashTileflowIconPackageManifest,
  serializeCanonicalJson,
  tileflowIconPackageContentHashSchema,
  tileflowIconPackageManifestSchema,
} from './icon-package';
import {
  collectTileflowIconSetReferences,
  TileflowIconSetError,
  tileflowIconSetIdSchema,
  tileflowIconSetPackageIdSchema,
  tileflowIconSetReferenceSchema,
  tileflowIconSetTeamIdSchema,
  tileflowIconSetVersionIdSchema,
  tileflowIconSourceLimit,
  type TileflowIconSource,
} from './icon-set';

export const tileflowIconsLockfileName = 'tileflow.icons.lock.json';
export const tileflowIconsLockfileMaximumBytes = 4 * 1024 * 1024;

export const tileflowIconSetPinSchema = z
  .object({
    teamId: tileflowIconSetTeamIdSchema,
    setId: tileflowIconSetIdSchema,
    versionId: tileflowIconSetVersionIdSchema,
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    packageId: tileflowIconSetPackageIdSchema,
    contentHash: tileflowIconPackageContentHashSchema,
    manifest: tileflowIconPackageManifestSchema,
    spriteUrl: z.string().max(2048),
  })
  .strict()
  .superRefine((pin, context) => {
    try {
      const url = new URL(pin.spriteUrl);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.href !== pin.spriteUrl ||
        !url.pathname.endsWith(`/sprites/${pin.packageId}/sprite`)
      ) {
        throw new Error('Invalid delivery URL');
      }
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['spriteUrl'],
        message:
          'Expected a canonical HTTPS sprite URL for the exact package, without credentials, query or fragment',
      });
    }
  });

export const tileflowIconsLockfileSchema = z
  .object({
    lockfileVersion: z.literal(1),
    sets: z.record(tileflowIconSetReferenceSchema, tileflowIconSetPinSchema),
  })
  .strict()
  .superRefine((lock, context) => {
    const entries = Object.entries(lock.sets);
    if (entries.length > tileflowIconSourceLimit) {
      context.addIssue({code: 'custom', path: ['sets'], message: 'Too many locked icon sets'});
    }
    const teams = new Set(entries.map(([, pin]) => pin.teamId));
    const slugs = new Set(entries.map(([reference]) => reference.split('/')[0]));
    const ids = new Set(entries.map(([, pin]) => pin.setId));
    if (teams.size > 1 || slugs.size > 1 || ids.size !== entries.length) {
      context.addIssue({
        code: 'custom',
        path: ['sets'],
        message: 'Locked sets must have distinct identities within one Team',
      });
    }
  });

export type TileflowIconSetPin = z.infer<typeof tileflowIconSetPinSchema>;
export type TileflowIconsLockfileV1 = z.infer<typeof tileflowIconsLockfileSchema>;

/** Parse a complete snapshot; no credentials, originals or floating versions belong in a lock. */
export async function parseTileflowIconsLockfile(
  input: unknown,
  sources?: readonly TileflowIconSource[],
): Promise<TileflowIconsLockfileV1> {
  try {
    const lock = tileflowIconsLockfileSchema.parse(
      typeof input === 'string'
        ? parseTileflowIconJson(input, tileflowIconsLockfileMaximumBytes)
        : input,
    );
    const serialized = serializeCanonicalJson(lock);
    if (new TextEncoder().encode(serialized).byteLength > tileflowIconsLockfileMaximumBytes)
      throw new Error('Lock exceeds its byte limit');
    for (const pin of Object.values(lock.sets)) {
      if ((await hashTileflowIconPackageManifest(pin.manifest)) !== pin.contentHash)
        throw new Error('Locked manifest does not match its content hash');
    }
    if (sources) {
      const required = collectTileflowIconSetReferences(sources).sort(compareCodeUnits);
      const actual = Object.keys(lock.sets).sort(compareCodeUnits);
      if (
        required.length !== actual.length ||
        required.some((reference, index) => reference !== actual[index])
      ) {
        throw new Error(
          'Lock must exactly match declared icon sets; explicitly install, update or pin it',
        );
      }
    }
    return lock;
  } catch (cause) {
    if (cause instanceof TileflowIconSetError) throw cause;
    throw new TileflowIconSetError(
      'ICON_LOCK_INVALID',
      'Invalid icon lock: exact references, revisions, manifests and delivery URLs are required',
      {cause},
    );
  }
}

export async function serializeTileflowIconsLockfile(
  input: TileflowIconsLockfileV1,
): Promise<string> {
  return `${serializeCanonicalJson(await parseTileflowIconsLockfile(input))}\n`;
}
