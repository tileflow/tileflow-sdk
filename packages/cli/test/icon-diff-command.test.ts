import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {type CompiledTileflowIconPackage, compileTileflowIconPackages} from '@tileflow/dev';
import {tileflowIconDiffDocumentSchema} from '../src/icon-diff-command';
import {writeIconDiffReport} from '../src/icon-diff-report';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const fakeApiKey = `tf_live_${'b'.repeat(48)}`;

test('JSON initial diff is deterministic, parseable, and performs one read with no file write', async (t) => {
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
    'mapping',
    'generatedBytes',
    'references',
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

test('absent proposed packages and unavailable historical mappings remain explicit', async (t) => {
  const fixture = await createLocalFixture(t);
  const baselinePackage = await createBaselinePackage(fixture.directory);
  await writeFile(
    fixture.configPath,
    `export default {maps: {production: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, name: 'Production'}}};\n`,
  );
  const requests: Array<{authorization?: string; method?: string; url?: string}> = [];
  const api = await createIconDiffApi(t, baselinePackage, requests, {mappingAvailable: false});
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
      api.url,
      '--json',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout) as IconDiffDocument;
  assert.equal(document.proposed.package, null);
  assert.deepEqual(document.icons.removed, ['cafe', 'hospital']);
  assert.deepEqual(document.mapping, {
    added: [],
    changed: [],
    comparisonAvailable: false,
    removed: [],
  });
  assert.equal(document.hasChanges, true);

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

test('a mapping-only revision changes policy output without inventing pixel changes', async (t) => {
  const fixture = await createLocalFixture(t);
  const baselinePackage = await createBaselinePackage(fixture.directory);
  await writeFile(
    fixture.configPath,
    `export default {maps: {production: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, icons: {mapping: {health: 'clinic'}, source: './baseline-icons'}}}};\n`,
  );
  const requests: Array<{authorization?: string; method?: string; url?: string}> = [];
  const api = await createIconDiffApi(t, baselinePackage, requests);
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
      api.url,
      '--json',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, result.stderr);
  const document = JSON.parse(result.stdout) as IconDiffDocument;
  assert.deepEqual(document.icons, {added: [], modified: [], removed: [], unchangedCount: 2});
  assert.deepEqual(document.mapping.changed, [
    {after: 'clinic', before: 'hospital', key: 'health'},
  ]);
  assert.equal(document.hasChanges, true);
});

test('text/JSON modes classify pixel changes and dangling references without remote writes', async (t) => {
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

  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /\+ bicycle/);
  assert.match(text.stdout, /~ cafe/);
  assert.match(text.stdout, /- hospital/);
  assert.match(
    text.stdout,
    /Warning: "hospital" is still referenced by maps\.production\.icons\.mapping\.health/,
  );

  const policy = await runCli(fixture.directory, [...common, '--json', '--fail-on', 'dangling'], {
    TILEFLOW_API_KEY: fakeApiKey,
  });
  assert.equal(policy.code, 2, policy.stderr);
  const document = JSON.parse(policy.stdout) as IconDiffDocument;
  assert.deepEqual(document.icons, {
    added: ['bicycle'],
    modified: ['cafe'],
    removed: ['hospital'],
    unchangedCount: 0,
  });
  assert.equal(document.references.dangling[0]?.iconName, 'hospital');
  assert.ok(requests.every((request) => request.method === 'GET'));
  assert.ok(requests.every((request) => !request.url?.startsWith('/v1/styles')));
});

test('HTML report is self-contained, atomic, credential-free, and requires force for replacement', async (t) => {
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
  const document = JSON.parse(created.stdout) as IconDiffDocument;
  assert.equal(document.artifacts.report, reportPath);
  const html = await readFile(reportPath, 'utf8');
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /<h1>Tileflow Icon Diff<\/h1>/);
  assert.match(html, /Map: <strong>production<\/strong>/);
  assert.match(html, /<h2 id="changed-icons-title">Changed icons<\/h2>/);
  assert.match(html, /id="icon-density-1x"/);
  assert.match(html, /id="icon-density-2x"[^>]*checked/);
  assert.match(
    html,
    /<section class="icon-changes"[^>]*>\s*<input class="density-input" id="icon-density-1x"[^>]*><input class="density-input" id="icon-density-2x"[^>]*>\s*<div class="section-heading">/,
  );
  assert.match(html, /#icon-density-1x:checked ~ \.change-groups \.preview-1x/);
  assert.doesNotMatch(html, /:has\(/);
  assert.match(html, /\.preview-1x \{ display: none; width: 48px; height: 48px; \}/);
  assert.match(html, /\.preview-2x \{ width: 96px; height: 96px; \}/);
  assert.match(html, /class="icon-preview preview-1x"/);
  assert.match(html, /class="icon-preview preview-2x"/);
  assert.match(html, /<figcaption>Before/);
  assert.match(html, /<figcaption>Next/);
  assert.match(html, /<details class="technical-details"><summary>Details<\/summary>/);
  assert.match(html, /<th>Before<\/th><th>Next<\/th>/);
  assert.match(html, /Mappings connect semantic keys in your configuration/);
  assert.match(html, /Checks whether removed icons are still referenced/);
  assert.match(html, /viewBox="0 0 48 48" overflow="hidden"/);
  assert.match(html, /<use href="#tileflow-(?:before|proposed)-2x" x="-48" y="0">/);
  assert.doesNotMatch(html, /class="presence"|>—<|>Not present</);
  assert.match(html, /bicycle|cafe|hospital/);
  const addedGroup = html.indexOf('<section class="change-group change-group-added"');
  const modifiedGroup = html.indexOf('<section class="change-group change-group-modified"');
  const removedGroup = html.indexOf('<section class="change-group change-group-removed"');
  assert.ok(addedGroup >= 0 && addedGroup < modifiedGroup && modifiedGroup < removedGroup);
  const secondarySection = html.indexOf('<section class="secondary-section"', removedGroup);
  const addedMarkup = html.slice(addedGroup, modifiedGroup);
  const modifiedMarkup = html.slice(modifiedGroup, removedGroup);
  const removedMarkup = html.slice(removedGroup, secondarySection);
  for (const singleSidedMarkup of [addedMarkup, removedMarkup]) {
    assert.match(singleSidedMarkup, /class="icon-single"/);
    assert.doesNotMatch(
      singleSidedMarkup,
      /class="icon-comparison"|class="change-arrow"|class="icon-missing"|<figcaption>/,
    );
  }
  assert.match(addedMarkup, /aria-label="Added (?:bicycle|clinic) at 2x"/);
  assert.match(removedMarkup, /aria-label="Removed hospital at 2x"/);
  assert.match(modifiedMarkup, /class="icon-comparison"/);
  assert.match(modifiedMarkup, /class="change-arrow"/);
  assert.match(modifiedMarkup, /<figcaption>Before<\/figcaption>/);
  assert.match(modifiedMarkup, /<figcaption>Next<\/figcaption>/);
  assert.doesNotMatch(html, /\bProposed\b|Analysis complete|overflow: visible/);
  assert.doesNotMatch(html, /Read-only local proposal|Changed icon crops|Atlas overlay|>Atlases</);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(html, new RegExp(fakeApiKey));
  assert.doesNotMatch(html, /<script|(?:src|href)="https?:/i);
  assert.equal(requests.filter((request) => request.url?.includes('/baseline/')).length, 1);
  assert.equal(requests.filter((request) => request.url?.startsWith('/sprites/')).length, 4);
  assert.ok(
    requests
      .filter((request) => request.url?.startsWith('/sprites/'))
      .every((request) => request.authorization === undefined),
  );

  const identical = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});
  assert.equal(identical.code, 0, identical.stderr);
  await writeFile(reportPath, 'sentinel');
  const refused = await runCli(fixture.directory, arguments_, {TILEFLOW_API_KEY: fakeApiKey});
  assert.equal(refused.code, 1);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /already exists with different contents/);
  assert.equal(await readFile(reportPath, 'utf8'), 'sentinel');
  assert.deepEqual(
    (await readdir(join(fixture.directory, 'artifacts'))).filter((name) => name.endsWith('.tmp')),
    [],
  );

  const replaced = await runCli(fixture.directory, [...arguments_, '--force'], {
    TILEFLOW_API_KEY: fakeApiKey,
  });
  assert.equal(replaced.code, 0, replaced.stderr);
  assert.match(await readFile(reportPath, 'utf8'), /<!doctype html>/);
});

test('HTML report omits map context when the comparison is not map-scoped', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-diff-report-'));
  const reportPath = join(directory, 'icon-diff.html');
  t.after(() => rm(directory, {force: true, recursive: true}));
  const document = tileflowIconDiffDocumentSchema.parse({
    schemaVersion: 1,
    environment: 'unscoped',
    baseline: null,
    proposed: {package: null},
    icons: {added: [], removed: [], modified: [], unchangedCount: 0},
    mapping: {comparisonAvailable: true, added: [], removed: [], changed: []},
    generatedBytes: {before: 0, after: 0, delta: 0},
    references: {
      analysisComplete: false,
      dangling: [],
      unanalyzable: [{kind: 'style-override-expression', path: 'icons.dynamic'}],
    },
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
  assert.match(html, /<title>Tileflow Icon Diff<\/title>/);
  assert.match(html, /Action required before deploying/);
  assert.match(html, /confirm that every icon name it can produce exists in Next/);
  assert.doesNotMatch(html, /Analysis complete/);
  assert.doesNotMatch(html, /class="map-pill"|Map:/);
});

test('unknown maps and invalid flag combinations fail before any request', async (t) => {
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
  assert.match(unknown.stderr, /Available maps: production/);

  const invalidFlags = await runCli(
    fixture.directory,
    ['icons', 'diff', '--against', 'production', '--open', '--json'],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(invalidFlags.code, 1);
  assert.equal(invalidFlags.stdout, '');
  assert.match(invalidFlags.stderr, /--open requires --report/);
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
  assert.match(result.stderr, /does not match the required schema/);
  assert.equal(requests, 1);
});

type IconDiffDocument = {
  artifacts: {report: string | null};
  baseline: null | {version: number};
  environment: string;
  generatedBytes: {after: number; before: number; delta: number};
  hasChanges: boolean;
  icons: {added: string[]; modified: string[]; removed: string[]; unchangedCount: number};
  mapping: {
    added: unknown[];
    changed: Array<{after: string; before: string; key: string}>;
    comparisonAvailable: boolean;
    removed: unknown[];
  };
  proposed: {package: null | {contentHash: string}};
  references: {dangling: Array<{iconName: string}>};
  schemaVersion: number;
};

async function createLocalFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-icon-diff-'));
  const configPath = join(directory, 'tileflow.config.ts');
  await mkdir(join(directory, 'icons'));
  await writeSvg(join(directory, 'icons', 'bicycle.svg'), '#f59e0b');
  await writeSvg(join(directory, 'icons', 'cafe.svg'), '#111827');
  await writeFile(
    configPath,
    `export default {
  maps: {
    production: {
      basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
      icons: {mapping: {health: 'hospital'}, source: './icons'},
      name: 'Production'
    }
  }
};
`,
  );
  t.after(() => rm(directory, {force: true, recursive: true}));
  return {configPath, directory};
}

async function createBaselinePackage(directory: string): Promise<CompiledTileflowIconPackage> {
  const source = join(directory, 'baseline-icons');
  await mkdir(source);
  await writeSvg(join(source, 'cafe.svg'), '#ef8354');
  await writeSvg(join(source, 'hospital.svg'), '#2563eb');
  const compiled = await compileTileflowIconPackages(
    {
      maps: {
        production: {
          basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
          icons: {source: './baseline-icons'},
        },
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
  options: {mappingAvailable?: boolean} = {},
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
              mapping: options.mappingAvailable === false ? null : {health: 'hospital'},
              mappingAvailable: options.mappingAvailable !== false,
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
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}"/></svg>`,
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

  Object.assign(environment, overrides, {
    HOME: cwd,
    NO_COLOR: '1',
    USERPROFILE: cwd,
  });

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
