import {Command} from 'commander';
import assert from 'node:assert/strict';
import test from 'node:test';
import {registerDeploymentCommands} from '../src/deployment-command';
import {registerTilesetCommands} from '../src/tileset-command';

const mapId = 'map_AbCdEfGhIjKlMnOp';
const apiKey = `tf_live_${'a'.repeat(48)}`;
const history = {
  deployments: [
    {
      active: true,
      createdAt: '2026-11-07T10:00:00.000Z',
      deploymentId: 'dep_three',
      restoredFromVersion: null,
      source: {kind: 'cli'},
      version: 3,
    },
    {
      active: false,
      createdAt: '2026-11-06T10:00:00.000Z',
      deploymentId: 'dep_two',
      restoredFromVersion: null,
      source: null,
      version: 2,
    },
  ],
  mapId,
  schemaVersion: 1,
};

type Captured = {body: string | null; headers: Headers; method: string; path: string};

function capture(t: {after(callback: () => void): void}, respond: (request: Captured) => Response) {
  const originals = {
    error: console.error,
    exitCode: process.exitCode,
    fetch: globalThis.fetch,
    log: console.log,
    stderr: process.stderr.write,
    stdout: process.stdout.write,
  };
  const output = {
    requests: [] as Captured[],
    stderr: '',
    stdout: '',
    async run(operation: () => Promise<unknown>) {
      globalThis.fetch = (async (input, init) => {
        const request = {
          body: typeof init?.body === 'string' ? init.body : null,
          headers: new Headers(init?.headers),
          method: init?.method ?? 'GET',
          path: new URL(String(input)).pathname,
        };
        output.requests.push(request);
        return respond(request);
      }) as typeof fetch;
      process.stdout.write = ((chunk: string | Uint8Array) => {
        output.stdout += String(chunk);
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        output.stderr += String(chunk);
        return true;
      }) as typeof process.stderr.write;
      console.log = (...args: unknown[]) => {
        output.stdout += `${args.join(' ')}\n`;
      };
      console.error = (...args: unknown[]) => {
        output.stderr += `${args.join(' ')}\n`;
      };
      try {
        await operation();
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
    process.exitCode = originals.exitCode;
  });
  return output;
}

function mapProgram() {
  const scopes: string[][] = [];
  const command = new Command().name('tileflow').exitOverride();
  registerDeploymentCommands(command, {
    resolveApi: async (_options, behavior) => {
      scopes.push(behavior.capabilityScopes);
      return {apiKey, apiUrl: 'https://api.tileflow.dev', mapId};
    },
  });
  return {command, scopes};
}

test('restore names the version it replaces and targets the Map', async (t) => {
  const output = capture(t, (request) =>
    request.method === 'GET'
      ? Response.json(history)
      : Response.json({
          changed: true,
          deploymentId: 'dep_four',
          mapId,
          restoredFromVersion: 2,
          schemaVersion: 1,
          version: 4,
        }),
  );
  const {command, scopes} = mapProgram();

  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'deployments', 'restore', '2', '--map-id', mapId]),
  );

  assert.equal(process.exitCode ?? 0, 0, output.stderr);
  assert.deepEqual(scopes, [['status:read', 'styles:write']]);
  assert.deepEqual(
    output.requests.map(({method, path}) => `${method} ${path}`),
    ['GET /v1/styles/deployments', 'POST /v1/styles/deployments/2/restore'],
  );
  assert.equal(output.requests[1]!.headers.get('X-Tileflow-Map-Id'), mapId);
  assert.equal(JSON.parse(output.requests[1]!.body!).expectedCurrentVersion, 3);
  assert.match(output.stdout, /Version 2 is live again as version 4/u);
});

test('a version outside the retained history sends no restore', async (t) => {
  const output = capture(t, () => Response.json(history));
  const {command} = mapProgram();

  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'deployments', 'restore', '1', '--map-id', mapId]),
  );

  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  assert.deepEqual(
    output.requests.map(({method}) => method),
    ['GET'],
  );
  assert.match(output.stderr, /not in this Map's retained history/u);
});

test('a refusal keeps the server code', async (t) => {
  const output = capture(t, (request) =>
    request.method === 'GET'
      ? Response.json(history)
      : Response.json(
          {code: 'TF_DEPLOYMENT_SOURCE_INCOMPATIBLE', error: 'Source stores lacks a field'},
          {status: 409},
        ),
  );
  const {command} = mapProgram();

  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'deployments', 'restore', '2', '--map-id', mapId, '--json']),
  );

  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  assert.equal(JSON.parse(output.stderr).error.code, 'TF_DEPLOYMENT_SOURCE_INCOMPATIBLE');
});

test('tileset restore names the current version it expects', async (t) => {
  const output = capture(t, (request) =>
    request.method === 'GET'
      ? Response.json({
          schemaVersion: 1,
          tileset: {
            attribution: null,
            currentVersion: 2,
            dependencies: [],
            dependencyNextCursor: null,
            id: 'tls_0123456789abcdef0123456789abcdef',
            name: 'Stores',
            slug: 'stores',
            state: 'active',
          },
        })
      : Response.json({
          schemaVersion: 1,
          tileset: {
            currentVersion: 1,
            id: 'tls_0123456789abcdef0123456789abcdef',
            previousVersion: 2,
            slug: 'stores',
          },
        }),
  );
  const command = new Command().name('tileflow').exitOverride();
  registerTilesetCommands(command, {
    defaultApiUrl: 'https://api.tileflow.dev',
    loadAuthConfig: (async () => {
      throw new Error('account state must not be loaded');
    }) as never,
  });

  await output.run(() =>
    command.parseAsync(['node', 'tileflow', 'tileset', 'restore', 'stores', '--api-key', apiKey]),
  );

  assert.equal(process.exitCode ?? 0, 0, output.stderr);
  assert.equal(output.requests.at(-1)!.path, '/v1/tilesets/stores/restore');
  assert.deepEqual(JSON.parse(output.requests.at(-1)!.body!), {expectedCurrentVersion: 2});
  assert.match(output.stdout, /stores is at version 1 again/u);
});
