import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer, type IncomingMessage} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {tileflowIconsLockfileName} from '@tileflow/core';
import {composeTileflowIconSources} from '@tileflow/dev/icons';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const apiKey = `tf_live_${'a'.repeat(48)}`;

test('a selected local API supports publication, exact locks and cold-cache map preparation', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-local-icon-api-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await mkdir(join(cwd, 'icons'));
  await writeFile(
    join(cwd, 'icons', 'shop.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#2563eb"/></svg>',
  );
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    tileflowMapFixture({
      data: 'fixture',
      fields: "icons: [iconSet('@acme/brand')]",
      icons: 'authored',
      id: 'main',
      imports: "import {iconSet} from '@tileflow/core';",
    }),
  );
  const artifact = (await composeTileflowIconSources(['./icons'], {cwd, target: 'hosted'}))
    .package!;
  const packageId = `icp_${artifact.contentHash.slice(0, 16)}`;
  let publications = 0;
  let downloads = 0;
  const failures: unknown[] = [];
  const pin = () => ({
    teamId: 'org_acme',
    setId: 'ics_0000000000000001',
    versionId: 'icv_0000000000000001',
    version: 1,
    packageId,
    contentHash: artifact.contentHash,
    manifest: artifact.manifest,
    spriteUrl: `${origin}/sprites/${packageId}/sprite`,
  });
  const revision = () => ({
    id: pin().versionId,
    reference: '@acme/brand',
    version: 1,
    publishedAt: '2026-11-12T10:00:00.000Z',
    purgedAt: null,
    iconCount: artifact.manifest.iconNames.length,
    totalBytes: artifact.files.reduce((sum, file) => sum + file.source.byteLength, 0),
    publisher: {kind: 'credential', id: 'credential_fixture'},
    pin: pin(),
  });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, origin);
      if (url.pathname.startsWith('/sprites/')) {
        assert.equal(request.headers.authorization, undefined);
        const file = artifact.files.find(
          (candidate) => url.pathname === `/sprites/${packageId}/${candidate.fileName}`,
        );
        assert.ok(file);
        downloads += 1;
        response.writeHead(200, {
          'Content-Type': file.contentType,
          'Content-Length': file.source.byteLength,
        });
        response.end(file.source);
        return;
      }
      assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'PUT') {
        assert.equal(url.pathname, `/v1/icon-sets/brand/versions/${artifact.contentHash}`);
        assert.equal(request.headers['idempotency-key'], 'local-icon-publication');
        const body = new Request(url, {
          method: 'PUT',
          headers: {'Content-Type': request.headers['content-type']!},
          body: new Uint8Array(await readBody(request)),
        });
        const files = await body.formData();
        for (const file of artifact.files) {
          const received = files.get(file.fileName);
          assert.ok(received instanceof Blob);
          assert.deepEqual(Buffer.from(await received.arrayBuffer()), Buffer.from(file.source));
        }
        publications += 1;
        response.end(JSON.stringify({schemaVersion: 1, changed: true, revision: revision()}));
        return;
      }
      assert.equal(request.method, 'GET');
      assert.equal(url.pathname, '/v1/icon-sets/brand/versions/latest');
      assert.ok(publications > 0);
      response.end(JSON.stringify({schemaVersion: 1, archived: false, revision: revision()}));
    } catch (error) {
      failures.push(error);
      response.writeHead(500).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const publish = await runCli(cwd, [
    'icon-set',
    'publish',
    './icons',
    '--id',
    'brand',
    '--idempotency-key',
    'local-icon-publication',
    '--api-url',
    origin,
    '--api-key',
    apiKey,
    '--json',
  ]);
  assert.equal(publish.code, 0, `${publish.stdout}\n${publish.stderr}`);
  assert.equal(JSON.parse(publish.stdout).iconSet.versionId, pin().versionId);
  assert.equal(publications, 1);

  const install = await runCli(cwd, ['icons', 'install', '--api-key', apiKey, '--json'], origin);
  assert.equal(install.code, 0, `${install.stdout}\n${install.stderr}`);
  const lock = JSON.parse(await readFile(join(cwd, tileflowIconsLockfileName), 'utf8'));
  assert.equal(lock.sets['@acme/brand'].spriteUrl, pin().spriteUrl);

  // A downloaded lock is data, not permission to contact its origin.
  const denied = await runCli(cwd, ['validate', '--cache-dir', join(cwd, 'untrusted'), '--json']);
  assert.equal(denied.code, 1);
  assert.equal(downloads, 0);

  const validated = await runCli(
    cwd,
    ['validate', '--api-base-url', origin, '--cache-dir', join(cwd, 'validated'), '--json'],
    'http://127.0.0.1:1',
  );
  assert.equal(validated.code, 0, `${validated.stdout}\n${validated.stderr}`);
  assert.equal(JSON.parse(validated.stdout).ok, true);
  assert.equal(downloads, 4);

  const built = await runCli(cwd, ['build', '--cache-dir', join(cwd, 'built'), '--json'], origin);
  assert.equal(built.code, 0, `${built.stdout}\n${built.stderr}`);
  assert.equal(JSON.parse(built.stdout).ok, true);
  assert.equal(downloads, 8);
  assert.deepEqual(failures, []);
});

function runCli(cwd: string, args: string[], apiOrigin?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    TILEFLOW_ICON_CACHE_DIR: join(cwd, 'default-cache'),
  };
  for (const name of [
    'TILEFLOW_API_KEY',
    'TILEFLOW_API_URL',
    'CI',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
  ]) {
    delete env[name];
  }
  if (apiOrigin !== undefined) env.TILEFLOW_API_URL = apiOrigin;
  return new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(process.execPath, cliFixtureArguments(args), {cwd, env});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({code, stdout, stderr}));
  });
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
