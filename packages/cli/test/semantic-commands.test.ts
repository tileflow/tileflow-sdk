import {Command} from 'commander';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createStyleResult} from '@tileflow/core';
import {registerAiCommands} from '../src/ai-commands';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

type ProjectedDiagnostic = {
  code: string;
  domain?: string;
  message: string;
  path: string;
  phase: string;
  severity: string;
  target?: string;
};

type ExplainDocument = {
  authoringManifestSchemaVersion: number;
  command: string;
  compilation: {
    diagnostics: ProjectedDiagnostic[];
    ok: boolean;
    report: {
      domains: Array<{name: string; status: string}>;
      map: string;
      planner: Array<{stage: string}>;
      provenance?: {layers: unknown[]};
      schemaVersion: number;
      targets: string[];
      theme?: string;
    };
    style?: unknown;
  };
  diagnostics: ProjectedDiagnostic[];
  ok: boolean;
  schemaVersion: number;
  selection: {map: string; theme: string};
};

type SemanticDiffDocument = {
  command: string;
  diff: {
    changes: Array<{kind: string; path: string}>;
    from: {id: string; version: number};
    schemaVersion: number;
    summary: {add: number; change: number; remove: number; total: number};
    to: {id: string; version: number};
  };
  diagnostics: unknown[];
  ok: boolean;
  schemaVersion: number;
};

test('explain compiles one deterministic selection and emits report plus diagnostics without style', async (t) => {
  const directory = await createFixture(t);
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {defineMap, poi} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'explained', version: 2, extends: streets,
  modules: {poi: poi({icons: false})},
  view: {center: [-3.7038, 40.4168], zoom: 12}
});
`,
  );

  const first = await runCli(directory, ['explain', '--json']);
  const second = await runCli(directory, ['explain', '--json']);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(second.stdout, first.stdout);
  const document = JSON.parse(first.stdout) as ExplainDocument;
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.authoringManifestSchemaVersion, 1);
  assert.equal(document.command, 'explain');
  assert.equal(document.ok, true);
  assert.deepEqual(document.selection, {map: 'explained', theme: 'light'});
  assert.equal(document.compilation.ok, true);
  assert.equal(document.compilation.report.schemaVersion, 1);
  assert.equal(document.compilation.report.map, 'explained');
  assert.equal(document.compilation.report.theme, 'light');
  assert.equal(document.compilation.report.domains.length, 13);
  assert.deepEqual(
    document.compilation.report.planner.map(({stage}) => stage),
    ['domain-ir', 'assembly', 'render-stack', 'physical-planner', 'lowering'],
  );
  assert.deepEqual(document.compilation.diagnostics, []);
  assert.deepEqual(document.diagnostics, []);
  assert.equal(Object.hasOwn(document.compilation, 'style'), false);

  const inspected = await runCli(directory, ['explain', '--inspection', '--json']);
  assert.equal(inspected.code, 0, inspected.stderr);
  const inspectedDocument = JSON.parse(inspected.stdout) as ExplainDocument;
  assert.ok((inspectedDocument.compilation.report.provenance?.layers.length ?? 0) > 0);
});

test('explain emits one structured selection failure and never leaks a local path', async (t) => {
  const directory = await createFixture(t);
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {streets} from '@tileflow/maps'; export default streets;\n`,
  );

  const result = await runCli(directory, ['explain', '--theme', 'missing', '--json']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.endsWith('\n'));
  assert.doesNotMatch(result.stderr, new RegExp(escapeRegExp(directory), 'u'));
  const document = JSON.parse(result.stderr) as {
    code: string;
    command: string;
    diagnostics: Array<{path: string}>;
    phase: string;
  };
  assert.equal(document.command, 'explain');
  assert.equal(document.code, 'EXPLAIN_THEME_NOT_FOUND');
  assert.equal(document.phase, 'command-validation');
  assert.equal(document.diagnostics[0]?.path, 'theme');
});

test('explain preserves contextual compiler diagnostics through safe JSON projection', async (t) => {
  const directory = await createFixture(t);
  const secret = `tf_live_${'x'.repeat(40)}`;
  const configPath = join(directory, 'tileflow.config.ts');
  await writeFile(
    configPath,
    `import {defineMap, defineTheme} from '@tileflow/core';
export default defineMap({
  id: 'contextual', version: 1, defaultTheme: 'light',
  themes: {light: defineTheme({id: 'light', version: 1, colorScheme: 'light'})}
});
`,
  );

  const compilerFailure: ReturnType<typeof createStyleResult> = {
    diagnostics: [
      {
        code: 'TILEFLOW_DOMAIN_IR_CONTEXT',
        domain: 'roads',
        message: `Failed while reading ${directory}/private/${secret}.`,
        path: 'modules.roads.renderStack.primaryFill',
        phase: 'domain-ir',
        severity: 'error',
        target: 'roads.classes.primary.surface.fill',
      },
    ],
    ok: false,
    report: {
      domains: [],
      map: 'contextual',
      planner: [],
      schemaVersion: 1,
      targets: [],
      theme: 'light',
    },
  };
  const program = new Command().name('tileflow').exitOverride();
  registerAiCommands(program, {
    createStyleResult: () => compilerFailure,
    defaultApiUrl: 'https://api.tileflow.dev',
    defaultConfigPath: 'tileflow.config.ts',
  });

  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  const originalCwd = process.cwd();
  let stdout = '';
  let stderr = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    process.exitCode = undefined;
    process.chdir(directory);
    await program.parseAsync(['node', 'tileflow', 'explain', '--config', configPath, '--json']);
    assert.equal(process.exitCode, 1);
  } finally {
    process.chdir(originalCwd);
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exitCode = originalExitCode;
  }

  assert.equal(stdout, '');
  assert.doesNotMatch(stderr, new RegExp(`${escapeRegExp(directory)}|tf_live_`, 'u'));
  const document = JSON.parse(stderr) as ExplainDocument & {
    code: string;
    domain?: string;
    path: string;
    phase: string;
    target?: string;
  };
  const expectedContext = {
    code: 'TILEFLOW_DOMAIN_IR_CONTEXT',
    domain: 'roads',
    path: 'modules.roads.renderStack.primaryFill',
    phase: 'domain-ir',
    target: 'roads.classes.primary.surface.fill',
  };
  assert.deepEqual(
    {
      code: document.code,
      domain: document.domain,
      path: document.path,
      phase: document.phase,
      target: document.target,
    },
    expectedContext,
  );
  for (const diagnostic of [document.diagnostics[0], document.compilation.diagnostics[0]]) {
    assert.deepEqual(
      diagnostic && {
        code: diagnostic.code,
        domain: diagnostic.domain,
        path: diagnostic.path,
        phase: diagnostic.phase,
        target: diagnostic.target,
      },
      expectedContext,
    );
  }
});

test('semantic-diff compares two workspace maps with deterministic JSON Pointers', async (t) => {
  const directory = await createFixture(t);
  const secret = `tf_live_${'s'.repeat(40)}`;
  await writeFile(
    join(directory, 'maps.workspace.ts'),
    `import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';
const before = defineMap({
  id: 'before', version: 1, extends: streets,
  glyphs: {
    kind: 'url',
    url: ${JSON.stringify(`https://fonts.example.test/{fontstack}/{range}.pbf?token=${secret}`)},
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  },
  view: {center: [-3.7, 40.4], zoom: 12}
});
const after = defineMap({
  id: 'after', version: 3, extends: streets,
  glyphs: {
    kind: 'url',
    url: ${JSON.stringify(`https://fonts.example.test/{fontstack}/{range}.pbf?token=${secret}-after`)},
    fontStacks: ['Noto Sans Regular', 'Noto Sans Bold']
  },
  modules: {water: disable()},
  projection: 'mercator',
  view: {center: [-3.7, 40.4], zoom: 13}
});
export default {maps: {before, after}};
`,
  );

  const arguments_ = [
    'semantic-diff',
    '--config',
    'maps.workspace.ts',
    '--from',
    'before',
    '--to',
    'after',
    '--json',
  ];
  const first = await runCli(directory, arguments_);
  const second = await runCli(directory, arguments_);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(second.stdout, first.stdout);
  assert.doesNotMatch(first.stdout, /tf_live_/u);
  const document = JSON.parse(first.stdout) as SemanticDiffDocument;
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.command, 'semantic-diff');
  assert.equal(document.ok, true);
  assert.deepEqual(document.diff.from, {id: 'before', version: 1});
  assert.deepEqual(document.diff.to, {id: 'after', version: 3});
  assert.equal(document.diff.schemaVersion, 1);
  assert.deepEqual(
    document.diff.changes.map(({kind, path}) => ({kind, path})),
    [
      {kind: 'change', path: '/glyphs/url'},
      {kind: 'remove', path: '/modules/water/bathymetry'},
      {kind: 'remove', path: '/modules/water/bodies'},
      {kind: 'add', path: '/modules/water/enabled'},
      {kind: 'remove', path: '/modules/water/intermittent'},
      {kind: 'remove', path: '/modules/water/waterways'},
      {kind: 'change', path: '/projection'},
      {kind: 'change', path: '/view/zoom'},
    ],
  );
  assert.deepEqual(document.diff.summary, {add: 1, change: 3, remove: 4, total: 8});
  assert.deepEqual(document.diagnostics, []);
});

test('semantic-diff compares the sole maps exported by two independent configs', async (t) => {
  const directory = await createFixture(t);
  await writeFile(
    join(directory, 'before.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'before-config', version: 1, extends: streets,
  view: {center: [-3.7, 40.4], zoom: 10}
});
`,
  );
  await writeFile(
    join(directory, 'after.config.ts'),
    `import {defineMap, disable} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({
  id: 'after-config', version: 2, extends: streets,
  modules: {water: disable()},
  view: {center: [-3.7, 40.4], zoom: 11}
});
`,
  );

  const result = await runCli(directory, [
    'semantic-diff',
    '--from-config',
    'before.config.ts',
    '--to-config',
    'after.config.ts',
    '--json',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const document = JSON.parse(result.stdout) as SemanticDiffDocument;
  assert.deepEqual(document.diff.from, {id: 'before-config', version: 1});
  assert.deepEqual(document.diff.to, {id: 'after-config', version: 2});
  assert.ok(document.diff.changes.some(({path}) => path === '/modules/water/enabled'));
  assert.ok(document.diff.changes.some(({path}) => path === '/view/zoom'));
});

test('semantic-diff map selectors are required for multi-map configs and rejected for singular configs', async (t) => {
  const directory = await createFixture(t);
  await writeFile(
    join(directory, 'before.workspace.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
const first = defineMap({id: 'first', version: 1, extends: streets});
const selected = defineMap({id: 'selected', version: 1, extends: streets, projection: 'mercator'});
export default {maps: {first, selected}};
`,
  );
  await writeFile(
    join(directory, 'after.config.ts'),
    `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id: 'after', version: 1, extends: streets, projection: 'globe'});
`,
  );

  const baseArguments = [
    'semantic-diff',
    '--from-config',
    'before.workspace.ts',
    '--to-config',
    'after.config.ts',
    '--json',
  ];
  const missing = await runCli(directory, baseArguments);
  assert.equal(missing.code, 1);
  const missingDocument = JSON.parse(missing.stderr) as {
    code: string;
    diagnostics: Array<{path: string}>;
  };
  assert.equal(missingDocument.code, 'SEMANTIC_DIFF_FROM_MAP_REQUIRED');
  assert.equal(missingDocument.diagnostics[0]?.path, 'from-map');

  const selected = await runCli(directory, [
    ...baseArguments.slice(0, -1),
    '--from-map',
    'selected',
    '--json',
  ]);
  assert.equal(selected.code, 0, selected.stderr);
  const selectedDocument = JSON.parse(selected.stdout) as SemanticDiffDocument;
  assert.deepEqual(selectedDocument.diff.from, {id: 'selected', version: 1});
  assert.deepEqual(selectedDocument.diff.to, {id: 'after', version: 1});

  const unnecessary = await runCli(directory, [
    ...baseArguments.slice(0, -1),
    '--from-map',
    'selected',
    '--to-map',
    'after',
    '--json',
  ]);
  assert.equal(unnecessary.code, 1);
  const unnecessaryDocument = JSON.parse(unnecessary.stderr) as {
    code: string;
    diagnostics: Array<{path: string}>;
  };
  assert.equal(unnecessaryDocument.code, 'SEMANTIC_DIFF_TO_MAP_UNNECESSARY');
  assert.equal(unnecessaryDocument.diagnostics[0]?.path, 'to-map');
});

test('semantic-diff rejects ambiguous mode mixtures without leaking config paths', async (t) => {
  const directory = await createFixture(t);
  const secret = `tf_live_${'m'.repeat(40)}`;
  const result = await runCli(directory, [
    'semantic-diff',
    '--from-config',
    join(directory, `${secret}-before.config.ts`),
    '--to-config',
    join(directory, 'after.config.ts'),
    '--config',
    join(directory, 'maps.workspace.ts'),
    '--from',
    'before',
    '--to',
    'after',
    '--json',
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, new RegExp(`${escapeRegExp(directory)}|tf_live_`, 'u'));
  const document = JSON.parse(result.stderr) as {
    code: string;
    diagnostics: Array<{path: string}>;
    phase: string;
  };
  assert.equal(document.code, 'SEMANTIC_DIFF_MODE_CONFLICT');
  assert.equal(document.phase, 'command-validation');
  assert.equal(document.diagnostics[0]?.path, 'config');
});

test('semantic-diff paired-config mode reports the missing endpoint precisely', async (t) => {
  const directory = await createFixture(t);
  const result = await runCli(directory, [
    'semantic-diff',
    '--from-config',
    'before.config.ts',
    '--json',
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  const document = JSON.parse(result.stderr) as {
    code: string;
    diagnostics: Array<{path: string}>;
  };
  assert.equal(document.code, 'SEMANTIC_DIFF_TO_CONFIG_REQUIRED');
  assert.equal(document.diagnostics[0]?.path, 'to-config');
});

test('semantic-diff requires explicit from/to selections', async (t) => {
  const directory = await createFixture(t);
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `import {streets} from '@tileflow/maps'; export default streets;\n`,
  );

  const result = await runCli(directory, ['semantic-diff', '--from', 'streets', '--json']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  const document = JSON.parse(result.stderr) as {
    code: string;
    command: string;
    diagnostics: Array<{path: string}>;
    phase: string;
  };
  assert.equal(document.command, 'semantic-diff');
  assert.equal(document.code, 'SEMANTIC_DIFF_SELECTION_REQUIRED');
  assert.equal(document.phase, 'command-validation');
  assert.equal(document.diagnostics[0]?.path, 'to');
});

async function createFixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-semantic-commands-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

function runCli(
  cwd: string,
  arguments_: string[],
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI']) delete environment[variable];
  Object.assign(environment, {NO_COLOR: '1', USERPROFILE: cwd});

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
