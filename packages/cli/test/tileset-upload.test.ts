import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHostedTeamTilesetUploadTransport,
  createTeamTilesetPartLayout,
  createTeamTilesetUploadIdempotencyKey,
  maximumTeamTilesetBytes,
  type PositionedUploadFile,
  type PreparedTeamTilesetUpload,
  prepareTeamTilesetUpload,
  publishPreparedTeamTilesetUpload,
  type TeamTilesetPartAuthorization,
  teamTilesetPartSize,
  TeamTilesetUploadError,
  type TeamTilesetUploadSession,
  type TeamTilesetUploadTransport,
  type UploadFileIdentity,
} from '../src/tileset-upload';

const tilesetId = 'tls_opaque_identity_1234';

test('fixed part layout reaches the exact 4,000,000,000-byte boundary without allocating it', () => {
  const layout = createTeamTilesetPartLayout(maximumTeamTilesetBytes);

  assert.equal(layout.length, 239);
  assert.deepEqual(layout[0], {byteCount: teamTilesetPartSize, partNumber: 1, position: 0});
  assert.deepEqual(layout.at(-1), {
    byteCount: 7_022_592,
    partNumber: 239,
    position: 3_992_977_408,
  });
  assert.throws(
    () => createTeamTilesetPartLayout(maximumTeamTilesetBytes + 1),
    (error: unknown) =>
      error instanceof TeamTilesetUploadError &&
      error.code === 'TF_TILESET_VERSION_TOO_LARGE' &&
      error.details.limitBytes === maximumTeamTilesetBytes,
  );
});

test('manifest hashing is deterministic and binds ordered MD5 and SHA-256 part evidence', async () => {
  const first = await prepareTeamTilesetUpload(memoryFile(new TextEncoder().encode('hello')));
  const second = await prepareTeamTilesetUpload(memoryFile(new TextEncoder().encode('hello')));

  assert.deepEqual(first, second);
  assert.deepEqual(first.parts, [
    {
      byteCount: 5,
      md5Base64: 'XUFAKrxLKna5cZ2REBfFkg==',
      partNumber: 1,
      sha256Base64: 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
    },
  ]);
  assert.equal(
    first.contentHash,
    'e9bf0cc83022b5147696619ea2ba2ed1ffcced1c9917ce90deb286602c7cd732',
  );
  assert.equal(
    createTeamTilesetUploadIdempotencyKey(tilesetId, first),
    createTeamTilesetUploadIdempotencyKey(tilesetId, second),
  );
});

test('direct publication buffers no more than four fixed parts concurrently', async () => {
  const file = generatedFile(teamTilesetPartSize * 4 + 1);
  const upload = await prepareTeamTilesetUpload(file);
  let activeBytes = 0;
  let maximumActiveBytes = 0;
  const transport = transportFor(upload, {
    async putPart(authorization, bytes) {
      activeBytes += bytes.byteLength;
      maximumActiveBytes = Math.max(maximumActiveBytes, activeBytes);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeBytes -= bytes.byteLength;
      return {etag: md5Hex(authorization), status: 200};
    },
  });

  const result = await publishPreparedTeamTilesetUpload({
    file,
    sleep: async () => undefined,
    tilesetId,
    transport,
    upload,
  });

  assert.equal(result.state, 'published');
  assert.equal(maximumActiveBytes, teamTilesetPartSize * 4);
});

test('transient part failure refreshes the signed URL before retry', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  let authorizationCalls = 0;
  let putCalls = 0;
  const delays: number[] = [];
  const transport = transportFor(upload, {
    async authorize(_uploadId, partNumbers) {
      authorizationCalls += 1;
      return partNumbers.map((partNumber) =>
        authorization(upload, partNumber, `refresh-${authorizationCalls}`),
      );
    },
    async putPart(value) {
      putCalls += 1;
      return putCalls === 1 ? {etag: null, status: 503} : {etag: md5Hex(value), status: 200};
    },
  });

  await publishPreparedTeamTilesetUpload({
    file,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    tilesetId,
    transport,
    upload,
  });

  assert.equal(authorizationCalls, 2);
  assert.equal(putCalls, 2);
  assert.deepEqual(delays, [250]);
});

test('restart uploads only parts not recorded by the server', async () => {
  const file = generatedFile(teamTilesetPartSize + 1);
  const upload = await prepareTeamTilesetUpload(file);
  const uploadedParts: number[] = [];
  const transport = transportFor(upload, {
    async putPart(value) {
      uploadedParts.push(value.partNumber);
      return {etag: md5Hex(value), status: 200};
    },
    status: async () =>
      session(upload, {
        parts: upload.parts.map((part) => ({
          byteCount: part.byteCount,
          partNumber: part.partNumber,
          uploaded: part.partNumber === 1,
          validationState: 'pending',
        })),
      }),
  });

  await publishPreparedTeamTilesetUpload({file, tilesetId, transport, upload});

  assert.deepEqual(uploadedParts, [2]);
});

test('completion polls validation until publication without repeating transfer', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  let completeCalls = 0;
  let putCalls = 0;
  let statusCalls = 0;
  const delays: number[] = [];
  const transport = transportFor(upload, {
    complete: async () => {
      completeCalls += 1;
      return session(upload, {
        parts: upload.parts.map((part) => ({
          byteCount: part.byteCount,
          partNumber: part.partNumber,
          uploaded: true,
          validationState: 'pending',
        })),
        state: 'validating',
        versionId: 'tsv_opaque_identity_1234',
      });
    },
    async putPart(value) {
      putCalls += 1;
      return {etag: md5Hex(value), status: 200};
    },
    status: async () => {
      statusCalls += 1;
      return statusCalls === 1 ? session(upload) : publishedSession(upload);
    },
  });

  const result = await publishPreparedTeamTilesetUpload({
    file,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    tilesetId,
    transport,
    upload,
  });

  assert.equal(result.state, 'published');
  assert.equal(putCalls, 1);
  assert.equal(completeCalls, 1);
  assert.equal(statusCalls, 2);
  assert.deepEqual(delays, [2_000]);
});

test('an initiating session waits for normal Queue processing within a bounded window', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  let beginCalls = 0;
  let statusCalls = 0;
  let now = Date.now();
  const transport = transportFor(upload, {
    begin: async () => {
      beginCalls += 1;
      return session(upload, {parts: [], state: 'initiating'});
    },
    status: async () => {
      statusCalls += 1;
      return statusCalls <= 20 ? session(upload, {state: 'initiating'}) : session(upload);
    },
  });

  const result = await publishPreparedTeamTilesetUpload({
    file,
    now: () => now,
    sleep: async (milliseconds) => {
      now += milliseconds;
    },
    tilesetId,
    transport,
    upload,
  });

  assert.equal(result.state, 'published');
  assert.equal(beginCalls, 1);
  assert.equal(statusCalls, 21);
});

test('a part capability is refreshed before it no longer covers the transfer budget', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  const now = Date.parse('2026-08-31T12:00:00.000Z');
  let authorizationCalls = 0;
  let putCalls = 0;
  const transport = transportFor(upload, {
    async authorize(_uploadId, partNumbers) {
      authorizationCalls += 1;
      const expiresAt = new Date(
        now + (authorizationCalls === 1 ? 5 * 60_000 : 15 * 60_000),
      ).toISOString();
      return partNumbers.map((partNumber) => ({
        ...authorization(upload, partNumber, `refresh-${authorizationCalls}`),
        expiresAt,
      }));
    },
    async putPart(value) {
      putCalls += 1;
      return {etag: md5Hex(value), status: 200};
    },
  });

  await publishPreparedTeamTilesetUpload({
    file,
    now: () => now,
    sleep: async () => undefined,
    tilesetId,
    transport,
    upload,
  } as never);

  assert.equal(authorizationCalls, 2);
  assert.equal(putCalls, 1);
});

test('idempotent control requests retry bounded transient HTTP failures', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  let calls = 0;
  const delays: number[] = [];
  const transport = createHostedTeamTilesetUploadTransport({
    apiOrigin: 'https://api.example.test',
    credential: `tf_cap_${'a'.repeat(64)}`,
    fetch: (async () => {
      calls += 1;
      return calls === 1
        ? Response.json({error: 'temporary'}, {status: 503})
        : Response.json({
            ...session(upload, {parts: []}),
            expiresAt: '2026-09-01T12:00:00.000Z',
            schemaVersion: 1,
          });
    }) as typeof fetch,
    sleep: async (milliseconds: number) => {
      delays.push(milliseconds);
    },
    tilesetId,
  } as never);

  const begun = await transport.begin({
    byteCount: upload.byteCount,
    contentHash: upload.contentHash,
    contentHashAlgorithm: upload.contentHashAlgorithm,
    idempotencyKey: createTeamTilesetUploadIdempotencyKey(tilesetId, upload),
    parts: upload.parts,
    partSize: upload.partSize,
    schemaVersion: 1,
  });

  assert.equal(begun.state, 'uploading');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test('an unchanged current version needs no retained upload control', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  const transport = createHostedTeamTilesetUploadTransport({
    apiOrigin: 'https://api.example.test',
    credential: `tf_cap_${'a'.repeat(64)}`,
    fetch: (async () =>
      Response.json({
        byteCount: upload.byteCount,
        contentHash: upload.contentHash,
        contentHashAlgorithm: upload.contentHashAlgorithm,
        publishedVersion: 7,
        schemaVersion: 1,
        state: 'published',
        versionId: 'tsv_opaque_identity_1234',
      })) as typeof fetch,
    tilesetId,
  } as never);

  const result = await publishPreparedTeamTilesetUpload({file, tilesetId, transport, upload});

  assert.deepEqual(result, {
    byteCount: upload.byteCount,
    changed: false,
    contentHash: upload.contentHash,
    contentHashAlgorithm: upload.contentHashAlgorithm,
    state: 'published',
    version: 7,
    versionId: 'tsv_opaque_identity_1234',
  });
});

test('local mutation stops before direct transfer or completion', async () => {
  let identityCalls = 0;
  let putCalls = 0;
  let completeCalls = 0;
  const stable = identity(8);
  const changed = {...stable, mtimeNanoseconds: 2n};
  const file: PositionedUploadFile = {
    close: async () => undefined,
    identity: async () => {
      identityCalls += 1;
      return identityCalls >= 4 ? changed : stable;
    },
    read: async (_position, byteCount) => new Uint8Array(byteCount),
  };
  const upload = await prepareTeamTilesetUpload(file);
  const transport = transportFor(upload, {
    complete: async () => {
      completeCalls += 1;
      return publishedSession(upload);
    },
    async putPart(value) {
      putCalls += 1;
      return {etag: md5Hex(value), status: 200};
    },
  });

  await assert.rejects(
    publishPreparedTeamTilesetUpload({file, tilesetId, transport, upload}),
    (error: unknown) =>
      error instanceof TeamTilesetUploadError && error.code === 'TF_TILESET_LOCAL_FILE_CHANGED',
  );
  assert.equal(putCalls, 0);
  assert.equal(completeCalls, 0);
});

test('server limits remain structured while signed URL failures are redacted', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  const limit = new TeamTilesetUploadError(
    'TF_TILESET_VERSION_TOO_LARGE',
    'PMTiles version is too large.',
    {actualBytes: 2_000_000_001, limitBytes: 2_000_000_000},
  );
  await assert.rejects(
    publishPreparedTeamTilesetUpload({
      file,
      tilesetId,
      transport: transportFor(upload, {begin: async () => Promise.reject(limit)}),
      upload,
    }),
    (error: unknown) => error === limit,
  );

  const secret = 'X-Amz-Credential=never-print-this';
  await assert.rejects(
    publishPreparedTeamTilesetUpload({
      file,
      sleep: async () => undefined,
      tilesetId,
      transport: transportFor(upload, {
        putPart: async () => Promise.reject(new Error(secret)),
      }),
      upload,
    }),
    (error: unknown) =>
      error instanceof TeamTilesetUploadError &&
      error.code === 'TF_TILESET_UPLOAD_UNAVAILABLE' &&
      !error.message.includes(secret),
  );
});

function transportFor(
  upload: PreparedTeamTilesetUpload,
  overrides: Partial<TeamTilesetUploadTransport> = {},
): TeamTilesetUploadTransport {
  return {
    authorize: async (_uploadId, partNumbers) =>
      partNumbers.map((partNumber) => authorization(upload, partNumber, 'initial')),
    begin: async () => session(upload, {parts: []}),
    complete: async () => publishedSession(upload),
    putPart: async (value) => ({etag: md5Hex(value), status: 200}),
    recordPart: async () => undefined,
    status: async () => session(upload),
    ...overrides,
  };
}

function session(
  upload: PreparedTeamTilesetUpload,
  overrides: Partial<TeamTilesetUploadSession> = {},
): TeamTilesetUploadSession {
  return {
    byteCount: upload.byteCount,
    contentHash: upload.contentHash,
    contentHashAlgorithm: upload.contentHashAlgorithm,
    expiresAt: '2026-09-01T12:00:00.000Z',
    failure: null,
    partCount: upload.parts.length,
    parts: upload.parts.map((part) => ({
      byteCount: part.byteCount,
      partNumber: part.partNumber,
      uploaded: false,
      validationState: 'pending',
    })),
    partSize: upload.partSize,
    publishedVersion: null,
    schemaVersion: 1,
    state: 'uploading',
    uploadId: 'tsu_opaque_identity_1234',
    versionId: null,
    ...overrides,
  } as TeamTilesetUploadSession;
}

function publishedSession(upload: PreparedTeamTilesetUpload): TeamTilesetUploadSession {
  return {
    byteCount: upload.byteCount,
    contentHash: upload.contentHash,
    contentHashAlgorithm: upload.contentHashAlgorithm,
    publishedVersion: 7,
    schemaVersion: 1,
    state: 'published',
    versionId: 'tsv_opaque_identity_1234',
  };
}

function authorization(
  upload: PreparedTeamTilesetUpload,
  partNumber: number,
  token: string,
): TeamTilesetPartAuthorization {
  const part = upload.parts[partNumber - 1]!;
  return {
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    headers: {
      'Content-Length': String(part.byteCount),
      'Content-MD5': part.md5Base64,
    },
    method: 'PUT',
    partNumber,
    url: `https://private.example.test/archive?token=${token}`,
  };
}

function md5Hex(value: TeamTilesetPartAuthorization) {
  return Buffer.from(value.headers['Content-MD5'], 'base64').toString('hex');
}

function memoryFile(bytes: Uint8Array): PositionedUploadFile {
  const value = identity(bytes.byteLength);
  return {
    close: async () => undefined,
    identity: async () => value,
    read: async (position, byteCount) => bytes.subarray(position, position + byteCount),
  };
}

function generatedFile(byteCount: number): PositionedUploadFile {
  const value = identity(byteCount);
  return {
    close: async () => undefined,
    identity: async () => value,
    read: async (position, length) => {
      const bytes = new Uint8Array(length);
      bytes.fill(Math.floor(position / teamTilesetPartSize) % 251);
      return bytes;
    },
  };
}

function identity(size: number): UploadFileIdentity {
  return {device: 1n, inode: 1n, mtimeNanoseconds: 1n, size};
}
