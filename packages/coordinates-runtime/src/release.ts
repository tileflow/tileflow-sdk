import {lstat, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {
  coordinatesGridSchema,
  type CoordinatesProvenance,
  coordinatesProvenanceSchema,
  coordinatesReleaseIdSchema,
} from '@tileflow/coordinates/contract';
import {digest, hashFile} from './identity';
import {
  coordinatesNativeQualificationSchema,
  coordinatesQualificationSubject,
} from './qualification';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const name = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
export const coordinatesReleasePathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9_./=+-]+$/u)
  .refine((value) => value.split('/').every((part) => part && part !== '.' && part !== '..'));

export const coordinatesReleaseFileSchema = z
  .object({
    path: coordinatesReleasePathSchema,
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256,
    executable: z.boolean(),
    assetId: name,
  })
  .strict();

export const coordinatesReleaseAssetSchema = z
  .object({
    id: name,
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256,
    format: z.enum(['tar-gzip', 'dmg']),
  })
  .strict();

export const coordinatesRuntimeArtifactSchema = z
  .object({
    id: name,
    platform: name,
    architecture: name,
    enginePath: coordinatesReleasePathSchema,
    nativePath: coordinatesReleasePathSchema,
    catalogPath: coordinatesReleasePathSchema,
    resourceDirectory: coordinatesReleasePathSchema,
    assets: z.array(coordinatesReleaseAssetSchema).min(1).max(128),
    files: z.array(coordinatesReleaseFileSchema).min(3).max(10000),
    distribution: z.discriminatedUnion('kind', [
      z.object({kind: z.literal('development')}).strict(),
      z
        .object({
          kind: z.literal('native-qualified'),
          qualification: coordinatesNativeQualificationSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('apple-notarized-dmg'),
          teamIdentifier: z.string().regex(/^[A-Z0-9]{10}$/u),
          cleanOfflineAcceptanceDigest: sha256,
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const assets = new Set(artifact.assets.map((asset) => asset.id));
    const files = new Set(artifact.files.map((file) => file.path));
    if (
      assets.size !== artifact.assets.length ||
      files.size !== artifact.files.length ||
      artifact.files.some((file) => !assets.has(file.assetId)) ||
      artifact.assets.some((asset) => !artifact.files.some((file) => file.assetId === asset.id))
    ) {
      ctx.addIssue({code: 'custom', message: 'Artifact entries must be unique and assigned'});
    }
    for (const path of [
      artifact.enginePath,
      artifact.nativePath,
      artifact.catalogPath,
      `${artifact.resourceDirectory}/proj.db`,
    ]) {
      if (!files.has(path))
        ctx.addIssue({code: 'custom', message: 'Artifact entry point is missing'});
    }
    if (
      artifact.distribution.kind === 'apple-notarized-dmg' &&
      (artifact.platform !== 'darwin' || artifact.assets.some((asset) => asset.format !== 'dmg'))
    ) {
      ctx.addIssue({code: 'custom', message: 'Public macOS artifacts require DMG assets'});
    }
    if (
      artifact.distribution.kind === 'native-qualified' &&
      (artifact.platform !== artifact.distribution.qualification.runtimeProfile.platform ||
        artifact.architecture !== artifact.distribution.qualification.runtimeProfile.architecture ||
        artifact.assets.some((asset) => asset.format !== 'tar-gzip'))
    )
      ctx.addIssue({code: 'custom', message: 'Qualified artifact profile mismatch'});
  });

const execution = coordinatesProvenanceSchema.omit({artifact: true});
export const coordinatesExecutionReleaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    protocolVersion: z.literal(1),
    releaseId: coordinatesReleaseIdSchema,
    execution,
    resources: z.array(coordinatesGridSchema).max(10000),
    artifacts: z.array(coordinatesRuntimeArtifactSchema).min(1).max(32),
  })
  .strict()
  .superRefine((release, ctx) => {
    const {releaseId, ...identity} = release;
    if (releaseId !== `cr_${digest(identity)}`)
      ctx.addIssue({code: 'custom', message: 'Release identity mismatch'});
    if (
      new Set(release.artifacts.map((artifact) => artifact.id)).size !== release.artifacts.length ||
      new Set(release.resources.map((resource) => resource.name)).size !==
        release.resources.length ||
      release.resources.some(
        (resource) => !resource.available || !resource.license || !resource.attribution.length,
      ) ||
      release.execution.gridSetDigest !== digest(release.resources)
    ) {
      ctx.addIssue({code: 'custom', message: 'Release inventory mismatch'});
    }
    for (const artifact of release.artifacts) {
      if (
        artifact.distribution.kind === 'native-qualified' &&
        artifact.distribution.qualification.subjectDigest !==
          coordinatesQualificationSubject(release, artifact)
      )
        ctx.addIssue({code: 'custom', message: 'Qualification subject mismatch'});
      const byPath = new Map(artifact.files.map((file) => [file.path, file]));
      const proofs = release.execution.applicabilityProofs ?? [];
      if (proofs.length && release.execution.numericConvention !== 'explicit-axis-models-v2') {
        ctx.addIssue({
          code: 'custom',
          message: 'Analytic proofs require the explicit axis convention',
        });
      }
      const proofPaths = new Set(proofs.map((proof) => `proofs/${proof.id}.json`));
      for (const proof of proofs) {
        if (byPath.get(`proofs/${proof.id}.json`)?.sha256 !== proof.digest) {
          ctx.addIssue({code: 'custom', message: 'Analytic proof digest mismatch'});
        }
      }
      for (const file of artifact.files) {
        if (file.path.startsWith('proofs/') && !proofPaths.has(file.path)) {
          ctx.addIssue({code: 'custom', message: 'Undeclared analytic proof'});
        }
      }
      if (
        byPath.get(`${artifact.resourceDirectory}/proj.db`)?.sha256 !==
        release.execution.catalog.digest
      ) {
        ctx.addIssue({code: 'custom', message: 'Catalog digest mismatch'});
      }
      const expected = new Set(['proj.db', ...release.resources.map((resource) => resource.name)]);
      for (const resource of release.resources) {
        if (
          byPath.get(`${artifact.resourceDirectory}/${resource.name}`)?.sha256 !== resource.digest
        ) {
          ctx.addIssue({code: 'custom', message: 'Resource digest mismatch'});
        }
      }
      for (const file of artifact.files) {
        if (
          file.path.startsWith(`${artifact.resourceDirectory}/`) &&
          !expected.has(file.path.slice(artifact.resourceDirectory.length + 1))
        ) {
          ctx.addIssue({code: 'custom', message: 'Undeclared execution resource'});
        }
      }
    }
  });

export type CoordinatesExecutionRelease = z.infer<typeof coordinatesExecutionReleaseSchema>;
export type CoordinatesRuntimeArtifact = z.infer<typeof coordinatesRuntimeArtifactSchema>;
export type CoordinatesReleaseAsset = z.infer<typeof coordinatesReleaseAssetSchema>;

export function runtimeProvenance(
  release: CoordinatesExecutionRelease,
  artifact: CoordinatesRuntimeArtifact,
): CoordinatesProvenance {
  return {...release.execution, artifact: {id: artifact.id, digest: digest(artifact)}};
}

/** Verification only. This module has no download or installation path. */
export async function verifyRuntimeFiles(
  root: string,
  artifact: CoordinatesRuntimeArtifact,
  signal?: AbortSignal,
): Promise<void> {
  const expected = new Map(artifact.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error('RUNTIME_DIRECTORY_INVALID');

  async function visit(path: string) {
    for (const entry of await readdir(join(root, path), {withFileTypes: true})) {
      signal?.throwIfAborted();
      const relative = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error('RUNTIME_FILE_INVALID');
      if (entry.isDirectory()) {
        if (!artifact.files.some((file) => file.path.startsWith(`${relative}/`)))
          throw new Error('RUNTIME_FILE_UNDECLARED');
        await visit(relative);
      } else {
        const file = expected.get(relative);
        if (!entry.isFile() || !file) throw new Error('RUNTIME_FILE_UNDECLARED');
        const physical = join(root, relative);
        const stat = await lstat(physical);
        if (
          stat.isSymbolicLink() ||
          !stat.isFile() ||
          stat.size !== file.bytes ||
          Boolean(stat.mode & 0o111) !== file.executable ||
          (await hashFile(physical, signal)) !== file.sha256
        ) {
          throw new Error('RUNTIME_FILE_INVALID');
        }
        seen.add(relative);
      }
    }
  }
  await visit('');
  if (seen.size !== expected.size) throw new Error('RUNTIME_FILE_MISSING');
}

export async function readExecutionRelease(path: string): Promise<CoordinatesExecutionRelease> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024)
    throw new Error('RELEASE_MANIFEST_INVALID');
  return coordinatesExecutionReleaseSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}
