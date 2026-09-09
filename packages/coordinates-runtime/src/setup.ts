import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat, mkdir, open, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {arch, platform} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {z} from 'zod';
import {coordinatesReleaseIdSchema} from '@tileflow/coordinates/contract';
import {extractCoordinatesArchive} from './archive';
import {extractCoordinatesDmg} from './dmg';
import {hashFile} from './identity';
import {
  coordinatesCacheDirectory,
  coordinatesInstallationDirectory,
  createLocalCoordinates,
} from './local';
import {copyOfflineDmg, ensureRemoteDmgQuarantine} from './macos';
import {CoordinatesRuntimeProfileError, verifyQualifiedRuntimeProfile} from './qualification';
import {
  coordinatesExecutionReleaseSchema,
  type CoordinatesReleaseAsset,
  readExecutionRelease,
  runtimeProvenance,
  verifyRuntimeFiles,
} from './release';

const defaultSource = 'https://tileflow.dev/runtime/coordinates/distribution.json';
const name = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const coordinatesDistributionSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: coordinatesExecutionReleaseSchema,
    locations: z.record(name, z.record(name, z.string().min(1).max(2048))),
  })
  .strict();

export type CoordinatesSetupOptions = {
  source?: string;
  cacheDirectory?: string;
  requiredReleaseId?: string;
  allowDevelopment?: boolean;
  signal?: AbortSignal;
};
const optionsSchema = z
  .object({
    source: z.string().min(1).optional(),
    cacheDirectory: z.string().min(1).optional(),
    requiredReleaseId: coordinatesReleaseIdSchema.optional(),
    allowDevelopment: z.boolean().default(false),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();

export type CoordinatesSetupCode =
  | 'COORDINATES_SETUP_INVALID_REQUEST'
  | 'COORDINATES_SETUP_RELEASE_UNAVAILABLE'
  | 'COORDINATES_SETUP_MANIFEST_INVALID'
  | 'COORDINATES_SETUP_ARTIFACT_UNAVAILABLE'
  | 'COORDINATES_SETUP_RUNTIME_UNSUPPORTED'
  | 'COORDINATES_SETUP_INTEGRITY_FAILED'
  | 'COORDINATES_SETUP_INSTALLATION_FAILED'
  | 'COORDINATES_SETUP_CANCELLED'
  | 'COORDINATES_SETUP_TIMEOUT';

export class CoordinatesSetupError extends Error {
  constructor(
    readonly code: CoordinatesSetupCode,
    readonly releaseId: string | null = null,
    readonly assetId?: string,
    readonly runtimeProfileId?: string,
  ) {
    super('Coordinates setup did not complete.');
    this.name = 'CoordinatesSetupError';
  }
  toJSON() {
    return {
      schemaVersion: 1,
      ok: false,
      command: 'setup.coordinates',
      releaseId: this.releaseId,
      usage: {mode: 'local', units: 0},
      error: {
        code: this.code,
        details: {
          ...(this.assetId ? {assetId: this.assetId} : {}),
          ...(this.runtimeProfileId ? {runtimeProfileId: this.runtimeProfileId} : {}),
        },
        message: this.message,
      },
    };
  }
}

type SetupPorts = {
  fetch?: typeof fetch;
  validateInstalled?: (
    directory: string,
    allowDevelopment: boolean,
    signal: AbortSignal,
  ) => Promise<void>;
};

class ArtifactIntegrityError extends Error {}

/** Delivery locations are transport metadata, never inputs to execution release identity. */
export function createCoordinatesSetup(ports: SetupPorts = {}) {
  return async (input: CoordinatesSetupOptions = {}) => {
    const parsed = optionsSchema.safeParse(input);
    if (!parsed.success) throw new CoordinatesSetupError('COORDINATES_SETUP_INVALID_REQUEST');
    const options = parsed.data;
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      15 * 60 * 1000,
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const fetcher = ports.fetch ?? globalThis.fetch;
    let releaseId: string | null = null;
    let activeAsset: string | undefined;
    let staging: string | undefined;
    let phase: CoordinatesSetupCode = 'COORDINATES_SETUP_MANIFEST_INVALID';
    try {
      signal.throwIfAborted();
      const source = options.source ?? defaultSource;
      const remote = /^https?:\/\//u.test(source);
      let base: string;
      let requestedAsset: string | undefined;
      let document: unknown;
      if (remote) {
        const manifest = await request(fetcher, source, signal);
        document = JSON.parse(await readResponse(manifest.response, 16 * 1024 * 1024, signal));
        base = manifest.url;
      } else {
        let path = resolve(source);
        const info = await lstat(path);
        if (info.isDirectory()) path = join(path, 'distribution.json');
        else if (/\.(dmg|tar\.gz)$/u.test(path)) {
          requestedAsset = path;
          path = join(dirname(path), 'distribution.json');
        }
        const manifestInfo = await lstat(path);
        if (
          !manifestInfo.isFile() ||
          manifestInfo.isSymbolicLink() ||
          manifestInfo.size > 16 * 1024 * 1024
        )
          throw new Error();
        document = JSON.parse(await readFile(path, 'utf8'));
        base = dirname(path);
      }
      const distribution = coordinatesDistributionSchema.parse(document);
      const release = distribution.release;
      releaseId = release.releaseId;
      if (options.requiredReleaseId && options.requiredReleaseId !== releaseId)
        throw new CoordinatesSetupError('COORDINATES_SETUP_RELEASE_UNAVAILABLE', releaseId);
      const candidates = release.artifacts.filter(
        (artifact) => artifact.platform === platform() && artifact.architecture === arch(),
      );
      if (candidates.length !== 1)
        throw new CoordinatesSetupError('COORDINATES_SETUP_RELEASE_UNAVAILABLE', releaseId);
      const artifact = candidates[0];
      if (artifact.distribution.kind === 'development' && !options.allowDevelopment)
        throw new CoordinatesSetupError('COORDINATES_SETUP_RELEASE_UNAVAILABLE', releaseId);
      await verifyQualifiedRuntimeProfile(artifact);
      const locations = distribution.locations[artifact.id];
      if (
        !locations ||
        Object.keys(locations).length !== artifact.assets.length ||
        artifact.assets.some((asset) => !locations[asset.id])
      )
        throw new Error();
      if (
        Object.keys(distribution.locations).some(
          (id) => !release.artifacts.some((candidate) => candidate.id === id),
        )
      )
        throw new Error();
      if (
        requestedAsset &&
        !Object.values(locations).some((location) => resolve(base, location) === requestedAsset)
      )
        throw new Error();
      const cache = resolve(options.cacheDirectory ?? coordinatesCacheDirectory());
      const directory = coordinatesInstallationDirectory(cache, releaseId, artifact.id);
      phase = 'COORDINATES_SETUP_INSTALLATION_FAILED';
      await mkdir(cache, {recursive: true, mode: 0o700});
      let exists = false;
      try {
        await lstat(directory);
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const validate = ports.validateInstalled ?? validateInstalled;
      let acquiredBytes = 0;
      if (!exists) {
        staging = join(cache, `.pending-${randomUUID()}`);
        await mkdir(staging, {mode: 0o700});
        const payload = join(staging, 'payload');
        await mkdir(payload, {mode: 0o700});
        const downloads = join(cache, 'artifacts');
        await mkdir(downloads, {recursive: true, mode: 0o700});
        for (const asset of artifact.assets) {
          activeAsset = asset.id;
          phase = 'COORDINATES_SETUP_ARTIFACT_UNAVAILABLE';
          const localAsset = join(downloads, `${asset.sha256}.asset`);
          let acquired = false;
          try {
            await lstat(localAsset);
            acquired = true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          if (!acquired) {
            const partial = join(staging, `${asset.id}.download`);
            const location = locations[asset.id];
            if (remote) {
              const response = await request(fetcher, new URL(location, base).href, signal);
              if (!response.response.body) throw new Error();
              await writeArtifact(response.response.body, partial, asset, signal);
            } else {
              // Offline sources cannot smuggle a network location into installation.
              if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(location)) throw new Error();
              const path = isAbsolute(location) ? location : resolve(base, location);
              const info = await lstat(path);
              if (!info.isFile() || info.isSymbolicLink()) throw new Error();
              if (info.size !== asset.bytes) throw new ArtifactIntegrityError();
              if (asset.format === 'dmg') await copyOfflineDmg(path, partial, signal);
              else await writeArtifact(createReadStream(path, {signal}), partial, asset, signal);
            }
            await rename(partial, localAsset);
            acquiredBytes += asset.bytes;
          }
          phase = 'COORDINATES_SETUP_INTEGRITY_FAILED';
          const info = await lstat(localAsset);
          if (
            !info.isFile() ||
            info.isSymbolicLink() ||
            info.size !== asset.bytes ||
            (await hashFile(localAsset, signal)) !== asset.sha256
          )
            throw new Error();
          if (remote && asset.format === 'dmg') await ensureRemoteDmgQuarantine(localAsset, signal);
          const part = join(staging, `part-${asset.id}`);
          const files = artifact.files.filter((file) => file.assetId === asset.id);
          phase = 'COORDINATES_SETUP_INSTALLATION_FAILED';
          if (asset.format === 'dmg') {
            if (artifact.distribution.kind === 'native-qualified') throw new Error();
            await extractCoordinatesDmg({
              artifactPath: localAsset,
              destination: part,
              files,
              trust: artifact.distribution,
              signal,
            });
          } else
            await extractCoordinatesArchive({
              archivePath: localAsset,
              destination: part,
              files,
              signal,
            });
          await merge(part, payload, signal);
          await rm(part, {recursive: true});
        }
        activeAsset = undefined;
        phase = 'COORDINATES_SETUP_INTEGRITY_FAILED';
        await verifyRuntimeFiles(payload, artifact, signal);
        await writeFile(join(staging, 'release.json'), `${JSON.stringify(release)}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
        phase = 'COORDINATES_SETUP_INSTALLATION_FAILED';
        await validate(staging, options.allowDevelopment, signal);
        signal.throwIfAborted();
        await mkdir(dirname(directory), {recursive: true, mode: 0o700});
        try {
          await rename(staging, directory);
          staging = undefined;
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? ''))
            throw error;
          if ((await readExecutionRelease(join(directory, 'release.json'))).releaseId !== releaseId)
            throw new ArtifactIntegrityError();
          await verifyRuntimeFiles(join(directory, 'payload'), artifact, signal);
          await validate(directory, options.allowDevelopment, signal);
        }
      } else {
        phase = 'COORDINATES_SETUP_INTEGRITY_FAILED';
        if ((await readExecutionRelease(join(directory, 'release.json'))).releaseId !== releaseId)
          throw new ArtifactIntegrityError();
        await verifyRuntimeFiles(join(directory, 'payload'), artifact, signal);
        await validate(directory, options.allowDevelopment, signal);
      }
      signal.throwIfAborted();
      const temporaryActive = join(cache, `.active-${randomUUID()}`);
      try {
        await writeFile(
          temporaryActive,
          `${JSON.stringify({releaseId, artifactId: artifact.id})}\n`,
          {flag: 'wx', mode: 0o600},
        );
        await rename(temporaryActive, join(cache, 'active.json'));
      } finally {
        await rm(temporaryActive, {force: true});
      }
      return {
        schemaVersion: 1 as const,
        ok: true as const,
        command: 'setup.coordinates' as const,
        releaseId,
        artifactId: artifact.id,
        provenance: runtimeProvenance(release, artifact),
        usage: {mode: 'local' as const, units: 0 as const},
        directory,
        cacheDirectory: cache,
        status: exists ? ('verified' as const) : ('installed' as const),
        distribution: artifact.distribution.kind,
        acquiredBytes,
        assets: artifact.assets.map(({id, bytes, sha256}) => ({id, bytes, sha256})),
      };
    } catch (error) {
      if (error instanceof CoordinatesRuntimeProfileError)
        throw new CoordinatesSetupError(
          'COORDINATES_SETUP_RUNTIME_UNSUPPORTED',
          releaseId,
          undefined,
          error.profileId,
        );
      if (signal.aborted)
        throw new CoordinatesSetupError(
          timedOut ? 'COORDINATES_SETUP_TIMEOUT' : 'COORDINATES_SETUP_CANCELLED',
          releaseId,
          activeAsset,
        );
      if (error instanceof ArtifactIntegrityError)
        throw new CoordinatesSetupError(
          'COORDINATES_SETUP_INTEGRITY_FAILED',
          releaseId,
          activeAsset,
        );
      if (error instanceof CoordinatesSetupError) throw error;
      throw new CoordinatesSetupError(phase, releaseId, activeAsset);
    } finally {
      clearTimeout(deadline);
      if (staging) await rm(staging, {recursive: true, force: true}).catch(() => undefined);
    }
  };
}

export const setupCoordinates = createCoordinatesSetup();
export type CoordinatesSetupResponse = Awaited<ReturnType<typeof setupCoordinates>>;

async function validateInstalled(
  directory: string,
  allowDevelopment: boolean,
  signal: AbortSignal,
) {
  const client = await createLocalCoordinates({directory, allowDevelopment, signal});
  try {
    const result = await client.transform(
      {from: 'EPSG:4258', to: 'EPSG:25832', positions: [[12, 55]]},
      {signal},
    );
    if (
      !result.ok ||
      Math.abs(result.result.results[0].position[0] - 691875.6321) > 0.0001 ||
      Math.abs(result.result.results[0].position[1] - 6098907.825) > 0.0001
    )
      throw new Error('CONTROL_POINT_FAILED');
  } finally {
    await client.close();
  }
}

async function merge(source: string, destination: string, signal: AbortSignal): Promise<void> {
  for (const entry of await readdir(source, {withFileTypes: true})) {
    signal.throwIfAborted();
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    let target;
    try {
      target = await lstat(to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!target) await rename(from, to);
    else if (target.isDirectory() && entry.isDirectory() && !target.isSymbolicLink())
      await merge(from, to, signal);
    else throw new Error('ASSET_FILE_COLLISION');
  }
}

async function request(
  fetcher: typeof fetch,
  location: string,
  signal: AbortSignal,
): Promise<{response: Response; url: string}> {
  let url = new URL(location);
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (
      (url.protocol !== 'https:' &&
        !(
          url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error('DELIVERY_URL_INVALID');
    const response = await fetcher(url, {method: 'GET', redirect: 'manual', signal});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined);
      const next = response.headers.get('location');
      if (!next) throw new Error('DELIVERY_REDIRECT_INVALID');
      url = new URL(next, url);
    } else {
      if (!response.ok || response.redirected) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error('DELIVERY_UNAVAILABLE');
      }
      return {response, url: url.href};
    }
  }
  throw new Error('DELIVERY_REDIRECT_LIMIT');
}

async function readResponse(response: Response, maximum: number, signal: AbortSignal) {
  if (!response.body) throw new Error('DELIVERY_EMPTY');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, {once: true});
  try {
    while (true) {
      signal.throwIfAborted();
      const {value, done} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maximum) {
        abort();
        throw new Error('DELIVERY_TOO_LARGE');
      }
      chunks.push(value);
    }
    signal.throwIfAborted();
    return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

async function writeArtifact(
  source: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  path: string,
  asset: CoordinatesReleaseAsset,
  signal: AbortSignal,
) {
  const target = await open(path, 'wx', 0o600);
  let size = 0;
  const hash = createHash('sha256');
  try {
    for await (const chunk of source as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > asset.bytes) throw new ArtifactIntegrityError();
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await target.write(chunk, offset, chunk.byteLength - offset, null);
        if (!written.bytesWritten) throw new Error('ASSET_WRITE_FAILED');
        offset += written.bytesWritten;
      }
    }
    if (size !== asset.bytes || hash.digest('hex') !== asset.sha256)
      throw new ArtifactIntegrityError();
  } finally {
    await target.close();
  }
}
