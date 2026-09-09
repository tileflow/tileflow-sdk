import {readFile} from 'node:fs/promises';
import {arch, homedir, platform} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {
  type CoordinatesCommand,
  CoordinatesContractError,
  type CoordinatesProvenance,
  coordinatesReleaseIdSchema,
  type CoordinatesRequest,
  type CoordinatesResponse,
  parseCoordinatesResponse,
} from '@tileflow/coordinates/contract';
import type {createCoordinatesEngine} from './engine';
import {readExecutionRelease, runtimeProvenance, verifyRuntimeFiles} from './release';
import {CoordinatesRuntimeProfileError, verifyQualifiedRuntimeProfile} from './qualification';

export type CoordinatesLocalOptions = {
  directory?: string;
  requiredReleaseId?: string;
  allowDevelopment?: boolean;
  signal?: AbortSignal;
};

export function coordinatesCacheDirectory(): string {
  return resolve(
    process.env.TILEFLOW_COORDINATES_CACHE ??
      (platform() === 'darwin'
        ? join(homedir(), 'Library', 'Caches', 'Tileflow', 'coordinates')
        : join(homedir(), '.cache', 'tileflow', 'coordinates')),
  );
}

export function coordinatesInstallationDirectory(
  cache: string,
  releaseId: string,
  artifactId: string,
): string {
  return join(cache, 'releases', releaseId, artifactId);
}

const optionsSchema = z
  .object({
    directory: z.string().min(1).optional(),
    requiredReleaseId: coordinatesReleaseIdSchema.optional(),
    allowDevelopment: z.boolean().default(false),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();

export async function createLocalCoordinates(input: CoordinatesLocalOptions = {}) {
  let releaseId: string | null = null;
  let provenance: CoordinatesProvenance | null = null;
  const failed = (
    command: CoordinatesCommand | null,
    reason:
      | 'RELEASE_UNAVAILABLE'
      | 'RELEASE_INTEGRITY_FAILED'
      | 'INVALID_VALUE'
      | 'CANCELLED'
      | 'RUNTIME_PROFILE_UNSUPPORTED',
    runtimeProfileId?: string,
  ) =>
    new CoordinatesContractError({
      schemaVersion: 1,
      ok: false,
      command,
      releaseId,
      provenance,
      warnings: [],
      usage: {mode: 'local', units: 0},
      error: {
        code:
          reason === 'CANCELLED'
            ? 'COORDINATES_CANCELLED'
            : reason === 'INVALID_VALUE'
              ? 'COORDINATES_INVALID_REQUEST'
              : reason === 'RELEASE_UNAVAILABLE' || reason === 'RUNTIME_PROFILE_UNSUPPORTED'
                ? 'COORDINATES_RELEASE_UNAVAILABLE'
                : 'COORDINATES_RELEASE_INVALID',
        reason,
        phase: reason === 'INVALID_VALUE' ? 'input' : 'release',
        details: runtimeProfileId ? {runtimeProfileId} : {},
      },
    });
  const parsed = optionsSchema.safeParse(input);
  if (!parsed.success) throw failed(null, 'INVALID_VALUE');
  const options = parsed.data;
  if (options.signal?.aborted) throw failed(null, 'CANCELLED');
  let directory = options.directory;
  if (!directory) {
    try {
      const active = z
        .object({
          releaseId: coordinatesReleaseIdSchema,
          artifactId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
        })
        .strict()
        .parse(
          JSON.parse(await readFile(join(coordinatesCacheDirectory(), 'active.json'), 'utf8')),
        );
      directory = coordinatesInstallationDirectory(
        coordinatesCacheDirectory(),
        active.releaseId,
        active.artifactId,
      );
    } catch {
      throw failed(null, 'RELEASE_UNAVAILABLE');
    }
  }

  let engine: Awaited<ReturnType<typeof createCoordinatesEngine>>;
  let root: string;
  try {
    const release = await readExecutionRelease(join(directory, 'release.json'));
    releaseId = release.releaseId;
    if (options.requiredReleaseId && options.requiredReleaseId !== releaseId)
      throw failed(null, 'RELEASE_UNAVAILABLE');
    const artifacts = release.artifacts.filter(
      (artifact) => artifact.platform === platform() && artifact.architecture === arch(),
    );
    if (artifacts.length !== 1) throw failed(null, 'RELEASE_UNAVAILABLE');
    const artifact = artifacts[0];
    provenance = runtimeProvenance(release, artifact);
    if (artifact.distribution.kind === 'development' && !options.allowDevelopment)
      throw failed(null, 'RELEASE_UNAVAILABLE');
    await verifyQualifiedRuntimeProfile(artifact);
    root = resolve(directory, 'payload');
    await verifyRuntimeFiles(root, artifact, options.signal);
    // The complete pinned artifact owns execution code; npm contains no native payload.
    const module = (await import(pathToFileURL(join(root, artifact.enginePath)).href)) as {
      createCoordinatesEngine: typeof createCoordinatesEngine;
    };
    engine = await module.createCoordinatesEngine({
      root,
      nativePath: join(root, artifact.nativePath),
      resourceDirectory: join(root, artifact.resourceDirectory),
      catalogPath: join(root, artifact.catalogPath),
      releaseId,
      provenance,
      resources: release.resources,
    });
    await engine.readiness();
  } catch (error) {
    if (error instanceof CoordinatesRuntimeProfileError)
      throw failed(null, 'RUNTIME_PROFILE_UNSUPPORTED', error.profileId);
    if (error instanceof CoordinatesContractError) throw error;
    if (options.signal?.aborted) throw failed(null, 'CANCELLED');
    throw failed(null, 'RELEASE_INTEGRITY_FAILED');
  }
  const resolvedReleaseId = releaseId!;
  const resolvedProvenance = provenance!;
  async function execute<C extends CoordinatesCommand>(
    command: C,
    request: CoordinatesRequest<C>,
    callOptions?: {signal?: AbortSignal},
  ): Promise<CoordinatesResponse<C>> {
    if (
      callOptions &&
      !z
        .object({signal: z.instanceof(AbortSignal).optional()})
        .strict()
        .safeParse(callOptions).success
    )
      throw failed(command, 'INVALID_VALUE');
    const signal =
      options.signal && callOptions?.signal
        ? AbortSignal.any([options.signal, callOptions.signal])
        : (options.signal ?? callOptions?.signal);
    try {
      const response = await engine.execute(command, request, signal);
      const parsed = parseCoordinatesResponse(command, request, response, {
        mode: 'local',
        releaseId: resolvedReleaseId,
        provenance: resolvedProvenance,
      });
      if (!parsed.ok) throw new CoordinatesContractError(parsed);
      return parsed;
    } catch (error) {
      if (error instanceof CoordinatesContractError) {
        throw new CoordinatesContractError({
          ...error.toJSON(),
          command,
          releaseId: resolvedReleaseId,
          provenance: resolvedProvenance,
          usage: {mode: 'local', units: 0},
        });
      }
      throw new CoordinatesContractError({
        schemaVersion: 1,
        ok: false,
        command,
        releaseId: resolvedReleaseId,
        provenance: resolvedProvenance,
        usage: {mode: 'local', units: 0},
        warnings: [],
        error: {
          code: 'COORDINATES_INVALID_RESPONSE',
          reason: 'RESPONSE_SHAPE_INVALID',
          phase: 'response',
          details: {},
        },
      });
    }
  }
  return Object.freeze({
    releaseId: resolvedReleaseId,
    provenance: resolvedProvenance,
    directory: resolve(directory),
    search: (request: CoordinatesRequest<'search'>, options?: {signal?: AbortSignal}) =>
      execute('search', request, options),
    describe: (request: CoordinatesRequest<'describe'>, options?: {signal?: AbortSignal}) =>
      execute('describe', request, options),
    operations: (request: CoordinatesRequest<'operations'>, options?: {signal?: AbortSignal}) =>
      execute('operations', request, options),
    transform: (request: CoordinatesRequest<'transform'>, options?: {signal?: AbortSignal}) =>
      execute('transform', request, options),
    close: async () => {
      engine.close();
    },
  });
}
