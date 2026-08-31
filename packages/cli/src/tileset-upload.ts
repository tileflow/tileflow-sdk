import {createHash} from 'node:crypto';
import {open, stat} from 'node:fs/promises';
import {z} from 'zod';
import {serializeCanonicalJson} from '@tileflow/core';
import {type HostedJsonResponse, requestHostedJson} from './hosted-client';

export const teamTilesetPartSize = 16_777_216;
export const maximumTeamTilesetBytes = 4_000_000_000;
const authorizationBatchSize = 16;
const uploadConcurrency = 4;
const maximumPartAttempts = 4;
const maximumControlAttempts = 4;
const maximumInitiatingWaitMs = 2 * 60 * 1_000;
const partTransferTimeoutMs = 10 * 60 * 1_000;
const authorizationClockSkewMs = 30_000;
const minimumPartAuthorizationLifetimeMs = partTransferTimeoutMs + authorizationClockSkewMs;

export type UploadFileIdentity = Readonly<{
  device: bigint;
  inode: bigint;
  mtimeNanoseconds: bigint;
  size: number;
}>;

export type PositionedUploadFile = Readonly<{
  close(): Promise<void>;
  identity(): Promise<UploadFileIdentity>;
  read(position: number, byteCount: number): Promise<Uint8Array>;
}>;

export type TeamTilesetUploadPart = Readonly<{
  byteCount: number;
  md5Base64: string;
  partNumber: number;
  sha256Base64: string;
}>;

export type PreparedTeamTilesetUpload = Readonly<{
  byteCount: number;
  contentHash: string;
  contentHashAlgorithm: 'sha256-fixed-parts-v1';
  identity: UploadFileIdentity;
  partSize: typeof teamTilesetPartSize;
  parts: readonly TeamTilesetUploadPart[];
  schemaVersion: 1;
}>;

type TeamTilesetUploadState =
  | 'aborted'
  | 'aborting'
  | 'expired'
  | 'expiring'
  | 'initiating'
  | 'published'
  | 'publishing'
  | 'ready_to_publish'
  | 'rejected'
  | 'rejecting'
  | 'uploading'
  | 'validating';

type TeamTilesetPublishedVersion = Readonly<{
  byteCount: number;
  contentHash: string;
  contentHashAlgorithm: 'sha256-fixed-parts-v1';
  publishedVersion: number;
  schemaVersion: 1;
  state: 'published';
  versionId: string;
}>;

type TeamTilesetUploadControl = Readonly<{
  byteCount: number;
  contentHash: string;
  contentHashAlgorithm: 'sha256-fixed-parts-v1';
  expiresAt: string;
  failure: Readonly<{code: string}> | null;
  partCount: number;
  parts: readonly Readonly<{
    byteCount: number;
    partNumber: number;
    uploaded: boolean;
    validationState: 'mismatch' | 'pending' | 'processing' | 'valid';
  }>[];
  partSize: typeof teamTilesetPartSize;
  publishedVersion: null;
  schemaVersion: 1;
  state: Exclude<TeamTilesetUploadState, 'published'>;
  uploadId: string;
  versionId: null;
}>;

export type TeamTilesetUploadSession = TeamTilesetPublishedVersion | TeamTilesetUploadControl;

export type TeamTilesetPartAuthorization = Readonly<{
  expiresAt: string;
  headers: Readonly<{
    'Content-Length': string;
    'Content-MD5': string;
  }>;
  method: 'PUT';
  partNumber: number;
  url: string;
}>;

export type TeamTilesetUploadTransport = Readonly<{
  authorize(
    uploadId: string,
    partNumbers: readonly number[],
  ): Promise<readonly TeamTilesetPartAuthorization[]>;
  begin(input: {
    byteCount: number;
    contentHash: string;
    contentHashAlgorithm: 'sha256-fixed-parts-v1';
    idempotencyKey: string;
    parts: readonly TeamTilesetUploadPart[];
    partSize: typeof teamTilesetPartSize;
    schemaVersion: 1;
  }): Promise<TeamTilesetUploadSession>;
  complete(uploadId: string): Promise<TeamTilesetUploadSession>;
  putPart(
    authorization: TeamTilesetPartAuthorization,
    bytes: Uint8Array,
  ): Promise<{etag: string | null; status: number}>;
  recordPart(uploadId: string, input: {etag: string; partNumber: number}): Promise<void>;
  status(uploadId: string): Promise<TeamTilesetUploadSession>;
}>;

export class TeamTilesetUploadError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, number>>;

  constructor(code: string, message: string, details: Readonly<Record<string, number>> = {}) {
    super(message);
    this.name = 'TeamTilesetUploadError';
    this.code = code;
    this.details = details;
  }
}

export function createTeamTilesetPartLayout(byteCount: number) {
  if (!Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > maximumTeamTilesetBytes) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_VERSION_TOO_LARGE',
      'PMTiles archive exceeds the 4,000,000,000-byte platform maximum.',
      {
        actualBytes: Number.isSafeInteger(byteCount) && byteCount >= 0 ? byteCount : 0,
        limitBytes: maximumTeamTilesetBytes,
      },
    );
  }

  return Object.freeze(
    Array.from({length: Math.ceil(byteCount / teamTilesetPartSize)}, (_, index) => {
      const position = index * teamTilesetPartSize;
      return Object.freeze({
        byteCount: Math.min(teamTilesetPartSize, byteCount - position),
        partNumber: index + 1,
        position,
      });
    }),
  );
}

export async function inspectNodeTeamTilesetArchive(path: string): Promise<UploadFileIdentity> {
  let value;
  try {
    value = await stat(path, {bigint: true});
  } catch {
    throw new TeamTilesetUploadError(
      'TF_TILESET_ARCHIVE_INVALID',
      'PMTiles archive is unavailable.',
    );
  }
  if (!value.isFile()) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_ARCHIVE_INVALID',
      'PMTiles archive must be a file.',
    );
  }

  return checkedIdentity(value.dev, value.ino, value.mtimeNs, value.size);
}

export async function openNodeTeamTilesetArchive(
  path: string,
  expectedIdentity: UploadFileIdentity,
): Promise<PositionedUploadFile> {
  const handle = await open(path, 'r');

  const identity = async () => {
    let pathStat;
    let handleStat;
    try {
      [pathStat, handleStat] = await Promise.all([
        stat(path, {bigint: true}),
        handle.stat({bigint: true}),
      ]);
    } catch {
      throw localFileChanged();
    }
    if (!pathStat.isFile() || !handleStat.isFile()) throw localFileChanged();
    const pathIdentity = checkedIdentity(
      pathStat.dev,
      pathStat.ino,
      pathStat.mtimeNs,
      pathStat.size,
    );
    const handleIdentity = checkedIdentity(
      handleStat.dev,
      handleStat.ino,
      handleStat.mtimeNs,
      handleStat.size,
    );
    assertFileIdentity(pathIdentity, handleIdentity);
    return pathIdentity;
  };

  try {
    assertFileIdentity(expectedIdentity, await identity());
  } catch (error) {
    await handle.close();
    throw error;
  }

  return {
    close: () => handle.close(),
    identity,
    async read(position, byteCount) {
      const bytes = Buffer.allocUnsafe(byteCount);
      let offset = 0;
      while (offset < byteCount) {
        const result = await handle.read(bytes, offset, byteCount - offset, position + offset);
        if (result.bytesRead === 0) throw localFileChanged();
        offset += result.bytesRead;
      }
      return bytes;
    },
  };
}

export async function prepareTeamTilesetUpload(
  file: PositionedUploadFile,
): Promise<PreparedTeamTilesetUpload> {
  const identity = await file.identity();
  const layout = createTeamTilesetPartLayout(identity.size);
  const parts: TeamTilesetUploadPart[] = [];

  for (const part of layout) {
    const bytes = await file.read(part.position, part.byteCount);
    if (bytes.byteLength !== part.byteCount) throw localFileChanged();
    parts.push(
      Object.freeze({
        byteCount: part.byteCount,
        md5Base64: createHash('md5').update(bytes).digest('base64'),
        partNumber: part.partNumber,
        sha256Base64: createHash('sha256').update(bytes).digest('base64'),
      }),
    );
  }

  assertFileIdentity(identity, await file.identity());
  const contentIdentity = {
    algorithm: 'sha256-fixed-parts-v1',
    byteCount: identity.size,
    partSize: teamTilesetPartSize,
    parts: parts.map(({byteCount, partNumber, sha256Base64}) => ({
      byteCount,
      partNumber,
      sha256Base64,
    })),
  };

  return Object.freeze({
    byteCount: identity.size,
    contentHash: createHash('sha256').update(serializeCanonicalJson(contentIdentity)).digest('hex'),
    contentHashAlgorithm: 'sha256-fixed-parts-v1',
    identity,
    partSize: teamTilesetPartSize,
    parts: Object.freeze(parts),
    schemaVersion: 1,
  });
}

export function createTeamTilesetUploadIdempotencyKey(
  tilesetId: string,
  upload: PreparedTeamTilesetUpload,
) {
  if (!/^tls_[A-Za-z0-9_-]{16,76}$/u.test(tilesetId)) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_NOT_FOUND',
      'Tileset registration returned an invalid ID.',
    );
  }
  return createHash('sha256')
    .update(
      serializeCanonicalJson({
        byteCount: upload.byteCount,
        contentHash: upload.contentHash,
        contentHashAlgorithm: upload.contentHashAlgorithm,
        tilesetId,
      }),
    )
    .digest('hex');
}

export async function publishPreparedTeamTilesetUpload(input: {
  file: PositionedUploadFile;
  onProgress?: (progress: {
    completedParts: number;
    phase: 'uploading' | 'validating';
    totalParts: number;
  }) => void;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  tilesetId: string;
  transport: TeamTilesetUploadTransport;
  upload: PreparedTeamTilesetUpload;
}) {
  assertFileIdentity(input.upload.identity, await input.file.identity());
  const beginInput = {
    byteCount: input.upload.byteCount,
    contentHash: input.upload.contentHash,
    contentHashAlgorithm: input.upload.contentHashAlgorithm,
    idempotencyKey: createTeamTilesetUploadIdempotencyKey(input.tilesetId, input.upload),
    parts: input.upload.parts,
    partSize: input.upload.partSize,
    schemaVersion: 1,
  } as const;
  const begun = await input.transport.begin(beginInput);
  assertSessionMatches(begun, input.upload);
  const changed = begun.state !== 'published';
  if (begun.state === 'published') return publicationResult(begun, input.upload, changed);

  let current = await input.transport.status(begun.uploadId);
  assertSessionMatches(current, input.upload, true);
  assertUsableSession(current);

  let initiatingWaitMs = 0;
  for (let attempt = 1; current.state === 'initiating'; attempt += 1) {
    const delay = Math.min(
      2_000,
      250 * 2 ** Math.min(attempt - 1, 3),
      maximumInitiatingWaitMs - initiatingWaitMs,
    );
    if (delay <= 0) {
      throw new TeamTilesetUploadError(
        'TF_TILESET_UPLOAD_UNAVAILABLE',
        'Tileset upload initialization did not converge within two minutes.',
      );
    }
    await (input.sleep ?? defaultSleep)(delay);
    initiatingWaitMs += delay;
    current = await input.transport.status(current.uploadId);
    assertSessionMatches(current, input.upload, true);
    assertUsableSession(current);
  }

  if (current.state === 'uploading') {
    const uploading = current;
    const missingParts = input.upload.parts.filter(
      (part) =>
        !uploading.parts.find((candidate) => candidate.partNumber === part.partNumber)?.uploaded,
    );
    await uploadMissingParts({...input, missingParts, uploadId: uploading.uploadId});
    assertFileIdentity(input.upload.identity, await input.file.identity());
    current = await input.transport.complete(uploading.uploadId);
    assertSessionMatches(current, input.upload);
    assertUsableSession(current);
  }

  while (current.state !== 'published') {
    if (!['publishing', 'ready_to_publish', 'validating'].includes(current.state)) {
      throw new TeamTilesetUploadError(
        'TF_TILESET_UPLOAD_UNAVAILABLE',
        'Tileset upload cannot continue from its current state.',
      );
    }
    input.onProgress?.({
      completedParts: input.upload.parts.length,
      phase: 'validating',
      totalParts: input.upload.parts.length,
    });
    await (input.sleep ?? defaultSleep)(2_000);
    current = await input.transport.status(current.uploadId);
    assertSessionMatches(current, input.upload, true);
    assertUsableSession(current);
  }

  return publicationResult(current, input.upload, changed);
}

export function createHostedTeamTilesetUploadTransport(input: {
  apiOrigin: string;
  credential: string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  tilesetId: string;
}): TeamTilesetUploadTransport {
  const basePath = `/v1/tilesets/${encodeURIComponent(input.tilesetId)}/uploads`;
  const control = async (path: string, init: RequestInit) => {
    for (let attempt = 1; attempt <= maximumControlAttempts; attempt += 1) {
      let response: HostedJsonResponse | undefined;
      try {
        response = await requestHostedJson(
          input.apiOrigin,
          path,
          {
            ...init,
            headers: {
              Authorization: `Bearer ${input.credential}`,
              ...(init.body ? {'Content-Type': 'application/json'} : {}),
              ...init.headers,
            },
          },
          {fetch: input.fetch},
        );
      } catch {
        if (attempt === maximumControlAttempts) {
          throw new TeamTilesetUploadError(
            'TF_TILESET_UPLOAD_UNAVAILABLE',
            'Tileset upload control request did not complete.',
          );
        }
      }
      if (response?.ok) return response.body;
      if (response && !isRetryableStatus(response.status)) throw responseError(response);
      if (attempt === maximumControlAttempts) {
        if (response) throw responseError(response);
        break;
      }
      await (input.sleep ?? defaultSleep)(Math.min(2_000, 250 * 2 ** (attempt - 1)));
    }
    throw new TeamTilesetUploadError(
      'TF_TILESET_UPLOAD_UNAVAILABLE',
      'Tileset upload control request did not complete.',
    );
  };

  return {
    async authorize(uploadId, partNumbers) {
      const body = await control(
        `${basePath}/${encodeURIComponent(uploadId)}/part-authorizations`,
        {
          body: JSON.stringify({partNumbers, schemaVersion: 1}),
          method: 'POST',
        },
      );
      return authorizationResponseSchema.parse(body).authorizations;
    },
    async begin(body) {
      return parseUploadSession(
        await control(basePath, {body: JSON.stringify(body), method: 'POST'}),
      );
    },
    async complete(uploadId) {
      return parseUploadSession(
        await control(`${basePath}/${encodeURIComponent(uploadId)}/complete`, {
          body: JSON.stringify({schemaVersion: 1}),
          method: 'POST',
        }),
      );
    },
    async putPart(authorization, bytes) {
      let response: Response;
      try {
        const body = new Uint8Array(
          bytes.buffer as ArrayBuffer,
          bytes.byteOffset,
          bytes.byteLength,
        );
        response = await (input.fetch ?? globalThis.fetch)(authorization.url, {
          body,
          headers: authorization.headers,
          method: 'PUT',
          redirect: 'error',
          signal: AbortSignal.timeout(partTransferTimeoutMs),
        });
      } catch {
        throw new Error('Direct part transfer failed.');
      }
      const etag = response.headers.get('etag');
      await response.body?.cancel().catch(() => undefined);
      return {etag, status: response.status};
    },
    async recordPart(uploadId, body) {
      partReceiptResponseSchema.parse(
        await control(`${basePath}/${encodeURIComponent(uploadId)}/parts`, {
          body: JSON.stringify(body),
          method: 'POST',
        }),
      );
    },
    async status(uploadId) {
      return parseUploadSession(
        await control(`${basePath}/${encodeURIComponent(uploadId)}`, {method: 'GET'}),
      );
    },
  };
}

async function uploadMissingParts(
  input: Parameters<typeof publishPreparedTeamTilesetUpload>[0] & {
    missingParts: readonly TeamTilesetUploadPart[];
    uploadId: string;
  },
) {
  let completedParts = input.upload.parts.length - input.missingParts.length;

  for (let offset = 0; offset < input.missingParts.length; offset += authorizationBatchSize) {
    const authorizationParts = input.missingParts.slice(offset, offset + authorizationBatchSize);
    const initial = indexAuthorizations(
      await input.transport.authorize(
        input.uploadId,
        authorizationParts.map(({partNumber}) => partNumber),
      ),
      authorizationParts,
    );

    for (
      let groupOffset = 0;
      groupOffset < authorizationParts.length;
      groupOffset += uploadConcurrency
    ) {
      assertFileIdentity(input.upload.identity, await input.file.identity());
      const group = authorizationParts.slice(groupOffset, groupOffset + uploadConcurrency);
      const settled = await Promise.allSettled(
        group.map(async (part) => {
          const position = (part.partNumber - 1) * teamTilesetPartSize;
          const bytes = await input.file.read(position, part.byteCount);
          if (bytes.byteLength !== part.byteCount) throw localFileChanged();
          await uploadPartWithRetry({
            ...input,
            initialAuthorization: initial.get(part.partNumber)!,
            part,
            bytes,
          });
        }),
      );
      const failed = settled.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
      completedParts += group.length;
      input.onProgress?.({
        completedParts,
        phase: 'uploading',
        totalParts: input.upload.parts.length,
      });
    }
  }
}

async function uploadPartWithRetry(
  input: Parameters<typeof uploadMissingParts>[0] & {
    bytes: Uint8Array;
    initialAuthorization: TeamTilesetPartAuthorization;
    part: TeamTilesetUploadPart;
  },
) {
  let authorization = input.initialAuthorization;

  for (let attempt = 1; attempt <= maximumPartAttempts; attempt += 1) {
    if (!authorizationCoversTransfer(authorization, input.now?.() ?? Date.now())) {
      const refreshed = await input.transport.authorize(input.uploadId, [input.part.partNumber]);
      authorization = indexAuthorizations(refreshed, [input.part]).get(input.part.partNumber)!;
      if (!authorizationCoversTransfer(authorization, input.now?.() ?? Date.now())) {
        throw invalidRemoteResponse();
      }
    }
    assertAuthorizationMatches(authorization, input.part);
    let result: {etag: string | null; status: number};
    try {
      result = await input.transport.putPart(authorization, input.bytes);
    } catch {
      result = {etag: null, status: 503};
    }

    if (result.status >= 200 && result.status < 300) {
      const etag = normalizePartEtag(result.etag, input.part.md5Base64);
      await input.transport.recordPart(input.uploadId, {
        etag,
        partNumber: input.part.partNumber,
      });
      return;
    }
    if (
      (result.status === 401 || result.status === 403) &&
      !authorizationCoversTransfer(authorization, input.now?.() ?? Date.now()) &&
      attempt < maximumPartAttempts
    ) {
      const refreshed = await input.transport.authorize(input.uploadId, [input.part.partNumber]);
      authorization = indexAuthorizations(refreshed, [input.part]).get(input.part.partNumber)!;
      continue;
    }
    if (!isRetryableStatus(result.status)) {
      throw new TeamTilesetUploadError(
        result.status === 401 || result.status === 403
          ? 'TF_TILESET_UPLOAD_AUTHORIZATION_FAILED'
          : 'TF_TILESET_UPLOAD_PART_INVALID',
        'Direct part transfer was rejected.',
      );
    }
    if (attempt === maximumPartAttempts) break;
    await (input.sleep ?? defaultSleep)(Math.min(2_000, 250 * 2 ** (attempt - 1)));
    const refreshed = await input.transport.authorize(input.uploadId, [input.part.partNumber]);
    authorization = indexAuthorizations(refreshed, [input.part]).get(input.part.partNumber)!;
  }

  throw new TeamTilesetUploadError(
    'TF_TILESET_UPLOAD_UNAVAILABLE',
    'Direct part transfer did not complete after bounded retries.',
  );
}

function authorizationCoversTransfer(
  authorization: TeamTilesetPartAuthorization,
  now: number,
): boolean {
  return Date.parse(authorization.expiresAt) - now >= minimumPartAuthorizationLifetimeMs;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function indexAuthorizations(
  authorizations: readonly TeamTilesetPartAuthorization[],
  parts: readonly TeamTilesetUploadPart[],
) {
  const expected = new Map(parts.map((part) => [part.partNumber, part]));
  const indexed = new Map<number, TeamTilesetPartAuthorization>();
  for (const authorization of authorizations) {
    const part = expected.get(authorization.partNumber);
    if (!part || indexed.has(authorization.partNumber)) {
      throw invalidRemoteResponse();
    }
    assertAuthorizationMatches(authorization, part);
    indexed.set(authorization.partNumber, authorization);
  }
  if (indexed.size !== expected.size) throw invalidRemoteResponse();
  return indexed;
}

function assertAuthorizationMatches(
  authorization: TeamTilesetPartAuthorization,
  part: TeamTilesetUploadPart,
) {
  if (
    authorization.partNumber !== part.partNumber ||
    authorization.method !== 'PUT' ||
    authorization.headers['Content-Length'] !== String(part.byteCount) ||
    authorization.headers['Content-MD5'] !== part.md5Base64
  ) {
    throw invalidRemoteResponse();
  }
}

function normalizePartEtag(value: string | null, md5Base64: string) {
  if (!value || !/^(?:[0-9a-f]{32}|"[0-9a-f]{32}")$/u.test(value)) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_UPLOAD_PART_INVALID',
      'Direct part transfer returned an invalid ETag.',
    );
  }
  const normalized = value.replaceAll('"', '');
  if (normalized !== Buffer.from(md5Base64, 'base64').toString('hex')) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_UPLOAD_PART_INVALID',
      'Direct part transfer returned a conflicting ETag.',
    );
  }
  return normalized;
}

function assertSessionMatches(
  session: TeamTilesetUploadSession,
  upload: PreparedTeamTilesetUpload,
  requireParts = false,
) {
  if (
    session.byteCount !== upload.byteCount ||
    session.contentHash !== upload.contentHash ||
    session.contentHashAlgorithm !== upload.contentHashAlgorithm
  ) {
    throw invalidRemoteResponse();
  }
  if (session.state === 'published') return;

  if (
    session.partCount !== upload.parts.length ||
    session.partSize !== upload.partSize ||
    (requireParts && session.parts.length !== upload.parts.length) ||
    session.parts.some((part, index) => {
      const expected = upload.parts[index];
      return (
        !expected ||
        part.partNumber !== expected.partNumber ||
        part.byteCount !== expected.byteCount
      );
    })
  ) {
    throw invalidRemoteResponse();
  }
}

function assertUsableSession(session: TeamTilesetUploadSession) {
  if (session.state === 'published') return;

  if (session.failure) {
    throw new TeamTilesetUploadError(session.failure.code, failureMessage(session.failure.code));
  }
  if (
    ['aborted', 'aborting', 'expired', 'expiring', 'rejected', 'rejecting'].includes(session.state)
  ) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_UPLOAD_UNAVAILABLE',
      'Tileset upload is no longer resumable.',
    );
  }
}

function publicationResult(
  session: TeamTilesetPublishedVersion,
  upload: PreparedTeamTilesetUpload,
  changed: boolean,
) {
  return Object.freeze({
    byteCount: upload.byteCount,
    changed,
    contentHash: upload.contentHash,
    contentHashAlgorithm: upload.contentHashAlgorithm,
    state: 'published' as const,
    version: session.publishedVersion,
    versionId: session.versionId,
  });
}

function assertFileIdentity(expected: UploadFileIdentity, actual: UploadFileIdentity) {
  const inodeChanged =
    expected.inode !== 0n &&
    actual.inode !== 0n &&
    (expected.inode !== actual.inode || expected.device !== actual.device);
  if (
    inodeChanged ||
    expected.size !== actual.size ||
    expected.mtimeNanoseconds !== actual.mtimeNanoseconds
  ) {
    throw localFileChanged();
  }
}

function checkedIdentity(device: bigint, inode: bigint, mtimeNanoseconds: bigint, size: bigint) {
  const numericSize = Number(size);
  if (numericSize === 0) {
    throw new TeamTilesetUploadError('TF_TILESET_ARCHIVE_EMPTY', 'PMTiles archive is empty.');
  }
  if (numericSize > maximumTeamTilesetBytes) {
    throw new TeamTilesetUploadError(
      'TF_TILESET_VERSION_TOO_LARGE',
      'PMTiles archive exceeds the 4,000,000,000-byte platform maximum.',
      {actualBytes: numericSize, limitBytes: maximumTeamTilesetBytes},
    );
  }
  return Object.freeze({device, inode, mtimeNanoseconds, size: numericSize});
}

function localFileChanged() {
  return new TeamTilesetUploadError(
    'TF_TILESET_LOCAL_FILE_CHANGED',
    'PMTiles archive changed during publication.',
  );
}

function invalidRemoteResponse() {
  return new TeamTilesetUploadError(
    'TF_TILESET_UPLOAD_UNAVAILABLE',
    'Tileset upload returned an invalid response.',
  );
}

function failureMessage(code: string) {
  if (code === 'TF_TILESET_SCHEMA_INCOMPATIBLE') {
    return 'Tileset schema is incompatible with retained Map deployments.';
  }
  if (code === 'TF_TILESET_UPLOAD_CHECKSUM_MISMATCH') {
    return 'Tileset upload checksum validation failed.';
  }
  if (code === 'TF_TILESET_UPLOAD_EXPIRED') return 'Tileset upload expired.';
  return 'Tileset upload failed.';
}

function responseError(response: HostedJsonResponse) {
  const body = asRecord(response.body);
  const code =
    typeof body.code === 'string' && /^TF_[A-Z0-9_]{1,96}$/u.test(body.code)
      ? body.code
      : 'TF_TILESET_UPLOAD_UNAVAILABLE';
  const details = numericDetails(body.details);
  return new TeamTilesetUploadError(code, failureMessage(code), details);
}

function numericDetails(value: unknown) {
  const source = asRecord(value);
  const details: Record<string, number> = {};
  for (const key of ['actualBytes', 'limitBytes']) {
    const candidate = source[key];
    if (Number.isSafeInteger(candidate) && (candidate as number) >= 0) {
      details[key] = candidate as number;
    }
  }
  return Object.freeze(details);
}

function parseUploadSession(value: unknown): TeamTilesetUploadSession {
  return uploadSessionSchema.parse(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function defaultSleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const identifierSchema = z
  .string()
  .min(20)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/u);
const uploadPartStatusSchema = z
  .object({
    byteCount: z.number().int().min(1).max(teamTilesetPartSize),
    partNumber: z.number().int().min(1).max(239),
    uploaded: z.boolean(),
    validationState: z.enum(['mismatch', 'pending', 'processing', 'valid']),
  })
  .strict();
const publishedVersionSchema = z
  .object({
    byteCount: z.number().int().min(1).max(maximumTeamTilesetBytes),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    contentHashAlgorithm: z.literal('sha256-fixed-parts-v1'),
    publishedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    schemaVersion: z.literal(1),
    state: z.literal('published'),
    versionId: identifierSchema.regex(/^tsv_[A-Za-z0-9_-]+$/u),
  })
  .strict();
const uploadControlSchema = z
  .object({
    byteCount: z.number().int().min(1).max(maximumTeamTilesetBytes),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/u),
    contentHashAlgorithm: z.literal('sha256-fixed-parts-v1'),
    expiresAt: z.iso.datetime({offset: true}),
    failure: z
      .object({code: z.string().regex(/^TF_[A-Z0-9_]{1,96}$/u)})
      .strict()
      .nullable(),
    partCount: z.number().int().min(1).max(239),
    parts: z.array(uploadPartStatusSchema).max(239),
    partSize: z.literal(teamTilesetPartSize),
    publishedVersion: z.null(),
    schemaVersion: z.literal(1),
    state: z.enum([
      'aborted',
      'aborting',
      'expired',
      'expiring',
      'initiating',
      'publishing',
      'ready_to_publish',
      'rejected',
      'rejecting',
      'uploading',
      'validating',
    ]),
    uploadId: z
      .string()
      .min(20)
      .max(80)
      .regex(/^tsu_[A-Za-z0-9_-]+$/u),
    versionId: z.null(),
  })
  .strict();
const uploadSessionSchema = z.union([publishedVersionSchema, uploadControlSchema]);
const authorizationSchema = z
  .object({
    expiresAt: z.iso.datetime({offset: true}),
    headers: z
      .object({
        'Content-Length': z.string().regex(/^[1-9][0-9]{0,9}$/u),
        'Content-MD5': z.string().regex(/^[A-Za-z0-9+/]{22}==$/u),
      })
      .strict(),
    method: z.literal('PUT'),
    partNumber: z.number().int().min(1).max(239),
    url: z
      .url()
      .max(8_192)
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
      }),
  })
  .strict();
const authorizationResponseSchema = z
  .object({
    authorizations: z.array(authorizationSchema).min(1).max(16),
    schemaVersion: z.literal(1),
  })
  .strict();
const partReceiptResponseSchema = z
  .object({
    changed: z.boolean(),
    etag: z.string().regex(/^[0-9a-f]{32}$/u),
    partNumber: z.number().int().min(1).max(239),
    schemaVersion: z.literal(1),
  })
  .strict();
