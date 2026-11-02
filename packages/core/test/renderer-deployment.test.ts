import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {serializeCanonicalJson} from '../src/icon-package';
import {createTileflowNativeBuildRecord} from '../src/native-build-record';
import {createTileflowNativeFamily} from '../src/native-profile-family';
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
            removedLayers: [],
            insertedLayers: [],
            layers: [],
            symbolOverlap: [],
            degradations: [],
          },
        ]),
        family: createTileflowNativeFamily({
          map: 'streets',
          themes: ['light'],
          styles: {light: structuredClone(style) as never},
        }),
      },
    },
  };
}

/** The web style draws browser contours; its native style leaves them out and records it. */
function degradedArtifact() {
  const value = artifact();
  const web = value.renderers.web.styles.light as Record<string, any>;
  web.sources.contours = {
    type: 'vector',
    tiles: ['tileflow-contour://tiles/{z}/{x}/{y}.pbf'],
  };
  web.layers.push({id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours'});
  const native = value.renderers.native.styles.light as Record<string, any>;
  native.metadata['tileflow:nativeDegradations'] = [
    {
      id: 'deviceContours:contours',
      feature: 'deviceContours',
      reason: 'web-runtime',
      fallback: 'none',
      layers: ['contours'],
    },
  ];
  for (const family of [value.renderers.web, value.renderers.native])
    family.buildManifest.maps.streets.themes.light.styleSha256 = hash(
      family === value.renderers.web ? web : native,
    );
  value.renderers.native.buildRecord = createTileflowNativeBuildRecord(
    hash(value.renderers.native.buildManifest),
    [
      {
        ...value.renderers.native.buildRecord.transformations[0]!,
        inputStyleSha256: hash(web),
        loweredStyleSha256: hash(native),
        inputLayers: 2,
        removedLayers: [1],
        degradations: ['deviceContours:contours'],
      },
    ],
  );
  value.renderers.native.family = createTileflowNativeFamily({
    map: 'streets',
    themes: ['light'],
    styles: {light: native as never},
  });
  return value;
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
      value.renderers.native.buildRecord.engines.ios = '0.0.0' as '7.0.0';
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

test('the family document is the one Core computes from the native styles', async () => {
  const parsed = await parseTileflowRendererDeploymentArtifact(artifact());
  assert.deepEqual(parsed.renderers.native.family.themes[0]!.degradations, []);
  for (const change of [
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.family.themes[0]!.sun.azimuth = 10;
    },
    (value: ReturnType<typeof artifact>) => {
      value.renderers.native.family.map = 'other';
    },
    (value: ReturnType<typeof artifact>) => {
      Reflect.deleteProperty(value.renderers.native, 'family');
    },
  ]) {
    const value = artifact();
    change(value);
    await assert.rejects(parseTileflowRendererDeploymentArtifact(value), {
      code: 'RENDERER_DEPLOYMENT_INVALID',
    });
  }
});

test('a native style leaves out only the sources its degradations name', async () => {
  const parsed = await parseTileflowRendererDeploymentArtifact(degradedArtifact());
  assert.deepEqual(
    parsed.renderers.native.family.themes[0]!.degradations.map(({id}) => id),
    ['deviceContours:contours'],
  );
  for (const change of [
    (value: ReturnType<typeof degradedArtifact>) => {
      value.renderers.native.buildRecord.transformations[0]!.degradations = [];
    },
    (value: ReturnType<typeof degradedArtifact>) => {
      // The record is gone, so the omitted source is unexplained.
      const native = value.renderers.native.styles.light as Record<string, any>;
      native.metadata['tileflow:nativeDegradations'] = [];
      value.renderers.native.buildManifest.maps.streets.themes.light.styleSha256 = hash(native);
      value.renderers.native.buildRecord = createTileflowNativeBuildRecord(
        hash(value.renderers.native.buildManifest),
        [
          {
            ...value.renderers.native.buildRecord.transformations[0]!,
            loweredStyleSha256: hash(native),
            degradations: [],
          },
        ],
      );
      value.renderers.native.family = createTileflowNativeFamily({
        map: 'streets',
        themes: ['light'],
        styles: {light: native as never},
      });
    },
  ]) {
    const value = degradedArtifact();
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

test('renderer families preserve a matching valid time-of-day catalog and reject dangling targets', async () => {
  const value = artifact();
  for (const family of [value.renderers.web, value.renderers.native]) {
    Object.assign(family.buildManifest.maps.streets, {timeOfDay: {light: {day: 'light'}}});
  }
  value.renderers.native.buildRecord.buildManifestSha256 = hash(
    value.renderers.native.buildManifest,
  );
  const parsed = await parseTileflowRendererDeploymentArtifact(value);
  assert.deepEqual(parsed.renderers.web.buildManifest.maps.streets?.timeOfDay, {
    light: {day: 'light'},
  });
  for (const family of [value.renderers.web, value.renderers.native]) {
    Object.assign(family.buildManifest.maps.streets, {timeOfDay: {light: {day: 'absent'}}});
  }
  value.renderers.native.buildRecord.buildManifestSha256 = hash(
    value.renderers.native.buildManifest,
  );
  await assert.rejects(() => parseTileflowRendererDeploymentArtifact(value));
});
