import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {tileflowMapFixture} from './map-fixture';

const cliEntry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const tsxLoader = import.meta.resolve('tsx');
const fakeApiKey = `tf_live_${'a'.repeat(48)}`;
const accountSessionToken = `tf_session_${'b'.repeat(64)}`;

test('World promotion auto-selects one map, fixes session mode, and writes a managed manifest', async (t) => {
  const fixture = await createFixture(t);
  let requestBody: Record<string, unknown> | null = null;
  const api = await createFakeApi(t, async (request) => {
    requestBody = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
    return {
      changed: true,
      deploymentId: 'dep_managed',
      mapId: 'map_managed',
      mapUrl: 'https://api.example.test/maps/map_managed/style.json',
      styleId: 'sty_managed',
      version: 1,
      worldPromotionId: 'wpr_12345678',
    };
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--world-promotion',
      'wpr_12345678',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(requestBody?.worldPromotionId, 'wpr_12345678');
  assert.equal(requestBody?.usageMode, 'session');
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: {madrid: Record<string, unknown>};
  };
  assert.equal(manifest.maps.madrid.mapId, 'map_managed');
  assert.equal(manifest.maps.madrid.usageMode, 'session');
  assert.equal(manifest.maps.madrid.worldGeneration, 'v1');
  assert.equal('worldPromotionId' in manifest.maps.madrid, false);
  assert.doesNotMatch(await readFile(fixture.manifestPath, 'utf8'), /wpr_12345678/u);
});

test('World promotion rejects a mismatched --map before network work', async (t) => {
  const fixture = await createFixture(t);
  let requests = 0;
  const api = await createFakeApi(t, async () => {
    requests += 1;
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--world-promotion',
      'wpr_12345678',
      '--map',
      'lisbon',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 0);
  assert.match(result.stdout, /Unknown Tileflow map for World promotion: lisbon/u);
  assert.match(result.stdout, /madrid/u);
  await assert.rejects(() => readFile(fixture.manifestPath, 'utf8'), {code: 'ENOENT'});
});

test('World promotion deploys only the selected map and preserves unrelated manifest entries', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'lisbon',
    }),
  );
  const requests: Record<string, unknown>[] = [];
  const api = await createFakeApi(t, async (request) => {
    const body = JSON.parse(await readRequestBody(request)) as Record<string, unknown>;
    requests.push(body);
    return {
      mapId: 'map_lisbon',
      mapUrl: 'https://api.example.test/maps/map_lisbon/style.json',
      styleId: 'sty_lisbon',
      worldPromotionId: 'wpr_12345678',
    };
  });
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify({
      apiUrl: api.url,
      kind: 'hosted',
      maps: {
        madrid: {
          environment: 'madrid',
          mapId: 'map_existing',
          styleId: 'style_existing',
          styleUrl: 'https://api.example.test/maps/map_existing/style.json',
        },
      },
      styles: {madrid: 'https://api.example.test/maps/map_existing/style.json'},
      version: 3,
    })}\n`,
  );
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--world-promotion',
      'wpr_12345678',
      '--map',
      'lisbon',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.environment, 'lisbon');
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: Record<string, {mapId: string}>;
  };
  assert.equal(manifest.maps.madrid?.mapId, 'map_existing');
  assert.equal(manifest.maps.lisbon?.mapId, 'map_lisbon');
});

test('deploy sends CI provenance but keeps it and the bearer key out of the manifest', async (t) => {
  const fixture = await createFixture(t);
  const observedSecretPath = join(fixture.directory, 'config-observed-secret.txt');
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      icons: 'official',
      imports: `import {writeFileSync} from 'node:fs';`,
      setup: `writeFileSync(${JSON.stringify(observedSecretPath)}, process.env.TILEFLOW_API_KEY ?? 'missing');`,
      fields: `delivery: {hosted: {allowedOrigins: ['https://maps.example.test']}},
name: 'Madrid',
view: {center: [-3.7, 40.4], zoom: 11}`,
    }),
    'utf8',
  );
  let requestBody: unknown;
  let authorization: string | undefined;
  const api = await createFakeApi(t, async (request) => {
    authorization = request.headers.authorization;
    if (request.method === 'PUT') {
      const body = await readRequestBodyBytes(request);
      return iconPackageResponseFromMultipart(
        request,
        body,
        'https://api.example.test',
        'icp_1234567890abcdef',
      );
    }
    requestBody = JSON.parse(await readRequestBody(request));
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF_NAME: 'main',
      GITHUB_REPOSITORY: 'tileflow/maps',
      GITHUB_RUN_ID: '42',
      GITHUB_SERVER_URL: 'https://github.example.test',
      GITHUB_SHA: '0123456789abcdef',
      TILEFLOW_API_KEY: fakeApiKey,
    },
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Published madrid\./);
  assert.equal(authorization, `Bearer ${fakeApiKey}`);
  assert.deepEqual((requestBody as {source?: unknown}).source, {
    kind: 'github_actions',
    ref: 'main',
    repository: 'tileflow/maps',
    revision: '0123456789abcdef',
    runId: '42',
    runUrl: 'https://github.example.test/tileflow/maps/actions/runs/42',
  });
  assert.equal((requestBody as {iconPackage?: {label?: unknown}}).iconPackage?.label, 'madrid');
  assert.deepEqual((requestBody as {policy?: unknown}).policy, {
    allowedOrigins: ['https://maps.example.test'],
  });
  assert.equal(
    (requestBody as {artifact?: {style?: {sprite?: unknown}}}).artifact?.style?.sprite,
    'https://api.example.test/sprites/icp_1234567890abcdef/sprite',
  );

  const manifest = await readFile(fixture.manifestPath, 'utf8');
  assert.deepEqual((JSON.parse(manifest) as {maps: {madrid: {view?: unknown}}}).maps.madrid.view, {
    center: [-3.7, 40.4],
    zoom: 11,
  });
  assert.equal(await readFile(observedSecretPath, 'utf8'), 'missing');
  assert.doesNotMatch(manifest, /github_actions|tileflow\/maps|0123456789abcdef/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}\n${manifest}`, new RegExp(fakeApiKey));
});

test('deploy reports an idempotent hosted no-op without changing the manifest contract', async (t) => {
  const fixture = await createFixture(t);
  const api = await createFakeApi(t, async () => undefined, {
    changed: false,
    deploymentId: 'dep_existing',
    mapId: 'map_test',
    mapUrl: 'https://api.example.test/maps/map_test/style.json',
    styleId: 'sty_test',
    version: 7,
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Unchanged madrid \(v7\)\./);
  assert.doesNotMatch(result.stdout, /Published madrid/);
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: {madrid: {styleUrl: string}};
  };
  assert.equal(manifest.maps.madrid.styleUrl, 'https://api.example.test/maps/map_test/style.json');
  assert.equal('deploymentId' in manifest.maps.madrid, false);
  assert.equal('version' in manifest.maps.madrid, false);
});

test('deploy reports a changed hosted version while accepting additive response fields', async (t) => {
  const fixture = await createFixture(t);
  const api = await createFakeApi(t, async () => undefined, {
    changed: true,
    deploymentId: 'dep_new',
    mapId: 'map_test',
    mapUrl: 'https://api.example.test/maps/map_test/style.json',
    styleId: 'sty_test',
    version: 8,
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Published madrid \(v8\)\./);
});

test('a failed singular deploy preserves the previous manifest and a retry converges', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'beta',
    }),
  );
  let failBeta = true;
  const published = new Set<string>();
  const attempts: string[] = [];
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readRequestBody(request)) as {environment: string};
    attempts.push(body.environment);
    if (failBeta) {
      response.writeHead(503, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({error: 'temporary beta failure'}));
      return;
    }
    const changed = !published.has(body.environment);
    published.add(body.environment);
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(
      JSON.stringify({
        changed,
        mapId: `map_${body.environment}`,
        mapUrl: `https://cdn.example.test/maps/map_${body.environment}/style.json`,
        styleId: `style_${body.environment}`,
      }),
    );
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
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const originalManifest = `${JSON.stringify({
    apiUrl,
    kind: 'hosted',
    maps: {
      previous: {
        environment: 'previous',
        mapId: 'map_previous',
        styleUrl: 'https://cdn.example.test/maps/map_previous/style.json',
      },
    },
    styles: {previous: 'https://cdn.example.test/maps/map_previous/style.json'},
    version: 3,
  })}\n`;
  await writeFile(fixture.manifestPath, originalManifest);

  const first = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      apiUrl,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(first.code, 1);
  assert.deepEqual(attempts, ['beta'], `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /Deploy failed for beta: 503/u);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);

  failBeta = false;
  const retry = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      apiUrl,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(retry.code, 0, `${retry.stdout}\n${retry.stderr}`);
  assert.deepEqual(attempts, ['beta', 'beta']);
  assert.match(retry.stdout, /Published beta/u);
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    kind: string;
    maps: Record<string, {mapId: string}>;
  };
  assert.equal(manifest.kind, 'hosted');
  assert.equal(manifest.maps.beta?.mapId, 'map_beta');
  assert.deepEqual(Object.keys(manifest.maps), ['beta']);
});

test('deploy refuses a self-hosted manifest unless replacement is explicit', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify({
      kind: 'self-hosted',
      maps: {madrid: '/tileflow/styles/madrid.json'},
      styles: {madrid: '/tileflow/styles/madrid.json'},
      version: 3,
    })}\n`,
  );
  let requests = 0;
  const api = await createFakeApi(t, async () => {
    requests += 1;
  });

  const refused = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(refused.code, 1);
  assert.equal(requests, 0);
  assert.match(refused.stdout, /Refusing to replace a self-hosted Tileflow manifest/u);

  const replaced = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--overwrite-self-hosted-manifest',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(replaced.code, 0, `${replaced.stdout}\n${replaced.stderr}`);
  assert.equal(requests, 1);
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {kind: string};
  assert.equal(manifest.kind, 'hosted');
});

test('hosted validation compiles local icons offline without credentials', async (t) => {
  const fixture = await createIconFixture(t);
  const result = await runCli(
    fixture.directory,
    ['validate', '--target', 'hosted', '--config', fixture.configPath],
    {TILEFLOW_API_URL: 'http://127.0.0.1:1'},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Icon asset closure/);
  assert.match(result.stdout, /Hosted compatibility/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /API key|login/);
});

test('plain validation now reports missing local icon sources', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      icons: 'authored',
      fields: `icons: ['./missing-icons']`,
    }),
  );
  const result = await runCli(
    fixture.directory,
    ['validate', '--config', 'tileflow.config.ts'],
    {},
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /maps\.madrid\.icons\.0/);
  assert.match(result.stdout, /not found/);
});

test('validation rejects removed raw style overrides at the config boundary', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      fields: `overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]`,
    }),
  );
  const result = await runCli(
    fixture.directory,
    ['validate', '--config', 'tileflow.config.ts'],
    {},
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /overrides/u);
  assert.match(result.stdout, /unrecognized key "overrides"/u);
  assert.doesNotMatch(result.stdout, /Config is valid|MapLibre style semantics/);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(fixture.directory), false);
});

test('deploy rejects removed raw style overrides before any remote write', async (t) => {
  const fixture = await createIconFixture(t);
  const originalManifest = '{"sentinel":"invalid-style"}\n';
  await writeFile(fixture.manifestPath, originalManifest);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      icons: 'authored',
      fields: `icons: ['./icons'],
modules: {poi: {type: 'poi', icons: 'essential', categories: ['food']}, roads: {type: 'roads', enabled: false}},
overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]`,
    }),
  );
  let requests = 0;
  const api = await createFakeApi(t, async () => {
    requests += 1;
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--project',
      '@acme/web',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 0);
  assert.match(result.stdout, /overrides/u);
  assert.match(result.stdout, /unrecognized key "overrides"/u);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('deploy rejects external vector data before any remote write', async (t) => {
  const fixture = await createFixture(t);
  const originalManifest = '{"sentinel":"external-data"}\n';
  await writeFile(fixture.manifestPath, originalManifest);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      fields: `data: {
    type: 'vector-tiles',
    attribution: '© Example © OpenStreetMap contributors',
    schema: {type: 'openmaptiles', contractVersion: 1},
    url: 'https://vector.example.test/tiles.json'
  }`,
    }),
  );
  let requests = 0;
  const api = await createFakeApi(t, async () => {
    requests += 1;
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 0);
  assert.match(result.stdout, /Hosted deploy supports only Tileflow World data/);
  assert.match(result.stdout, /Map madrid uses an external vector dataset/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('deploy uploads package-owned Cyberpunk fonts before binding and publishing the style', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    "import {defineMap} from '@tileflow/core'; import {cyberpunk} from '@tileflow/maps'; export default defineMap({id:'night',name:'Night',version:1,extends:cyberpunk});\n",
  );
  const requests: string[] = [];
  const api = await createFakeApi(t, async (request) => {
    requests.push(`${request.method} ${request.url?.split('/').slice(0, 3).join('/')}`);
    const bodyBytes = await readRequestBodyBytes(request);
    const body = bodyBytes.toString('utf8');
    const contentHash = request.url?.split('/').pop() ?? '';
    if (request.url?.startsWith('/v1/icon-packages/')) {
      return iconPackageResponseFromMultipart(request, bodyBytes, api.url, 'icp_cyberpunk_123456');
    }
    if (request.url?.startsWith('/v1/font-bundles/')) {
      const bundleId = 'fnb_1234567890abcdef';
      assert.match(request.headers['content-type'] ?? '', /^multipart\/form-data; boundary=/u);
      const manifest = fontBundleManifestFromMultipart(body);
      assert.equal(manifest.format, 'tileflow-font-bundle-v1');
      assert.equal(manifest.fontFaces.length, 2);
      assert.ok(manifest.files.some((file) => file.kind === 'license'));
      assert.ok(
        manifest.files.every((file) =>
          body.includes(`name="file:${encodeURIComponent(file.name)}"`),
        ),
      );
      return {
        baseUrl: `${api.url}/font-bundles/${bundleId}`,
        changed: true,
        contentHash,
        fontFaceCount: manifest.fontFaces.length,
        id: bundleId,
        totalBytes: manifest.files.reduce((total, file) => total + file.byteLength, 0),
      };
    }

    const parsed = JSON.parse(body) as Record<string, unknown>;
    const artifact = parsed.artifact as {
      buildManifest: {
        maps: Record<
          string,
          {assetSetSha256: string; sourceAssets: {fonts: Array<{sha256: string}>}}
        >;
      };
      mapId: string;
      schemaVersion: number;
      style: {metadata?: Record<string, unknown>};
    };
    const binding = parsed.fontBundle as {contentHash: string};
    const faces = artifact.style.metadata?.['tileflow:fontFaces'] as Array<{source: string}>;
    assert.equal(artifact.schemaVersion, 2);
    assert.equal(artifact.mapId, 'night');
    assert.match(binding.contentHash, /^[a-f0-9]{64}$/u);
    assert.equal(artifact.buildManifest.maps.night?.sourceAssets.fonts.length, 2);
    assert.match(artifact.buildManifest.maps.night?.assetSetSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.ok(
      faces.every((face) =>
        face.source.startsWith(`${api.url}/font-bundles/fnb_1234567890abcdef/fonts/`),
      ),
    );
    return {
      changed: true,
      mapId: 'map_night',
      mapUrl: 'https://api.example.test/maps/map_night/style.json',
      styleId: 'sty_night',
      version: 1,
    };
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(requests, ['PUT /v1/icon-packages', 'PUT /v1/font-bundles', 'POST /v1/styles']);
  assert.match(result.stdout, /Uploaded font bundle \(2 faces,/u);
  assert.match(result.stdout, /Published night \(v1\)\./u);
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: {night: {mapId: string}};
  };
  assert.equal(manifest.maps.night.mapId, 'map_night');
});

test('deploy uploads generated icon files before posting sanitized style JSON', async (t) => {
  const fixture = await createIconFixture(t);
  const requests: Array<{body: string; method?: string; url?: string}> = [];
  const api = await createFakeApi(t, async (request) => {
    const bodyBytes = await readRequestBodyBytes(request);
    const body = bodyBytes.toString('utf8');
    requests.push({body, method: request.method, url: request.url});

    if (request.method === 'PUT') {
      assert.match(request.headers['content-type'] ?? '', /^multipart\/form-data; boundary=/);
      for (const field of ['spriteJson', 'spritePng', 'sprite2xJson', 'sprite2xPng']) {
        assert.match(body, new RegExp(`name="${field}"`));
      }
      assert.doesNotMatch(body, /source-secret|<svg|\.\/icons/);
      return iconPackageResponseFromMultipart(
        request,
        bodyBytes,
        api.url,
        'icp_12345678-1234-1234-1234-123456789abc',
      );
    }

    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.equal('icons' in parsed, false);
    const artifact = parsed.artifact as {
      buildManifest?: {
        maps?: Record<
          string,
          {
            lineage?: Array<{id: string; mapVersion: number}>;
            mapVersion?: number;
            recipe?: {compiler?: string; compilerVersion?: number};
            styleSha256?: string;
          }
        >;
        provenance?: Record<string, unknown>;
        schemaVersion?: number;
      };
      mapId?: string;
      schemaVersion?: number;
      style?: {layers?: Array<{id?: string; layout?: Record<string, unknown>}>; sprite?: unknown};
    };
    const mapEntry = artifact.buildManifest?.maps?.madrid;
    assert.equal(artifact.mapId, 'madrid');
    assert.equal(artifact.schemaVersion, 2);
    assert.equal(artifact.buildManifest?.schemaVersion, 1);
    assert.equal(mapEntry?.mapVersion, 1);
    assert.equal(mapEntry?.recipe?.compiler, 'streets');
    assert.equal(mapEntry?.recipe?.compilerVersion, 1);
    assert.deepEqual(
      mapEntry?.lineage?.map((node) => node.id),
      ['madrid', 'streets'],
    );
    assert.equal(typeof mapEntry?.styleSha256, 'string');
    assert.ok(artifact.buildManifest?.provenance);
    assert.equal(
      artifact.style?.sprite,
      `${api.url}/sprites/icp_12345678-1234-1234-1234-123456789abc/sprite`,
    );
    const foodPoiLayer = artifact.style?.layers?.find(
      (layer) => layer.id === 'streets-poi-food-icon',
    );
    assert.equal(foodPoiLayer?.layout?.['icon-image'], 'food');
    assert.deepEqual(parsed.iconPackage, {
      contentHash: requests[0]?.url?.split('/').pop(),
      label: 'madrid',
    });
    assert.doesNotMatch(JSON.stringify(artifact), /\.\/icons|source-secret/);
    return {
      changed: true,
      mapId: 'map_test',
      mapUrl: 'https://api.example.test/maps/map_test/style.json',
      styleId: 'sty_test',
      version: 1,
    };
  });
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(
    requests.map((request) => `${request.method} ${request.url?.split('/').slice(0, 3).join('/')}`),
    [`PUT /v1/icon-packages`, `POST /v1/styles`],
  );
  assert.match(result.stdout, /Uploaded icon package madrid \(2 icons,/);
  assert.match(result.stdout, /Published madrid \(v1\)\./);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(fakeApiKey));
});

test('a failed icon upload makes no style request and does not rewrite the manifest', async (t) => {
  const fixture = await createIconFixture(t);
  let requests = 0;
  const api = await createFailingIconApi(t, () => {
    requests += 1;
  });
  const originalManifest = existingHostedManifest(api.url);
  await writeFile(fixture.manifestPath, originalManifest);
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.match(result.stdout, /Icon package upload failed: 503/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('a style failure after icon upload also preserves the previous manifest', async (t) => {
  const fixture = await createIconFixture(t);
  const methods: string[] = [];
  const api = await createStyleFailingAfterIconApi(t, (method) => methods.push(method));
  const originalManifest = existingHostedManifest(api.url);
  await writeFile(fixture.manifestPath, originalManifest);
  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Deploy failed for madrid: 503/);
  assert.deepEqual(methods, ['PUT', 'POST']);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('CI deploy runs local config preflight before failing closed on saved credentials', async (t) => {
  const fixture = await createFixture(t);
  const configMarkerPath = join(fixture.directory, 'config-was-imported.txt');
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      imports: `import {writeFileSync} from 'node:fs';`,
      setup: `writeFileSync(${JSON.stringify(configMarkerPath)}, 'imported');`,
      fields: `name: 'Madrid'`,
    }),
    'utf8',
  );
  let requests = 0;
  const api = await createFakeApi(t, async () => {
    requests += 1;
  });
  const authDirectory = join(fixture.directory, '.tileflow');
  await mkdir(authDirectory, {recursive: true});
  await writeFile(
    join(authDirectory, 'config.json'),
    `${JSON.stringify({
      sessions: {
        [api.url]: {
          account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
          accountSession: `tf_session_${'b'.repeat(64)}`,
          apiOrigin: api.url,
          createdAt: '2026-08-15T00:00:00.000Z',
          expiresAt: '2026-12-01T00:00:00.000Z',
          sessionId: 'cli_session_ada',
        },
      },
      version: 2,
    })}\n`,
    'utf8',
  );

  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {
      CI: 'true',
      HOME: fixture.directory,
      USERPROFILE: fixture.directory,
    },
  );

  assert.equal(result.code, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /explicit application-scoped Tileflow API key/,
  );
  assert.match(`${result.stdout}\n${result.stderr}`, /TILEFLOW_API_KEY/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /tileflow login/);
  assert.equal(requests, 0);
  assert.equal(await readFile(configMarkerPath, 'utf8'), 'imported');
});

test('an ambiguous account-session deploy authenticates after local config preflight', async (t) => {
  const fixture = await createFixture(t);
  const configMarkerPath = join(fixture.directory, 'ambiguous-config-imported.txt');
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      imports: `import {writeFileSync} from 'node:fs';`,
      setup: `writeFileSync(${JSON.stringify(configMarkerPath)}, 'imported');`,
      fields: `name: 'Madrid'`,
    }),
  );
  let requests = 0;
  const api = await createFakeApi(t, async (request) => {
    requests += 1;
    assert.match(request.url ?? '', /^\/v1\/cli\/projects\?/u);
    assert.equal(request.headers.authorization, `Bearer ${accountSessionToken}`);
    return {
      items: [accountProjectTarget('acme', 'web'), accountProjectTarget('acme', 'worker')],
      nextCursor: null,
      schemaVersion: 1,
    };
  });
  await writeAccountSession(fixture.directory, api.url);

  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
    ],
    {HOME: fixture.directory, USERPROFILE: fixture.directory},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.match(result.stdout, /Managed destination is ambiguous: @acme\/web, @acme\/worker/);
  const expectedRetry = [
    'tileflow',
    'deploy',
    '--config',
    fixture.configPath,
    '--manifest',
    fixture.manifestPath,
    '--api-url',
    api.url,
    '--project',
    '@acme/web',
  ]
    .map(quoteExpectedCliArgument)
    .join(' ');
  assert.ok(result.stdout.includes(expectedRetry), result.stdout);
  assert.equal(await readFile(configMarkerPath, 'utf8'), 'imported');
});

test('one account session exchanges a visible target for a brief deploy capability', async (t) => {
  const fixture = await createFixture(t);
  const observedSecretPath = join(fixture.directory, 'account-config-observed-secret.txt');
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      imports: `import {writeFileSync} from 'node:fs';`,
      setup: `writeFileSync(${JSON.stringify(observedSecretPath)}, process.env.TILEFLOW_API_KEY ?? 'missing');`,
      fields: `name: 'Madrid'`,
    }),
  );
  const capability = `tf_cap_${'c'.repeat(96)}`;
  const requests: string[] = [];
  const api = await createFakeApi(t, async (request) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url?.startsWith('/v1/cli/projects?')) {
      assert.equal(request.headers.authorization, `Bearer ${accountSessionToken}`);
      return {
        items: [accountProjectTarget('acme', 'web'), accountProjectTarget('acme', 'worker')],
        nextCursor: null,
        schemaVersion: 1,
      };
    }
    if (request.url === '/v1/cli/project-capabilities') {
      assert.equal(request.headers.authorization, `Bearer ${accountSessionToken}`);
      assert.deepEqual(JSON.parse(await readRequestBody(request)), {
        project: '@acme/web',
        scopes: ['styles:write'],
      });
      return {
        capability,
        expiresAt: '2026-08-15T23:59:00.000Z',
        reference: '@acme/web',
        schemaVersion: 1,
        scopes: ['styles:write'],
      };
    }
    assert.equal(request.url, '/v1/styles');
    assert.equal(request.headers.authorization, `Bearer ${capability}`);
    await readRequestBody(request);
    return {
      mapId: 'map_test',
      mapUrl: 'https://api.example.test/maps/map_test/style.json',
      styleId: 'sty_test',
    };
  });
  await writeAccountSession(fixture.directory, api.url);

  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--project',
      '@acme/web',
    ],
    {HOME: fixture.directory, USERPROFILE: fixture.directory},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests, [
    'GET /v1/cli/projects?includeArchived=false&limit=100',
    'POST /v1/cli/project-capabilities',
    'POST /v1/styles',
  ]);
  assert.equal(await readFile(observedSecretPath, 'utf8'), 'missing');
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}\n${await readFile(fixture.manifestPath, 'utf8')}`,
    new RegExp(`${accountSessionToken}|${capability}`),
  );
});

test('an explicit project key rejects a mismatched --project after local config preflight', async (t) => {
  const fixture = await createFixture(t);
  const configMarkerPath = join(fixture.directory, 'mismatch-config-imported.txt');
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      imports: `import {writeFileSync} from 'node:fs';`,
      setup: `writeFileSync(${JSON.stringify(configMarkerPath)}, 'imported');`,
      fields: `name: 'Madrid'`,
    }),
  );
  let requests = 0;
  const api = await createFakeApi(t, async (request) => {
    requests += 1;
    assert.equal(request.url, '/v1/me');
    assert.equal(request.headers.authorization, `Bearer ${fakeApiKey}`);
    return {
      apiKeyId: 'key_test',
      credentialType: 'project_api_key',
      organization: {id: 'org_acme', name: 'Acme', slug: 'acme'},
      project: {id: 'prj_web', name: 'Web', slug: 'web'},
      projectId: 'prj_web',
      scopes: ['styles:write'],
    };
  });

  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      api.url,
      '--project',
      '@acme/other',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 1);
  assert.match(result.stdout, /belongs to @acme\/web, not @acme\/other/);
  assert.equal(await readFile(configMarkerPath, 'utf8'), 'imported');
});

test('/v1/me validation returns one canonical project property', async () => {
  const source = await readFile(new URL('../src/hosted-client.ts', import.meta.url), 'utf8');
  const validator = source.slice(
    source.indexOf('export async function validateApiKey'),
    source.indexOf('function isProjectIdentity'),
  );
  assert.equal(validator.match(/project: body\.project/gu)?.length, 1);
});

test('validate --target hosted shares deploy rejection of external vector data', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      fields: `data: {
    type: 'vector-tiles',
    attribution: '© Example © OpenStreetMap contributors',
    schema: {type: 'openmaptiles', contractVersion: 1},
    url: 'https://vector.example.test/tiles.json'
  }`,
    }),
  );

  const result = await runCli(
    fixture.directory,
    ['validate', '--target', 'hosted', '--config', fixture.configPath],
    {TILEFLOW_API_URL: 'http://127.0.0.1:1'},
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Hosted deploy supports only Tileflow World data/);
  assert.match(result.stdout, /Map madrid uses an external vector dataset/);
  assert.doesNotMatch(result.stdout, /Config is valid|Hosted compatibility/);
});

test('executable config cannot read ambient or argv API keys and the diagnostic stays secret-free', async (t) => {
  const fixture = await createFixture(t);
  const observedPath = join(fixture.directory, 'observed-config-process.json');
  const ambientSecret = `tf_live_${'e'.repeat(48)}`;
  const argumentSecret = `tf_live_${'f'.repeat(48)}`;
  await writeFile(
    fixture.configPath,
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(observedPath)}, JSON.stringify({
  apiKey: process.env.TILEFLOW_API_KEY ?? null,
  argv: process.argv
}));
throw new Error('config stopped after observing its process');
`,
  );

  const result = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      'http://127.0.0.1:1',
      '--api-key',
      argumentSecret,
    ],
    {TILEFLOW_API_KEY: ambientSecret},
  );

  assert.equal(result.code, 1);
  const observed = JSON.parse(await readFile(observedPath, 'utf8')) as {
    apiKey: string | null;
    argv: string[];
  };
  assert.equal(observed.apiKey, null);
  assert.equal(observed.argv.includes('--api-key'), false);
  assert.equal(
    observed.argv.some((argument) => argument.includes(argumentSecret)),
    false,
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(ambientSecret));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(argumentSecret));
});

test('invalid hosted deploy and status responses fail closed and preserve the manifest', async (t) => {
  const fixture = await createFixture(t);
  const deployApi = await createFakeApi(t, async () => undefined, {
    mapId: 'map_test',
    mapUrl: 'javascript:alert(1)',
  });
  const originalManifest = existingHostedManifest(deployApi.url);
  await writeFile(fixture.manifestPath, originalManifest);
  const deploy = await runCli(
    fixture.directory,
    [
      'deploy',
      '--config',
      fixture.configPath,
      '--manifest',
      fixture.manifestPath,
      '--api-url',
      deployApi.url,
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(deploy.code, 1);
  assert.match(deploy.stdout, /Deploy response for madrid returned an invalid response/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);

  const statusApi = await createFakeApi(t, async () => undefined, {
    projectId: 'prj_test',
    styles: 'invalid',
  });
  const status = await runCli(
    fixture.directory,
    ['status', '--json', '--api-url', statusApi.url, '--api-key', fakeApiKey],
    {},
  );
  assert.equal(status.code, 1);
  assert.equal(status.stdout, '');
  assert.match(status.stderr, /Status response returned an invalid response/);
  assert.doesNotMatch(`${status.stdout}\n${status.stderr}`, new RegExp(fakeApiKey));

  const unauthenticatedStatus = await runCli(
    fixture.directory,
    ['status', '--json', '--api-url', 'https://api.example.test'],
    {HOME: fixture.directory, USERPROFILE: fixture.directory},
  );
  assert.equal(unauthenticatedStatus.code, 1);
  assert.equal(unauthenticatedStatus.stdout, '');
  assert.match(unauthenticatedStatus.stderr, /^Status authentication failed\.\n$/u);
});

function accountProjectTarget(organizationSlug: string, projectSlug: string) {
  return {
    organization: {
      id: `org_${organizationSlug}`,
      name: organizationSlug[0].toUpperCase() + organizationSlug.slice(1),
      slug: organizationSlug,
    },
    project: {
      archivedAt: null,
      createdAt: '2026-08-15T00:00:00.000Z',
      id: `prj_${projectSlug}`,
      name: projectSlug[0].toUpperCase() + projectSlug.slice(1),
      slug: projectSlug,
      updatedAt: '2026-08-15T00:00:00.000Z',
    },
    reference: `@${organizationSlug}/${projectSlug}`,
  };
}

function quoteExpectedCliArgument(value: string) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function writeAccountSession(home: string, apiUrl: string) {
  const authDirectory = join(home, '.tileflow');
  await mkdir(authDirectory, {recursive: true});
  await writeFile(
    join(authDirectory, 'config.json'),
    `${JSON.stringify({
      sessions: {
        [apiUrl]: {
          account: {email: 'ada@example.test', id: 'usr_ada', name: 'Ada'},
          accountSession: accountSessionToken,
          apiOrigin: apiUrl,
          createdAt: '2026-08-15T00:00:00.000Z',
          expiresAt: '2026-12-01T00:00:00.000Z',
          sessionId: 'cli_session_ada',
        },
      },
      version: 2,
    })}\n`,
    {mode: 0o600},
  );
}

function existingHostedManifest(apiUrl: string): string {
  const styleUrl = 'https://styles.example.test/existing.json';
  return `${JSON.stringify({
    apiUrl,
    kind: 'hosted',
    maps: {
      existing: {environment: 'existing', mapId: 'map_existing', styleUrl},
    },
    styles: {existing: styleUrl},
    version: 3,
  })}\n`;
}

async function createFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-cli-adversarial-'));
  await linkWorkspacePackages(directory);
  const configPath = join(directory, 'tileflow.config.ts');
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(
    configPath,
    tileflowMapFixture({
      id: 'madrid',
      fields: `name: 'Madrid'`,
    }),
    'utf8',
  );
  t.after(() => rm(directory, {force: true, recursive: true}));

  return {configPath, directory, manifestPath};
}

async function createIconFixture(t: TestContext) {
  const fixture = await createFixture(t);
  const iconsDirectory = join(fixture.directory, 'icons');
  await mkdir(iconsDirectory);
  await writeFile(
    join(iconsDirectory, 'food.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle id="source-secret" cx="8" cy="8" r="7" /></svg>',
  );
  await writeFile(
    join(iconsDirectory, 'park.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" /></svg>',
  );
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      icons: 'authored',
      fields: `icons: ['./icons'],
modules: {poi: {type: 'poi', icons: 'essential', categories: ['food']}, roads: {type: 'roads', enabled: false}},
name: 'Madrid'`,
    }),
  );
  return fixture;
}

async function createFakeApi(
  t: TestContext,
  inspectRequest: (
    request: import('node:http').IncomingMessage,
  ) => Promise<Record<string, unknown> | void>,
  result: Record<string, unknown> = {
    mapId: 'map_test',
    mapUrl: 'https://api.example.test/maps/map_test/style.json',
    styleId: 'sty_test',
  },
) {
  const server = createServer(async (request, response) => {
    try {
      const requestResult = await inspectRequest(request);
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(JSON.stringify(requestResult ?? result));
    } catch (error) {
      response.writeHead(500, {'Content-Type': 'application/json'});
      response.end(JSON.stringify({error: error instanceof Error ? error.message : 'test error'}));
    }
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

  return {url: `http://127.0.0.1:${address.port}`};
}

async function createFailingIconApi(t: TestContext, inspect: () => void) {
  const server = createServer((request, response) => {
    inspect();
    request.resume();
    assert.equal(request.method, 'PUT');
    assert.match(request.url ?? '', /^\/v1\/icon-packages\/[a-f0-9]{64}$/);
    response.writeHead(503, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({error: 'storage unavailable'}));
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
  return {url: `http://127.0.0.1:${address.port}`};
}

async function createStyleFailingAfterIconApi(t: TestContext, inspect: (method: string) => void) {
  const server = createServer(async (request, response) => {
    const method = request.method ?? '';
    inspect(method);
    const body = await readRequestBodyBytes(request);

    if (method === 'PUT') {
      const id = 'icp_12345678-1234-1234-1234-123456789abc';
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(
        JSON.stringify(
          await iconPackageResponseFromMultipart(request, body, 'https://api.example.test', id),
        ),
      );
      return;
    }

    response.writeHead(503, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({error: 'style storage unavailable'}));
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
  return {url: `http://127.0.0.1:${address.port}`};
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
    'GITHUB_REF',
    'GITHUB_REF_NAME',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ID',
    'GITHUB_SERVER_URL',
    'GITHUB_SHA',
    'GITLAB_CI',
    'TILEFLOW_API_KEY',
    'TILEFLOW_API_URL',
    'TILEFLOW_DEPLOY_REF',
    'TILEFLOW_DEPLOY_REPOSITORY',
    'TILEFLOW_DEPLOY_REVISION',
    'TILEFLOW_DEPLOY_RUN_ID',
    'TILEFLOW_DEPLOY_RUN_URL',
  ]) {
    delete environment[variable];
  }

  Object.assign(environment, overrides, {NO_COLOR: '1'});

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

async function readRequestBody(request: import('node:http').IncomingMessage) {
  return (await readRequestBodyBytes(request)).toString('utf8');
}

async function readRequestBodyBytes(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function iconPackageResponseFromMultipart(
  request: import('node:http').IncomingMessage,
  body: Buffer,
  baseUrl: string,
  id: string,
) {
  const contentType = request.headers['content-type'];
  assert.equal(typeof contentType, 'string');
  const bodyCopy = new Uint8Array(body.byteLength);
  bodyCopy.set(body);
  const formData = await new Request('https://fixture.example.test/upload', {
    body: bodyCopy,
    headers: {'Content-Type': contentType},
    method: 'POST',
  }).formData();
  const fields = ['spriteJson', 'spritePng', 'sprite2xJson', 'sprite2xPng'] as const;
  const files = fields.map((field) => formData.get(field));
  assert.ok(files.every((file) => file instanceof Blob));
  const spriteJson = files[0];
  assert.ok(spriteJson instanceof Blob);
  const index = JSON.parse(await spriteJson.text()) as Record<string, unknown>;

  return {
    changed: true,
    contentHash: request.url?.split('/').pop(),
    iconCount: Object.keys(index).length,
    id,
    spriteUrl: `${baseUrl}/sprites/${id}/sprite`,
    totalBytes: files.reduce((total, file) => total + (file instanceof Blob ? file.size : 0), 0),
  };
}

function fontBundleManifestFromMultipart(body: string): {
  files: Array<{byteLength: number; kind: 'font' | 'license'; name: string}>;
  fontFaces: Array<Record<string, unknown>>;
  format: string;
} {
  const match = body.match(
    /name="manifest"; filename="manifest\.json"\r\nContent-Type: application\/json\r\n\r\n([^\r]+)\r\n--/u,
  );
  assert.ok(match?.[1], 'multipart request must contain a canonical manifest file');
  return JSON.parse(match[1]) as {
    files: Array<{byteLength: number; kind: 'font' | 'license'; name: string}>;
    fontFaces: Array<Record<string, unknown>>;
    format: string;
  };
}
