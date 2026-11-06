import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {tileflowRendererDeploymentRequestArtifactSchema} from '@tileflow/core/build';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {createTileflowIconSetProject} from '../../../test-support/icon-set-project';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {writeGlb} from '../../dev/test/tree-model-fixtures';
import {
  failure,
  type FakePlatform,
  projectProfile,
  requestJson,
  startFakePlatform,
} from './hosted-platform-fake';
import {tileflowMapFixture as mapFixture} from './map-fixture';

const tileflowMapFixture = (input: Parameters<typeof mapFixture>[0]) =>
  mapFixture({
    ...input,
    fields: ['platforms: ["web", "native"]', input.fields].filter(Boolean).join(',\n'),
  });

const fakeApiKey = `tf_live_${'a'.repeat(48)}`;
const accountSessionToken = `tf_session_${'b'.repeat(64)}`;
const managedMapId = 'map_AbCdEfGhIjKlMnOp';
const streetsThemeNames = [
  'dark',
  'dark-faded',
  'dark-monochrome',
  'dawn',
  'dawn-faded',
  'dawn-monochrome',
  'dusk',
  'dusk-faded',
  'dusk-monochrome',
  'faded',
  'light',
  'monochrome',
] as const;
/** Every native document of a Streets deployment: each theme style, then the family. */
const streetsDocuments = [...streetsThemeNames.map((theme) => `style:${theme}`), 'family'];

type DeployBody = {
  artifact: {
    kind: string;
    schemaVersion: number;
    mapId: string;
    teamSources: Record<string, unknown>;
    renderers: {
      web: {
        buildManifest: {
          maps: Record<string, Record<string, any>>;
          provenance?: Record<string, unknown>;
          schemaVersion: number;
        };
        styles: Record<string, Record<string, any>>;
      };
      native: {
        buildManifest: Record<string, any>;
        buildRecord: Record<string, any>;
        documents: {styles: Record<string, unknown>; family: {themes: string[]}};
      };
    };
  };
  [key: string]: any;
};
const deployBody = (platform: FakePlatform, index = 0) => {
  const body = platform.deployments[index]!.body;
  return {
    ...body,
    artifact: tileflowRendererDeploymentRequestArtifactSchema.parse(body.artifact),
  } as DeployBody;
};
const routes = (platform: FakePlatform) =>
  platform.requests.map(
    (request) =>
      `${request.method} ${request.path
        .replace(/^\/v1\/styles\/deployments\/[^/]+\/native\/.*$/u, '/v1/styles/deployments/native')
        .replace(/^(\/v1\/(?:icon-packages|font-bundles))\/.*$/u, '$1')}`,
  );
/** Consecutive repeats collapsed: the shape of a deployment's requests. */
const flow = (platform: FakePlatform) =>
  routes(platform).filter((route, index, all) => route !== all[index - 1]);
const deployArguments = (fixture: {configPath: string; manifestPath: string}, apiUrl: string) => [
  'deploy',
  '--config',
  fixture.configPath,
  '--manifest',
  fixture.manifestPath,
  '--api-url',
  apiUrl,
];

test('Map deploy auto-selects one map, publishes both renderer families and writes a session manifest', async (t) => {
  const fixture = await createFixture(t);
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(flow(api), [
    'POST /v1/styles',
    'PUT /v1/styles/deployments/native',
    'POST /v1/styles',
  ]);
  const body = deployBody(api);
  assert.equal(body.managedMapId, managedMapId);
  assert.equal(body.usageMode, 'session');
  assert.equal(body.artifact.kind, 'tileflow-map-deployment');
  assert.equal(body.artifact.schemaVersion, 5);
  assert.deepEqual(body.artifact.teamSources, {});
  assert.deepEqual(Object.keys(body.artifact.renderers.web.styles), streetsThemeNames);
  assert.deepEqual(Object.keys(body.artifact.renderers.native.documents.styles), streetsThemeNames);
  assert.equal('policy' in body, false);
  assert.ok(
    body.artifact.renderers.web.styles.light?.metadata?.['tileflow:colors'],
    'hosted web publication retains runtime colour bindings',
  );
  // Each native document travels on its own, gzip-encoded, family last.
  assert.deepEqual(
    api.uploads.map(({document}) => document),
    streetsDocuments,
  );
  assert.ok(api.uploads.every(({encoding, status}) => encoding === 'gzip' && status === 200));
  assert.ok(api.requests.every((request) => request.headers['content-encoding'] === 'gzip'));
  assert.equal(api.activeVersion(), 1);
  assert.match(result.stdout, /Reserved v1; uploading 13 native documents/u);
  assert.match(result.stdout, /Published madrid \(v1\) for web and native apps\./u);
  assert.match(result.stdout, new RegExp(`/maps/${managedMapId}/native/manifest\\.json`, 'u'));
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: {madrid: Record<string, unknown>};
  };
  assert.equal(manifest.maps.madrid.mapId, managedMapId);
  assert.equal(manifest.maps.madrid.usageMode, 'session');
  assert.equal(manifest.maps.madrid.worldGeneration, 'v1');
  assert.doesNotMatch(await readFile(fixture.manifestPath, 'utf8'), /wcv_12345678/u);
});

test('Map deploy rejects a mismatched --map before network work', async (t) => {
  const fixture = await createFixture(t);
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId, '--map', 'lisbon'],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(api.requests.length, 0);
  assert.match(result.stdout, /Unknown Tileflow map: lisbon/u);
  assert.match(result.stdout, /madrid/u);
  await assert.rejects(() => readFile(fixture.manifestPath, 'utf8'), {code: 'ENOENT'});
});

test('Map deploy publishes only the selected map and preserves unrelated manifest entries', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(fixture.configPath, tileflowMapFixture({id: 'lisbon'}));
  const api = await startFakePlatform(t, {mapId: managedMapId});
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify({
      apiUrl: api.url,
      maps: {
        madrid: {
          defaultTheme: 'light',
          environment: 'madrid',
          mapId: 'map_existing',
          themes: {
            light: {
              colorScheme: 'light',
              styleId: 'style_existing_light',
              styleUrl: 'https://api.example.test/maps/map_existing/light.json',
            },
          },
        },
      },
      version: 1,
    })}\n`,
  );
  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId, '--map', 'lisbon'],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(
    api.deployments.map(({body}) => body.environment),
    ['lisbon', 'lisbon'],
  );
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: Record<string, {mapId: string}>;
  };
  assert.equal(manifest.maps.madrid?.mapId, 'map_existing');
  assert.equal(manifest.maps.lisbon?.mapId, managedMapId);
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
      fields: `name: 'Madrid',
view: {center: [-3.7, 40.4], zoom: 11}`,
    }),
    'utf8',
  );
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    GITHUB_ACTIONS: 'true',
    GITHUB_REF_NAME: 'main',
    GITHUB_REPOSITORY: 'tileflow/maps',
    GITHUB_RUN_ID: '42',
    GITHUB_SERVER_URL: 'https://github.example.test',
    GITHUB_SHA: '0123456789abcdef',
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Published madrid \(v1\)/);
  assert.ok(
    api.requests.every((request) => request.headers.authorization === `Bearer ${fakeApiKey}`),
  );
  const body = deployBody(api);
  assert.deepEqual(body.source, {
    kind: 'github_actions',
    ref: 'main',
    repository: 'tileflow/maps',
    revision: '0123456789abcdef',
    runId: '42',
    runUrl: 'https://github.example.test/tileflow/maps/actions/runs/42',
  });
  assert.equal(body.managedMapId, managedMapId);
  assert.equal(body.iconPackage?.label, 'madrid');
  assert.equal(body.policy, undefined);
  assert.equal(body.artifact.schemaVersion, 5);
  const styles = body.artifact.renderers.web.styles;
  assert.deepEqual(Object.keys(styles), streetsThemeNames);
  const sprite = `${api.url}/sprites/icp_${String(body.iconPackage?.contentHash).slice(0, 24)}/sprite`;
  for (const style of Object.values(styles)) {
    assert.equal(style.sprite, sprite);
    const source = style.sources?.tileflow;
    assert.equal(source?.url, `${api.url}/tiles/world/tiles.json`);
    assert.equal(source?.tiles, undefined);
  }

  const manifest = await readFile(fixture.manifestPath, 'utf8');
  const manifestDocument = JSON.parse(manifest) as {
    maps: {
      madrid: {
        defaultTheme: string;
        systemThemes?: {dark: string; light: string};
        timeOfDay?: Record<string, unknown>;
        themes: Record<
          string,
          {
            colorScheme: string;
            fontFaces: unknown[];
            revision?: string;
            styleId?: string;
            styleUrl: string;
          }
        >;
        view?: unknown;
      };
    };
    version: number;
  };
  assert.equal(manifestDocument.version, 2);
  assert.equal(manifestDocument.maps.madrid.defaultTheme, 'light');
  assert.deepEqual(manifestDocument.maps.madrid.timeOfDay?.light, {
    day: 'light',
    dawn: 'dawn',
    dusk: 'dusk',
    night: 'dark',
  });
  assert.deepEqual(manifestDocument.maps.madrid.systemThemes, {dark: 'dark', light: 'light'});
  assert.deepEqual(Object.keys(manifestDocument.maps.madrid.themes), streetsThemeNames);
  assert.equal(manifestDocument.maps.madrid.themes.dark?.colorScheme, 'dark');
  assert.equal(manifestDocument.maps.madrid.themes.light?.colorScheme, 'light');
  for (const [name, theme] of Object.entries(manifestDocument.maps.madrid.themes)) {
    assert.deepEqual(theme.fontFaces, []);
    assert.match(theme.revision ?? '', /^[a-f0-9]{64}$/u);
    assert.equal(theme.styleId, `${managedMapId}_${name}`);
    assert.equal(theme.styleUrl, `${api.url}/maps/${managedMapId}/${name}.json`);
  }
  assert.deepEqual(manifestDocument.maps.madrid.view, {
    center: [-3.7, 40.4],
    zoom: 11,
  });
  assert.equal(await readFile(observedSecretPath, 'utf8'), 'missing');
  assert.doesNotMatch(manifest, /github_actions|tileflow\/maps|0123456789abcdef/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}\n${manifest}`, new RegExp(fakeApiKey));
});

test('a repeated deploy is an unchanged no-op and a changed map publishes the next version', async (t) => {
  const fixture = await createFixture(t);
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const deploy = () =>
    runCli(fixture.directory, deployArguments(fixture, api.url), {TILEFLOW_API_KEY: fakeApiKey});

  const first = await deploy();
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  const before = api.requests.length;
  const repeated = await deploy();
  assert.equal(repeated.code, 0, `${repeated.stdout}\n${repeated.stderr}`);
  assert.match(repeated.stdout, /Unchanged madrid \(v1\)\./);
  assert.doesNotMatch(repeated.stdout, /Published madrid|uploading/);
  // The server answers from the active deployment: nothing is uploaded again.
  assert.deepEqual(
    api.requests.slice(before).map((request) => `${request.method} ${request.path}`),
    ['POST /v1/styles'],
  );
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: {madrid: Record<string, any>};
  };
  assert.equal(
    manifest.maps.madrid.themes.light.styleUrl,
    `${api.url}/maps/${managedMapId}/light.json`,
  );
  assert.equal('deploymentId' in manifest.maps.madrid, false);
  assert.equal('version' in manifest.maps.madrid, false);

  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      fields: `name: 'Madrid', view: {center: [-3.7, 40.4], zoom: 12}`,
    }),
  );
  const changed = await deploy();
  assert.equal(changed.code, 0, `${changed.stdout}\n${changed.stderr}`);
  assert.match(changed.stdout, /Published madrid \(v2\) for web and native apps\./);
});

test('an interrupted upload preserves the manifest and the same deploy resumes it', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(fixture.configPath, tileflowMapFixture({id: 'beta'}));
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const originalManifest = `${JSON.stringify({
    apiUrl: api.url,
    maps: {
      previous: {
        defaultTheme: 'light',
        environment: 'previous',
        mapId: 'map_previous',
        themes: {
          light: {
            colorScheme: 'light',
            styleUrl: 'https://cdn.example.test/maps/map_previous/light.json',
          },
        },
      },
    },
    version: 1,
  })}\n`;
  await writeFile(fixture.manifestPath, originalManifest);
  const deploy = () =>
    runCli(fixture.directory, deployArguments(fixture, api.url), {TILEFLOW_API_KEY: fakeApiKey});

  api.failUploadsAfter = 3;
  const first = await deploy();
  assert.equal(first.code, 1);
  assert.match(
    first.stdout,
    /upload of native style dawn failed \(503 TF_NATIVE_DOCUMENT_UNAVAILABLE\)/u,
  );
  assert.match(first.stdout, /Run the same deploy again: it resumes where this one stopped/u);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
  assert.equal(api.activeVersion(), undefined);

  api.failUploadsAfter = undefined;
  const uploadsBefore = api.uploads.length;
  const resumed = await deploy();
  assert.equal(resumed.code, 0, `${resumed.stdout}\n${resumed.stderr}`);
  assert.match(resumed.stdout, /Resuming v1: 10 of 13 native documents left to upload/u);
  assert.match(resumed.stdout, /Published beta \(v1\) for web and native apps\./u);
  assert.deepEqual(
    api.uploads.slice(uploadsBefore).map(({document}) => document),
    streetsDocuments.slice(3),
  );
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    maps: Record<string, {mapId: string}>;
    version: number;
  };
  assert.equal(manifest.version, 2);
  assert.equal(manifest.maps.beta?.mapId, managedMapId);
  assert.deepEqual(Object.keys(manifest.maps), ['previous', 'beta']);
});

test('deploy refuses a self-hosted manifest unless replacement is explicit', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.manifestPath,
    `${JSON.stringify({
      maps: {
        madrid: {
          defaultTheme: 'light',
          systemThemes: {dark: 'dark', light: 'light'},
          themes: {
            dark: {colorScheme: 'dark', styleUrl: '/tileflow/styles/madrid/dark.json'},
            light: {colorScheme: 'light', styleUrl: '/tileflow/styles/madrid/light.json'},
          },
        },
      },
      version: 1,
    })}\n`,
  );
  const api = await startFakePlatform(t, {mapId: managedMapId});

  const refused = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });
  assert.equal(refused.code, 1);
  assert.equal(api.requests.length, 0);
  assert.match(refused.stdout, /Refusing to replace a self-hosted Tileflow manifest/u);

  const replaced = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--overwrite-self-hosted-manifest'],
    {TILEFLOW_API_KEY: fakeApiKey},
  );
  assert.equal(replaced.code, 0, `${replaced.stdout}\n${replaced.stderr}`);
  assert.equal(api.activeVersion(), 1);
  const manifest = JSON.parse(await readFile(fixture.manifestPath, 'utf8')) as {
    apiUrl?: string;
    version: number;
  };
  assert.equal(manifest.version, 2);
  assert.equal(manifest.apiUrl, api.url);
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
      fields: `overrides: [{kind: 'patch', id: 'tileflow-background', patch: {paint: {'background-color': 42}}}]`,
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
modules: {poi: {type: 'poi', density: 3, icons: true, categories: ['food-drink']}, roads: disable(), vegetation: disable()},
overrides: [{kind: 'patch', id: 'tileflow-background', patch: {paint: {'background-color': 42}}}]`,
    }),
  );
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(api.requests.length, 0);
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
    schema: {type: 'openmaptiles', contractVersion: 2},
    url: 'https://vector.example.test/tiles.json'
  }`,
    }),
  );
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 1);
  assert.equal(api.requests.length, 0);
  assert.match(result.stdout, /Hosted deploy supports only Tileflow World data/);
  assert.match(result.stdout, /Map madrid theme dark uses an external vector dataset/);
  assert.match(result.stdout, /Map madrid theme light uses an external vector dataset/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test("deploy uploads a map's own fonts as a font bundle that both renderer families use", async (t) => {
  const fixture = await createFixture(t);
  await writeFile(
    fixture.configPath,
    "import {defineMap} from '@tileflow/core'; import {baedeker} from '@tileflow/maps'; export default defineMap({id:'night',name:'Night',version:1,platforms:['web','native'],extends:baedeker});\n",
  );
  const api = await startFakePlatform(t, {mapId: managedMapId});
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(flow(api), [
    'PUT /v1/icon-packages',
    'PUT /v1/font-bundles',
    'POST /v1/styles',
    'PUT /v1/styles/deployments/native',
    'POST /v1/styles',
  ]);
  assert.match(result.stdout, /Uploaded font bundle \(3 faces,/u);
  const body = deployBody(api);
  const bundle = api.requests.find((request) => request.path.startsWith('/v1/font-bundles/'))!;
  const contentHash = bundle.path.split('/').pop()!;
  assert.deepEqual(body.fontBundle, {contentHash});
  const base = `${api.url}/font-bundles/fnb_${contentHash.slice(0, 24)}/fonts/`;
  for (const style of Object.values(body.artifact.renderers.web.styles)) {
    const faces = style.metadata['tileflow:fontFaces'] as Array<{source: string}>;
    assert.ok(faces.length > 0);
    assert.ok(faces.every(({source}) => source.startsWith(base)));
  }
  // Native styles draw the same uploaded font files, each claiming the characters it holds.
  const nativeStyle = requestJson(
    api.requests.find((request) => request.path.endsWith('/native/styles/light.json'))!,
  );
  const files = Object.values(
    nativeStyle['font-faces'] as Record<string, Array<{url: string}>>,
  ).flat();
  assert.ok(files.length > 0);
  assert.ok(files.every(({url}) => url.startsWith(base)));
  // Browser contours are a web feature; native apps are told, and the deploy still publishes.
  assert.match(result.stdout, /Native apps draw night without some web features/u);
  assert.match(result.stdout, /Contour lines and labels: not drawn/u);
});

test('deploy uploads generated icon files before posting sanitized style JSON', async (t) => {
  const fixture = await createIconFixture(t);
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept(request) {
      if (!request.path.startsWith('/v1/icon-packages/')) return undefined;
      const body = request.body.toString('utf8');
      assert.match(String(request.headers['content-type']), /^multipart\/form-data; boundary=/);
      for (const field of ['spriteJson', 'spritePng', 'sprite2xJson', 'sprite2xPng']) {
        assert.match(body, new RegExp(`name="${field}"`));
      }
      assert.doesNotMatch(body, /source-secret|<svg|\.\/icons/);
      return undefined;
    },
  });
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(flow(api), [
    'PUT /v1/icon-packages',
    'POST /v1/styles',
    'PUT /v1/styles/deployments/native',
    'POST /v1/styles',
  ]);
  const parsed = deployBody(api);
  assert.equal('icons' in parsed, false);
  const artifact = parsed.artifact;
  const buildManifest = artifact.renderers.web.buildManifest;
  const mapEntry = buildManifest.maps.madrid;
  assert.equal(artifact.mapId, 'madrid');
  assert.equal(artifact.schemaVersion, 5);
  assert.equal(buildManifest.schemaVersion, 1);
  assert.equal(mapEntry?.mapVersion, 1);
  assert.equal(mapEntry?.semanticCompiler?.name, 'tileflow-semantic');
  assert.equal(mapEntry?.semanticCompiler?.version, 1);
  assert.deepEqual(
    mapEntry?.lineage?.map((node: {id: string}) => node.id),
    ['madrid', 'streets'],
  );
  assert.equal(typeof mapEntry?.themes?.dark?.styleSha256, 'string');
  assert.equal(typeof mapEntry?.themes?.light?.styleSha256, 'string');
  assert.ok(buildManifest.provenance);
  const iconPackage = api.requests[0]!.path.split('/').pop()!;
  assert.deepEqual(Object.keys(artifact.renderers.web.styles), streetsThemeNames);
  for (const style of Object.values(artifact.renderers.web.styles)) {
    assert.equal(style.sprite, `${api.url}/sprites/icp_${iconPackage.slice(0, 24)}/sprite`);
    const foodPoiLayer = style.layers?.find((layer: {id?: string}) => layer.id === 'tileflow-poi');
    assert.ok(foodPoiLayer?.layout?.['text-field'], 'default POIs include their name');
    const iconImage = JSON.stringify(foodPoiLayer?.layout?.['icon-image']);
    assert.match(iconImage, /"get","icon"/u);
    assert.match(iconImage, /"image","(?:unified-day-food|food(?:-dark|-monochrome(?:-dark)?)?)"/u);
  }
  assert.deepEqual(parsed.iconPackage, {contentHash: iconPackage, label: 'madrid'});
  assert.doesNotMatch(JSON.stringify(artifact), /\.\/icons|source-secret/);
  assert.match(result.stdout, /Uploaded icon package madrid \(6 icons,/);
  assert.match(result.stdout, /Published madrid \(v1\)/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(fakeApiKey));
});

test("deploy places a map's own building models as Team 3D models by name and uploads none", async (t) => {
  const fixture = await createFixture(t);
  await mkdir(join(fixture.directory, 'models'));
  // A block 20 m wide and 120 m tall, its walls and roof named as a building's parts.
  await writeFile(
    join(fixture.directory, 'models', 'tower.glb'),
    writeGlb([
      {
        material: 'roof',
        positions: [-10, 120, -10, 10, 120, -10, 10, 120, 10, -10, 120, 10],
        indices: [0, 2, 1, 0, 3, 2],
      },
      {
        material: 'surface',
        positions: [-10, 0, 10, 10, 0, 10, 10, 120, 10, -10, 120, 10],
        indices: [0, 1, 2, 0, 2, 3],
      },
    ]),
  );
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      imports: `import {buildings} from '@tileflow/core';`,
      fields: `models: ['./models'],
modules: {
  addresses: disable(), aeroways: disable(), boundaries: disable(), labels: disable(), land: disable(),
  landforms: disable(), poi: disable(), roads: disable(), transit: disable(), vegetation: disable(),
  water: disable(),
  buildings: buildings({mode: '3d', threeDimensional: {models: [{model: 'tower', at: [-3.7038, 40.4168], heading: 30}]}})
},
name: 'Madrid'`,
    }),
  );
  const source = await readFile(join(fixture.directory, 'models', 'tower.glb'));
  const api = await startFakePlatform(t, {mapId: managedMapId});
  api.teamModels = [{model: 'tower', version: 2, sources: 'differ'}];
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(flow(api), [
    'POST /v1/styles',
    'PUT /v1/styles/deployments/native',
    'POST /v1/styles',
  ]);
  const parsed = deployBody(api);
  assert.equal(parsed.modelBundle, undefined);
  // Every web theme places the Team model by its placeholder; the deploy binds its address.
  for (const style of Object.values(parsed.artifact.renderers.web.styles)) {
    const design = style.metadata?.['tileflow:buildings'] as {
      models: Array<{model: string; url: string}>;
    };
    assert.deepEqual(
      design.models.map(({model, url}) => [model, url]),
      [['tower', 'tileflow://team-models/tower']],
    );
  }
  // Native styles leave the model out and record it.
  for (const upload of api.requests.filter((request) => request.path.includes('/native/styles/'))) {
    const nativeStyle = requestJson(upload);
    assert.doesNotMatch(JSON.stringify(nativeStyle), /team-models/u);
    assert.ok(
      (nativeStyle.metadata['tileflow:nativeDegradations'] as Array<{id: string}>).some(
        ({id}) => id === 'models3d',
      ),
    );
  }
  // The map follows the model by name: its files are neither assets nor revision sources.
  const built = parsed.artifact.renderers.web.buildManifest.maps.madrid!;
  assert.equal(built.sourceAssets.models, undefined);
  assert.deepEqual(parsed.teamModelSources, {
    tower: [
      {
        level: 'near',
        sha256: createHash('sha256').update(source).digest('hex'),
        byteLength: source.byteLength,
      },
    ],
  });
  assert.match(result.stdout, /Landmarks and building models: not drawn/u);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /3D model .*tower.* draws its published version 2, which was not prepared from this project's files/u,
  );
});

test('deploy binds one composition receipt to the effective package in manifest and body', async (t) => {
  const fixture = await createSharedIconFixture(t);
  const api = await startFakePlatform(t, {mapId: managedMapId});

  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--cache-dir', fixture.directory, '--offline'],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(flow(api), [
    'PUT /v1/icon-packages',
    'POST /v1/styles',
    'PUT /v1/styles/deployments/native',
    'POST /v1/styles',
  ]);
  const body = deployBody(api);
  const built = body.artifact.renderers.web.buildManifest.maps.madrid!;
  const embedded = built.sourceAssets.iconComposition;
  assert.ok(body.iconComposition);
  assert.ok(embedded);
  assert.equal(built.mapRevisionSchemaVersion, 2);
  assert.deepEqual(body.iconComposition, embedded);
  assert.equal(body.iconComposition.packageHash, body.iconPackage?.contentHash);
  assert.equal(body.iconComposition.packageHash, api.requests[0]!.path.split('/').pop());
  assert.deepEqual(
    body.iconComposition.contributors.map(
      (contributor: Record<string, unknown>) => contributor.reference ?? contributor.kind,
    ),
    ['@acme/brand', '@acme/transport', 'local'],
  );
  // The referenced source revisions are never re-uploaded by a deploy.
  assert.equal(
    api.requests.filter((request) => request.path.startsWith('/v1/icon-packages/')).length,
    1,
  );
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(fakeApiKey));
});

test('an explicit key for another Map is rejected before icon or style writes', async (t) => {
  const fixture = await createIconFixture(t);
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    profile: projectProfile('map_ZYXWVUTSRQPONMLK'),
  });
  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(api.requests.length, 0);
  assert.match(result.stdout, /API key belongs to another Map/u);
});

test('a failed icon upload makes no style request and does not rewrite the manifest', async (t) => {
  const fixture = await createIconFixture(t);
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept: (request) =>
      request.path.startsWith('/v1/icon-packages/')
        ? failure(503, 'ICON_STORAGE_UNAVAILABLE')
        : undefined,
  });
  const originalManifest = existingHostedManifest(api.url);
  await writeFile(fixture.manifestPath, originalManifest);
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 1);
  assert.deepEqual(routes(api), ['PUT /v1/icon-packages']);
  assert.match(result.stdout, /Icon package upload failed: 503/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);
});

test('a style failure after icon upload also preserves the previous manifest', async (t) => {
  const fixture = await createIconFixture(t);
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept: (request) =>
      request.path === '/v1/styles'
        ? failure(503, 'TF_STYLE_STORAGE_UNAVAILABLE', `Rejected ${fakeApiKey}`)
        : undefined,
  });
  const originalManifest = existingHostedManifest(api.url);
  await writeFile(fixture.manifestPath, originalManifest);
  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /Deploy failed \(503 TF_STYLE_STORAGE_UNAVAILABLE\)/);
  assert(!result.stdout.includes(fakeApiKey));
  assert.deepEqual(routes(api), ['PUT /v1/icon-packages', 'POST /v1/styles']);
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
  const api = await startFakePlatform(t, {mapId: managedMapId});
  await writeAccountSession(fixture.directory, api.url);

  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    CI: 'true',
    HOME: fixture.directory,
    USERPROFILE: fixture.directory,
  });

  assert.equal(result.code, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /explicit Tileflow credential with access to the target Map/,
  );
  assert.match(`${result.stdout}\n${result.stderr}`, /TILEFLOW_API_KEY/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /tileflow login/);
  assert.equal(api.requests.length, 0);
  assert.equal(await readFile(configMarkerPath, 'utf8'), 'imported');
});

test('an account-session Map lookup happens after local config preflight', async (t) => {
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
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept(request) {
      assert.equal(request.path, '/v1/cli/map-capabilities');
      assert.equal(request.headers.authorization, `Bearer ${accountSessionToken}`);
      assert.deepEqual(requestJson(request), {mapId: managedMapId, scopes: ['styles:write']});
      return {status: 200, body: {error: 'not found'}};
    },
  });
  await writeAccountSession(fixture.directory, api.url);

  const result = await runCli(fixture.directory, deployArguments(fixture, api.url), {
    HOME: fixture.directory,
    USERPROFILE: fixture.directory,
  });

  assert.equal(result.code, 1);
  assert.equal(api.requests.length, 1);
  assert.match(result.stdout, /Map capability response was invalid/u);
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
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept(request) {
      if (request.path === '/v1/cli/map-capabilities') {
        assert.equal(request.headers.authorization, `Bearer ${accountSessionToken}`);
        assert.deepEqual(requestJson(request), {mapId: managedMapId, scopes: ['styles:write']});
        return {
          status: 200,
          body: {
            capability,
            expiresAt: '2026-08-15T23:59:00.000Z',
            mapId: managedMapId,
            schemaVersion: 1,
            scopes: ['styles:write'],
          },
        };
      }
      assert.equal(request.headers.authorization, `Bearer ${capability}`);
      return undefined;
    },
  });
  await writeAccountSession(fixture.directory, api.url);

  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId],
    {HOME: fixture.directory, USERPROFILE: fixture.directory},
  );

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(flow(api), [
    'POST /v1/cli/map-capabilities',
    'POST /v1/styles',
    'PUT /v1/styles/deployments/native',
    'POST /v1/styles',
  ]);
  assert.equal(await readFile(observedSecretPath, 'utf8'), 'missing');
  assert.doesNotMatch(
    `${result.stdout}\n${result.stderr}\n${await readFile(fixture.manifestPath, 'utf8')}`,
    new RegExp(`${accountSessionToken}|${capability}`),
  );
});

test('a Map-scoped key rejection preserves the explicit target after local preflight', async (t) => {
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
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept(request) {
      assert.equal(request.path, '/v1/styles');
      assert.equal(request.headers.authorization, `Bearer ${fakeApiKey}`);
      assert.equal(requestJson(request).managedMapId, managedMapId);
      return failure(403, 'TF_MAP_FORBIDDEN', 'API key cannot deploy styles');
    },
  });

  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.equal(api.requests.length, 1);
  assert.match(result.stdout, /Deploy failed \(403 TF_MAP_FORBIDDEN\)/u);
  assert.doesNotMatch(result.stdout, /resumes where this one stopped/u);
  assert.equal(await readFile(configMarkerPath, 'utf8'), 'imported');
});

test('deploy rejects a successful response for another persistent Map', async (t) => {
  const fixture = await createFixture(t);
  const otherMap = 'map_ZYXWVUTSRQPONMLK';
  const api = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept(request, platform) {
      if (request.path !== '/v1/styles' || platform.deployments.length === 0) return undefined;
      // Once the documents arrived, answer with a complete deployment of another Map.
      const themes = requestJson(request).artifact.renderers.web.family.themes as string[];
      const native = `${platform.url}/maps/${otherMap}/native`;
      return {
        status: 200,
        body: {
          kind: 'tileflow-map-deployment-result',
          schemaVersion: 3,
          changed: true,
          mapId: otherMap,
          deploymentId: 'dep_other',
          version: 1,
          renderers: {
            web: {
              themes: Object.fromEntries(
                themes.map((theme) => [
                  theme,
                  {styleUrl: `${platform.url}/maps/${otherMap}/${theme}.json`},
                ]),
              ),
            },
            native: {
              profile: 'native-v1',
              manifestUrl: `${native}/manifest.json`,
              family: {url: `${native}/family/v1.json`, revision: 'a'.repeat(64)},
              themes: Object.fromEntries(
                themes.map((theme) => [
                  theme,
                  {styleUrl: `${native}/v1/${theme}.json`, revision: 'a'.repeat(64)},
                ]),
              ),
            },
          },
        },
      };
    },
  });
  const result = await runCli(
    fixture.directory,
    [...deployArguments(fixture, api.url), '--map-id', managedMapId],
    {TILEFLOW_API_KEY: fakeApiKey},
  );

  assert.equal(result.code, 1);
  assert.match(result.stdout, /did not confirm the requested Map/u);
  await assert.rejects(() => readFile(fixture.manifestPath, 'utf8'), {code: 'ENOENT'});
});

test('/v1/me validation requires one canonical Map identity', async () => {
  const source = await readFile(new URL('../src/hosted-client.ts', import.meta.url), 'utf8');
  const validator = source.slice(
    source.indexOf('export async function validateApiKey'),
    source.indexOf('export async function requestMapCapability'),
  );
  assert.equal(validator.match(/mapId: body\.mapId/gu)?.length, 1);
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
    schema: {type: 'openmaptiles', contractVersion: 2},
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
  assert.match(result.stdout, /Map madrid theme dark uses an external vector dataset/);
  assert.match(result.stdout, /Map madrid theme light uses an external vector dataset/);
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
  const deployApi = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept: (request) =>
      request.path === '/v1/styles'
        ? {
            status: 200,
            body: {
              mapId: managedMapId,
              themes: {
                dark: {styleUrl: 'javascript:alert(1)'},
                light: {styleUrl: 'https://api.example.test/maps/map_test/light.json'},
              },
            },
          }
        : undefined,
  });
  const originalManifest = existingHostedManifest(deployApi.url);
  await writeFile(fixture.manifestPath, originalManifest);
  const deploy = await runCli(fixture.directory, deployArguments(fixture, deployApi.url), {
    TILEFLOW_API_KEY: fakeApiKey,
  });

  assert.equal(deploy.code, 1);
  assert.match(deploy.stdout, /The deployment response is invalid/);
  assert.equal(await readFile(fixture.manifestPath, 'utf8'), originalManifest);

  const statusApi = await startFakePlatform(t, {
    mapId: managedMapId,
    intercept: () => ({status: 200, body: {mapId: managedMapId, styles: 'invalid'}}),
  });
  const status = await runCli(
    fixture.directory,
    [
      'status',
      '--json',
      '--api-url',
      statusApi.url,
      '--api-key',
      fakeApiKey,
      '--map-id',
      managedMapId,
    ],
    {},
  );
  assert.equal(status.code, 1);
  assert.equal(status.stdout, '');
  assert.match(status.stderr, /Status response returned an invalid response/);
  assert.doesNotMatch(`${status.stdout}\n${status.stderr}`, new RegExp(fakeApiKey));

  const unauthenticatedStatus = await runCli(
    fixture.directory,
    ['status', '--json', '--api-url', 'https://api.example.test', '--map-id', managedMapId],
    {HOME: fixture.directory, USERPROFILE: fixture.directory},
  );
  assert.equal(unauthenticatedStatus.code, 1);
  assert.equal(unauthenticatedStatus.stdout, '');
  assert.match(unauthenticatedStatus.stderr, /^Status authentication failed\.\n$/u);
});

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
    maps: {
      existing: {
        defaultTheme: 'light',
        environment: 'existing',
        mapId: 'map_existing',
        themes: {
          light: {
            colorScheme: 'light',
            styleId: 'style_existing_light',
            styleUrl,
          },
        },
      },
    },
    version: 1,
  })}\n`;
}

async function createFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-adversarial-'));
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
  for (const image of [
    'food',
    'unified-day-food',
    'food-dark',
    'food-monochrome',
    'food-monochrome-dark',
  ]) {
    await writeFile(
      join(iconsDirectory, `${image}.svg`),
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle id="source-secret" cx="8" cy="8" r="7" /></svg>',
    );
  }
  await writeFile(
    join(iconsDirectory, 'park.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" /></svg>',
  );
  // Streets' dark theme draws each POI with its night pictogram.
  await writeFile(
    join(iconsDirectory, 'food-dark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" /></svg>',
  );
  await writeFile(
    fixture.configPath,
    tileflowMapFixture({
      id: 'madrid',
      icons: 'authored',
      fields: `icons: ['./icons'],
modules: {poi: {type: 'poi', density: 3, icons: true, categories: ['food-drink']}, roads: disable(), vegetation: disable()},
name: 'Madrid'`,
    }),
  );
  return fixture;
}

async function createSharedIconFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'tileflow-shared-icons-'));
  t.after(() => rm(directory, {force: true, recursive: true}));
  await createTileflowIconSetProject(directory, {mapId: 'madrid'});
  const configPath = join(directory, 'tileflow.config.ts');
  const config = await readFile(configPath, 'utf8');
  await writeFile(
    configPath,
    config.replace('defineMap({', 'defineMap({platforms: ["web", "native"],'),
  );
  return {
    configPath: join(directory, 'tileflow.config.ts'),
    directory,
    manifestPath: join(directory, 'manifest.json'),
  };
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

  const effectiveArguments =
    arguments_[0] === 'deploy' && !arguments_.includes('--map-id')
      ? [...arguments_, '--map-id', managedMapId]
      : arguments_;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliFixtureArguments(effectiveArguments), {
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

test('native CI does not re-upload when only lockfiles and build receipts change', async (t) => {
  const fixture = await createFixture(t);
  const lock = join(fixture.directory, 'pnpm-lock.yaml');
  const api = await startFakePlatform(t, {mapId: managedMapId, preflight: true});
  const run = (sha: string) =>
    runCli(fixture.directory, [...deployArguments(fixture, api.url), '--map-id', managedMapId], {
      TILEFLOW_API_KEY: fakeApiKey,
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: sha,
    });
  await writeFile(lock, 'lockfileVersion: 9.0\n');
  const first = await run('first');
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  assert.ok(api.uploads.length > 0);
  const before = api.requests.length;
  await writeFile(lock, 'lockfileVersion: 9.0\n# unrelated change\n');
  const second = await run('second');
  assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
  assert.match(second.stdout, /Unchanged madrid \(v1\)/u);
  assert.deepEqual(
    api.requests.slice(before).map(({path}) => path),
    ['/v1/styles/publications/check'],
  );
});

test('web-only CI publishes without native uploads and a new lockfile needs only a check', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(fixture.configPath, mapFixture({id: 'madrid'}));
  await writeFile(
    join(fixture.directory, 'package.json'),
    JSON.stringify({
      dependencies: {'@tileflow/react-native': '1.0.0'},
    }),
  );
  const lock = join(fixture.directory, 'pnpm-lock.yaml');
  await writeFile(lock, 'lockfileVersion: 9.0\n');
  const api = await startFakePlatform(t, {mapId: managedMapId, preflight: true});
  const run = (sha: string) =>
    runCli(fixture.directory, [...deployArguments(fixture, api.url), '--map-id', managedMapId], {
      TILEFLOW_API_KEY: fakeApiKey,
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: sha,
    });
  const first = await run('first');
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  assert.match(first.stdout, /platforms: \["web", "native"\],/u);
  assert.match(first.stdout, /Published madrid \(v1\) for web\./u);
  assert.equal(api.deployments[0]!.body.artifact?.schemaVersion, 3);
  assert.equal(api.uploads.length, 0);

  await writeFile(lock, 'lockfileVersion: 9.0\n# unrelated change\n');
  const second = await run('second');
  assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
  assert.match(second.stdout, /Unchanged madrid \(v1\)/u);
  assert.equal(api.deployments.length, 1);
  const checks = api.requests.filter(({path}) => path === '/v1/styles/publications/check');
  assert.equal(checks.length, 2);
  assert.notEqual(
    requestJson(checks[0]!).builds[0].lockfile.sha256,
    requestJson(checks[1]!).builds[0].lockfile.sha256,
  );
});
