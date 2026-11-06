import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {type MapLibreStyle, serializeCanonicalJson} from '@tileflow/core';
import {
  inferTileflowDataRequirements,
  inferTileflowSourceRequirements,
  splitTileflowRendererDeployment,
  type TileflowMapBuildManifestV1,
  type TileflowRendererDeploymentArtifact,
} from '@tileflow/core/build';
import type {TileflowRuntimeManifest} from '@tileflow/core/manifest';
import {prepareTileflowHostedNativeDeployment} from '@tileflow/dev/artifacts';
import {
  HostedDeploymentError,
  type HostedRendererDeploymentEvent,
  publishHostedRendererDeployment,
} from '../src/hosted-client';
import {
  describeNativeDifference,
  type HostedDeployEvent,
  type PreparedHostedDeploy,
  runHostedDeploy,
  summarizeNativeDifferences,
} from '../src/hosted-native-deploy';
import {failure, requestJson, startFakePlatform} from './hosted-platform-fake';

const mapId = 'map_AbCdEfGhIjKlMnOp';
const apiKey = `tf_cap_${'c'.repeat(64)}`;
const digest = (value: unknown) =>
  createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
const immediately = async () => undefined;

function style(theme: 'dark' | 'light'): MapLibreStyle {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {'background-color': theme === 'dark' ? '#111111' : '#ffffff'},
      },
    ],
    metadata: {
      'tileflow:map': 'main',
      'tileflow:mapVersion': 1,
      'tileflow:theme': theme,
      'tileflow:colorScheme': theme,
      'tileflow:compiler': 'tileflow-semantic',
      'tileflow:compilerVersion': 1,
    },
    // The dark theme is drawn on a globe, which native maps draw in Web Mercator.
    ...(theme === 'dark' ? {projection: {type: 'globe'}} : {}),
  } as MapLibreStyle;
}

/** Both renderer families of a two-theme map, as the CLI prepares them. */
async function rendererDeployment(): Promise<TileflowRendererDeploymentArtifact> {
  const styles = {dark: style('dark'), light: style('light')};
  const buildManifest: TileflowMapBuildManifestV1 = {
    schemaVersion: 1,
    maps: {
      main: {
        assetSetSha256: 'a'.repeat(64),
        mapRevisionSha256: 'b'.repeat(64),
        defaultTheme: 'light',
        lineage: [{id: 'main', mapVersion: 1}],
        mapVersion: 1,
        semanticCompiler: {name: 'tileflow-semantic', version: 1},
        sourceAssets: {fonts: [], icons: []},
        systemThemes: {dark: 'dark', light: 'light'},
        themes: Object.fromEntries(
          (['dark', 'light'] as const).map((theme) => [
            theme,
            {
              colorScheme: theme,
              dataRequirements: inferTileflowDataRequirements(styles[theme]),
              sourceRequirements: inferTileflowSourceRequirements(styles[theme]),
              styleSha256: digest(styles[theme]),
              themeId: theme,
              themeVersion: 1,
            },
          ]),
        ),
      },
    },
  };
  return prepareTileflowHostedNativeDeployment({
    mapId: 'main',
    styles,
    buildManifest,
    assets: [],
    teamSources: {},
    themes: ['light', 'dark'],
  });
}

async function body(artifact: TileflowRendererDeploymentArtifact) {
  const split = await splitTileflowRendererDeployment(artifact);
  return {
    split,
    body: {
      artifact: split.artifact,
      environment: 'main',
      managedMapId: mapId,
      usageMode: 'session',
      source: {kind: 'cli'},
    },
  };
}

test('a deployment is reserved, its native documents uploaded family last, then activated', async (t) => {
  const platform = await startFakePlatform(t, {mapId});
  const input = await body(await rendererDeployment());
  const events: HostedRendererDeploymentEvent[] = [];
  const result = await publishHostedRendererDeployment(
    {apiKey, apiUrl: platform.url, mapId},
    input,
    {onProgress: (event) => events.push(event)},
  );

  assert.equal(result.changed, true);
  assert.equal(result.version, 1);
  assert.equal(
    result.renderers.native.family.url,
    `${platform.url}/maps/${mapId}/native/family/v1.json`,
  );
  assert.deepEqual(
    platform.requests.map(
      (request) => `${request.method} ${request.path.replace(/dep_[^/]+/u, 'dep')}`,
    ),
    [
      'POST /v1/styles',
      'PUT /v1/styles/deployments/dep/native/styles/dark.json',
      'PUT /v1/styles/deployments/dep/native/styles/light.json',
      'PUT /v1/styles/deployments/dep/native/family.json',
      'POST /v1/styles',
    ],
  );
  // Every request travels gzip-encoded with the credential and the Map; documents are the exact
  // canonical bytes the request indexed.
  for (const request of platform.requests) {
    assert.equal(request.headers['content-encoding'], 'gzip');
    assert.equal(request.headers.authorization, `Bearer ${apiKey}`);
    assert.equal(request.headers['x-tileflow-map-id'], mapId);
  }
  assert.equal(platform.requests[1]!.body.toString('utf8'), input.split.documents.styles.dark);
  assert.equal(platform.requests[3]!.body.toString('utf8'), input.split.documents.family);
  assert.equal(requestJson(platform.requests[0]!).artifact.schemaVersion, 5);
  assert.equal('styles' in requestJson(platform.requests[0]!).artifact.renderers.native, false);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['reserved', 'uploaded', 'uploaded', 'uploaded', 'activating'],
  );
  assert.deepEqual(events[0], {
    kind: 'reserved',
    deploymentId: (events[0] as {deploymentId: string}).deploymentId,
    version: 1,
    documents: 3,
    bytes:
      Buffer.byteLength(input.split.documents.styles.dark!) +
      Buffer.byteLength(input.split.documents.styles.light!) +
      Buffer.byteLength(input.split.documents.family),
    total: 3,
  });
});

test('a repeated deploy resumes after a partial upload and is unchanged once published', async (t) => {
  const platform = await startFakePlatform(t, {mapId});
  const input = await body(await rendererDeployment());
  const api = {apiKey, apiUrl: platform.url, mapId};

  platform.failUploadsAfter = 1;
  await assert.rejects(
    publishHostedRendererDeployment(api, input, {sleep: immediately}),
    (error: unknown) =>
      error instanceof HostedDeploymentError &&
      error.resumable &&
      error.code === 'TF_NATIVE_DOCUMENT_UNAVAILABLE',
  );
  // The first style was stored; the second was retried and then left for the next run.
  assert.deepEqual(
    platform.uploads.map(({document, status}) => `${document} ${status}`),
    ['style:dark 200', 'style:light 503', 'style:light 503', 'style:light 503'],
  );
  assert.equal(platform.activeVersion(), undefined);

  platform.failUploadsAfter = undefined;
  const events: HostedRendererDeploymentEvent[] = [];
  const resumed = await publishHostedRendererDeployment(api, input, {
    onProgress: (event) => events.push(event),
  });
  assert.equal(resumed.changed, true);
  assert.equal(resumed.version, 1, 'the same reservation completes');
  assert.deepEqual(
    platform.uploads.slice(4).map(({document}) => document),
    ['style:light', 'family'],
  );
  assert.equal((events[0] as {documents: number}).documents, 2);
  assert.equal((events[0] as {total: number}).total, 3);

  const before = platform.requests.length;
  const repeated = await publishHostedRendererDeployment(api, input);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.version, 1);
  assert.deepEqual(
    platform.requests.slice(before).map((request) => `${request.method} ${request.path}`),
    ['POST /v1/styles'],
  );
});

test('when the server says the deployment moved on, the client asks it what remains', async (t) => {
  let refused = false;
  const platform = await startFakePlatform(t, {
    mapId,
    intercept(request) {
      if (refused || !request.path.endsWith('/native/family.json')) return undefined;
      refused = true;
      return {
        status: 409,
        body: {code: 'TF_NATIVE_DOCUMENTS_INCOMPLETE', error: 'incomplete', missing: ['light']},
      };
    },
  });
  const input = await body(await rendererDeployment());
  const result = await publishHostedRendererDeployment(
    {apiKey, apiUrl: platform.url, mapId},
    input,
  );
  assert.equal(result.changed, true);
  assert.deepEqual(
    platform.requests.map((request) => `${request.method} ${request.path.split('/').at(-1)}`),
    [
      'POST styles',
      'PUT dark.json',
      'PUT light.json',
      'PUT family.json',
      'POST styles',
      'PUT family.json',
      'POST styles',
    ],
  );
});

test('a pending reply that does not match the local documents or origin uploads nothing', async (t) => {
  const input = await body(await rendererDeployment());
  for (const change of [
    (document: Record<string, unknown>) => ({...document, sha256: 'f'.repeat(64)}),
    (document: Record<string, unknown>) => ({
      ...document,
      url: String(document.url).replace(
        /^http:\/\/127\.0\.0\.1:\d+/u,
        'https://other.example.test',
      ),
    }),
  ]) {
    let pending = true;
    const platform = await startFakePlatform(t, {
      mapId,
      intercept(request, fake) {
        if (!pending || request.path !== '/v1/styles') return undefined;
        pending = false;
        const index = input.split.artifact.renderers.native.documents;
        const base = `${fake.url}/v1/styles/deployments/dep_fixture/native`;
        return {
          status: 202,
          body: {
            kind: 'tileflow-map-deployment-pending',
            schemaVersion: 1,
            mapId,
            deploymentId: 'dep_fixture',
            version: 1,
            native: {
              documents: [
                change({
                  document: 'style',
                  theme: 'dark',
                  ...index.styles.dark,
                  method: 'PUT',
                  url: `${base}/styles/dark.json`,
                }),
              ],
            },
          },
        };
      },
    });
    await assert.rejects(
      publishHostedRendererDeployment({apiKey, apiUrl: platform.url, mapId}, input),
      HostedDeploymentError,
    );
    assert.equal(platform.uploads.length, 0);
    assert.deepEqual(
      platform.requests.map((request) => request.method),
      ['POST'],
    );
  }
});

test('opaque publication failures identify the step, decoded size and available request ID', async (t) => {
  const input = await body(await rendererDeployment());
  const postBytes = Buffer.byteLength(serializeCanonicalJson(input.body));
  const index = input.split.artifact.renderers.native.documents;
  const cases = [
    {step: 'reservation', bytes: postBytes, requestId: 'ray-reserve-LIS'},
    {step: 'native style dark upload', bytes: index.styles.dark!.bytes, requestId: 'req-style'},
    {step: 'family document upload', bytes: index.family.bytes, requestId: undefined},
    {step: 'activation', bytes: postBytes, requestId: 'req-activate'},
  ];

  for (const {step, bytes, requestId} of cases) {
    await t.test(step, async (t) => {
      let fail = true;
      const platform = await startFakePlatform(t, {
        mapId,
        intercept(request, fake) {
          if (!fail) return undefined;
          if (request.path.endsWith('/styles/dark.json') && step === 'native style dark upload')
            return {status: 502, body: '', raw: true, headers: {'X-Request-ID': 'req-style'}};
          if (request.path.endsWith('/family.json') && step === 'family document upload')
            return {disconnect: true};
          if (request.path !== '/v1/styles') return undefined;
          if (step === 'reservation')
            return {
              status: 503,
              body: '<html>Error 1102: Worker exceeded resource limits</html>',
              raw: true,
              headers: {'CF-Ray': 'ray-reserve-LIS'},
            };
          if (step === 'activation' && fake.uploads.length === 3)
            return {
              status: 500,
              body: {error: 'Internal Server Error', requestId: 'req-activate'},
            };
          return undefined;
        },
      });
      const api = {apiKey, apiUrl: platform.url, mapId};
      await assert.rejects(
        publishHostedRendererDeployment(api, input, {sleep: immediately}),
        (error: unknown) => {
          assert.ok(error instanceof HostedDeploymentError);
          assert.match(error.message, /server could not process the publication/i);
          assert.match(error.message, /contact support/i);
          assert.ok(error.message.includes(step));
          assert.ok(error.message.includes(`${bytes} bytes`));
          if (requestId) assert.ok(error.message.includes(requestId));
          else assert.doesNotMatch(error.message, /request id/i);
          assert.doesNotMatch(error.message, /<html>|Internal Server Error/);
          assert.equal(error.resumable, true);
          return true;
        },
      );
      assert.equal(platform.activeVersion(), undefined);
      fail = false;
      const resumed = await publishHostedRendererDeployment(api, input, {sleep: immediately});
      assert.equal(resumed.version, 1);
    });
  }
});

test('a recognized server error keeps its actionable message', async (t) => {
  const input = await body(await rendererDeployment());
  const platform = await startFakePlatform(t, {
    mapId,
    intercept: () => failure(503, 'TF_STYLE_STORAGE_UNAVAILABLE'),
  });
  await assert.rejects(
    publishHostedRendererDeployment({apiKey, apiUrl: platform.url, mapId}, input),
    {
      message:
        'Deploy failed (503 TF_STYLE_STORAGE_UNAVAILABLE): Hosted could not store the style. Retry the deployment.',
    },
  );
});

test('a queued publication resumes after losing its status response', async (t) => {
  const platform = await startFakePlatform(t, {mapId});
  const input = await body(await rendererDeployment());
  const api = {apiKey, apiUrl: platform.url, mapId};
  const jobId = `pub_${'a'.repeat(64)}`;
  const events: HostedRendererDeploymentEvent[] = [];
  let result: Response;
  let lost = false;
  const fetch: typeof globalThis.fetch = async (target, init) => {
    const path = new URL(String(target)).pathname;
    if (path === '/v1/styles/publications/' + jobId) {
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${apiKey}`);
      if (!lost && result.status === 200) {
        lost = true;
        throw new Error('Connection closed');
      }
      return result;
    }
    const response = await globalThis.fetch(target, init);
    if (path !== '/v1/styles') return response;
    assert.equal(new Headers(init?.headers).get('X-Tileflow-Publication'), 'async');
    result = response;
    return Response.json(
      {kind: 'tileflow-hosted-publication-job', mapId, jobId, state: 'queued'},
      {status: 202},
    );
  };
  await assert.rejects(
    publishHostedRendererDeployment(api, input, {
      request: {fetch},
      sleep: immediately,
      onProgress: (e) => events.push(e),
    }),
    (error: unknown) => error instanceof HostedDeploymentError && error.resumable,
  );
  const uploads = platform.uploads.length;
  const published = await publishHostedRendererDeployment(api, input, {
    request: {fetch},
    sleep: immediately,
  });
  assert.equal(published.version, 1);
  assert.equal(platform.uploads.length, uploads);
  assert.ok(events.some((event) => event.kind === 'publication-job' && event.jobId === jobId));
});

test('polling reports each runner phase while the job is running', async (t) => {
  const input = await body(await rendererDeployment());
  const jobId = `pub_${'c'.repeat(64)}`;
  const phases = ['family', 'staging', 'activation'];
  const events: HostedRendererDeploymentEvent[] = [];
  const platform = await startFakePlatform(t, {
    mapId,
    intercept: ({path}) => {
      if (!path.endsWith(jobId)) return undefined;
      const phase = phases.shift();
      return phase
        ? {
            status: 202,
            body: {kind: 'tileflow-hosted-publication-job', mapId, jobId, state: 'running', phase},
          }
        : {status: 422, body: {code: 'TF_HOSTED_PUBLICATION_FAILED', jobId}};
    },
  });
  const fetch: typeof globalThis.fetch = async (target, init) =>
    init?.method === 'POST'
      ? Response.json(
          {kind: 'tileflow-hosted-publication-job', mapId, jobId, state: 'queued'},
          {status: 202},
        )
      : globalThis.fetch(target, init);
  await assert.rejects(
    publishHostedRendererDeployment({apiKey, apiUrl: platform.url, mapId}, input, {
      request: {fetch},
      sleep: immediately,
      onProgress: (event) => events.push(event),
    }),
  );
  assert.deepEqual(
    events.filter((event) => event.kind === 'publication-job').map((event) => event.phase),
    [undefined, 'family', 'staging', 'activation'],
  );
});

test('a permanent runner failure reports the publication ID', async (t) => {
  const input = await body(await rendererDeployment());
  const jobId = `pub_${'b'.repeat(64)}`;
  const platform = await startFakePlatform(t, {
    mapId,
    intercept: (request) =>
      request.method === 'POST'
        ? {
            status: 202,
            body: {kind: 'tileflow-hosted-publication-job', mapId, jobId, state: 'running'},
          }
        : {status: 422, body: {code: 'TF_HOSTED_PUBLICATION_FAILED', jobId}},
  });
  await assert.rejects(
    publishHostedRendererDeployment({apiKey, apiUrl: platform.url, mapId}, input, {
      sleep: immediately,
    }),
    (error: unknown) =>
      error instanceof HostedDeploymentError &&
      !error.resumable &&
      error.code === 'TF_HOSTED_PUBLICATION_FAILED' &&
      error.message.includes(jobId),
  );
});

test('a rejected document stops the deployment with the server code', async (t) => {
  const platform = await startFakePlatform(t, {
    mapId,
    intercept: (request) =>
      request.path.endsWith('/native/family.json')
        ? failure(400, 'TF_NATIVE_FAMILY_INVALID', 'The family document does not match')
        : undefined,
  });
  const input = await body(await rendererDeployment());
  await assert.rejects(
    publishHostedRendererDeployment({apiKey, apiUrl: platform.url, mapId}, input),
    (error: unknown) =>
      error instanceof HostedDeploymentError &&
      !error.resumable &&
      error.code === 'TF_NATIVE_FAMILY_INVALID' &&
      /family document/u.test(error.message),
  );
  assert.equal(platform.activeVersion(), undefined);
});

function prepared(
  artifact: TileflowRendererDeploymentArtifact,
  events: string[] = [],
): PreparedHostedDeploy {
  return {
    mapName: 'main',
    preflight: artifact,
    packages: [],
    async retarget() {
      return artifact;
    },
    async dispose() {
      events.push('dispose');
    },
  };
}

test('a Hosted deploy checks the manifest before the target, publishes, then writes the manifest', async (t) => {
  const platform = await startFakePlatform(t, {mapId});
  platform.teamModels = [{model: 'tower', version: 2, sources: 'differ'}];
  const artifact = await rendererDeployment();
  const events: string[] = [];
  const progress: HostedDeployEvent[] = [];
  let written: TileflowRuntimeManifest | undefined;
  const result = await runHostedDeploy(
    prepared(artifact, events),
    {apiUrl: platform.url, manifest: 'tileflow.manifest.json'},
    {
      source: {kind: 'cli'},
      async loadManifest() {
        events.push('existing');
        return null;
      },
      async resolveTarget({mapName}) {
        events.push(`target ${mapName}`);
        return {apiKey, apiUrl: platform.url, mapId};
      },
      progress: (event) => progress.push(event),
      async writeManifest(path, manifest) {
        events.push(`write ${platform.requests.length}`);
        written = manifest;
        return path;
      },
    },
  );

  assert.deepEqual(events, ['existing', 'target main', 'write 5', 'dispose']);
  assert.equal(result?.changed, true);
  assert.equal(result?.nativeManifestUrl, `${platform.url}/maps/${mapId}/native/manifest.json`);
  assert.deepEqual(result?.teamModels, [{model: 'tower', version: 2, sources: 'differ'}]);
  assert.equal(progress[0]?.kind, 'publishing');
  const entry = written?.maps.main;
  assert.equal(written?.apiUrl, platform.url);
  assert.equal(entry?.mapId, mapId);
  assert.equal(entry?.usageMode, 'session');
  assert.equal(entry?.worldGeneration, 'v1');
  assert.deepEqual(entry?.systemThemes, {dark: 'dark', light: 'light'});
  assert.equal(entry?.themes.light?.styleUrl, `${platform.url}/maps/${mapId}/light.json`);
  assert.equal(
    entry?.themes.dark?.revision,
    artifact.renderers.web.buildManifest.maps.main!.themes.dark!.styleSha256,
  );
  assert.deepEqual(
    result?.nativeDifferences.map((difference) => [
      describeNativeDifference(difference),
      difference.all ? 'all' : difference.themes.join(','),
    ]),
    [['Globe: drawn in Web Mercator', 'dark']],
  );
});

test('a failed or unconfirmed Hosted deploy preserves the manifest and releases its preparation', async (t) => {
  const artifact = await rendererDeployment();
  for (const intercept of [
    () => failure(503, 'TF_NATIVE_STAGING_UNAVAILABLE'),
    () => failure(403, 'TF_MAP_FORBIDDEN'),
    () => ({status: 200, body: {mapId, themes: {}}}),
  ]) {
    const platform = await startFakePlatform(t, {
      mapId,
      intercept: (request) => (request.path === '/v1/styles' ? intercept() : undefined),
    });
    const events: string[] = [];
    await assert.rejects(
      runHostedDeploy(
        prepared(artifact, events),
        {apiUrl: platform.url, manifest: 'tileflow.manifest.json'},
        {
          source: {kind: 'cli'},
          loadManifest: async () => null,
          resolveTarget: async () => ({apiKey, apiUrl: platform.url, mapId}),
          async writeManifest() {
            events.push('write');
            return '';
          },
        },
      ),
      HostedDeploymentError,
    );
    assert.deepEqual(events, ['dispose']);
  }
});

test('an existing manifest for another API stops the deploy before any target or request', async (t) => {
  const platform = await startFakePlatform(t, {mapId});
  const events: string[] = [];
  await assert.rejects(
    runHostedDeploy(
      prepared(await rendererDeployment(), events),
      {apiUrl: platform.url, manifest: 'tileflow.manifest.json'},
      {
        source: {kind: 'cli'},
        loadManifest: async () =>
          ({apiUrl: 'https://api.example.test', maps: {}, version: 1}) as TileflowRuntimeManifest,
        async resolveTarget() {
          events.push('target');
          return null;
        },
        writeManifest: async () => '',
      },
    ),
    /different Tileflow API origin/u,
  );
  assert.deepEqual(events, ['dispose']);
  assert.equal(platform.requests.length, 0);
});

test('native differences are summarized once each with the themes they apply to', async () => {
  const family = (await rendererDeployment()).renderers.native.family;
  assert.deepEqual(summarizeNativeDifferences(family), [
    {capability: 'globe', fallback: 'mercator', themes: ['dark'], all: false},
  ]);
});

test('a Hosted publication rate limit tells CI when to retry', async (t) => {
  const platform = await startFakePlatform(t, {
    mapId,
    intercept: (request) =>
      request.method === 'POST'
        ? {status: 429, headers: {'Retry-After': '180'}, body: {code: 'RATE_LIMITED'}}
        : undefined,
  });
  const input = await body(await rendererDeployment());
  await assert.rejects(
    publishHostedRendererDeployment({apiKey, apiUrl: platform.url, mapId}, input),
    (error: unknown) =>
      error instanceof HostedDeploymentError &&
      error.resumable &&
      error.status === 429 &&
      /retry in 180 seconds/iu.test(error.message),
  );
});
