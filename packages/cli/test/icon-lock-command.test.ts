import {Command} from 'commander';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {tileflowIconsLockfileName} from '@tileflow/core';
import {registerIconLockCommands} from '../src/icon-lock-command';

const apiKey = `tf_live_${'a'.repeat(48)}`;
const glyphs = `{kind:'url',url:'https://fonts.example.test/{fontstack}/{range}.pbf',fontStacks:['Noto Sans Regular','Noto Sans Bold']}`;
const modules = `{poi:{type:'poi',icons:false},roads:disable()}`;

type CapturedRequest = {body: unknown; method: string; url: string};

function pin(setIndex: number, version: number) {
  const packageId = `icp_${String(setIndex * 100 + version).padStart(16, '0')}`;
  return {
    teamId: 'org_1',
    setId: `ics_${String(setIndex).padStart(16, '0')}`,
    versionId: `icv_${String(setIndex * 100 + version).padStart(16, '0')}`,
    version,
    packageId,
    contentHash: `${String(setIndex)}${String(version)}`.padEnd(64, 'a'),
    manifest: null as unknown,
    spriteUrl: `https://api.tileflow.dev/sprites/${packageId}/sprite`,
  };
}

/** A pin is only valid when its manifest hashes to the locked content hash. */
async function realPin(setIndex: number, version: number, iconId: string) {
  const {packTileflowRenderedIcons} = await import('@tileflow/dev/icons');
  const cell = (ratio: number) => ({
    width: 4 * ratio,
    height: 2 * ratio,
    rgba: new Uint8Array(4 * ratio * 2 * ratio * 4).fill(setIndex * 16 + version),
  });
  const artifact = await packTileflowRenderedIcons([{id: iconId, oneX: cell(1), twoX: cell(2)}]);
  const packageId = `icp_${artifact.contentHash.slice(0, 16)}`;
  return {
    ...pin(setIndex, version),
    contentHash: artifact.contentHash,
    manifest: artifact.manifest,
    packageId,
    spriteUrl: `https://api.tileflow.dev/sprites/${packageId}/sprite`,
  };
}

async function fixture(
  t: {after(callback: () => Promise<void> | void): void},
  references: readonly string[],
) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-icon-lock-'));
  t.after(() => rm(cwd, {force: true, maxRetries: 5, recursive: true, retryDelay: 100}));
  await mkdir(join(cwd, 'icons'));
  await writeFile(
    join(cwd, 'icons', 'shop.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2563eb"/></svg>',
  );
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap, disable, iconSet} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:streets,icons:[${references
      .map((reference) => `iconSet(${JSON.stringify(reference)})`)
      .join(',')},'./icons'],modules:${modules},glyphs:${glyphs}});\n`,
  );
  return cwd;
}

function run(
  t: {after(callback: () => void): void},
  cwd: string,
  respond: (request: CapturedRequest) => Response,
  captured: CapturedRequest[],
) {
  const output = {stderr: '', stdout: ''};
  const originalExitCode = process.exitCode;
  const fetchStub = (async (input, init) => {
    const request: CapturedRequest = {
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      method: init?.method ?? 'GET',
      url: String(input),
    };
    captured.push(request);
    return respond(request);
  }) as typeof globalThis.fetch;
  t.after(() => {
    process.exitCode = originalExitCode;
  });
  const command = new Command().name('tileflow').exitOverride();
  registerIconLockCommands(command, {
    defaultApiUrl: 'https://api.tileflow.dev',
    defaultConfigPath: 'tileflow.config.ts',
    loadAuthConfig: (async () => {
      throw new Error('account state must not be loaded');
    }) as never,
  });
  return {
    command,
    output,
    async parse(argv: string[]) {
      const originalFetch = globalThis.fetch;
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      const originalExitCode = process.exitCode;
      const originalCwd = process.cwd();
      process.chdir(cwd);
      globalThis.fetch = fetchStub;
      process.stdout.write = ((chunk: string | Uint8Array) => {
        output.stdout += String(chunk);
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        output.stderr += String(chunk);
        return true;
      }) as typeof process.stderr.write;
      try {
        await command.parseAsync(['node', 'tileflow', ...argv]);
      } finally {
        globalThis.fetch = originalFetch;
        process.chdir(originalCwd);
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      }
    },
  };
}

function revisionResponse(value: Awaited<ReturnType<typeof realPin>>, reference: string) {
  return Response.json({
    schemaVersion: 1,
    archived: false,
    revision: {
      id: value.versionId,
      reference,
      version: value.version,
      publishedAt: '2026-09-14T10:00:00.000Z',
      purgedAt: null,
      iconCount: 1,
      totalBytes: 400,
      publisher: {kind: 'membership', id: 'user_1'},
      pin: value,
    },
  });
}

test('install resolves latest exactly once for each declared reference', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const transport = await realPin(2, 5, 'bus');
  const cwd = await fixture(t, ['@acme/brand', '@acme/transport']);
  const authoredConfig = await readFile(join(cwd, 'tileflow.config.ts'), 'utf8');
  const captured: CapturedRequest[] = [];
  const context = run(
    t,
    cwd,
    (request) =>
      request.url.includes('/icon-sets/brand/')
        ? revisionResponse(brand, '@acme/brand')
        : revisionResponse(transport, '@acme/transport'),
    captured,
  );

  await context.parse(['icons', 'install', '--api-key', apiKey, '--json']);

  assert.deepEqual(
    captured.map((request) => request.url),
    [
      'https://api.tileflow.dev/v1/icon-sets/brand/versions/latest',
      'https://api.tileflow.dev/v1/icon-sets/transport/versions/latest',
    ],
  );
  const lock = JSON.parse(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8')) as {
    lockfileVersion: number;
    sets: Record<string, {version: number}>;
  };
  assert.equal(lock.lockfileVersion, 1);
  assert.deepEqual(Object.keys(lock.sets).sort(), ['@acme/brand', '@acme/transport']);
  assert.equal(lock.sets['@acme/brand']!.version, 2);
  assert.equal(lock.sets['@acme/transport']!.version, 5);
  const document = JSON.parse(context.output.stdout) as {command: string; sets: unknown[]};
  assert.equal(document.command, 'icons install');
  assert.equal(document.sets.length, 2);
  assert.equal(await readFile(join(cwd, 'tileflow.config.ts'), 'utf8'), authoredConfig);
});

test('install keeps an already pinned reference and resolves only the missing one', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const transport = await realPin(2, 5, 'bus');
  const cwd = await fixture(t, ['@acme/brand', '@acme/transport']);
  await writeFile(
    join(cwd, tileflowIconsLockfileName),
    `${JSON.stringify({lockfileVersion: 1, sets: {'@acme/brand': brand}})}\n`,
  );
  const captured: CapturedRequest[] = [];
  const context = run(t, cwd, () => revisionResponse(transport, '@acme/transport'), captured);

  await context.parse(['icons', 'install', '--api-key', apiKey, '--json']);

  assert.deepEqual(
    captured.map((request) => request.url),
    ['https://api.tileflow.dev/v1/icon-sets/transport/versions/latest'],
  );
  const lock = JSON.parse(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8')) as {
    sets: Record<string, {version: number; versionId: string}>;
  };
  assert.equal(lock.sets['@acme/brand']!.versionId, brand.versionId);
  assert.equal(lock.sets['@acme/transport']!.version, 5);
});

test('update replaces only the selected pin and preserves every other exact pin', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const brandNext = await realPin(1, 7, 'hospital');
  const transport = await realPin(2, 5, 'bus');
  const cwd = await fixture(t, ['@acme/brand', '@acme/transport']);
  await writeFile(
    join(cwd, tileflowIconsLockfileName),
    `${JSON.stringify({lockfileVersion: 1, sets: {'@acme/brand': brand, '@acme/transport': transport}})}\n`,
  );
  const captured: CapturedRequest[] = [];
  const context = run(t, cwd, () => revisionResponse(brandNext, '@acme/brand'), captured);

  await context.parse(['icons', 'update', '@acme/brand', '--api-key', apiKey, '--json']);

  assert.deepEqual(
    captured.map((request) => request.url),
    ['https://api.tileflow.dev/v1/icon-sets/brand/versions/latest'],
  );
  const lock = JSON.parse(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8')) as {
    sets: Record<string, {version: number; versionId: string}>;
  };
  assert.equal(lock.sets['@acme/brand']!.version, 7);
  assert.deepEqual(lock.sets['@acme/transport'], transport);
});

test('pin selects one exact revision and never resolves a head', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const cwd = await fixture(t, ['@acme/brand']);
  const captured: CapturedRequest[] = [];
  const context = run(t, cwd, () => revisionResponse(brand, '@acme/brand'), captured);

  await context.parse([
    'icons',
    'pin',
    '@acme/brand',
    '--version',
    '2',
    '--api-key',
    apiKey,
    '--json',
  ]);

  assert.deepEqual(
    captured.map((request) => request.url),
    ['https://api.tileflow.dev/v1/icon-sets/brand/versions/2'],
  );
  const lock = JSON.parse(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8')) as {
    sets: Record<string, {version: number}>;
  };
  assert.equal(lock.sets['@acme/brand']!.version, 2);
});

test('an undeclared reference is rejected before any request or lock write', async (t) => {
  const cwd = await fixture(t, ['@acme/brand']);
  const captured: CapturedRequest[] = [];
  const context = run(t, cwd, () => Response.json({}), captured);

  await context.parse(['icons', 'update', '@acme/unknown', '--api-key', apiKey, '--json']);

  assert.equal(captured.length, 0);
  await assert.rejects(() => readFile(join(cwd, tileflowIconsLockfileName), 'utf8'), {
    code: 'ENOENT',
  });
  const failure = JSON.parse(context.output.stderr) as {error: {code: string}};
  assert.equal(failure.error.code, 'icon_set_not_declared');
  assert.equal(process.exitCode, 1);
});

test('a purged or archived selection is rejected without writing a partial lock', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const transport = await realPin(2, 5, 'bus');
  const cwd = await fixture(t, ['@acme/brand', '@acme/transport']);
  const captured: CapturedRequest[] = [];
  const context = run(
    t,
    cwd,
    (request) =>
      request.url.includes('/icon-sets/brand/')
        ? revisionResponse(brand, '@acme/brand')
        : Response.json(
            {schemaVersion: 1, code: 'ICON_SET_ARCHIVED', error: 'Icon Set is archived'},
            {status: 409},
          ),
    captured,
  );

  await context.parse(['icons', 'install', '--api-key', apiKey, '--json']);

  assert.equal(captured.length, 2);
  await assert.rejects(() => readFile(join(cwd, tileflowIconsLockfileName), 'utf8'), {
    code: 'ENOENT',
  });
  assert.equal(process.exitCode, 1);
  assert.equal(transport.version, 5);
});

test('a lock changed by another writer fails compare-and-swap without losing its pins', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const transport = await realPin(2, 5, 'bus');
  const cwd = await fixture(t, ['@acme/brand', '@acme/transport']);
  const concurrent = `${JSON.stringify({lockfileVersion: 1, sets: {'@acme/transport': transport}})}\n`;
  const captured: CapturedRequest[] = [];
  const context = run(
    t,
    cwd,
    (request) => {
      // Another writer commits its own exact snapshot while this command resolves.
      void writeFile(join(cwd, tileflowIconsLockfileName), concurrent);
      return request.url.includes('/icon-sets/brand/')
        ? revisionResponse(brand, '@acme/brand')
        : revisionResponse(transport, '@acme/transport');
    },
    captured,
  );

  await context.parse(['icons', 'install', '--api-key', apiKey, '--json']);

  assert.equal(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8'), concurrent);
  const failure = JSON.parse(context.output.stderr) as {error: {code: string}};
  assert.equal(failure.error.code, 'ICON_LOCK_CONFLICT');
  assert.equal(process.exitCode, 1);
});

test('install preserves an invalid existing lock and makes no catalog request', async (t) => {
  const brand = await realPin(1, 2, 'hospital');
  const cwd = await fixture(t, ['@acme/brand']);
  const invalid = `${JSON.stringify({
    lockfileVersion: 1,
    sets: {'@acme/brand': brand},
    unexpected: true,
  })}\n`;
  await writeFile(join(cwd, tileflowIconsLockfileName), invalid);
  const captured: CapturedRequest[] = [];
  const context = run(t, cwd, () => revisionResponse(brand, '@acme/brand'), captured);

  await context.parse(['icons', 'install', '--api-key', apiKey, '--json']);

  assert.equal(captured.length, 0);
  assert.equal(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8'), invalid);
  const failure = JSON.parse(context.output.stderr) as {error: {code: string}};
  assert.equal(failure.error.code, 'icon_lock_unreadable');
  assert.equal(process.exitCode, 1);
});
