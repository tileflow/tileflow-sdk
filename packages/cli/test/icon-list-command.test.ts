import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const ambientApiKey = `tf_live_catalog_${'k'.repeat(40)}`;
const sourceMarker = 'SOURCE_PIXELS_MUST_NOT_REACH_STDOUT';
const remoteMarker = 'SIGNED_REMOTE_SPRITE_MUST_NOT_REACH_STDOUT';

test('lists deterministic v1 metadata with no network, auth, payload, or file mutation', async (t) => {
  const fixture = await createCatalogFixture(t);
  const sentinel = await createHttpSentinel(t);
  const before = await inventory(fixture.directory);
  const arguments_ = ['icons', 'list', '--json', '--config', fixture.configPath];
  const environment = {
    TILEFLOW_API_KEY: ambientApiKey,
    TILEFLOW_API_URL: sentinel.url,
  };
  const first = await runCli(fixture.directory, arguments_, environment);
  const second = await runCli(fixture.directory, arguments_, environment);
  const after = await inventory(fixture.directory);

  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, '');
  assert.equal(first.stdout, second.stdout);
  assert.ok(first.stdout.endsWith('\n'));
  assert.ok(!first.stdout.endsWith('\n\n'));
  assert.equal(sentinel.requests(), 0);
  assert.deepEqual(after, before);
  await assert.rejects(() => readFile(join(fixture.directory, '.tileflow', 'auth.json')), {
    code: 'ENOENT',
  });

  const document = JSON.parse(first.stdout) as IconListDocument;
  assert.deepEqual(Object.keys(document), ['schemaVersion', 'pathBase', 'catalogs', 'maps']);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.pathBase, 'cwd');
  assert.equal(document.catalogs.length, 1);
  assert.deepEqual(
    document.maps.map((map) => [map.name, map.icons.kind]),
    [
      ['alpha', 'local'],
      ['beta', 'local'],
      ['external', 'external'],
      ['none', 'none'],
    ],
  );

  const catalog = document.catalogs[0];
  assert.ok(catalog);
  assert.deepEqual(Object.keys(catalog), [
    'sourcePath',
    'insideWorkingTree',
    'packageHash',
    'iconCount',
    'generatedByteLength',
    'atlas',
    'icons',
  ]);
  assert.equal(catalog.sourcePath, 'icons/shared');
  assert.equal(catalog.insideWorkingTree, true);
  assert.match(catalog.packageHash, /^[a-f0-9]{64}$/);
  assert.equal(catalog.iconCount, 2);
  assert.ok(catalog.generatedByteLength > 0);
  assert.deepEqual(
    catalog.icons.map((icon) => [icon.id, icon.source.format, icon.source.path]),
    [
      ['cafe', 'svg', 'icons/shared/cafe.svg'],
      ['photo', 'svg', 'icons/shared/photo.svg'],
    ],
  );
  assert.ok(
    catalog.icons.every(
      (icon) =>
        /^[a-f0-9]{64}$/.test(icon.rendered.oneX.pixelSha256) &&
        /^[a-f0-9]{64}$/.test(icon.rendered.twoX.pixelSha256),
    ),
  );
  assert.deepEqual(Object.keys(catalog.icons[0]?.rendered.oneX.atlas ?? {}), [
    'x',
    'y',
    'width',
    'height',
  ]);
  assert.deepEqual(catalog.icons[0]?.mappedFrom, [{map: 'alpha', semantic: 'food'}]);
  assert.deepEqual(catalog.icons[1]?.mappedFrom, [{map: 'beta', semantic: 'food'}]);

  const alpha = document.maps.find((map) => map.name === 'alpha');
  const beta = document.maps.find((map) => map.name === 'beta');
  const external = document.maps.find((map) => map.name === 'external');
  assert.deepEqual(alpha?.icons.mappings, [
    {semantic: 'dangling', iconId: 'missing', targetStatus: 'missing'},
    {semantic: 'food', iconId: 'cafe', targetStatus: 'present'},
  ]);
  assert.deepEqual(beta?.icons.mappings, [
    {semantic: 'dangling', iconId: 'missing', targetStatus: 'missing'},
    {semantic: 'food', iconId: 'photo', targetStatus: 'present'},
  ]);
  assert.deepEqual(external?.icons.mappings, [
    {semantic: 'remote', iconId: 'remote-pin', targetStatus: 'unknown'},
  ]);

  for (const forbidden of [
    fixture.directory,
    ambientApiKey,
    sourceMarker,
    remoteMarker,
    'data:',
    'base64,',
    '\u001b[',
    '✓',
  ]) {
    assert.ok(!first.stdout.includes(forbidden), `stdout contained forbidden value ${forbidden}`);
  }
});

test('filters before source I/O and rejects unknown maps with sorted valid names', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-filter-');
  const configPath = join(directory, 'tileflow.config.ts');
  await writeFileEnsured(join(directory, 'icons', 'safe.svg'), simpleSvg('#22c55e'));
  await writeFile(
    configPath,
    `export default {maps: {
      zeta: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: {source: './missing'}},
      alpha: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: {source: './icons'}}
    }};\n`,
  );

  const selected = await runCli(
    directory,
    ['icons', 'list', '--json', '--map', 'alpha', '--config', configPath],
    {},
  );
  assert.equal(selected.code, 0, selected.stderr);
  const selectedDocument = JSON.parse(selected.stdout) as IconListDocument;
  assert.deepEqual(
    selectedDocument.maps.map((map) => map.name),
    ['alpha'],
  );
  assert.deepEqual(
    selectedDocument.catalogs.map((catalog) => catalog.sourcePath),
    ['icons'],
  );

  const unknown = await runCli(
    directory,
    ['icons', 'list', '--json', '--map', 'missing-map', '--config', configPath],
    {},
  );
  assert.equal(unknown.code, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown map "missing-map"/);
  assert.match(unknown.stderr, /Available maps: alpha, zeta/);
  assert.doesNotMatch(unknown.stderr, /Icon source was not found/);
});

test('keeps unsupported human surfaces off stdout', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-usage-');
  const withoutJson = await runCli(directory, ['icons', 'list'], {});
  const preview = await runCli(directory, ['icons', 'preview'], {});

  assert.equal(withoutJson.code, 1);
  assert.equal(withoutJson.stdout, '');
  assert.match(withoutJson.stderr, /requires --json/);
  assert.equal(preview.code, 1);
  assert.equal(preview.stdout, '');
  assert.match(preview.stderr, /unknown command ['"]preview['"]/i);
});

test('reports config, source, and decode failures on stderr without partial JSON', async (t) => {
  const invalidConfig = await createDirectoryFixture(t, 'tileflow-icon-list-invalid-config-');
  await writeFile(
    join(invalidConfig, 'tileflow.config.ts'),
    `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, unsupportedField: true}}};\n`,
  );
  const invalid = await runCli(invalidConfig, ['icons', 'list', '--json'], {});
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Tileflow config has errors/);

  const missingSource = await createDirectoryFixture(t, 'tileflow-icon-list-missing-source-');
  await writeFile(
    join(missingSource, 'tileflow.config.ts'),
    `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: {source: './missing'}}}};\n`,
  );
  const missing = await runCli(missingSource, ['icons', 'list', '--json'], {});
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /Tileflow icon catalog has errors/);
  assert.match(missing.stderr, /Icon source was not found/);

  const brokenImage = await createDirectoryFixture(t, 'tileflow-icon-list-broken-image-');
  await writeFileEnsured(join(brokenImage, 'icons', 'broken.png'), 'not a PNG');
  await writeFile(
    join(brokenImage, 'tileflow.config.ts'),
    `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: {source: './icons'}}}};\n`,
  );
  const broken = await runCli(brokenImage, ['icons', 'list', '--json'], {});
  assert.equal(broken.code, 1);
  assert.equal(broken.stdout, '');
  assert.match(broken.stderr, /Tileflow icon catalog has errors/);
});

test('succeeds with an empty catalog array for external and absent map icons', async (t) => {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-empty-');
  await writeFile(
    join(directory, 'tileflow.config.ts'),
    `export default {maps: {
      external: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: {mapping: {poi: 'pin'}, sprite: 'https://example.invalid/${remoteMarker}'}},
      none: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}}
    }};\n`,
  );
  const result = await runCli(directory, ['icons', 'list', '--json'], {});

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual((JSON.parse(result.stdout) as IconListDocument).catalogs, []);
  assert.ok(!result.stdout.includes(remoteMarker));
});

async function createCatalogFixture(t: TestContext) {
  const directory = await createDirectoryFixture(t, 'tileflow-icon-list-');
  const configPath = join(directory, 'tileflow.config.ts');
  await writeFileEnsured(
    join(directory, 'icons', 'shared', 'cafe.svg'),
    `${simpleSvg('#ef4444')}<!-- ${sourceMarker} -->`,
  );
  await writeFileEnsured(join(directory, 'icons', 'shared', 'photo.svg'), simpleSvg('#2563eb'));
  await writeFile(
    configPath,
    `if (process.env.TILEFLOW_API_KEY) {
  throw new Error('ambient Tileflow API key reached executable config');
}
export default {
  icons: {
    base: {mapping: {dangling: 'missing', food: 'cafe'}, source: './icons/shared'},
    remote: {
      mapping: {remote: 'remote-pin'},
      sprite: 'https://example.invalid/${remoteMarker}?signature=secret'
    }
  },
  maps: {
    none: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}},
    external: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: 'remote'},
    beta: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: {extends: 'base', mapping: {food: 'photo'}}},
    alpha: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: 'base'}
  }
};
`,
  );
  return {configPath, directory};
}

async function createDirectoryFixture(t: TestContext, prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, {force: true, recursive: true}));
  return directory;
}

async function createHttpSentinel(t: TestContext) {
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    request.resume();
    response.writeHead(500, {'Content-Type': 'text/plain'});
    response.end('unexpected request');
  });
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
  return {requests: () => requestCount, url: `http://127.0.0.1:${address.port}`};
}

async function inventory(
  root: string,
): Promise<Array<{path: string; sha256: string; size: number}>> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

    for (const entry of entries) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  await visit(root);
  return Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(path);
      return {
        path: relative(root, path).split('/').join('/'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength,
      };
    }),
  );
}

async function writeFileEnsured(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, contents);
}

function simpleSvg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="${color}" /></svg>`;
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

type IconListDocument = {
  schemaVersion: number;
  pathBase: string;
  catalogs: Array<{
    sourcePath: string;
    insideWorkingTree: boolean;
    packageHash: string;
    iconCount: number;
    generatedByteLength: number;
    atlas: unknown;
    icons: Array<{
      id: string;
      source: {format: string; path: string};
      rendered: {
        oneX: {
          atlas: {x: number; y: number; width: number; height: number};
          pixelSha256: string;
        };
        twoX: {
          atlas: {x: number; y: number; width: number; height: number};
          pixelSha256: string;
        };
      };
      mappedFrom: Array<{map: string; semantic: string}>;
    }>;
  }>;
  maps: Array<{
    name: string;
    icons: {
      kind: 'external' | 'local' | 'none';
      mappings: Array<{semantic: string; iconId: string; targetStatus: string}>;
    };
  }>;
};
