import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  createHostedTeamTilesetUploadTransport,
  createTeamTilesetPartLayout,
  createTeamTilesetUploadIdempotencyKey,
  inspectNodeTeamTilesetArchive,
  maximumTeamTilesetBytes,
  openNodeTeamTilesetArchive,
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

test('Node positioned reads preserve offsets, concurrent ownership and truncated-file errors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-positioned-upload-'));
  const path = join(directory, 'archive.bin');
  const source = Buffer.from(Array.from({length: 129}, (_, index) => index));
  await writeFile(path, source);
  const file = await openNodeTeamTilesetArchive(path, await inspectNodeTeamTilesetArchive(path));
  t.after(async () => {
    await file.close();
    await rm(directory, {recursive: true, force: true});
  });
  assert.ok(file.readInto);
  const backing = Buffer.alloc(16, 255);
  assert.equal(await file.readInto(7, backing.subarray(3, 13)), 10);
  assert.deepEqual(backing.subarray(0, 3), Buffer.alloc(3, 255));
  assert.deepEqual(backing.subarray(3, 13), source.subarray(7, 17));
  assert.deepEqual(backing.subarray(13), Buffer.alloc(3, 255));

  const targets = Array.from({length: 4}, () => Buffer.alloc(8));
  await Promise.all(targets.map((target, index) => file.readInto!(index * 32 + 1, target)));
  targets.forEach((target, index) =>
    assert.deepEqual(target, source.subarray(index * 32 + 1, index * 32 + 9)),
  );
  const [first, second] = await Promise.all([file.read(10, 9), file.read(100, 5)]);
  first.fill(255);
  assert.deepEqual(second, source.subarray(100, 105));
  await assert.rejects(
    file.readInto(125, Buffer.alloc(5)),
    (error: unknown) =>
      error instanceof TeamTilesetUploadError && error.code === 'TF_TILESET_LOCAL_FILE_CHANGED',
  );
});

test('fixed part layout reaches the exact 8,000,000,000-byte boundary without allocating it', () => {
  const layout = createTeamTilesetPartLayout(maximumTeamTilesetBytes);

  assert.equal(layout.length, 477);
  assert.deepEqual(layout[0], {byteCount: teamTilesetPartSize, partNumber: 1, position: 0});
  assert.deepEqual(layout.at(-1), {
    byteCount: 14_045_184,
    partNumber: 477,
    position: 7_985_954_816,
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

test('manifest hashing reuses one positioned-read buffer without changing part evidence', async () => {
  const size = teamTilesetPartSize * 2 + 7;
  const expected = await prepareTeamTilesetUpload(generatedFile(size));
  const buffers = new Set<ArrayBufferLike>();
  const lengths: number[] = [];
  let allocatingReads = 0;
  const file = {
    ...generatedFile(size),
    async read(position: number, count: number) {
      allocatingReads += 1;
      return new Uint8Array(count).fill(Math.floor(position / teamTilesetPartSize) % 251);
    },
    async readInto(position: number, target: Uint8Array) {
      buffers.add(target.buffer);
      lengths.push(target.byteLength);
      target.fill(Math.floor(position / teamTilesetPartSize) % 251);
      return target.byteLength;
    },
  };

  const actual = await prepareTeamTilesetUpload(file);

  assert.deepEqual(actual, expected);
  assert.equal(allocatingReads, 0);
  assert.equal(buffers.size, 1);
  assert.deepEqual(lengths, [teamTilesetPartSize, teamTilesetPartSize, 7]);
});

test('HTTP part bodies avoid full-buffer copies and retain exact bytes and integrity headers', async () => {
  await new Request('https://example.test', {method: 'PUT', body: 'warmup'}).body?.cancel();
  const buffers = Array.from({length: 4}, (_, index) => Buffer.alloc(teamTilesetPartSize, index));
  const requests: Request[] = [];
  let allReady!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    allReady = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const transport = createHostedTeamTilesetUploadTransport({
    apiOrigin: 'https://api.example.test',
    credential: `tf_cap_${'a'.repeat(64)}`,
    tilesetId,
    fetch: (async (url, init) => {
      const request = new Request(url, init);
      const index = requests.push(request) - 1;
      if (requests.length === buffers.length) allReady();
      await barrier;
      const bytes = new Uint8Array(await request.arrayBuffer());
      assert.deepEqual(bytes, new Uint8Array(buffers[index]!));
      assert.equal(request.headers.get('content-length'), String(teamTilesetPartSize));
      const md5 = createHash('md5').update(bytes).digest('base64');
      assert.equal(request.headers.get('content-md5'), md5);
      return new Response(null, {
        status: 200,
        headers: {etag: Buffer.from(md5, 'base64').toString('hex')},
      });
    }) as typeof fetch,
  });
  const before = process.memoryUsage().arrayBuffers;
  const pending = buffers.map((bytes, index) =>
    transport.putPart(
      {
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
        headers: {
          'Content-Length': String(bytes.byteLength),
          'Content-MD5': createHash('md5').update(bytes).digest('base64'),
        },
        method: 'PUT',
        partNumber: index + 1,
        url: `https://private.example.test/part-${index}`,
      },
      bytes,
    ),
  );

  await ready;
  const additionalBytes = process.memoryUsage().arrayBuffers - before;
  release();
  await Promise.all(pending);

  assert.ok(
    additionalBytes < teamTilesetPartSize,
    `Request preparation copied ${additionalBytes} bytes`,
  );
});

test('real HTTP retries send complete bodies and retire each request signal', async (t) => {
  const bytes = Buffer.alloc(128 * 1024 + 9, 7);
  const md5 = createHash('md5').update(bytes).digest('base64');
  const seen: Array<{length: number; md5: string; chunked: string | undefined}> = [];
  const server = createServer(async (request, response) => {
    const digest = createHash('md5');
    let length = 0;
    for await (const chunk of request) {
      digest.update(chunk);
      length += chunk.length;
    }
    seen.push({
      length,
      md5: digest.digest('base64'),
      chunked: request.headers['transfer-encoding'],
    });
    response.writeHead(seen.length === 1 ? 503 : 200, {
      etag: Buffer.from(md5, 'base64').toString('hex'),
    });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const signals: AbortSignal[] = [];
  const transport = createHostedTeamTilesetUploadTransport({
    apiOrigin: 'https://api.example.test',
    credential: `tf_cap_${'a'.repeat(64)}`,
    tilesetId,
    fetch: (async (url, init) => {
      signals.push(init!.signal!);
      return globalThis.fetch(url, init);
    }) as typeof fetch,
  });
  const authorization: TeamTilesetPartAuthorization = {
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    headers: {'Content-Length': String(bytes.length), 'Content-MD5': md5},
    method: 'PUT',
    partNumber: 1,
    url: `http://127.0.0.1:${address.port}/part`,
  };

  assert.equal((await transport.putPart(authorization, bytes)).status, 503);
  assert.equal((await transport.putPart(authorization, bytes)).status, 200);
  assert.deepEqual(
    seen,
    Array.from({length: 2}, () => ({length: bytes.length, md5, chunked: undefined})),
  );
  assert.ok(signals.every((signal) => signal.aborted));
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

test('positioned transfer buffers are reused only after their four owners finish', async () => {
  const size = teamTilesetPartSize * 8 + 7;
  const buffers = new Set<ArrayBufferLike>();
  const active = new Set<ArrayBufferLike>();
  let allocatingReads = 0;
  let maximumActive = 0;
  const file = {
    ...generatedFile(size),
    async read(position: number, count: number) {
      allocatingReads += 1;
      return new Uint8Array(count).fill(Math.floor(position / teamTilesetPartSize) % 251);
    },
    async readInto(position: number, target: Uint8Array) {
      buffers.add(target.buffer);
      target.fill(Math.floor(position / teamTilesetPartSize) % 251);
      return target.byteLength;
    },
  };
  const upload = await prepareTeamTilesetUpload(file);
  buffers.clear();
  const transport = transportFor(upload, {
    async putPart(authorization, bytes) {
      assert.ok(!active.has(bytes.buffer));
      active.add(bytes.buffer);
      maximumActive = Math.max(maximumActive, active.size);
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(
        createHash('md5').update(bytes).digest('base64'),
        authorization.headers['Content-MD5'],
      );
      active.delete(bytes.buffer);
      return {etag: md5Hex(authorization), status: 200};
    },
  });

  await publishPreparedTeamTilesetUpload({file, tilesetId, transport, upload});

  assert.equal(allocatingReads, 0);
  assert.equal(buffers.size, 4);
  assert.equal(maximumActive, 4);
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

test('failed Team renewal sends no stale credential or private failure text', async () => {
  let renewals = 0;
  let requests = 0;
  const transport = createHostedTeamTilesetUploadTransport({
    apiOrigin: 'https://api.example.test',
    credential: 'tf_cap_stale',
    getCredential: async () => {
      renewals += 1;
      throw new Error('private-session-and-provider-response');
    },
    fetch: (async () => {
      requests += 1;
      throw new Error('Stale authority must not be sent');
    }) as typeof fetch,
    tilesetId,
  });

  await assert.rejects(
    transport.status('tsu_opaque-upload-session'),
    (error: unknown) =>
      error instanceof TeamTilesetUploadError &&
      error.code === 'TF_TILESET_UPLOAD_UNAVAILABLE' &&
      error.message.includes('Run tileflow login') &&
      !error.message.includes('private-session'),
  );
  assert.equal(renewals, 1);
  assert.equal(requests, 0);
});

test('administratively disabled uploads stop without retrying or exposing server text', async () => {
  const file = generatedFile(8);
  const upload = await prepareTeamTilesetUpload(file);
  let calls = 0;
  const delays: number[] = [];
  const transport = createHostedTeamTilesetUploadTransport({
    apiOrigin: 'https://api.example.test',
    credential: `tf_cap_${'a'.repeat(64)}`,
    fetch: (async () => {
      calls += 1;
      return Response.json(
        {code: 'TF_TILESET_UPLOAD_DISABLED', error: 'X-Amz-Credential=never-print-this'},
        {status: 503},
      );
    }) as typeof fetch,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
    tilesetId,
  });

  await assert.rejects(
    publishPreparedTeamTilesetUpload({file, tilesetId, transport, upload}),
    (error: unknown) =>
      error instanceof TeamTilesetUploadError &&
      error.code === 'TF_TILESET_UPLOAD_DISABLED' &&
      !error.message.includes('never-print-this'),
  );

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
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
