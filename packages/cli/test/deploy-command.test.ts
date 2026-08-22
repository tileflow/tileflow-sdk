import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';

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

test('World promotion requires --map before network work for a multi-map config', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    `export default {maps: {
      madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, modules: {poi: {type: 'poi', icons: false}}},
      lisbon: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, modules: {poi: {type: 'poi', icons: false}}}
    }};\n`,
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
      '--world-promotion',
      'wpr_12345678',
    ],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(requests, 0);
  assert.match(result.stdout, /requires an explicit map/u);
  assert.match(result.stdout, /lisbon, madrid|madrid, lisbon/u);
  await assert.rejects(() => readFile(fixture.manifestPath, 'utf8'), {code: 'ENOENT'});
});

test('World promotion deploys only the selected map and preserves unrelated manifest entries', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    `export default {maps: {
      madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, modules: {poi: {type: 'poi', icons: false}}},
      lisbon: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, modules: {poi: {type: 'poi', icons: false}}}
    }};\n`,
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
      maps: {
        madrid: {
          environment: 'madrid',
          mapId: 'map_existing',
          styleUrl: 'https://api.example.test/maps/map_existing/style.json',
        },
      },
      styles: {madrid: 'https://api.example.test/maps/map_existing/style.json'},
      version: 2,
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
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(observedSecretPath)}, process.env.TILEFLOW_API_KEY ?? 'missing');
export default {maps: {madrid: {allowedOrigins: ['https://maps.example.test'], basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, name: 'Madrid'}}};
`,
    'utf8',
  );
  let requestBody: unknown;
  let authorization: string | undefined;
  const api = await createFakeApi(t, async (request) => {
    authorization = request.headers.authorization;
    if (request.method === 'PUT') {
      await readRequestBody(request);
      return {spriteUrl: 'https://api.example.test/sprites/tileflow-streets/sprite'};
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
  assert.equal(
    (requestBody as {iconPackage?: {label?: unknown}}).iconPackage?.label,
    'tileflow-streets',
  );
  assert.deepEqual((requestBody as {policy?: unknown}).policy, {
    allowedOrigins: ['https://maps.example.test'],
  });
  assert.equal(
    (requestBody as {artifact?: {style?: {sprite?: unknown}}}).artifact?.style?.sprite,
    'https://api.example.test/sprites/tileflow-streets/sprite',
  );

  const manifest = await readFile(fixture.manifestPath, 'utf8');
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

test('hosted validation compiles local icons offline without credentials', async (t) => {
  const fixture = await createIconFixture(t);
  const result = await runCli(
    fixture.directory,
    ['validate', '--target', 'hosted', '--config', fixture.configPath],
    {TILEFLOW_API_URL: 'http://127.0.0.1:1'},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Local icon package/);
  assert.match(result.stdout, /Hosted compatibility/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /API key|login/);
});

test('plain validation now reports missing local icon sources', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    `export default {maps: {madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, icons: {source: './missing-icons'}}}};\n`,
  );
  const result = await runCli(
    fixture.directory,
    ['validate', '--config', 'tileflow.config.ts'],
    {},
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /maps\.madrid\.icons\.source/);
  assert.match(result.stdout, /not found/);
});

test('validation rejects invalid MapLibre semantics with a stable layer path', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    `export default {maps: {madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]}}};\n`,
  );
  const result = await runCli(
    fixture.directory,
    ['validate', '--config', 'tileflow.config.ts'],
    {},
  );

  assert.equal(result.code, 1);
  assert.match(
    result.stdout,
    /maps\.madrid\.style\.layers\.streets-background\.paint\.background-color/,
  );
  assert.match(result.stdout, /color expected, number found/);
  assert.doesNotMatch(result.stdout, /Config is valid|MapLibre style semantics/);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(fixture.directory), false);
});

test('deploy rejects invalid MapLibre semantics before any remote write', async (t) => {
  const fixture = await createIconFixture(t);
  const originalManifest = '{"sentinel":"invalid-style"}\n';
  await writeFile(fixture.manifestPath, originalManifest);
  await writeFile(
    fixture.configPath,
    `export default {
  icons: {brand: {mapping: {restaurant: 'cafe'}, source: './icons'}},
  maps: {
    madrid: {
      basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
      icons: 'brand',
      overrides: [{kind: 'patch', id: 'streets-background', patch: {paint: {'background-color': 42}}}]
    }
  }
};\n`,
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
  assert.match(
    result.stdout,
    /maps\.madrid\.style\.layers\.streets-background\.paint\.background-color/,
  );
  assert.match(result.stdout, /color expected, number found/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('deploy rejects external vector data before any remote write', async (t) => {
  const fixture = await createFixture(t);
  const originalManifest = '{"sentinel":"external-data"}\n';
  await writeFile(fixture.manifestPath, originalManifest);
  await writeFile(
    fixture.configPath,
    `export default {maps: {madrid: {
  basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
  data: {
    type: 'vector-tiles',
    attribution: '© Example © OpenStreetMap contributors',
    schema: {type: 'openmaptiles', contractVersion: 1},
    url: 'https://vector.example.test/tiles.json'
  }
}}};\n`,
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

test('deploy uploads generated icon files before posting sanitized style JSON', async (t) => {
  const fixture = await createIconFixture(t);
  const requests: Array<{body: string; method?: string; url?: string}> = [];
  const api = await createFakeApi(t, async (request) => {
    const body = await readRequestBody(request);
    requests.push({body, method: request.method, url: request.url});

    if (request.method === 'PUT') {
      assert.match(request.headers['content-type'] ?? '', /^multipart\/form-data; boundary=/);
      for (const field of ['spriteJson', 'spritePng', 'sprite2xJson', 'sprite2xPng']) {
        assert.match(body, new RegExp(`name="${field}"`));
      }
      assert.doesNotMatch(body, /source-secret|<svg|\.\/icons/);
      const contentHash = request.url?.split('/').pop() ?? '';
      return {
        changed: true,
        contentHash,
        iconCount: 2,
        id: 'icp_12345678-1234-1234-1234-123456789abc',
        spriteUrl: `${api.url}/sprites/icp_12345678-1234-1234-1234-123456789abc/sprite`,
        totalBytes: body.length,
      };
    }

    const parsed = JSON.parse(body) as Record<string, unknown>;
    assert.equal('icons' in parsed, false);
    const artifact = parsed.artifact as {
      receipt?: Record<string, unknown>;
      style?: {layers?: Array<{id?: string; layout?: Record<string, unknown>}>; sprite?: unknown};
    };
    assert.equal(artifact.receipt?.basemap, 'streets');
    assert.equal(typeof artifact.receipt?.styleHash, 'string');
    assert.equal(Object.hasOwn(artifact.receipt ?? {}, 'provenance'), false);
    assert.equal(
      artifact.style?.sprite,
      `${api.url}/sprites/icp_12345678-1234-1234-1234-123456789abc/sprite`,
    );
    const foodPoiLayer = artifact.style?.layers?.find(
      (layer) => layer.id === 'streets-poi-food-icon',
    );
    assert.deepEqual(foodPoiLayer?.layout?.['icon-image'], [
      'coalesce',
      ['image', 'cafe'],
      ['image', 'restaurant_11'],
      ['image', 'marker_11'],
    ]);
    assert.deepEqual(parsed.iconPackage, {
      contentHash: requests[0]?.url?.split('/').pop(),
      label: 'brand',
      mapping: {restaurant: 'cafe'},
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
  assert.match(result.stdout, /Uploaded icon package brand \(2 icons,/);
  assert.match(result.stdout, /Published madrid \(v1\)\./);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(fakeApiKey));
});

test('a failed icon upload makes no style request and does not rewrite the manifest', async (t) => {
  const fixture = await createIconFixture(t);
  const originalManifest = '{"sentinel":true}\n';
  await writeFile(fixture.manifestPath, originalManifest);
  let requests = 0;
  const api = await createFailingIconApi(t, () => {
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
  assert.equal(requests, 1);
  assert.match(result.stdout, /Icon package upload failed: 503/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('a style failure after icon upload also preserves the previous manifest', async (t) => {
  const fixture = await createIconFixture(t);
  const originalManifest = '{"sentinel":"style-failure"}\n';
  await writeFile(fixture.manifestPath, originalManifest);
  const methods: string[] = [];
  const api = await createStyleFailingAfterIconApi(t, (method) => methods.push(method));
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
  assert.deepEqual(methods, ['PUT', 'POST']);
  assert.match(result.stdout, /Deploy failed for madrid: 503/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('CI deploy fails closed instead of reusing a credential saved by local login', async (t) => {
  const fixture = await createFixture(t);
  const configMarkerPath = join(fixture.directory, 'config-was-imported.txt');
  await writeFile(
    fixture.configPath,
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(configMarkerPath)}, 'imported');
export default {maps: {madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, name: 'Madrid'}}};
`,
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
  assert.match(`${result.stdout}\n${result.stderr}`, /explicit project-bound Tileflow API key/);
  assert.match(`${result.stdout}\n${result.stderr}`, /TILEFLOW_API_KEY/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /tileflow login/);
  assert.equal(requests, 0);
  await assert.rejects(() => readFile(configMarkerPath, 'utf8'), {code: 'ENOENT'});
});

test('an ambiguous account-session deploy fails before config execution with exact project options', async (t) => {
  const fixture = await createFixture(t);
  const configMarkerPath = join(fixture.directory, 'ambiguous-config-imported.txt');
  await writeFile(
    fixture.configPath,
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(configMarkerPath)}, 'imported');
export default {maps: {madrid: {name: 'Madrid'}}};
`,
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
  assert.match(result.stdout, /Project target is ambiguous: @acme\/web, @acme\/worker/);
  assert.ok(
    result.stdout.includes(
      `tileflow deploy --config ${fixture.configPath} --manifest ${fixture.manifestPath} --api-url ${api.url} --project @acme/web`,
    ),
    result.stdout,
  );
  await assert.rejects(() => readFile(configMarkerPath, 'utf8'), {code: 'ENOENT'});
});

test('one account session exchanges a visible target for a brief deploy capability', async (t) => {
  const fixture = await createFixture(t);
  const observedSecretPath = join(fixture.directory, 'account-config-observed-secret.txt');
  await writeFile(
    fixture.configPath,
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(observedSecretPath)}, process.env.TILEFLOW_API_KEY ?? 'missing');
export default {maps: {madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, modules: {poi: {type: 'poi', icons: false}}, name: 'Madrid'}}};
`,
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

test('an explicit project key rejects a mismatched --project before config execution', async (t) => {
  const fixture = await createFixture(t);
  const configMarkerPath = join(fixture.directory, 'mismatch-config-imported.txt');
  await writeFile(
    fixture.configPath,
    `import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(configMarkerPath)}, 'imported');
export default {maps: {madrid: {name: 'Madrid'}}};
`,
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
  await assert.rejects(() => readFile(configMarkerPath, 'utf8'), {code: 'ENOENT'});
});

test('/v1/me validation returns one canonical project property', async () => {
  const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const validator = source.slice(
    source.indexOf('async function validateApiKey'),
    source.indexOf('function isAuthIdentity'),
  );
  assert.equal(validator.match(/project: body\.project/gu)?.length, 1);
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

async function createFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-cli-adversarial-'));
  const configPath = join(directory, 'tileflow.config.ts');
  const manifestPath = join(directory, 'manifest.json');
  await writeFile(
    configPath,
    `export default {maps: {madrid: {basemap: {type: 'streets', basemapVersion: 3, variant: 'light'}, modules: {poi: {type: 'poi', icons: false}}, name: 'Madrid'}}};\n`,
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
    join(iconsDirectory, 'cafe.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle id="source-secret" cx="8" cy="8" r="7" /></svg>',
  );
  await writeFile(
    join(iconsDirectory, 'park.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" /></svg>',
  );
  await writeFile(
    fixture.configPath,
    `export default {
  icons: {brand: {mapping: {restaurant: 'cafe'}, source: './icons'}},
  maps: {
    madrid: {
      basemap: {type: 'streets', basemapVersion: 3, variant: 'light'},
      icons: 'brand',
      modules: {poi: {type: 'poi', icons: 'essential'}},
      name: 'Madrid'
    }
  }
};\n`,
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
    await readRequestBody(request);

    if (method === 'PUT') {
      response.writeHead(200, {'Content-Type': 'application/json'});
      response.end(
        JSON.stringify({
          changed: true,
          contentHash: request.url?.split('/').pop(),
          iconCount: 2,
          id: 'icp_12345678-1234-1234-1234-123456789abc',
          spriteUrl: 'https://api.example.test/sprites/icp_test/sprite',
          totalBytes: 100,
        }),
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
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}
