import {Command} from 'commander';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {registerTilesetCommands} from '../src/tileset-command';

test('Team data keys manage tilesets without loading account or Project state', async (t) => {
  const apiKey = `tf_live_${'a'.repeat(48)}`;
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  let accountLoads = 0;
  let authorization = '';
  let requestedUrl = '';
  let stdout = '';

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  });
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('authorization') ?? '';
    return Response.json({schemaVersion: 1, tilesets: []});
  }) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      accountLoads += 1;
      throw new Error('account state must not be loaded');
    },
  });
  await program.parseAsync([
    'node',
    'tileflow',
    'tileset',
    'list',
    '--api-url',
    'https://api.example.test',
    '--api-key',
    apiKey,
    '--json',
  ]);

  assert.equal(accountLoads, 0);
  assert.equal(requestedUrl, 'https://api.example.test/v1/tilesets?limit=100');
  assert.equal(authorization, `Bearer ${apiKey}`);
  assert.deepEqual(JSON.parse(stdout), {
    command: 'tileset list',
    schemaVersion: 1,
    tilesets: [],
  });
});

test('publish registers a Team-local ID and uses the resumable direct-upload protocol', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-tileset-publish-'));
  const archive = join(directory, 'stores.pmtiles');
  const archiveBytes = createPmtiles({vector_layers: []});
  const apiKey = `tf_live_${'b'.repeat(48)}`;
  const resourceId = 'tls_opaque-server-owned-id';
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  const requests: Array<{
    body: BodyInit | null | undefined;
    headers: Headers;
    method: string;
    url: string;
  }> = [];
  let beginBody: Record<string, unknown> | null = null;
  let stdout = '';

  await writeFile(archive, archiveBytes);

  t.after(async () => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
    await rm(directory, {force: true, recursive: true});
  });
  globalThis.fetch = (async (input, init) => {
    const request = {
      body: init?.body,
      headers: new Headers(init?.headers),
      method: init?.method ?? 'GET',
      url: String(input),
    };
    requests.push(request);
    const url = new URL(request.url);

    if (url.pathname === '/v1/tilesets') {
      return Response.json({tilesetId: resourceId});
    }
    if (url.pathname === `/v1/tilesets/${resourceId}/uploads` && request.method === 'POST') {
      beginBody = JSON.parse(String(request.body)) as Record<string, unknown>;
      return Response.json(uploadSession(beginBody, {parts: []}));
    }
    if (url.pathname.endsWith('/part-authorizations')) {
      const part = (beginBody?.parts as Array<Record<string, unknown>>)[0]!;
      return Response.json({
        authorizations: [
          {
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            headers: {
              'Content-Length': String(part.byteCount),
              'Content-MD5': String(part.md5Base64),
            },
            method: 'PUT',
            partNumber: 1,
            url: 'https://private.example.test/archive?X-Amz-Signature=secret',
          },
        ],
        schemaVersion: 1,
      });
    }
    if (url.origin === 'https://private.example.test') {
      const part = (beginBody?.parts as Array<Record<string, unknown>>)[0]!;
      return new Response(null, {
        headers: {etag: Buffer.from(String(part.md5Base64), 'base64').toString('hex')},
        status: 200,
      });
    }
    if (url.pathname.endsWith('/parts')) {
      const receipt = JSON.parse(String(request.body)) as {etag: string; partNumber: number};
      return Response.json({...receipt, changed: true, schemaVersion: 1});
    }
    if (url.pathname.endsWith('/complete')) {
      return Response.json({
        byteCount: beginBody!.byteCount,
        contentHash: beginBody!.contentHash,
        contentHashAlgorithm: beginBody!.contentHashAlgorithm,
        publishedVersion: 7,
        schemaVersion: 1,
        state: 'published',
        versionId: 'tsv_opaque-version-identity',
      });
    }
    if (url.pathname.includes('/uploads/')) {
      return Response.json(
        uploadSession(beginBody!, {parts: uploadedPartStatuses(beginBody!, false)}),
      );
    }

    throw new Error(`Unexpected request: ${request.method} ${url.origin}${url.pathname}`);
  }) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      throw new Error('account state must not be loaded');
    },
  });
  await program.parseAsync([
    'node',
    'tileflow',
    'tileset',
    'publish',
    archive,
    '--id',
    'stores',
    '--api-url',
    'https://api.example.test',
    '--api-key',
    apiKey,
    '--json',
  ]);

  assert.equal(requests.length, 7);
  assert.equal(requests[0]?.method, 'POST');
  assert.equal(requests[0]?.url, 'https://api.example.test/v1/tilesets');
  assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
    format: 'pmtiles',
    name: 'stores',
    slug: 'stores',
  });
  assert.equal(
    requests.some(({url}) => url.endsWith('/archive.pmtiles')),
    false,
  );
  const direct = requests.find(({url}) => url.startsWith('https://private.example.test/'))!;
  assert.equal(direct.method, 'PUT');
  assert.equal(direct.headers.has('authorization'), false);
  assert.equal((direct.body as Uint8Array).byteLength, archiveBytes.byteLength);
  const document = JSON.parse(stdout) as {
    publication: string;
    schemaVersion: number;
    team: unknown;
    tileset: {byteCount: number; logicalId: string; tilesetId: string; version: {number: number}};
  };
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.publication, 'changed');
  assert.equal(document.team, null);
  assert.equal(document.tileset.logicalId, 'stores');
  assert.equal(document.tileset.tilesetId, resourceId);
  assert.equal(document.tileset.byteCount, archiveBytes.byteLength);
  assert.equal(document.tileset.version.number, 7);
  assert.equal(stdout.includes('r2Key'), false);
  assert.equal(stdout.includes('uploadId'), false);
  assert.equal(stdout.includes('X-Amz'), false);
});

test('JSON management commands contain transport failures', async (t) => {
  const apiKey = `tf_live_${'c'.repeat(48)}`;
  const originalFetch = globalThis.fetch;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let stderr = '';

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  });
  globalThis.fetch = (async () => {
    throw new TypeError('connect ECONNREFUSED private-host');
  }) as typeof fetch;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      throw new Error('account state must not be loaded');
    },
  });

  await assert.doesNotReject(
    program.parseAsync(['node', 'tileflow', 'tileset', 'list', '--api-key', apiKey, '--json']),
  );
  const failure = JSON.parse(stderr) as {error: {code: string; message: string}; schemaVersion: 1};
  assert.equal(failure.schemaVersion, 1);
  assert.equal(failure.error.code, 'tileset_list_failed');
  assert.doesNotMatch(failure.error.message, /private-host/u);
});

test('tileset list aggregates every cursor page into one deterministic document', async (t) => {
  const apiKey = `tf_live_${'d'.repeat(48)}`;
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  const urls: string[] = [];
  let stdout = '';

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  });
  globalThis.fetch = (async (input) => {
    const url = String(input);
    urls.push(url);
    const cursor = new URL(url).searchParams.get('cursor');
    return Response.json({
      nextCursor: cursor ? null : 'cursor-2',
      schemaVersion: 1,
      tilesets: [inventoryItem(cursor ? 'beta' : 'alpha')],
    });
  }) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      throw new Error('account state must not be loaded');
    },
  });
  await program.parseAsync(['node', 'tileflow', 'tileset', 'list', '--api-key', apiKey, '--json']);

  const document = JSON.parse(stdout) as {tilesets: Array<{logicalName: string}>};
  assert.deepEqual(
    document.tilesets.map(({logicalName}) => logicalName),
    ['alpha', 'beta'],
  );
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[0]!).searchParams.get('limit'), '100');
  assert.equal(new URL(urls[1]!).searchParams.get('cursor'), 'cursor-2');
});

test('human tileset status prints the resolved physical resource ID', async (t) => {
  const apiKey = `tf_live_${'9'.repeat(48)}`;
  const resourceId = 'tls_opaque_resource_1234';
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write;
  const originalExitCode = process.exitCode;
  let stdout = '';

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = originalExitCode;
  });
  globalThis.fetch = (async () =>
    Response.json({
      schemaVersion: 1,
      tileset: {
        attribution: null,
        currentVersion: 3,
        dependencies: [],
        dependencyNextCursor: null,
        id: resourceId,
        name: 'Stores',
        slug: 'stores',
        state: 'active',
      },
    })) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      throw new Error('account state must not be loaded');
    },
  });
  await program.parseAsync([
    'node',
    'tileflow',
    'tileset',
    'status',
    'stores',
    '--api-key',
    apiKey,
  ]);

  assert.match(stdout, new RegExp(`ID: ${resourceId}`, 'u'));
  assert.doesNotMatch(stdout, /ID: stores(?:\n|$)/u);
});

test('tileset purge preserves bounded dependency blockers and their cursor', async (t) => {
  const apiKey = `tf_live_${'e'.repeat(48)}`;
  const originalFetch = globalThis.fetch;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let stderr = '';

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  });
  globalThis.fetch = (async () =>
    Response.json(
      {
        code: 'TF_TILESET_IN_USE',
        dependencies: [{deploymentId: 'dep_123', mapId: 'map_123', sourceId: 'stores'}],
        error: 'Tileset is used by retained Map deployments',
        nextCursor: 'dependency-cursor',
      },
      {status: 409},
    )) as typeof fetch;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      throw new Error('account state must not be loaded');
    },
  });
  await program.parseAsync([
    'node',
    'tileflow',
    'tileset',
    'purge',
    'stores',
    '--confirm',
    'stores',
    '--api-key',
    apiKey,
    '--json',
  ]);

  const failure = JSON.parse(stderr) as {
    error: {code: string; dependencies: unknown[]; nextCursor: string};
  };
  assert.equal(failure.error.code, 'TF_TILESET_IN_USE');
  assert.equal(failure.error.dependencies.length, 1);
  assert.equal(failure.error.nextCursor, 'dependency-cursor');
});

test('tileset management rejects extra remote fields without reflecting them', async (t) => {
  const secret = 'r2-secret-key-never-reflect';
  const apiKey = `tf_live_${'f'.repeat(48)}`;
  const originalFetch = globalThis.fetch;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let stdout = '';
  let stderr = '';

  t.after(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  });
  globalThis.fetch = (async () =>
    Response.json({
      nextCursor: null,
      r2Key: secret,
      schemaVersion: 1,
      tilesets: [],
    })) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const program = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(program, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: async () => {
      throw new Error('account state must not be loaded');
    },
  });
  await program.parseAsync(['node', 'tileflow', 'tileset', 'list', '--api-key', apiKey, '--json']);

  assert.equal(stdout, '');
  assert.match(stderr, /tileset_list_failed/u);
  assert.doesNotMatch(stderr, new RegExp(secret));
});

function inventoryItem(logicalName: string) {
  return {
    currentVersion: null,
    hasCurrent: false,
    id: `tls_${logicalName.padEnd(16, 'x')}`,
    logicalName,
    name: logicalName,
    retainedBytes: 0,
    retainedDeploymentCount: 0,
    status: 'active',
    updatedAt: '2026-08-31T12:00:00.000Z',
    usedByMapCount: 0,
  };
}

function createPmtiles(metadata: Record<string, unknown>) {
  const headerLength = 127;
  const directory = new Uint8Array([1, 0, 1, 1, 1]);
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const tile = new Uint8Array([0]);
  const bytes = new Uint8Array(
    headerLength + directory.byteLength + metadataBytes.byteLength + tile.byteLength,
  );
  const view = new DataView(bytes.buffer);
  const rootOffset = headerLength;
  const metadataOffset = rootOffset + directory.byteLength;
  const tileOffset = metadataOffset + metadataBytes.byteLength;
  bytes.set(new TextEncoder().encode('PMTiles'), 0);
  view.setUint8(7, 3);
  setUint64(view, 8, rootOffset);
  setUint64(view, 16, directory.byteLength);
  setUint64(view, 24, metadataOffset);
  setUint64(view, 32, metadataBytes.byteLength);
  setUint64(view, 40, tileOffset);
  setUint64(view, 48, 0);
  setUint64(view, 56, tileOffset);
  setUint64(view, 64, tile.byteLength);
  setUint64(view, 72, 1);
  setUint64(view, 80, 1);
  setUint64(view, 88, 1);
  view.setUint8(96, 1);
  view.setUint8(97, 1);
  view.setUint8(98, 1);
  view.setUint8(99, 1);
  view.setUint8(100, 0);
  view.setUint8(101, 0);
  view.setInt32(102, -1_800_000_000, true);
  view.setInt32(106, -850_000_000, true);
  view.setInt32(110, 1_800_000_000, true);
  view.setInt32(114, 850_000_000, true);
  view.setUint8(118, 0);
  view.setInt32(119, 0, true);
  view.setInt32(123, 0, true);
  bytes.set(directory, rootOffset);
  bytes.set(metadataBytes, metadataOffset);
  bytes.set(tile, tileOffset);
  return bytes;
}

function uploadSession(begin: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const parts = begin.parts as Array<Record<string, unknown>>;
  return {
    byteCount: begin.byteCount,
    contentHash: begin.contentHash,
    contentHashAlgorithm: begin.contentHashAlgorithm,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    failure: null,
    partCount: parts.length,
    parts: uploadedPartStatuses(begin, false),
    partSize: begin.partSize,
    publishedVersion: null,
    schemaVersion: 1,
    state: 'uploading',
    uploadId: 'tsu_opaque-upload-session',
    versionId: null,
    ...overrides,
  };
}

function uploadedPartStatuses(begin: Record<string, unknown>, uploaded = true) {
  return (begin.parts as Array<Record<string, unknown>>).map((part) => ({
    byteCount: part.byteCount,
    partNumber: part.partNumber,
    uploaded,
    validationState: uploaded ? 'valid' : 'pending',
  }));
}

function setUint64(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 2 ** 32), true);
}
