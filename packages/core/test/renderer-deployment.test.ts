import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {serializeCanonicalJson} from '../src/icon-package';
import {createTileflowNativeBuildRecord} from '../src/native-build-record';
import {createTileflowNativeFamily} from '../src/native-profile-family';
import {
  parseTileflowRendererDeploymentArtifact,
  splitTileflowRendererDeployment,
  tileflowNativeDocumentReceiptSchema,
  tileflowRendererDeploymentArtifactSchema,
  tileflowRendererDeploymentPendingSchema,
  tileflowRendererDeploymentRequestArtifactSchema,
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

/** One map whose themes are the same style; each native style carries `padding` extra bytes. */
function paddedArtifact(themes: readonly string[], padding: number) {
  const base = artifact();
  const webStyles: Record<string, any> = {};
  const nativeStyles: Record<string, any> = {};
  const themeBuilds: Record<string, any> = {};
  const nativeBuilds: Record<string, any> = {};
  for (const theme of themes) {
    const web = structuredClone(base.renderers.web.styles.light) as Record<string, any>;
    web.metadata['tileflow:theme'] = theme;
    const native = structuredClone(web);
    native.metadata['tileflow:padding'] = 'x'.repeat(padding);
    webStyles[theme] = web;
    nativeStyles[theme] = native;
    const build = base.renderers.web.buildManifest.maps.streets.themes.light;
    themeBuilds[theme] = {...build, themeId: theme, styleSha256: hash(web)};
    nativeBuilds[theme] = {...build, themeId: theme, styleSha256: hash(native)};
  }
  const manifest = (builds: Record<string, any>) => ({
    ...base.renderers.web.buildManifest,
    maps: {
      streets: {
        ...base.renderers.web.buildManifest.maps.streets,
        defaultTheme: themes[0]!,
        themes: builds,
      },
    },
  });
  const nativeManifest = manifest(nativeBuilds);
  return {
    ...base,
    renderers: {
      web: {buildManifest: manifest(themeBuilds), styles: webStyles},
      native: {
        buildManifest: nativeManifest,
        styles: nativeStyles,
        buildRecord: createTileflowNativeBuildRecord(
          hash(nativeManifest),
          themes.map((theme) => ({
            ...base.renderers.native.buildRecord.transformations[0]!,
            theme,
            inputStyleSha256: hash(webStyles[theme]),
            loweredStyleSha256: hash(nativeStyles[theme]),
          })),
        ),
        family: createTileflowNativeFamily({map: 'streets', themes, styles: nativeStyles}),
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
    schemaVersion: 3,
    changed: true,
    mapId,
    deploymentId: 'dep_example',
    version: 7,
    renderers: {
      web: {themes: {light: {styleUrl: `https://api.example/maps/${mapId}/light.json`}}},
      native: {
        profile: 'native-v1',
        manifestUrl: `https://api.example/maps/${mapId}/native/manifest.json`,
        family: {
          url: `https://api.example/maps/${mapId}/native/family/v7.json`,
          revision: 'b'.repeat(64),
        },
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
  assert.equal(
    tileflowRendererDeploymentResponseSchema.safeParse({
      ...response,
      teamModels: [{model: 'clock-tower', version: 3, sources: 'differ'}],
    }).success,
    true,
  );
  const native = response.renderers.native;
  for (const value of [
    {...response, grant: 'must-not-be-accepted'},
    {...response, schemaVersion: 2},
    {...response, version: 8},
    {...response, mapId: 'map_ponmlkjihgfedcba'},
    {...response, teamModels: [{model: 'Clock Tower', version: 3, sources: 'differ'}]},
    {
      ...response,
      renderers: {
        ...response.renderers,
        native: {...native, manifestUrl: `${native.manifestUrl}?credential=unexpected`},
      },
    },
    {
      ...response,
      renderers: {
        ...response.renderers,
        native: {...native, family: {...native.family, url: native.family.url.replace('v7', 'v6')}},
      },
    },
    {
      ...response,
      renderers: {...response.renderers, native: {...native, family: undefined}},
    },
    {
      ...response,
      renderers: {
        ...response.renderers,
        native: {
          ...native,
          manifestUrl: `http://api.example/maps/${mapId}/native/manifest.json`,
        },
      },
    },
  ])
    assert.equal(tileflowRendererDeploymentResponseSchema.safeParse(value).success, false);
});

test('a pending deployment lists each missing document once at its upload route, family last', () => {
  const origin = 'https://api.example';
  const base = `${origin}/v1/styles/deployments/dep_example/native`;
  const pending = {
    kind: 'tileflow-map-deployment-pending',
    schemaVersion: 1,
    mapId: 'map_abcdefghijklmnop',
    deploymentId: 'dep_example',
    version: 4,
    native: {
      documents: [
        {
          document: 'style',
          theme: 'dark',
          sha256: 'a'.repeat(64),
          bytes: 120,
          method: 'PUT',
          url: `${base}/styles/dark.json`,
        },
        {
          document: 'family',
          sha256: 'b'.repeat(64),
          bytes: 80,
          method: 'PUT',
          url: `${base}/family.json`,
        },
      ],
    },
  };
  assert.equal(tileflowRendererDeploymentPendingSchema.safeParse(pending).success, true);
  const [style, family] = pending.native.documents;
  for (const documents of [
    [family, style],
    [style, style, family],
    [{...style, url: `${base}/styles/light.json`}],
    [
      style,
      {
        ...family,
        url: `https://other.example/v1/styles/deployments/dep_example/native/family.json`,
      },
    ],
    [{...style, method: 'POST'}],
    [{...style, bytes: 9 * 1024 * 1024}],
    [],
  ])
    assert.equal(
      tileflowRendererDeploymentPendingSchema.safeParse({...pending, native: {documents}}).success,
      false,
    );
  assert.equal(
    tileflowRendererDeploymentPendingSchema.safeParse({...pending, deploymentId: 'other'}).success,
    false,
  );
  // The client binds the origin to the API it called; the reply binds every route to one origin.
  // Loopback HTTP serves local development of the API.
  const local = JSON.parse(
    JSON.stringify(pending).replaceAll('https://api.example', 'http://127.0.0.1:8787'),
  );
  assert.equal(tileflowRendererDeploymentPendingSchema.safeParse(local).success, true);
});

test('a document receipt names its theme only for a style', () => {
  const receipt = {
    kind: 'tileflow-native-document-receipt',
    schemaVersion: 1,
    deploymentId: 'dep_example',
    version: 4,
    document: 'style',
    theme: 'dark',
    sha256: 'a'.repeat(64),
    bytes: 120,
  };
  assert.equal(tileflowNativeDocumentReceiptSchema.safeParse(receipt).success, true);
  const {theme: _theme, ...family} = receipt;
  assert.equal(
    tileflowNativeDocumentReceiptSchema.safeParse({...family, document: 'family'}).success,
    true,
  );
  assert.equal(tileflowNativeDocumentReceiptSchema.safeParse(family).success, false);
  assert.equal(
    tileflowNativeDocumentReceiptSchema.safeParse({...receipt, document: 'family'}).success,
    false,
  );
});

test('split carries the web family in the request and each native document as canonical bytes', async () => {
  const value = await parseTileflowRendererDeploymentArtifact(artifact());
  const split = await splitTileflowRendererDeployment(value);
  assert.equal(split.artifact.schemaVersion, 3);
  assert.deepEqual(split.artifact.renderers.web, value.renderers.web);
  assert.deepEqual(Object.keys(split.artifact.renderers.native).sort(), [
    'buildManifest',
    'buildRecord',
    'documents',
  ]);
  const {documents} = split.artifact.renderers.native;
  const styleText = serializeCanonicalJson(value.renderers.native.styles.light);
  assert.equal(split.documents.styles.light, styleText);
  assert.deepEqual(documents.styles.light, {
    sha256: createHash('sha256').update(styleText).digest('hex'),
    bytes: Buffer.byteLength(styleText),
  });
  assert.equal(
    documents.styles.light!.sha256,
    value.renderers.native.buildManifest.maps.streets!.themes.light!.styleSha256,
  );
  assert.equal(split.documents.family, serializeCanonicalJson(value.renderers.native.family));
  assert.deepEqual(documents.family, {
    sha256: createHash('sha256').update(split.documents.family).digest('hex'),
    bytes: Buffer.byteLength(split.documents.family),
    themes: ['light'],
  });
  assert.equal(
    tileflowRendererDeploymentRequestArtifactSchema.safeParse(split.artifact).success,
    true,
  );
  for (const change of [
    (request: Record<string, any>) => {
      request.renderers.native.documents.styles.light.sha256 = 'c'.repeat(64);
    },
    (request: Record<string, any>) => {
      request.renderers.native.documents.family.themes = ['light', 'light'];
    },
    (request: Record<string, any>) => {
      request.renderers.native.documents.styles.dark = {sha256: 'c'.repeat(64), bytes: 10};
    },
    (request: Record<string, any>) => {
      request.renderers.native.styles = value.renderers.native.styles;
    },
  ]) {
    const request = structuredClone(split.artifact) as Record<string, any>;
    change(request);
    assert.equal(tileflowRendererDeploymentRequestArtifactSchema.safeParse(request).success, false);
  }
});

test('budgets apply per native document and per family, not to the whole artifact', async () => {
  // Three themes whose native styles hold 3 MiB each: over one document's worth together, but each
  // document and the family stay within their budgets.
  const themes = ['dark', 'dusk', 'light'];
  const padded = paddedArtifact(themes, 3 * 1024 * 1024);
  const parsed = await parseTileflowRendererDeploymentArtifact(padded);
  const split = await splitTileflowRendererDeployment(parsed);
  assert.deepEqual(Object.keys(split.documents.styles), themes);
  for (const document of Object.values(split.artifact.renderers.native.documents.styles))
    assert.ok(document.bytes > 3 * 1024 * 1024);
  // One document over 8 MiB is refused.
  await assert.rejects(
    parseTileflowRendererDeploymentArtifact(paddedArtifact(['light'], 8 * 1024 * 1024 + 1)),
    {code: 'RENDERER_DEPLOYMENT_INVALID'},
  );
  await assert.rejects(
    splitTileflowRendererDeployment(
      paddedArtifact(['light'], 8 * 1024 * 1024 + 1) as unknown as typeof parsed,
    ),
    {code: 'RENDERER_DEPLOYMENT_INVALID'},
  );
});

test("a map's own tree model identities are part of its build manifest", async () => {
  const value = artifact();
  const models = [
    {id: 'streets-tree-open', level: 'far', sha256: 'c'.repeat(64)},
    {id: 'streets-tree-open', level: 'near', sha256: 'd'.repeat(64)},
  ];
  for (const family of [value.renderers.web, value.renderers.native])
    Object.assign(family.buildManifest.maps.streets.sourceAssets, {models});
  value.renderers.native.buildRecord.buildManifestSha256 = hash(
    value.renderers.native.buildManifest,
  );
  const parsed = await parseTileflowRendererDeploymentArtifact(value);
  assert.deepEqual(parsed.renderers.web.buildManifest.maps.streets?.sourceAssets.models, models);
  for (const family of [value.renderers.web, value.renderers.native])
    Object.assign(family.buildManifest.maps.streets.sourceAssets, {
      models: [{id: 'Open Tree', level: 'far', sha256: 'c'.repeat(64)}],
    });
  value.renderers.native.buildRecord.buildManifestSha256 = hash(
    value.renderers.native.buildManifest,
  );
  await assert.rejects(parseTileflowRendererDeploymentArtifact(value));
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
