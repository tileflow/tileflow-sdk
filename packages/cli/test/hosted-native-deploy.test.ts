import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {serializeCanonicalJson, type MapLibreStyle} from '@tileflow/core';
import {
  inferTileflowDataRequirements,
  inferTileflowSourceRequirements,
  type TileflowMapBuildManifestV1,
} from '@tileflow/core/build';
import {prepareTileflowHostedNativeDeployment} from '@tileflow/dev';
import {runHostedNativeDeploy, type PreparedNativeDeploy} from '../src/hosted-native-deploy';
import type {TileflowRuntimeManifest} from '@tileflow/core/manifest';

const apiUrl = 'https://api.example.test';
const mapId = 'map_0123456789abcdef';
const options = {config: 'tileflow.config.ts', manifest: 'tileflow.manifest.json', apiUrl, mapId};
const digest = (value: unknown) =>
  createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');

async function prepared(): Promise<PreparedNativeDeploy> {
  const style: MapLibreStyle = {
    version: 8,
    sources: {},
    layers: [{id: 'background', type: 'background'}],
    metadata: {
      'tileflow:map': 'main',
      'tileflow:mapVersion': 1,
      'tileflow:theme': 'light',
      'tileflow:colorScheme': 'light',
    },
  };
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
        themes: {
          light: {
            colorScheme: 'light',
            dataRequirements: inferTileflowDataRequirements(style),
            sourceRequirements: inferTileflowSourceRequirements(style),
            styleSha256: digest(style),
            themeId: 'light',
            themeVersion: 1,
          },
        },
      },
    },
  };
  const artifact = await prepareTileflowHostedNativeDeployment({
    mapId: 'main',
    styles: {light: style},
    buildManifest,
    assets: [],
    teamSources: {},
  });
  return {
    mapName: 'main',
    artifact,
    packages: [],
    async retarget() {
      return artifact;
    },
    async dispose() {},
  };
}
function receipt() {
  return {
    kind: 'tileflow-map-deployment-result',
    schemaVersion: 2,
    changed: true,
    mapId,
    deploymentId: 'dep_fixture',
    version: 7,
    renderers: {
      web: {themes: {light: {styleUrl: `${apiUrl}/maps/${mapId}/light.json`}}},
      native: {
        profile: 'native-v1',
        manifestUrl: `${apiUrl}/maps/${mapId}/native/manifest.json`,
        themes: {
          light: {
            styleUrl: `${apiUrl}/maps/${mapId}/native/v7/light.json`,
            revision: 'a'.repeat(64),
          },
        },
      },
    },
  };
}

test('native selection rejects absent target and unsafe origin before local config or remote work', async () => {
  for (const patch of [
    {mapId: undefined},
    {mapId: 'invalid'},
    {apiUrl: 'http://api.example.test'},
  ]) {
    let work = 0;
    await assert.rejects(
      runHostedNativeDeploy(
        {...options, ...patch},
        {
          source: {kind: 'cli'},
          async resolveApi() {
            work++;
            return null;
          },
          async prepare() {
            work++;
            return prepared();
          },
          async loadManifest() {
            work++;
            return null;
          },
          async writeManifest() {
            work++;
            return '';
          },
        },
      ),
    );
    assert.equal(work, 0);
  }
});

test('complete preflight and existing-manifest checks precede authentication and schema-2 publication', async () => {
  const events: string[] = [];
  let written: TileflowRuntimeManifest | undefined;
  const candidate = await prepared();
  const before = digest(candidate.artifact);
  const output = await runHostedNativeDeploy(options, {
    source: {kind: 'cli'},
    async prepare() {
      events.push('preflight');
      return {
        ...candidate,
        async dispose() {
          events.push('dispose');
        },
      };
    },
    async loadManifest() {
      events.push('existing');
      return null;
    },
    async resolveApi() {
      events.push('auth');
      return {apiUrl, apiKey: 'tf_cap_fixture', mapId};
    },
    request: {
      fetch: async (url, init) => {
        events.push('publish');
        assert.equal(url, `${apiUrl}/v1/styles`);
        assert.equal(init?.redirect, 'error');
        assert.equal(new Headers(init?.headers).get('X-Tileflow-Map-Id'), mapId);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.artifact.schemaVersion, 2);
        assert.equal(body.managedMapId, mapId);
        assert.equal(body.usageMode, 'session');
        assert.deepEqual(Object.keys(body.artifact.renderers).sort(), ['native', 'web']);
        return Response.json(receipt());
      },
    },
    async writeManifest(path, value) {
      events.push('write');
      written = value;
      return path;
    },
  });
  assert.deepEqual(events, ['preflight', 'existing', 'auth', 'publish', 'write', 'dispose']);
  assert.equal(output?.nativeManifestUrl, receipt().renderers.native.manifestUrl);
  assert.equal(written?.version, 1, 'Existing strict web clients continue to read version 1.');
  assert.equal(written?.maps.main?.mapId, mapId);
  assert.equal(Object.hasOwn(written!, 'renderers'), false);
  assert.equal(digest(candidate.artifact), before);
});

test('invalid native preflight cannot perform even authentication', async () => {
  let remote = 0;
  await assert.rejects(
    runHostedNativeDeploy(options, {
      source: {kind: 'cli'},
      async prepare() {
        throw new Error('Native incompatibility.');
      },
      async loadManifest() {
        return null;
      },
      async resolveApi() {
        remote++;
        return null;
      },
      async writeManifest() {
        assert.fail('No manifest replacement.');
      },
    }),
  );
  assert.equal(remote, 0);
});

test('failed, mismatched or legacy responses preserve the previous manifest and dispose preparation', async () => {
  for (const reply of [
    () => new Response('', {status: 503}),
    () => Response.json({...receipt(), mapId: 'map_abcdefghijklmnop'}),
    () => Response.json({mapId, themes: receipt().renderers.web.themes}),
    () =>
      Response.json({
        ...receipt(),
        renderers: {
          ...receipt().renderers,
          native: {
            ...receipt().renderers.native,
            manifestUrl: 'https://other.example/manifest.json',
          },
        },
      }),
    () =>
      Response.json({
        ...receipt(),
        renderers: {
          ...receipt().renderers,
          native: {
            ...receipt().renderers.native,
            themes: {
              light: {
                styleUrl: `${apiUrl}/maps/${mapId}/native/v8/light.json`,
                revision: 'a'.repeat(64),
              },
            },
          },
        },
      }),
  ]) {
    let writes = 0;
    let disposed = 0;
    const candidate = await prepared();
    await assert.rejects(
      runHostedNativeDeploy(options, {
        source: {kind: 'cli'},
        async prepare() {
          return {
            ...candidate,
            async dispose() {
              disposed++;
            },
          };
        },
        async loadManifest() {
          return null;
        },
        async resolveApi() {
          return {apiUrl, apiKey: 'tf_cap_fixture', mapId};
        },
        request: {fetch: async () => reply()},
        async writeManifest() {
          writes++;
          return '';
        },
      }),
    );
    assert.equal(writes, 0);
    assert.equal(disposed, 1);
  }
});

test('an idempotent server retry writes the confirmed manifest without creating another destination', async () => {
  const candidate = await prepared();
  let publications = 0;
  const result = await runHostedNativeDeploy(options, {
    source: {kind: 'cli'},
    async prepare() {
      return candidate;
    },
    async loadManifest() {
      return null;
    },
    async resolveApi() {
      return {apiUrl, apiKey: 'tf_cap_fixture', mapId};
    },
    request: {
      fetch: async () => {
        publications++;
        return Response.json({...receipt(), changed: false});
      },
    },
    async writeManifest(path) {
      return path;
    },
  });
  assert.equal(result?.changed, false);
  assert.equal(result?.version, 7);
  assert.equal(publications, 1);
});
