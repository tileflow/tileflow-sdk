import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {serializeCanonicalJson} from '../src/icon-package';
import {createTileflowNativeBuildRecord} from '../src/native-build-record';
import {
  parseTileflowRendererDeploymentArtifact,
  tileflowRendererDeploymentArtifactSchema,
  tileflowRendererDeploymentResponseSchema,
} from '../src/renderer-deployment';

const hash = (value: unknown) =>
  createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
function artifact() {
  const style = {
    version: 8,
    sources: {
      tileflow: {
        type: 'vector',
        url: 'https://tiles.example/tiles/world/tiles.json',
        attribution: 'OpenStreetMap',
      },
    },
    metadata: {
      'tileflow:map': 'streets',
      'tileflow:mapVersion': 1,
      'tileflow:theme': 'light',
      'tileflow:colorScheme': 'light',
      'tileflow:compiler': 'tileflow-semantic',
      'tileflow:compilerVersion': 1,
    },
    layers: [{id: 'background', type: 'background', paint: {'background-color': '#ffffff'}}],
  };
  const buildManifest = {
    schemaVersion: 1,
    maps: {
      streets: {
        assetSetSha256: 'a'.repeat(64),
        mapRevisionSha256: 'b'.repeat(64),
        defaultTheme: 'light',
        lineage: [{id: 'streets', mapVersion: 1}],
        mapVersion: 1,
        semanticCompiler: {name: 'tileflow-semantic', version: 1},
        sourceAssets: {fonts: [], icons: []},
        themes: {
          light: {
            colorScheme: 'light',
            dataRequirements: {},
            sourceRequirements: {},
            styleSha256: hash(style),
            themeId: 'light',
            themeVersion: 1,
          },
        },
      },
    },
  };
  return {
    kind: 'tileflow-map-deployment',
    schemaVersion: 2,
    mapId: 'streets',
    teamSources: {},
    renderers: {
      web: {buildManifest, styles: {light: style}},
      native: {
        buildManifest: structuredClone(buildManifest),
        styles: {light: structuredClone(style)},
        buildRecord: createTileflowNativeBuildRecord(hash(buildManifest), [
          {
            map: 'streets',
            theme: 'light',
            inputStyleSha256: hash(style),
            loweredStyleSha256: hash(style),
            inputLayers: 1,
            outputLayers: 1,
            projection: 'none',
            layers: [],
          },
        ]),
      },
    },
  };
}

test('renderer deployment v2 binds one complete web and native family without widening v1', async () => {
  const value = artifact();
  const parsed = await parseTileflowRendererDeploymentArtifact(value);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.renderers.native.buildRecord.profile, 'native-v1');
  assert.deepEqual(
    parsed.renderers.web.buildManifest.maps,
    parsed.renderers.native.buildManifest.maps,
  );
  assert.equal(
    tileflowRendererDeploymentArtifactSchema.safeParse({...value, schemaVersion: 1}).success,
    false,
  );
  assert.equal(
    tileflowRendererDeploymentArtifactSchema.safeParse({
      ...value,
      styles: value.renderers.web.styles,
    }).success,
    false,
  );
});

test('renderer envelope rejects absent renderers, extra fields, theme and authored identity drift', async () => {
  for (const change of [
    (value: ReturnType<typeof artifact>) => {
      Reflect.deleteProperty(value.renderers, 'native');
    },
    (value: ReturnType<typeof artifact>) => {
      Object.assign(value.renderers, {unknown: {}});
    },
    (value: ReturnType<typeof artifact>) => {
      Reflect.deleteProperty(value.renderers.native.styles, 'light');
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildManifest.maps.streets.mapRevisionSha256 = 'c'.repeat(64);
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildManifest.maps.streets.assetSetSha256 = 'c'.repeat(64);
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildManifest.maps.streets.defaultTheme = 'dark';
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildRecord.engines.ios = '0.0.0' as '6.26.0';
    },
  ]) {
    const value = artifact();
    change(value);
    await assert.rejects(parseTileflowRendererDeploymentArtifact(value), {
      code: 'RENDERER_DEPLOYMENT_INVALID',
    });
  }
});

test('renderer hashes bind web input, native output and its complete build record', async () => {
  for (const change of [
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.styles.light.layers[0]!.paint['background-color'] = '#000000';
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildRecord.buildManifestSha256 = 'c'.repeat(64);
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildRecord.transformations[0]!.inputStyleSha256 = 'c'.repeat(64);
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.buildRecord.transformations = [];
    },
  ]) {
    const value = artifact();
    change(value);
    await assert.rejects(parseTileflowRendererDeploymentArtifact(value), {
      code: 'RENDERER_DEPLOYMENT_INVALID',
    });
  }
});

test('matching hashes do not permit a native cross-source or attribution substitution', async () => {
  for (const field of ['url', 'attribution'] as const) {
    const value = artifact();
    value.renderers.native.styles.light.sources.tileflow[field] = 'https://other.example/value';
    value.renderers.native.buildManifest.maps.streets.themes.light.styleSha256 = hash(
      value.renderers.native.styles.light,
    );
    value.renderers.native.buildRecord.buildManifestSha256 = hash(
      value.renderers.native.buildManifest,
    );
    await assert.rejects(parseTileflowRendererDeploymentArtifact(value), {
      code: 'RENDERER_DEPLOYMENT_INVALID',
    });
  }
});

test('renderer response has exact versioned Native routes and no credential or unknown payload', () => {
  const mapId = 'map_abcdefghijklmnop';
  const response = {
    kind: 'tileflow-map-deployment-result',
    schemaVersion: 2,
    changed: true,
    mapId,
    deploymentId: 'dpl_example',
    version: 7,
    renderers: {
      web: {themes: {light: {styleUrl: `https://api.example/maps/${mapId}/light.json`}}},
      native: {
        profile: 'native-v1',
        manifestUrl: `https://api.example/maps/${mapId}/native/manifest.json`,
        themes: {
          light: {
            styleUrl: `https://api.example/maps/${mapId}/native/v7/light.json`,
            revision: 'a'.repeat(64),
          },
        },
      },
    },
  };
  assert.equal(tileflowRendererDeploymentResponseSchema.safeParse(response).success, true);
  for (const value of [
    {...response, grant: 'must-not-be-accepted'},
    {...response, version: 8},
    {...response, mapId: 'map_ponmlkjihgfedcba'},
    {
      ...response,
      renderers: {
        ...response.renderers,
        native: {
          ...response.renderers.native,
          manifestUrl: `${response.renderers.native.manifestUrl}?credential=unexpected`,
        },
      },
    },
  ])
    assert.equal(tileflowRendererDeploymentResponseSchema.safeParse(value).success, false);
});
