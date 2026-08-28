import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');

test('visual help explains reference matching and reviewed baselines', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-visual-help-');
  t.after(() => rm(directory, {force: true, recursive: true}));
  const rootHelp = await runCli(directory, ['visual', '--help']);
  const analyzeHelp = await runCli(directory, ['visual', 'analyze', '--help']);
  const diffHelp = await runCli(directory, ['visual', 'diff', '--help']);
  const updateHelp = await runCli(directory, ['visual', 'update', '--help']);

  assert.equal(rootHelp.code, 0, rootHelp.stderr);
  assert.equal(analyzeHelp.code, 0, analyzeHelp.stderr);
  assert.equal(diffHelp.code, 0, diffHelp.stderr);
  assert.equal(updateHelp.code, 0, updateHelp.stderr);
  assert.match(rootHelp.stdout, /references or approved baselines/i);
  assert.match(analyzeHelp.stdout, /reference PNG; it is never modified/i);
  assert.match(analyzeHelp.stdout, /--region <x,y,width,height>/i);
  assert.match(diffHelp.stdout, /approved baselines without changing them/i);
  assert.match(updateHelp.stdout, /Save fresh scene renders as approved visual baselines/i);
});

test('visual diff and update require named scenes or explicit --all, never both', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-visual-selection-');
  const missing = await runCli(directory, [
    'visual',
    'diff',
    '--baseline-dir',
    'visual-baselines',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /at least one committed visual scene or use --all/);

  const ambiguous = await runCli(directory, [
    'visual',
    'update',
    'proof',
    '--all',
    '--baseline-dir',
    'visual-baselines',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(ambiguous.code, 1);
  assert.equal(ambiguous.stdout, '');
  assert.match(ambiguous.stderr, /either named scenes or --all/);

  await writeFile(
    join(directory, 'tileflow.config.ts'),
    tileflowMapFixture({
      id: 'main',
      fields: `modules: {poi: {type: 'poi', unsupported: true}}`,
    }),
  );
  const all = await runCli(directory, [
    'visual',
    'update',
    '--all',
    '--baseline-dir',
    'visual-baselines',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(all.code, 1);
  assert.equal(all.stdout, '');
  assert.doesNotMatch(all.stderr, /Select at least|either named scenes/);
  assert.match(all.stderr, /config|unsupported/i);
});

test(
  'diffs, fails by explicit policy, and atomically updates controlled visual baselines',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async (t) => {
    const directory = await createDirectoryFixture(t, 'tileflow-visual-workflow-');
    await writeFile(join(directory, 'tileflow.config.ts'), applicationConfig);
    let color = '#123456';
    const server = createServer((_request, response) => {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(
        `<!doctype html><style>html,body{margin:0}.proof{width:64px;height:64px;background:${color}}</style><div class="proof" data-tileflow-map="proof" data-tileflow-theme="light" data-tileflow-capture-id="proof" data-tileflow-state="idle"></div>`,
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const common = [
      'proof',
      '--baseline-dir',
      'visual-baselines',
      '--app-origin',
      `http://127.0.0.1:${address.port}`,
      '--json',
      '--no-browser-install',
    ];

    const missing = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
    ]);
    assert.equal(missing.code, 1, missing.stderr);
    assert.notEqual(missing.stdout, '', missing.stderr);
    const missingDocument = parseDiff(missing.stdout);
    assert.equal(missingDocument.comparisons[0]?.status, 'missing-baseline');
    assert.equal(missingDocument.comparisons[0]?.diffPath, null);
    assert.deepEqual(
      [...(await readFile(join(directory, 'evidence/proof.actual.png'))).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );

    const created = await runCli(directory, ['visual', 'update', ...common]);
    assert.equal(created.code, 0, created.stderr);
    assert.equal(parseUpdate(created.stdout).updates[0]?.status, 'created');
    assert.equal(parseUpdate(created.stdout).updates[0]?.theme, 'light');
    const baselinePath = join(directory, 'visual-baselines/proof.png');
    const receiptPath = join(directory, 'visual-baselines/proof.receipt.json');
    const originalBaseline = await readFile(baselinePath);
    const originalReceipt = await readFile(receiptPath);

    const unchanged = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
    ]);
    assert.equal(unchanged.code, 0, unchanged.stderr);
    const unchangedEntry = parseDiff(unchanged.stdout).comparisons[0]!;
    assert.equal(unchangedEntry.status, 'unchanged');
    assert.equal(unchangedEntry.exact?.changedPixels, 0);
    const transparentDiff = PNG.sync.read(
      await readFile(join(directory, unchangedEntry.diffPath!)),
    );
    assert.equal(
      transparentDiff.data.every((channel) => channel === 0),
      true,
    );
    const deterministicRepeat = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
    ]);
    assert.equal(deterministicRepeat.code, 0, deterministicRepeat.stderr);
    assert.equal(deterministicRepeat.stdout, unchanged.stdout);
    assert.equal(unchanged.stdout.includes(directory), false);

    const mismatchedReceipt = JSON.parse(originalReceipt.toString('utf8')) as {
      renderer: {chromiumVersion: string};
    };
    mismatchedReceipt.renderer.chromiumVersion = '0.0-runtime-mismatch';
    await writeFile(receiptPath, `${JSON.stringify(mismatchedReceipt)}\n`);
    const runtimeMismatch = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
    ]);
    assert.equal(runtimeMismatch.code, 1, runtimeMismatch.stderr);
    assert.equal(parseDiff(runtimeMismatch.stdout).comparisons[0]?.status, 'runtime-mismatch');
    await writeFile(receiptPath, originalReceipt);

    color = '#abcdef';
    const changed = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
    ]);
    assert.equal(changed.code, 0, changed.stderr);
    const changedEntry = parseDiff(changed.stdout).comparisons[0]!;
    assert.equal(changedEntry.status, 'changed');
    assert.equal(changedEntry.changeKind, 'pixels');
    assert.equal(changedEntry.exact?.changedPixels, 64 * 64);
    assert.deepEqual(await readFile(baselinePath), originalBaseline);
    assert.deepEqual(await readFile(receiptPath), originalReceipt);

    const policyFailure = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
      '--fail-on',
      'changed',
    ]);
    assert.equal(policyFailure.code, 2, policyFailure.stderr);
    assert.equal(parseDiff(policyFailure.stdout).comparisons[0]?.status, 'changed');

    const updated = await runCli(directory, ['visual', 'update', ...common]);
    assert.equal(updated.code, 0, updated.stderr);
    assert.equal(parseUpdate(updated.stdout).updates[0]?.status, 'updated');
    const currentBaseline = await readFile(baselinePath);
    assert.notDeepEqual(currentBaseline, originalBaseline);

    const repeated = await runCli(directory, ['visual', 'update', ...common]);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.equal(parseUpdate(repeated.stdout).updates[0]?.status, 'unchanged');
    assert.deepEqual(await readFile(baselinePath), currentBaseline);

    await unlink(receiptPath);
    const repaired = await runCli(directory, ['visual', 'update', ...common]);
    assert.equal(repaired.code, 0, repaired.stderr);
    assert.equal(parseUpdate(repaired.stdout).updates[0]?.status, 'repaired');
    assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).image.sha256.length, 64);

    await writeFile(receiptPath, '{"execute":"never"}\n');
    const corrupt = await runCli(directory, [
      'visual',
      'diff',
      ...common,
      '--output-dir',
      'evidence',
    ]);
    assert.equal(corrupt.code, 1);
    assert.equal(corrupt.stdout, '');
    assert.match(corrupt.stderr, /baseline receipt/i);

    const repairedCorrupt = await runCli(directory, ['visual', 'update', ...common]);
    assert.equal(repairedCorrupt.code, 0, repairedCorrupt.stderr);
    assert.equal(parseUpdate(repairedCorrupt.stdout).updates[0]?.status, 'repaired');
  },
);

test('rejects ambiguous and symlinked baseline directories before browser launch', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-visual-paths-');
  await writeFile(join(directory, 'tileflow.config.ts'), applicationConfig);
  await symlink(join(directory, 'owned-baselines'), join(directory, 'linked-baselines'), 'dir');

  const root = await runCli(directory, [
    'visual',
    'update',
    'proof',
    '--baseline-dir',
    '.',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(root.code, 1);
  assert.equal(root.stdout, '');
  assert.match(root.stderr, /dedicated subdirectory/);

  const symlinkResult = await runCli(directory, [
    'visual',
    'update',
    'proof',
    '--baseline-dir',
    'linked-baselines',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(symlinkResult.code, 1);
  assert.equal(symlinkResult.stdout, '');
  assert.match(symlinkResult.stderr, /symbolic links|non-symlink/);

  const overlap = await runCli(directory, [
    'visual',
    'diff',
    'proof',
    '--baseline-dir',
    'visual-baselines',
    '--output-dir',
    'visual-baselines/generated',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(overlap.code, 1);
  assert.equal(overlap.stdout, '');
  assert.match(overlap.stderr, /must not overlap/);

  const caseFoldedOverlap = await runCli(directory, [
    'visual',
    'diff',
    'proof',
    '--baseline-dir',
    'Portable-Baselines',
    '--output-dir',
    'portable-baselines/generated',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(caseFoldedOverlap.code, 1);
  assert.equal(caseFoldedOverlap.stdout, '');
  assert.match(caseFoldedOverlap.stderr, /must not overlap/);
});

test('does not expose an external absolute symlink path in visual diagnostics', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-visual-diagnostic-');
  const external = await createDirectoryFixture(t, 'tileflow-visual-external-');
  const target = join(external, 'target');
  const linked = join(external, 'linked');
  await writeFile(join(directory, 'tileflow.config.ts'), applicationConfig);
  await symlink(target, linked, 'dir');

  const result = await runCli(directory, [
    'visual',
    'update',
    'proof',
    '--baseline-dir',
    linked,
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(external), false);

  const blockingFile = join(external, 'private-parent');
  await writeFile(blockingFile, 'not a directory');
  const filesystemFailure = await runCli(directory, [
    'visual',
    'update',
    'proof',
    '--baseline-dir',
    join(blockingFile, 'sensitive-child'),
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(filesystemFailure.code, 1);
  assert.equal(filesystemFailure.stdout, '');
  assert.equal(filesystemFailure.stderr.includes(external), false);
});

test('rejects invalid and symlinked analysis references before browser launch', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-visual-analysis-input-');
  await writeFile(join(directory, 'tileflow.config.ts'), applicationConfig);
  await writeFile(join(directory, 'invalid.png'), 'not a png');
  await writeFile(join(directory, 'valid.png'), createPng(32, 32, [18, 52, 86, 255]));
  await symlink(join(directory, 'invalid.png'), join(directory, 'linked.png'));

  const invalidRegion = await runCli(directory, [
    'visual',
    'analyze',
    'proof',
    '--reference',
    'valid.png',
    '--region',
    '0,0,2.5,2',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(invalidRegion.code, 1);
  assert.equal(invalidRegion.stdout, '');
  assert.match(invalidRegion.stderr, /--region expects.*integers/i);
  assert.doesNotMatch(invalidRegion.stderr, /browser|chromium/i);

  const outsideReference = await runCli(directory, [
    'visual',
    'analyze',
    'proof',
    '--reference',
    'valid.png',
    '--region',
    '24,24,9,8',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(outsideReference.code, 1);
  assert.equal(outsideReference.stdout, '');
  assert.match(outsideReference.stderr, /reference PNG physical dimensions \(32x32\)/i);
  assert.doesNotMatch(outsideReference.stderr, /browser|chromium/i);

  const invalid = await runCli(directory, [
    'visual',
    'analyze',
    'proof',
    '--reference',
    'invalid.png',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /reference.*valid PNG|valid PNG/i);
  assert.doesNotMatch(invalid.stderr, /browser|chromium/i);

  const linked = await runCli(directory, [
    'visual',
    'analyze',
    'proof',
    '--reference',
    'linked.png',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(linked.code, 1);
  assert.equal(linked.stdout, '');
  assert.match(linked.stderr, /regular file|symbolic link/i);

  await mkdir(join(directory, 'analysis'));
  const overlappingReference = createPng(32, 32, [18, 52, 86, 255]);
  await writeFile(join(directory, 'analysis/proof.diff.png'), overlappingReference);
  const overlap = await runCli(directory, [
    'visual',
    'analyze',
    'proof',
    '--reference',
    'analysis/proof.diff.png',
    '--output-dir',
    'analysis',
    '--json',
    '--no-browser-install',
  ]);
  assert.equal(overlap.code, 1);
  assert.equal(overlap.stdout, '');
  assert.match(overlap.stderr, /must not replace the reference PNG/i);
  assert.doesNotMatch(overlap.stderr, /browser|chromium/i);
  assert.equal(
    (await readFile(join(directory, 'analysis/proof.diff.png'))).equals(
      Buffer.from(overlappingReference),
    ),
    true,
  );
});

test(
  'analyzes one reference without modifying it or visual baselines',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1', timeout: 60_000},
  async (t) => {
    const directory = await createDirectoryFixture(t, 'tileflow-visual-analysis-');
    await writeFile(join(directory, 'tileflow.config.ts'), applicationConfig);
    const reference = createPng(64, 64, [18, 52, 86, 255]);
    await writeFile(join(directory, 'reference.png'), reference);
    const server = createServer((_request, response) => {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      response.end(
        '<!doctype html><style>html,body{margin:0}.proof{width:64px;height:64px;background:#123456}</style><div class="proof" data-tileflow-map="proof" data-tileflow-theme="light" data-tileflow-capture-id="proof" data-tileflow-state="idle"></div>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const result = await runCli(directory, [
      'visual',
      'analyze',
      'proof',
      '--reference',
      'reference.png',
      '--output-dir',
      'analysis',
      '--region',
      '8,8,32,24',
      '--app-origin',
      `http://127.0.0.1:${address.port}`,
      '--json',
      '--no-browser-install',
    ]);
    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(result.stdout) as {
      command: string;
      dimensionsMatch: boolean;
      theme: string;
      appearance: {
        region: {x: number; y: number; width: number; height: number};
        actualMinusReference: {linearLuminance: {mean: number}};
      } | null;
      actualPath: string;
      diffPath: string | null;
      reportPath: string;
    };
    assert.equal(document.command, 'visual.analyze');
    assert.equal(document.theme, 'light');
    assert.equal(document.dimensionsMatch, true);
    assert.deepEqual(document.appearance?.region, {x: 8, y: 8, width: 32, height: 24});
    assert.equal(document.appearance?.actualMinusReference.linearLuminance.mean, 0);
    assert.notEqual(document.diffPath, null);
    assert.equal((await readFile(join(directory, 'reference.png'))).equals(reference), true);
    assert.deepEqual(
      [...(await readFile(join(directory, document.actualPath))).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(await readFile(join(directory, document.reportPath), 'utf8'), result.stdout);
    await assert.rejects(() => readFile(join(directory, 'visual-baselines/proof.png')));
  },
);

const applicationConfig = tileflowMapFixture({
  data: 'fixture',
  id: 'proof',
  fields: `scenes: {proof: {camera: {type: 'center', center: [0, 0], zoom: 0}, theme: 'light', viewport: {width: 128, height: 128}, target: {kind: 'application', path: '/', captureId: 'proof'}}}`,
});

type DiffDocument = {
  comparisons: Array<{
    status: string;
    changeKind: string | null;
    diffPath: string | null;
    exact: {changedPixels: number} | null;
  }>;
};

type UpdateDocument = {updates: Array<{status: string; theme: string}>};

function parseDiff(source: string): DiffDocument {
  return JSON.parse(source) as DiffDocument;
}

function parseUpdate(source: string): UpdateDocument {
  return JSON.parse(source) as UpdateDocument;
}

function createPng(
  width: number,
  height: number,
  fill: [number, number, number, number],
): Uint8Array {
  const image = new PNG({height, width});
  for (let offset = 0; offset < image.data.byteLength; offset += 4) {
    image.data.set(fill, offset);
  }
  return new Uint8Array(PNG.sync.write(image, {colorType: 6, filterType: 4, inputColorType: 6}));
}

async function createDirectoryFixture(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await linkWorkspacePackages(directory);
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

function runCli(
  cwd: string,
  arguments_: string[],
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TILEFLOW_API_KEY']) {
    delete environment[variable];
  }
  Object.assign(environment, {
    HOME: process.env.HOME ?? cwd,
    NO_COLOR: '1',
    USERPROFILE: process.env.USERPROFILE ?? cwd,
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
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolveResult({code, stderr, stdout}));
  });
}
