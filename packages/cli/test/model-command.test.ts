import {Command} from 'commander';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readTileflowModelFileSummary} from '@tileflow/core';
import {writeGlb} from '../../dev/test/tree-model-fixtures';
import {registerModelCommands} from '../src/model-command';

const apiKey = `tf_live_${'a'.repeat(48)}`;

type CapturedRequest = {
  body: BodyInit | null | undefined;
  headers: Headers;
  method: string;
  url: string;
};

function program(
  respond: (request: CapturedRequest) => Response | Promise<Response>,
  captured: CapturedRequest[],
) {
  globalThis.fetch = (async (input, init) => {
    const request: CapturedRequest = {
      body: init?.body,
      headers: new Headers(init?.headers),
      method: init?.method ?? 'GET',
      url: String(input),
    };
    captured.push(request);
    return respond(request);
  }) as typeof fetch;
  const command = new Command().name('tileflow').exitOverride();
  registerModelCommands(command, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: (async () => {
      throw new Error('account state must not be loaded');
    }) as never,
  });
  return command;
}

/** Capture only while a command runs; the test reporter keeps the real streams otherwise. */
function captureOutput(t: {after(callback: () => void): void}) {
  const originals = {
    fetch: globalThis.fetch,
    stdout: process.stdout.write,
    stderr: process.stderr.write,
    exitCode: process.exitCode,
    log: console.log,
    error: console.error,
  };
  const output = {
    stderr: '',
    stdout: '',
    async run<T>(operation: () => Promise<T>): Promise<T> {
      // Node's test reporter uses binary frames; capture only the CLI's string writes.
      process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
        if (typeof chunk !== 'string')
          return Reflect.apply(originals.stdout, process.stdout, [chunk, ...args]);

        output.stdout += chunk;
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
        if (typeof chunk !== 'string')
          return Reflect.apply(originals.stderr, process.stderr, [chunk, ...args]);

        output.stderr += chunk;
        return true;
      }) as typeof process.stderr.write;
      console.log = (...values: unknown[]) => {
        output.stdout += `${values.join(' ')}\n`;
      };
      console.error = (...values: unknown[]) => {
        output.stderr += `${values.join(' ')}\n`;
      };
      try {
        return await operation();
      } finally {
        process.stdout.write = originals.stdout;
        process.stderr.write = originals.stderr;
        console.log = originals.log;
        console.error = originals.error;
      }
    },
  };
  t.after(() => {
    globalThis.fetch = originals.fetch;
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
    console.log = originals.log;
    console.error = originals.error;
    process.exitCode = originals.exitCode;
  });
  return output;
}

/** A block 20 m wide and 120 m tall, its walls and roof named as a building's parts. */
const tower = () =>
  writeGlb([
    {
      material: 'roof',
      positions: [-10, 120, -10, 10, 120, -10, 10, 120, 10, -10, 120, 10],
      indices: [0, 2, 1, 0, 3, 2],
    },
    {
      material: 'surface',
      positions: [-10, 0, 10, 10, 0, 10, 10, 120, 10, -10, 120, 10],
      indices: [0, 1, 2, 0, 2, 3],
    },
  ]);

const summary = {
  levels: [{level: 'near', vertices: 8, triangles: 4}],
  width: 20,
  depth: 20,
  height: 120,
  footprint: {rings: 1, points: 4, area: 400},
};
const version = (number: number, state: string, contentHash: string) => ({
  id: `tmv_${String(number).padStart(16, '0')}`,
  version: number,
  state,
  contentHash,
  byteLength: 1234,
  publishedAt: '2026-10-20T10:00:00.000Z',
  summary,
});
const model = (
  current: ReturnType<typeof version> | null,
  previous: ReturnType<typeof version> | null = null,
) => ({
  id: 'tmd_0000000000000001',
  name: 'tower',
  state: 'active',
  current,
  previous,
  url: 'https://api.tileflow.dev/team-models/tmd_0000000000000001/current.glb',
  usedByMaps: 2,
  updatedAt: '2026-10-20T10:00:00.000Z',
});

test('publish prepares a building model and sends its file with the sources it came from', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-model-publish-'));
  t.after(async () => {
    process.chdir(originalCwd);
    assert.notEqual(
      await realpath(process.cwd()),
      await realpath(directory),
      'Leave the fixture before removing it.',
    );
    return rm(directory, {force: true, recursive: true});
  });
  await mkdir(join(directory, 'models'));
  const source = tower();
  await writeFile(join(directory, 'models', 'tower.glb'), source);
  process.chdir(directory);

  let sent: {file: Uint8Array; metadata: unknown; sha256: string} | undefined;
  const command = program(async (request) => {
    const form = request.body as FormData;
    const file = new Uint8Array(await (form.get('file') as Blob).arrayBuffer());
    sent = {
      file,
      metadata: JSON.parse(await (form.get('metadata') as Blob).text()),
      sha256: request.url.split('/').pop()!,
    };
    return Response.json({
      schemaVersion: 1,
      changed: true,
      model: model(version(3, 'current', sent.sha256)),
    });
  }, captured);

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'models',
      'publish',
      './models/tower.glb',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );

  assert.equal(process.exitCode ?? 0, 0, output.stderr);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.method, 'PUT');
  assert.match(
    captured[0]!.url,
    /^https:\/\/api\.tileflow\.dev\/v1\/models\/tower\/versions\/[a-f0-9]{64}$/u,
  );
  assert.equal(captured[0]!.headers.get('authorization'), `Bearer ${apiKey}`);
  // The prepared file is what is named and sent, and it is one Tileflow model of that name.
  assert.equal(createHash('sha256').update(sent!.file).digest('hex'), sent!.sha256);
  assert.equal(readTileflowModelFileSummary(sent!.file)?.model, 'tower');
  assert.deepEqual(sent!.metadata, {
    sources: [
      {
        level: 'near',
        sha256: createHash('sha256').update(source).digest('hex'),
        byteLength: source.byteLength,
      },
    ],
  });
  assert.deepEqual(JSON.parse(output.stdout), {
    command: 'models publish',
    models: [{changed: true, contentHash: sent!.sha256, name: 'tower', version: 3}],
    ok: true,
    schemaVersion: 1,
  });
});

test('publish refuses a response that does not confirm the submitted file', async (t) => {
  const output = captureOutput(t);
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-model-publish-'));
  t.after(async () => {
    process.chdir(originalCwd);
    assert.notEqual(
      await realpath(process.cwd()),
      await realpath(directory),
      'Leave the fixture before removing it.',
    );
    return rm(directory, {force: true, recursive: true});
  });
  await writeFile(join(directory, 'tower.glb'), tower());
  process.chdir(directory);
  const command = program(
    () =>
      Response.json({
        schemaVersion: 1,
        changed: true,
        model: model(version(3, 'current', 'b'.repeat(64))),
      }),
    [],
  );
  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'models', 'publish', '.', '--api-key', apiKey]),
  );
  assert.equal(process.exitCode, 1);
  assert.match(output.stderr, /did not confirm the submitted model file/u);
});

test('restore names the current version it expects and confirms the previous one is current', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const command = program((request) => {
    if (request.method === 'GET')
      return Response.json({
        schemaVersion: 1,
        model: model(version(4, 'current', b), version(3, 'previous', a)),
        versions: [version(4, 'current', b), version(3, 'previous', a)],
        uses: [],
      });
    return Response.json({
      schemaVersion: 1,
      model: model(version(3, 'current', a), version(4, 'previous', b)),
    });
  }, captured);

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'models',
      'restore',
      'tower',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );

  assert.equal(process.exitCode ?? 0, 0, output.stderr);
  assert.deepEqual(
    captured.map(({method, url}) => `${method} ${new URL(url).pathname}`),
    ['GET /v1/models/tower', 'POST /v1/models/tower/restore'],
  );
  assert.deepEqual(JSON.parse(String(captured[1]!.body)), {expectedCurrentVersion: 4});
  assert.deepEqual(JSON.parse(output.stdout), {
    command: 'models restore',
    ok: true,
    schemaVersion: 1,
    model: model(version(3, 'current', a), version(4, 'previous', b)),
  });
});

test('purge sends nothing without the repeated name, then confirms it in a header', async (t) => {
  const output = captureOutput(t);
  const captured: CapturedRequest[] = [];
  const command = program(
    () => Response.json({schemaVersion: 1, purge: {name: 'tower', state: 'purging'}}),
    captured,
  );
  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'models', 'purge', 'tower', '--api-key', apiKey]),
  );
  assert.equal(captured.length, 0);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  await output.run(() =>
    command.parseAsync([
      'node',
      'tileflow',
      'models',
      'purge',
      'tower',
      '--confirm',
      'tower',
      '--api-key',
      apiKey,
      '--json',
    ]),
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0]!.method, 'DELETE');
  assert.equal(captured[0]!.headers.get('x-tileflow-confirm-model-purge'), 'tower');
  assert.equal(process.exitCode, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), {
    command: 'models purge',
    ok: true,
    schemaVersion: 1,
    purge: {name: 'tower', state: 'purging'},
  });
});
