import {Command} from 'commander';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {CoordinatesContractError} from '@tileflow/coordinates/contract';
import {
  type CoordinatesCommandDependencies,
  registerCoordinatesCommands,
} from '../src/coordinates-command';

test('coordinates search emits one response document and closes its local runtime', async () => {
  let closeCalls = 0;
  let request: unknown;
  const result = await runCoordinates(['coordinates', 'search', '--query', 'Madrid', '--json'], {
    createLocalCoordinates: async () => ({
      close: async () => {
        closeCalls += 1;
      },
      describe: async () => {
        throw new Error('unexpected command');
      },
      directory: '/cache/release',
      operations: async () => {
        throw new Error('unexpected command');
      },
      provenance: null,
      releaseId: 'cr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      search: async (value) => {
        request = value;
        return {schemaVersion: 1, ok: true, command: 'search', matches: [], nextCursor: null};
      },
      transform: async () => {
        throw new Error('unexpected command');
      },
    }),
  });

  assert.deepEqual(request, {
    schemaVersion: 1,
    query: 'Madrid',
    limit: 50,
    deprecated: 'exclude',
  });
  assert.equal(closeCalls, 1);
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    ok: true,
    command: 'search',
    matches: [],
    nextCursor: null,
  });
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, undefined);
});

test('coordinates passes runtime selection options to its local client', async () => {
  let localInput: unknown;
  const result = await runCoordinates(
    [
      'coordinates',
      'search',
      '--runtime-dir',
      '/runtime',
      '--release',
      'cr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--development',
      '--query',
      'Lisbon',
    ],
    {
      createLocalCoordinates: async (input) => {
        localInput = input;
        return localClient({
          schemaVersion: 1,
          ok: true,
          command: 'search',
          matches: [],
          nextCursor: null,
        });
      },
    },
  );

  const actual = localInput as {signal?: AbortSignal} & Record<string, unknown>;
  assert.deepEqual(
    {...actual, signal: undefined},
    {
      directory: '/runtime',
      requiredReleaseId: 'cr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      allowDevelopment: true,
      signal: undefined,
    },
  );
  assert.ok(actual.signal instanceof AbortSignal);
  assert.equal(result.exitCode, undefined);
  assert.equal(result.stderr, '');
});

test('coordinates rejects unknown options before creating a runtime', async () => {
  let factoryCalls = 0;
  const result = await runCoordinates(
    ['coordinates', 'describe', '--id', 'EPSG:4326', '--unknown'],
    {
      createLocalCoordinates: async () => {
        factoryCalls += 1;
        throw new Error('runtime must not be created');
      },
    },
  );

  assert.equal(factoryCalls, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(JSON.parse(result.stderr), {
    schemaVersion: 1,
    ok: false,
    command: 'describe',
    releaseId: null,
    provenance: null,
    warnings: [],
    usage: null,
    error: {
      code: 'COORDINATES_INVALID_REQUEST',
      reason: 'UNKNOWN_FIELD',
      details: {path: ['options']},
      phase: 'input',
      message: 'The Coordinates request is invalid.',
    },
  });
});

test('coordinates unknown options are structured in the CLI process before runtime setup', async () => {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'src/index.ts',
      'coordinates',
      'describe',
      '--id',
      'EPSG:4326',
      '--unknown',
    ],
    {cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe']},
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  const failure = JSON.parse(stderr) as {command: string; error: {reason: string}; ok: boolean};
  assert.equal(failure.command, 'describe');
  assert.equal(failure.error.reason, 'UNKNOWN_FIELD');
  assert.equal(failure.ok, false);
});

test('coordinates reports invalid JSON as one input failure before creating a runtime', async () => {
  let factoryCalls = 0;
  const result = await runCoordinates(['coordinates', 'transform', '--request', '{'], {
    createLocalCoordinates: async () => {
      factoryCalls += 1;
      throw new Error('runtime must not be created');
    },
  });

  assert.equal(factoryCalls, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.exitCode, 1);
  const failure = JSON.parse(result.stderr) as {error: {reason: string}};
  assert.equal(failure.error.reason, 'INVALID_JSON');
});

test('coordinates binds an unresolved factory failure to the requested command', async () => {
  const result = await runCoordinates(['coordinates', 'search', '--query', 'Lisbon'], {
    createLocalCoordinates: async () => {
      throw new CoordinatesContractError({
        schemaVersion: 1,
        ok: false,
        command: null,
        releaseId: null,
        provenance: null,
        warnings: [],
        usage: {mode: 'local', units: 0},
        error: {
          code: 'COORDINATES_RELEASE_UNAVAILABLE',
          reason: 'RELEASE_UNAVAILABLE',
          details: {},
          phase: 'release',
        },
      });
    },
  });

  const failure = JSON.parse(result.stderr) as {command: string; error: {code: string}};
  assert.equal(failure.command, 'search');
  assert.equal(failure.error.code, 'COORDINATES_RELEASE_UNAVAILABLE');
});

test('coordinates rejects request JSON mixed with convenience flags before creating a runtime', async () => {
  let factoryCalls = 0;
  const result = await runCoordinates(
    ['coordinates', 'describe', '--request', '{"id":"EPSG:4326"}', '--id', 'EPSG:3857'],
    {
      createLocalCoordinates: async () => {
        factoryCalls += 1;
        throw new Error('runtime must not be created');
      },
    },
  );

  assert.equal(factoryCalls, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.exitCode, 1);
  const failure = JSON.parse(result.stderr) as {error: {reason: string}};
  assert.equal(failure.error.reason, 'INVALID_VALUE');
});

test('coordinates unknown subcommands are structured in the CLI process', async () => {
  const result = await runCli(['coordinates', 'unknown', '--json']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  const failure = JSON.parse(result.stderr) as {
    command: null;
    error: {reason: string};
    ok: boolean;
  };
  assert.equal(failure.command, null);
  assert.equal(failure.error.reason, 'UNKNOWN_FIELD');
  assert.equal(failure.ok, false);
});

test('coordinates help with JSON is structured without human help output', async () => {
  const result = await runCli(['coordinates', 'search', '--help', '--json']);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  const failure = JSON.parse(result.stderr) as {command: string; error: {reason: string}};
  assert.equal(failure.command, 'search');
  assert.equal(failure.error.reason, 'INVALID_VALUE');
});

test('setup coordinates rejects a URL archive before setup can download it', async () => {
  const result = await runCli([
    'setup',
    'coordinates',
    '--archive',
    'https://example.test/coordinates.tar.gz',
    '--json',
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), {
    schemaVersion: 1,
    ok: false,
    command: 'setup.coordinates',
    releaseId: null,
    usage: {mode: 'local', units: 0},
    error: {
      code: 'COORDINATES_SETUP_INVALID_REQUEST',
      details: {},
      message: 'Coordinates setup did not complete.',
    },
  });
});

test('coordinates stdin cancellation is structured', async () => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts', 'coordinates', 'transform', '--input', '-', '--json'],
    {cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe']},
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await new Promise<void>((resolve) => child.once('spawn', resolve));
  child.stdin.write('{');
  await new Promise<void>((resolve) => setTimeout(resolve, 4000));
  child.kill('SIGINT');
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  child.stdin.end();

  const exitCode = await exited;

  assert.equal(exitCode, 1);
  assert.equal(stdout, '');
  const failure = JSON.parse(stderr) as {command: string; error: {code: string; reason: string}};
  assert.equal(failure.command, 'transform');
  assert.equal(failure.error.code, 'COORDINATES_CANCELLED');
  assert.equal(failure.error.reason, 'CANCELLED');
});

test('setup coordinates forwards the offline source and emits its receipt', async () => {
  let setupInput: unknown;
  const result = await runCoordinates(
    [
      'setup',
      'coordinates',
      '--archive',
      '/downloads/coordinates.tar.gz',
      '--cache-dir',
      '/cache',
      '--release',
      'cr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '--development',
      '--json',
    ],
    {
      setupCoordinates: async (value) => {
        setupInput = value;
        return {
          version: 1,
          command: 'setup.coordinates',
          ok: true,
          releaseId: 'cr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        };
      },
    },
  );

  const setup = setupInput as {signal?: AbortSignal} & Record<string, unknown>;
  assert.deepEqual(
    {...setup, signal: undefined},
    {
      source: '/downloads/coordinates.tar.gz',
      cacheDirectory: '/cache',
      requiredReleaseId: 'cr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      allowDevelopment: true,
      signal: undefined,
    },
  );
  assert.ok(setup.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    command: 'setup.coordinates',
    ok: true,
    releaseId: 'cr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  });
  assert.equal(result.stderr, '');
});

type CoordinatesRun = Readonly<{exitCode: number | undefined; stderr: string; stdout: string}>;

async function runCoordinates(
  args: string[],
  overrides: Partial<CoordinatesCommandDependencies> = {},
): Promise<CoordinatesRun> {
  const program = new Command().name('tileflow').exitOverride();
  registerCoordinatesCommands(program, {
    createLocalCoordinates: async () => {
      throw new Error('unexpected runtime creation');
    },
    setupCoordinates: async () => {
      throw new Error('unexpected setup');
    },
    ...overrides,
  });
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await program.parseAsync(args, {from: 'user'});
    return {exitCode: process.exitCode, stderr, stdout};
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }
}

async function runCli(args: string[]): Promise<CoordinatesRun> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number | undefined>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? undefined));
  });
  return {exitCode, stderr, stdout};
}

function localClient(response: unknown) {
  return {
    close: async () => undefined,
    describe: async () => response,
    directory: '/runtime',
    operations: async () => response,
    provenance: null,
    releaseId: 'cr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    search: async () => response,
    transform: async () => response,
  };
}
