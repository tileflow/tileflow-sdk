import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

type StructuredDiagnostic = {
  code: string;
  message: string;
  path: string;
  phase: string;
  severity: string;
  suggestion: string;
};

type CommandDocument = StructuredDiagnostic & {
  command: string;
  diagnostics: StructuredDiagnostic[];
  ok: boolean;
  schemaVersion: number;
};

test('validate and inspect emit deterministic agent JSON on stdout', async (t) => {
  const directory = await createDirectoryFixture(t);
  const secret = `tf_live_${'a'.repeat(40)}`;
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {defineMap, defineRootMap} from '@tileflow/core';
if (process.env.TILEFLOW_API_KEY) throw new Error('ambient API key reached config');
const root = defineRootMap({
  id: 'root',
  name: 'Root',
  version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  glyphs: {
    kind: 'url',
    url: 'https://example.com/fonts/{fontstack}/{range}.pbf',
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  },
  modules: {poi: {type: 'poi', icons: false}},
  theme: {colors: {land: '#eeeeee'}, mode: 'light'}
});
export default defineMap({
  id: 'child',
  name: ${JSON.stringify(`${directory}/private/${secret}`)},
  version: 2,
  extends: root,
  theme: {colors: {water: '#112233'}}
});
`,
  );

  for (const command of [
    ['validate', '--json'],
    ['inspect', '--json'],
  ] as const) {
    const first = await runCli(directory, [...command], secret);
    const second = await runCli(directory, [...command], secret);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stderr, '');
    assert.equal(second.stdout, first.stdout);
    assert.ok(first.stdout.endsWith('\n'));
    assert.doesNotMatch(first.stdout, new RegExp(`${escapeRegExp(directory)}|tf_live_`, 'u'));
    assertCommandContract(JSON.parse(first.stdout) as CommandDocument, command[0]);
  }

  const inspection = JSON.parse(
    (await runCli(directory, ['inspect', '--json'], secret)).stdout,
  ) as CommandDocument & {
    maps: Array<{
      id: string;
      lineage: Array<{depth: number; id: string}>;
      provenance: Array<{
        operation: string;
        path: string;
        sourceDepth: number;
        sourceMap: string;
      }>;
    }>;
  };
  assert.deepEqual(
    inspection.maps[0]?.lineage.map(({depth, id}) => ({depth, id})),
    [
      {depth: 0, id: 'root'},
      {depth: 1, id: 'child'},
    ],
  );
  assert.deepEqual(
    inspection.maps[0]?.provenance.find(({path}) => path === 'theme.colors.water'),
    {
      declared: true,
      inherited: false,
      operation: 'defined',
      path: 'theme.colors.water',
      sourceDepth: 1,
      sourceMap: 'child',
    },
  );
});

test('validate and inspect emit one safe structured failure on stderr', async (t) => {
  const directory = await createDirectoryFixture(t);
  const secret = `tf_live_${'b'.repeat(40)}`;
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `throw new Error(${JSON.stringify(`Unable to import ${directory}/private/${secret}`)});\n`,
  );

  const validation = await runCli(directory, ['validate', '--json'], secret);
  assert.equal(validation.code, 1);
  assert.equal(validation.stdout, '');
  assert.ok(validation.stderr.endsWith('\n'));
  assert.doesNotMatch(validation.stderr, new RegExp(`${escapeRegExp(directory)}|tf_live_`, 'u'));
  assertCommandContract(JSON.parse(validation.stderr) as CommandDocument, 'validate');

  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({id: 'main', version: 1, root: {compiler: 'streets', compilerVersion: 1}});
`,
  );
  const inspection = await runCli(directory, ['inspect', '--map', 'missing', '--json'], secret);
  assert.equal(inspection.code, 1);
  assert.equal(inspection.stdout, '');
  const document = JSON.parse(inspection.stderr) as CommandDocument;
  assertCommandContract(document, 'inspect');
  assert.equal(document.code, 'INSPECT_MAP_NOT_FOUND');
  assert.equal(document.phase, 'config-inspection');
  assert.equal(document.path, 'map');
});

test('validate --json reports the exact editable path in a singular config', async (t) => {
  const directory = await createDirectoryFixture(t);
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {defineRootMap} from '@tileflow/core';
export default defineRootMap({
  id: 'madrid', version: 1,
  root: {compiler: 'streets', compilerVersion: 1},
  view: {pitch: 99}
});
`,
  );

  const result = await runCli(directory, ['validate', '--json'], 'no-secret');
  assert.equal(result.code, 1);
  const document = JSON.parse(result.stderr) as CommandDocument;
  assert.equal(document.path, 'view.pitch');
  assert.equal(document.diagnostics[0]?.path, 'view.pitch');
});

function assertCommandContract(document: CommandDocument, command: string): void {
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.command, command);
  for (const key of ['phase', 'code', 'path', 'severity', 'message', 'suggestion'] as const) {
    assert.equal(typeof document[key], 'string', `${command}.${key}`);
  }
  assert.ok(Array.isArray(document.diagnostics));
  for (const diagnostic of document.diagnostics) {
    for (const key of ['phase', 'code', 'path', 'severity', 'message', 'suggestion'] as const) {
      assert.equal(typeof diagnostic[key], 'string', `${command}.diagnostics.${key}`);
    }
  }
}

async function createDirectoryFixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-ai-commands-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

function runCli(
  cwd: string,
  arguments_: string[],
  secret: string,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI']) delete environment[variable];
  Object.assign(environment, {
    HOME: cwd,
    NO_COLOR: '1',
    TILEFLOW_API_KEY: secret,
    USERPROFILE: cwd,
  });

  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, cliEntry, ...arguments_], {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    child.stderr.setEncoding('utf8');
    child.stdout.setEncoding('utf8');
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolveResult({code, stderr, stdout}));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
