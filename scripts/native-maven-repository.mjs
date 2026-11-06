import {execFile} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {parseArgs, promisify} from 'node:util';
import {
  gpgSignatureVerifier,
  readMavenMetadata,
  validateMavenRepository,
} from './native-maven-bundle.mjs';
import {
  compareAlphaVersions,
  mavenArtifactDirectory,
  parseAlphaVersion,
  readNativeReleaseCatalog,
} from './native-release-config.mjs';

const exec = promisify(execFile);
const rehearsalVersion = /^0\.0\.0-rehearsal\.(0|[1-9]\d*)$/u;
const rehearsalBucket = /^tileflow-maven-rehearsal(?:-[a-z0-9-]+)?$/u;
const cacheImmutable = 'public, max-age=31536000, immutable';
const cacheMutable = 'no-store';
const maxAttempts = 8;
const retryDelay = (attempt) => sleep(Math.min(250 * 2 ** attempt, 2000));

export const reservationIndexKey = '_tileflow/native-releases/reservations.json';

function versionValidator(rehearsal) {
  return (version) =>
    typeof version === 'string' &&
    (rehearsal ? rehearsalVersion.test(version) : Boolean(parseAlphaVersion(version)));
}

export function parseReservationIndex(bytes, catalog, {rehearsal = false} = {}) {
  try {
    const index = JSON.parse(bytes.toString('utf8'));
    if (
      index?.schemaVersion !== 1 ||
      index.group !== catalog.maven.group ||
      Object.keys(index).length !== 3 ||
      !Array.isArray(index.versions) ||
      !index.versions.every(versionValidator(rehearsal)) ||
      new Set(index.versions).size !== index.versions.length
    ) {
      throw new Error('Expected schema version 1 and a unique list of versions for this group.');
    }
    return index.versions;
  } catch (error) {
    throw new Error(`Invalid Maven reservation index ${reservationIndexKey}: ${error.message}`, {
      cause: error,
    });
  }
}

function writeReservationIndex(group, versions) {
  return Buffer.from(`${JSON.stringify({schemaVersion: 1, group, versions})}\n`);
}

function digest(algorithm, bytes, encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function contentType(key) {
  if (/\.(?:xml|pom)$/u.test(key)) return 'application/xml';
  if (/\.(?:json|module)$/u.test(key)) return 'application/json';
  if (key.endsWith('.jar')) return 'application/java-archive';
  if (key.endsWith('.aar')) return 'application/zip';
  if (key.endsWith('.asc')) return 'application/pgp-signature';
  return 'text/plain; charset=utf-8';
}

async function batches(items, apply) {
  const values = [...items];
  for (let offset = 0; offset < values.length; offset += 6) {
    const results = await Promise.allSettled(values.slice(offset, offset + 6).map(apply));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}

function writeMetadata({group, artifactId}, versions, date) {
  const latest = versions.at(-1);
  const timestamp = date.toISOString().replace(/\D/gu, '').slice(0, 14);
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<metadata>\n  <groupId>${group}</groupId>\n  <artifactId>${artifactId}</artifactId>\n` +
      `  <versioning>\n    <latest>${latest}</latest>\n    <release>${latest}</release>\n` +
      `    <versions>\n${versions.map((version) => `      <version>${version}</version>`).join('\n')}\n` +
      `    </versions>\n    <lastUpdated>${timestamp}</lastUpdated>\n  </versioning>\n</metadata>\n`,
  );
}

function rejectConflict(key, expected, existing) {
  if (existing && !existing.equals(expected)) {
    throw new Error(`Maven publication conflicts with existing bytes at ${key}.`);
  }
}

async function createImmutable(store, key, bytes, cacheControl) {
  if (await store.put(key, bytes, {ifNoneMatch: '*', cacheControl})) return;

  const existing = await store.get(key);
  if (!existing) throw new Error(`Conditional write lost without an object at ${key}.`);
  rejectConflict(key, bytes, existing.bytes);
}

async function verifyPublic(readPublic, key, expected, wait) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if ((await readPublic(key))?.equals(expected)) return;
    if (attempt + 1 < maxAttempts) await wait(attempt);
  }
  throw new Error(`Anonymous Maven download did not match approved bytes at ${key}.`);
}

export async function readAnonymousMavenFile(
  baseUrl,
  key,
  {request = fetch, wait = retryDelay} = {},
) {
  const attempts = 4;
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const signal = AbortSignal.timeout(20_000);
    try {
      const response = await request(`${baseUrl}/${key}`, {redirect: 'error', signal});
      if (response.ok) return Buffer.from(await response.arrayBuffer());

      await response.body?.cancel();
      if (response.status === 404) return null;
      failure = new Error(`Anonymous download returned HTTP ${response.status} for ${key}.`);
      if (response.status !== 429 && (response.status < 500 || response.status >= 600)) {
        throw failure;
      }
    } catch (error) {
      if (
        !signal.aborted &&
        error?.name !== 'TimeoutError' &&
        !['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT'].includes(error?.cause?.code)
      ) {
        throw error;
      }
      failure = new Error(`Anonymous download timed out for ${key}.`, {cause: error});
    }

    if (attempt + 1 < attempts) await wait(attempt);
  }
  throw failure;
}

async function ensureVersionListed({
  store,
  readPublic,
  version,
  key,
  readVersions,
  writeVersions,
  compareVersions,
  wait,
}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const previous = await store.get(key);
    const versions = previous ? readVersions(previous.bytes) : [];
    if (versions.includes(version)) {
      // A concurrent release may update the public listing between reads. Compare a new snapshot.
      if ((await readPublic(key))?.equals(previous.bytes)) return;
    } else {
      const updated = writeVersions([...versions, version].sort(compareVersions));
      const condition = previous ? {ifMatch: previous.etag} : {ifNoneMatch: '*'};
      if (previous && !previous.etag) throw new Error(`Missing ETag for ${key}.`);

      if (await store.put(key, updated, {...condition, cacheControl: cacheMutable})) {
        if ((await readPublic(key))?.equals(updated)) return;
      }
    }
    if (attempt + 1 < maxAttempts) await wait(attempt);
  }
  throw new Error(`Could not update and verify ${key} on the public Maven repository.`);
}

/** Publishes bytes from a validated signed repository. `store.put` returns false on a lost CAS. */
export async function publishMavenRepository({
  catalog,
  version,
  files,
  store,
  readPublic,
  now = () => new Date(),
  wait = retryDelay,
}) {
  const rehearsal = rehearsalVersion.test(version);
  const acceptsVersion = versionValidator(rehearsal);
  if (!acceptsVersion(version)) throw new Error(`Invalid Maven release version ${version}.`);
  const compareVersions = rehearsal
    ? (a, b) => {
        const left = BigInt(rehearsalVersion.exec(a)[1]);
        const right = BigInt(rehearsalVersion.exec(b)[1]);
        return left < right ? -1 : left > right ? 1 : 0;
      }
    : compareAlphaVersions;

  const {group, publications} = catalog.maven;
  const metadata = publications.map(({artifactId}) => {
    const prefix = `${mavenArtifactDirectory(catalog, artifactId)}/`;
    return {
      key: `${prefix}maven-metadata.xml`,
      prefix: `${prefix}${version}/`,
      group,
      artifactId,
      acceptsVersion,
    };
  });
  const entries = [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  if (
    metadata.length === 0 ||
    metadata.some(({prefix}) => !entries.some(([key]) => key.startsWith(prefix))) ||
    entries.some(([key, bytes]) => {
      const prefix = metadata.find((item) => key.startsWith(item.prefix))?.prefix;
      return !prefix || !/^[a-z0-9][a-z0-9.-]*$/u.test(key.slice(prefix.length)) || !bytes.length;
    })
  ) {
    throw new Error('Expected nonempty Maven release files for every artifact.');
  }

  // Claim the complete signed byte set once. Concurrent attempts with different signatures or
  // artifacts must not mix files, even if both preflight reads saw an empty version.
  const claimKey = `_tileflow/native-releases/${group}/${version}.sha256`;
  const manifest = JSON.stringify(entries.map(([key, bytes]) => [key, digest('sha256', bytes)]));
  const claim = Buffer.from(`${digest('sha256', manifest)}\n`);
  const existingClaim = await store.get(claimKey);
  rejectConflict(claimKey, claim, existingClaim?.bytes);

  await batches(metadata, async (item) => {
    for (const key of await store.list(item.prefix)) {
      if (!files.has(key)) throw new Error(`Unexpected existing Maven release object ${key}.`);
    }
    const existing = await store.get(item.key);
    if (existing) readMavenMetadata(existing.bytes, item);
  });

  const missing = [];
  await batches(entries, async ([key, bytes]) => {
    const existing = await store.get(key);
    if (!existing) {
      missing.push([key, bytes]);
      return;
    }
    rejectConflict(key, bytes, existing.bytes);
    rejectConflict(key, bytes, await readPublic(key));
  });

  // A fresh workflow must skip this version even if this one stops before the claim or artifacts.
  const listingOptions = {store, readPublic, version, compareVersions, wait};
  await ensureVersionListed({
    ...listingOptions,
    key: reservationIndexKey,
    readVersions: (bytes) => parseReservationIndex(bytes, catalog, {rehearsal}),
    writeVersions: (versions) => writeReservationIndex(group, versions),
  });

  if (!existingClaim) await createImmutable(store, claimKey, claim, cacheMutable);
  await batches(missing, ([key, bytes]) => createImmutable(store, key, bytes, cacheImmutable));
  await batches(entries, ([key, bytes]) => verifyPublic(readPublic, key, bytes, wait));

  // Only the XML listing is mutable. Separate metadata checksum files cannot be updated atomically.
  await batches(metadata, (item) =>
    ensureVersionListed({
      ...listingOptions,
      key: item.key,
      readVersions: (bytes) => readMavenMetadata(bytes, item),
      writeVersions: (versions) => writeMetadata(item, versions, now()),
    }),
  );
  return {files: entries.length, version};
}

function makeR2Store({accountId, bucket, accessKeyId, secretAccessKey, workDirectory, env}) {
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const cliEnv = {
    ...Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('AWS_'))),
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_CONFIG_FILE: '/dev/null',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED',
    AWS_RESPONSE_CHECKSUM_VALIDATION: 'WHEN_REQUIRED',
  };

  async function call(operation, options, ignored) {
    try {
      const {stdout} = await exec(
        'aws',
        [
          's3api',
          operation,
          '--bucket',
          bucket,
          '--endpoint-url',
          endpoint,
          '--region',
          'auto',
          '--output',
          'json',
          '--no-cli-pager',
          '--no-cli-auto-prompt',
          '--cli-connect-timeout',
          '10',
          '--cli-read-timeout',
          '30',
          ...options,
        ],
        {env: cliEnv},
      );
      return stdout.trim() ? JSON.parse(stdout) : {};
    } catch (error) {
      if (ignored?.test(error.stderr ?? '')) return null;
      throw new Error(`R2 ${operation} failed: ${error.stderr?.trim() || error.message}`);
    }
  }

  async function withFile(operation) {
    const path = join(workDirectory, randomUUID());
    try {
      return await operation(path);
    } finally {
      await rm(path, {force: true});
    }
  }

  return {
    async get(key) {
      return await withFile(async (path) => {
        const result = await call('get-object', ['--key', key, path], /\(NoSuchKey\)/u);
        if (!result) return null;
        return {bytes: await readFile(path), etag: result.ETag};
      });
    },
    async list(prefix) {
      const result = await call('list-objects-v2', ['--prefix', prefix]);
      return (result.Contents ?? []).map(({Key}) => Key);
    },
    async put(key, bytes, {ifMatch, ifNoneMatch, cacheControl}) {
      return await withFile(async (path) => {
        await writeFile(path, bytes, {flag: 'wx'});
        const result = await call(
          'put-object',
          [
            '--key',
            key,
            '--body',
            path,
            '--content-md5',
            digest('md5', bytes, 'base64'),
            '--content-type',
            contentType(key),
            '--cache-control',
            cacheControl,
            ...(ifMatch ? ['--if-match', ifMatch] : ['--if-none-match', ifNoneMatch]),
          ],
          /\((?:PreconditionFailed|ConditionalRequestConflict)\)/u,
        );
        return Boolean(result);
      });
    },
  };
}

function requireTarget({catalog, version, rehearsal, publicUrl, env}) {
  const {
    R2_ACCOUNT_ID: accountId,
    R2_MAVEN_BUCKET: bucket,
    R2_MAVEN_ACCESS_KEY_ID: accessKeyId,
    R2_MAVEN_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (
    !/^[0-9a-f]{32}$/u.test(accountId ?? '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u.test(bucket ?? '') ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    throw new Error(
      'Set R2_ACCOUNT_ID, R2_MAVEN_BUCKET and the bucket-scoped R2_MAVEN credentials.',
    );
  }

  if (rehearsal) {
    if (
      !rehearsalVersion.test(version) ||
      !rehearsalBucket.test(bucket) ||
      !/^https:\/\/[a-z0-9-]+\.r2\.dev\/?$/u.test(publicUrl ?? '')
    ) {
      throw new Error(
        'Rehearsal requires a rehearsal bucket, public r2.dev URL and rehearsal version.',
      );
    }
  } else {
    if (
      publicUrl !== undefined ||
      rehearsalBucket.test(bucket) ||
      !parseAlphaVersion(version) ||
      env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_REPOSITORY !== catalog.sourceRepository ||
      env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      env.GITHUB_WORKFLOW_REF !==
        `${catalog.sourceRepository}/.github/workflows/native-publish.yml@refs/heads/main`
    ) {
      throw new Error('Production Maven publication requires the native publish workflow on main.');
    }
    publicUrl = catalog.maven.repositoryUrl;
  }

  return {
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrl: publicUrl.replace(/\/$/u, ''),
  };
}

async function main(env = process.env) {
  const {values} = parseArgs({
    options: {
      repository: {type: 'string'},
      version: {type: 'string'},
      gnupghome: {type: 'string'},
      rehearsal: {type: 'boolean'},
      'public-url': {type: 'string'},
    },
  });
  const {repository, version, gnupghome, rehearsal, 'public-url': publicUrl} = values;
  if (!isAbsolute(repository ?? '') || !version || !isAbsolute(gnupghome ?? '')) {
    throw new Error('Pass absolute --repository and --gnupghome paths and the --version.');
  }
  const fingerprint = (env.NATIVE_SIGNING_KEY_FINGERPRINT ?? '').toUpperCase();
  if (!/^[0-9A-F]{40}$/u.test(fingerprint)) {
    throw new Error('Set NATIVE_SIGNING_KEY_FINGERPRINT to the signing key fingerprint.');
  }

  const catalog = await readNativeReleaseCatalog();
  const target = requireTarget({catalog, version, rehearsal, publicUrl, env});
  const paths = await validateMavenRepository(repository, {
    catalog,
    version,
    signed: true,
    verifySignature: gpgSignatureVerifier({gnupgHome: gnupghome, fingerprint}),
  });
  const files = new Map();
  for (const key of paths) files.set(key, await readFile(join(repository, key)));

  const workDirectory = await mkdtemp(join(tmpdir(), 'tileflow-maven-r2-'));
  try {
    const result = await publishMavenRepository({
      catalog,
      version,
      files,
      store: makeR2Store({...target, workDirectory, env}),
      readPublic: (key) => readAnonymousMavenFile(target.publicUrl, key),
    });
    console.log(
      `Maven ${version}: verified ${result.files} signed release files and version listings at ${target.publicUrl}.`,
    );
  } finally {
    await rm(workDirectory, {recursive: true, force: true});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
