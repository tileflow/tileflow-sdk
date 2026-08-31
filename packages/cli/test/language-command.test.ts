import {Command} from 'commander';
import assert from 'node:assert/strict';
import test from 'node:test';
import {registerLanguageCommand} from '../src/language-command';

test('language manifest exposes the complete deterministic AI authoring contract', async () => {
  const result = await runLanguage(['language', 'manifest', '--json']);
  const manifest = JSON.parse(result.stdout) as {
    compiler: {name: string; version: number};
    domains: unknown[];
    expressions: {builders: unknown[]};
    language: string;
    schemas: {document: string};
  };
  assert.deepEqual(manifest.compiler, {name: 'tileflow-semantic', version: 1});
  assert.equal(manifest.language, 'tileflow-semantic-v1');
  assert.equal(manifest.domains.length, 13);
  assert.equal(manifest.expressions.builders.length, 32);
  assert.equal(
    manifest.schemas.document,
    'https://tileflow.dev/schemas/tileflow-config-reference-v4.json',
  );
  assert.ok(result.stdout.endsWith('\n'));
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, undefined);
});

test('language schema exposes the generated authoring and resolved entrypoints', async () => {
  const result = await runLanguage(['language', 'schema', '--json'], undefined, async () => ({
    $id: 'https://tileflow.dev/schemas/tileflow-config-reference-v4.json',
    $ref: '#/$defs/TileflowAuthoringMap',
    schemaVersion: 4,
    entrypoints: {
      authoring: {schemaRef: '#/$defs/TileflowAuthoringMap'},
      resolved: {schemaRef: '#/$defs/ResolvedTileflowMap'},
    },
  }));
  const schema = JSON.parse(result.stdout) as {
    $ref: string;
    entrypoints: {authoring: {schemaRef: string}; resolved: {schemaRef: string}};
    schemaVersion: number;
  };
  assert.equal(schema.schemaVersion, 4);
  assert.equal(schema.$ref, '#/$defs/TileflowAuthoringMap');
  assert.equal(schema.entrypoints.resolved.schemaRef, '#/$defs/ResolvedTileflowMap');
  assert.equal(result.stderr, '');
  assert.equal(result.exitCode, undefined);
});

test('language schema emits one deterministic command failure to stderr', async () => {
  const loadSchema = async (): Promise<Readonly<Record<string, unknown>>> => {
    throw new Error('Packaged Tileflow config reference is unavailable.');
  };
  const first = await runLanguage(['language', 'schema', '--json'], undefined, loadSchema);
  const second = await runLanguage(['language', 'schema', '--json'], undefined, loadSchema);

  assert.equal(first.stdout, '');
  assert.equal(first.stderr, second.stderr);
  assert.equal(first.exitCode, 1);
  assert.ok(first.stderr.endsWith('\n'));
  const failure = JSON.parse(first.stderr) as Record<string, unknown>;
  assert.equal(failure.schemaVersion, 1);
  assert.equal(failure.command, 'language-schema');
  assert.equal(failure.ok, false);
  assert.equal(failure.phase, 'language-discovery');
  assert.equal(failure.code, 'LANGUAGE_SCHEMA_FAILED');
});

test('language manifest emits one deterministic command failure to stderr', async () => {
  const loadManifest = (): never => {
    throw new Error('Packaged Tileflow authoring manifest is unavailable.');
  };
  const result = await runLanguage(['language', 'manifest', '--json'], loadManifest);

  assert.equal(result.stdout, '');
  assert.equal(result.exitCode, 1);
  const failure = JSON.parse(result.stderr) as Record<string, unknown>;
  assert.equal(failure.schemaVersion, 1);
  assert.equal(failure.command, 'language-manifest');
  assert.equal(failure.ok, false);
  assert.equal(failure.phase, 'language-discovery');
  assert.equal(failure.code, 'LANGUAGE_MANIFEST_FAILED');
});

type LanguageRun = Readonly<{
  exitCode: number | undefined;
  stderr: string;
  stdout: string;
}>;

async function runLanguage(
  args: string[],
  loadManifest?: () => never,
  loadSchema?: () => Promise<Readonly<Record<string, unknown>>>,
): Promise<LanguageRun> {
  const program = new Command().name('tileflow').exitOverride();
  registerLanguageCommand(program, {loadManifest, loadSchema});
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
