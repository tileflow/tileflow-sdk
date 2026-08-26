import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
import {type CompiledTileflowIconPackage, compileTileflowIconPackages} from '@tileflow/dev/icons';
import {
  iconPackageBaselineResponseSchema,
  tileflowIconDiffDocumentSchema,
} from '../src/icon-diff-command';
import {writeIconDiffReport} from '../src/icon-diff-report';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const cliNodeModules = fileURLToPath(new URL('../node_modules', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const fakeApiKey = `tf_live_${'b'.repeat(48)}`;

test('JSON initial diff is deterministic, exact, read-only, and manifest-based', async (t) => {
  const fixture = await createLocalFixture(t);
  const requests: Array<{authorization?: string; method?: string; url?: string}> = [];
  const api = await createIconDiffApi(t, null, requests);
  const arguments_ = [
    'icons',
    'diff',
    '--against',
    'production',
    '--config',
    fixture.configPath,
    '--api-url',
    api.url,
    '--json',
  ];
  const first = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});
  const second = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});

  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, second.stdout);
  const document = JSON.parse(first.stdout) as IconDiffDocument;
  assert.deepEqual(Object.keys(document), [
    'schemaVersion',
    'environment',
    'baseline',
    'proposed',
    'icons',
    'generatedBytes',
    'artifacts',
    'hasChanges',
  ]);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.baseline, null);
  assert.deepEqual(document.icons.added, ['bicycle', 'cafe']);
  assert.equal(document.hasChanges, true);
  assert.deepEqual(
    requests.map((request) => request.method),
    ['GET', 'GET'],
  );
  assert.ok(requests.every((request) => request.authorization === `Bearer ${fakeApiKey}`));
  await assert.rejects(() => readFile(join(fixture.directory, 'public/tileflow/manifest.json')), {
    code: 'ENOENT',
  });
});

test('classifies added, modified, removed, and empty package transitions', async (t) => {
  const fixture = await createLocalFixture(t);
  const baselinePackage = await createBaselinePackage(fixture.directory);
  const requests: Array<{authorization?: string; method?: string; url?: string}> = [];
  const api = await createIconDiffApi(t, baselinePackage, requests);
  const common = [
    'icons',
    'diff',
    '--against',
    'production',
    '--config',
    fixture.configPath,
    '--api-url',
    api.url,
  ];
  const text = await runCli(fixture.directory, common, {TILEFLOW_API_KEY: fakeApiKey});
  const json = await runCli(fixture.directory, [...common, '--json'], {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /\+ bicycle/u);
  assert.match(text.stdout, /~ cafe/u);
  assert.match(text.stdout, /- hospital/u);
  assert.doesNotMatch(text.stdout, /mapping|reference|dangling/iu);
  assert.equal(json.code, 0, json.stderr);
  const document = JSON.parse(json.stdout) as IconDiffDocument;
  assert.deepEqual(document.icons, {
    added: ['bicycle'],
    modified: ['cafe'],
    removed: ['hospital'],
    unchangedCount: 0,
  });
  assert.ok(requests.every((request) => request.method === 'GET'));

  await writeFile(
    fixture.configPath,
    tileflowMapFixture({id: 'production', icons: 'authored', fields: `icons: []`}),
  );
  const removed = await runCli(fixture.directory, [...common, '--json'], {
    TILEFLOW_API_KEY: fakeApiKey,
  });
  assert.equal(removed.code, 0, removed.stderr);
  const removedDocument = JSON.parse(removed.stdout) as IconDiffDocument;
  assert.equal(removedDocument.proposed.package, null);
  assert.deepEqual(removedDocument.icons.removed, ['cafe', 'hospital']);
  assert.equal(removedDocument.hasChanges, true);

  const initialApi = await createIconDiffApi(t, null, requests);
  const bothEmpty = await runCli(
    fixture.directory,
    [
      'icons',
      'diff',
      '--against',
      'production',
      '--config',
      fixture.configPath,
      '--api-url',
      initialApi.url,
      '--json',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(bothEmpty.code, 0, bothEmpty.stderr);
  assert.equal((JSON.parse(bothEmpty.stdout) as IconDiffDocument).hasChanges, false);
});

test('schemas reject every removed mapping and reference field', () => {
  const document = {
    schemaVersion: 1,
    environment: 'production',
    baseline: null,
    proposed: {package: null},
    icons: {added: [], removed: [], modified: [], unchangedCount: 0},
    generatedBytes: {before: 0, after: 0, delta: 0},
    artifacts: {report: null},
    hasChanges: false,
  };
  assert.equal(tileflowIconDiffDocumentSchema.safeParse(document).success, true);
  assert.equal(tileflowIconDiffDocumentSchema.safeParse({...document, mapping: {}}).success, false);
  assert.equal(
    tileflowIconDiffDocumentSchema.safeParse({...document, references: {}}).success,
    false,
  );
  const response = {schemaVersion: 1, environment: 'production', baseline: null};
  assert.equal(iconPackageBaselineResponseSchema.safeParse(response).success, true);
  assert.equal(
    iconPackageBaselineResponseSchema.safeParse({
      ...response,
      baseline: {
        deployedAt: '2026-08-12T10:00:00.000Z',
        deploymentId: 'dep',
        mapping: null,
        package: null,
        version: 1,
      },
    }).success,
    false,
  );
});

test('HTML report is self-contained, atomic, and contains only final visual differences', async (t) => {
  const fixture = await createLocalFixture(t);
  const baselinePackage = await createBaselinePackage(fixture.directory);
  const requests: Array<{authorization?: string; method?: string; url?: string}> = [];
  const api = await createIconDiffApi(t, baselinePackage, requests);
  const reportPath = join(fixture.directory, 'artifacts', 'icons.html');
  const arguments_ = [
    'icons',
    'diff',
    '--against',
    'production',
    '--config',
    fixture.configPath,
    '--api-url',
    api.url,
    '--report',
    reportPath,
    '--json',
  ];
  const created = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});

  assert.equal(created.code, 0, created.stderr);
  assert.equal((JSON.parse(created.stdout) as IconDiffDocument).artifacts.report, reportPath);
  const html = await readFile(reportPath, 'utf8');
  assert.match(html, /data:image\/png;base64,/u);
  assert.match(html, /<h1>Tileflow Icon Diff<\/h1>/u);
  assert.match(html, /Map: <strong>production<\/strong>/u);
  assert.match(html, /<h2 id="changed-icons-title">Changed icons<\/h2>/u);
  assert.match(html, /class="icon-preview preview-1x"/u);
  assert.match(html, /class="icon-preview preview-2x"/u);
  assert.match(html, /<details class="technical-details"><summary>Details<\/summary>/u);
  assert.doesNotMatch(html, /mapping|reference|dangling|unanalyzable/iu);
  assert.doesNotMatch(html, new RegExp(fakeApiKey, 'u'));
  assert.doesNotMatch(html, /<script|(?:src|href)="https?:/iu);
  assert.equal(requests.filter((request) => request.url?.includes('/baseline/')).length, 1);
  assert.equal(requests.filter((request) => request.url?.startsWith('/sprites/')).length, 4);

  const identical = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});
  assert.equal(identical.code, 0, identical.stderr);
  await writeFile(reportPath, 'sentinel');
  const refused = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already exists with different contents/u);
  assert.equal(await readFile(reportPath, 'utf8'), 'sentinel');
  const replaced = await runCli(fixture.directory, [...arguments_, '--force'], {
    TILEFLOW_API_KEY: fakeApiKey,
  });
  assert.equal(replaced.code, 0, replaced.stderr);
  assert.match(await readFile(reportPath, 'utf8'), /<!doctype html>/u);
});

test('report supports an unscoped empty comparison without legacy review sections', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-diff-report-'));
  const reportPath = join(directory, 'icon-diff.html');
  t.after(() => rm(directory, {force: true, recursive: true}));
  const document = tileflowIconDiffDocumentSchema.parse({
    schemaVersion: 1,
    environment: 'unscoped',
    baseline: null,
    proposed: {package: null},
    icons: {added: [], removed: [], modified: [], unchangedCount: 0},
    generatedBytes: {before: 0, after: 0, delta: 0},
    artifacts: {report: reportPath},
    hasChanges: false,
  });

  await writeIconDiffReport({
    baseline: null,
    document,
    force: false,
    mapName: null,
    outputPath: reportPath,
    proposedPackage: null,
  });
  const html = await readFile(reportPath, 'utf8');
  assert.match(html, /<title>Tileflow Icon Diff<\/title>/u);
  assert.doesNotMatch(html, /class="map-pill"|Map:/u);
  assert.doesNotMatch(html, /mapping|reference|Action required/iu);
});

test('unknown maps and removed flags fail before any request', async (t) => {
  const fixture = await createLocalFixture(t);
  const requests: Array<{method?: string}> = [];
  const api = await createIconDiffApi(t, null, requests);
  const unknown = await runCli(
    fixture.directory,
    [
      'icons',
      'diff',
      '--against',
      'staging',
      '--config',
      fixture.configPath,
      '--api-url',
      api.url,
      '--json',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Available maps: production/u);

  const removedFlag = await runCli(
    fixture.directory,
    ['icons', 'diff', '--against', 'production', '--fail-on', 'dangling', '--json'],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(removedFlag.code, 1);
  assert.equal(removedFlag.stdout, '');
  assert.match(removedFlag.stderr, /unknown option '--fail-on'/iu);
  assert.equal(requests.length, 0);
});

test('malformed baseline responses fail closed with diagnostics only on stderr', async (t) => {
  const fixture = await createLocalFixture(t);
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({baseline: null, environment: 'wrong', schemaVersion: 1}));
  });
  const url = await listen(t, server);
  const result = await runCli(
    fixture.directory,
    [
      'icons',
      'diff',
      '--against',
      'production',
      '--config',
      fixture.configPath,
      '--api-url',
      url,
      '--json',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /does not match the required schema/u);
  assert.equal(requests, 1);
});

type IconDiffDocument = {
  artifacts: {report: string | null};
  baseline: null | {version: number};
  environment: string;
  generatedBytes: {after: number; before: number; delta: number};
  hasChanges: boolean;
  icons: {added: string[]; modified: string[]; removed: string[]; unchangedCount: number};
  proposed: {package: null | {contentHash: string}};
  schemaVersion: number;
};

async function createLocalFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-diff-'));
  await symlink(cliNodeModules, join(directory, 'node_modules'), 'dir');
  const configPath = join(directory, 'tileflow.config.ts');
  await mkdir(join(directory, 'icons'));
  await writeSvg(join(directory, 'icons', 'bicycle.svg'), '#f59e0b');
  await writeSvg(join(directory, 'icons', 'cafe.svg'), '#111827');
  await writeFile(
    configPath,
    tileflowMapFixture({
      id: 'production',
      icons: 'authored',
      fields: `icons: ['./icons'],\nname: 'Production'`,
    }),
  );
  t.after(() => rm(directory, {force: true, recursive: true}));
  return {configPath, directory};
}

async function createBaselinePackage(directory: string): Promise<CompiledTileflowIconPackage> {
  const source = join(directory, 'baseline-icons');
  await mkdir(source, {recursive: true});
  await writeSvg(join(source, 'cafe.svg'), '#ef8354');
  await writeSvg(join(source, 'hospital.svg'), '#2563eb');
  const compiled = await compileTileflowIconPackages(
    {
      maps: {
        production: defineMap({
          id: 'production',
          version: 1,
          extends: streets,
          icons: ['./baseline-icons'],
        }),
      },
    },
    {cwd: directory, target: 'hosted'},
  );
  const iconPackage = compiled.packages[0];
  assert.ok(iconPackage);
  return iconPackage;
}

async function createIconDiffApi(
  t: TestContext,
  baselinePackage: CompiledTileflowIconPackage | null,
  requests: Array<{authorization?: string; method?: string; url?: string}>,
) {
  let baseUrl = '';
  const server = createServer((request, response) => {
    requests.push({
      authorization: request.headers.authorization,
      method: request.method,
      url: request.url,
    });

    if (request.url === '/v1/icon-packages/baseline/production') {
      request.resume();
      sendJson(response, {
        baseline: baselinePackage
          ? {
              deployedAt: '2026-08-12T10:00:00.000Z',
              deploymentId: 'dep_baseline',
              package: {
                contentHash: baselinePackage.contentHash,
                label: 'Brand icons',
                manifest: baselinePackage.manifest,
                spriteUrl: `${baseUrl}/sprites/icp_1234567890abcdef/sprite`,
                totalBytes: baselinePackage.files.reduce(
                  (total, file) => total + file.source.byteLength,
                  0,
                ),
              },
              version: 7,
            }
          : null,
        environment: 'production',
        schemaVersion: 1,
      });
      return;
    }

    const fileName = request.url?.split('/').pop();
    const file = baselinePackage?.files.find((candidate) => candidate.fileName === fileName);
    if (request.url?.startsWith('/sprites/') && file) {
      request.resume();
      response.writeHead(200, {
        'Content-Length': file.source.byteLength,
        'Content-Type': file.contentType,
      });
      response.end(Buffer.from(file.source));
      return;
    }

    request.resume();
    response.writeHead(404, {'Content-Type': 'application/json'});
    response.end('{"error":"not found"}');
  });
  baseUrl = await listen(t, server);
  return {url: baseUrl};
}

async function listen(t: TestContext, server: ReturnType<typeof createServer>): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

function sendJson(response: ServerResponse<IncomingMessage>, value: unknown): void {
  response.writeHead(200, {'Content-Type': 'application/json'});
  response.end(JSON.stringify(value));
}

async function writeSvg(path: string, color: string): Promise<void> {
  await writeFile(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="${color}" /></svg>`,
  );
}

function runCli(
  cwd: string,
  arguments_: string[],
  overrides: Record<string, string>,
): Promise<{code: number | null; stderr: string; stdout: string}> {
  const environment: NodeJS.ProcessEnv = {...process.env};
  for (const variable of [
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'TILEFLOW_API_KEY',
    'TILEFLOW_API_URL',
  ]) {
    delete environment[variable];
  }
  Object.assign(environment, overrides, {HOME: cwd, NO_COLOR: '1', USERPROFILE: cwd});

  return new Promise((resolve, reject) => {
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
    child.on('close', (code) => resolve({code, stderr, stdout}));
  });
}
