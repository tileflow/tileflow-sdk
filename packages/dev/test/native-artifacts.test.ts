import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {hostedTileset, type MapLibreStyle, serializeCanonicalJson} from '@tileflow/core';
import {parseTileflowRuntimeManifest} from '@tileflow/core/manifest';
import {
  createTileflowNativeDiagnostic,
  tileflowNativeBuildRecordSchema,
  TileflowNativeCompatibilityError,
  validateTileflowNativePreparedStyle,
} from '@tileflow/core/native-profile';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {
  createTileflowArtifactSession,
  createTileflowBuildArtifacts,
  disposeTileflowBuildArtifacts,
  getTileflowArtifactFiles,
  writeTileflowBuildArtifacts,
} from '../src/artifacts';
import {
  assertTileflowNativeCompiledStyles,
  prepareTileflowNativeStyles,
} from '../src/native-artifacts';
import {createTileflowArtifactDiagnostics} from '../src/session';
import {createTileflowCommandFailureDocument} from '../src/validation';

const config = (extra = '') => `import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
export default defineMap({id:'main',version:1,extends:streets,${extra}});\n`;

async function fixture(t: {after(callback: () => Promise<void>): void}) {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-native-artifacts-'));
  t.after(() => rm(cwd, {recursive: true, force: true}));
  await linkWorkspacePackages(cwd, ['core', 'maps']);
  await writeFile(join(cwd, 'tileflow.config.ts'), config());
  return cwd;
}

function digest(source: string | Uint8Array): string {
  return createHash('sha256').update(source).digest('hex');
}

async function snapshot(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(path: string, prefix: string) {
    for (const entry of await readdir(path, {withFileTypes: true})) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(join(path, entry.name), `${name}/`);
      else result[name] = digest(await readFile(join(path, entry.name)));
    }
  }
  await walk(directory, '');
  return result;
}

test('default and explicit web preparation preserve every artifact byte and public object key', async (t) => {
  const cwd = await fixture(t);
  const implicit = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
  const explicit = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.', renderer: 'web'});
  t.after(() => disposeTileflowBuildArtifacts(implicit));
  t.after(() => disposeTileflowBuildArtifacts(explicit));
  assert.deepEqual(implicit.files, explicit.files);
  assert.deepEqual(Object.keys(implicit), Object.keys(explicit));
  assert.equal(Object.hasOwn(implicit, 'nativeBuild'), false);
});

test('prepares Streets and every theme deterministically without changing logical map revision', async (t) => {
  const cwd = await fixture(t);
  const options = {cwd, styleBaseUrl: '.', renderer: 'native' as const};
  const first = await createTileflowBuildArtifacts(options);
  const second = await createTileflowBuildArtifacts(options);
  const web = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.'});
  for (const artifacts of [first, second, web])
    t.after(() => disposeTileflowBuildArtifacts(artifacts));
  assert.deepEqual(first.files, second.files);
  assert.deepEqual(Object.keys(first.styles.main!).sort(), Object.keys(web.styles.main!).sort());
  assert.equal(
    first.buildManifest.maps.main!.mapRevisionSha256,
    web.buildManifest.maps.main!.mapRevisionSha256,
  );
  assert.deepEqual(parseTileflowRuntimeManifest(first.manifest), first.manifest);
  assert.equal(first.manifest.version, 1);
  assert.equal(Object.hasOwn(first.manifest, 'renderer'), false);
  assert.equal(Object.hasOwn(first.manifest, 'profile'), false);
  assert.ok(first.nativeBuild);
  assert.deepEqual(tileflowNativeBuildRecordSchema.parse(first.nativeBuild), first.nativeBuild);
  assert.equal(
    first.nativeBuild.buildManifestSha256,
    digest(serializeCanonicalJson(first.buildManifest)),
  );
  const record = first.files.find(({fileName}) => fileName === 'native-build.json');
  assert.ok(record);
  assert.deepEqual(JSON.parse(String(record.source)), first.nativeBuild);
  for (const theme of Object.keys(first.styles.main!)) {
    assert.equal(Object.hasOwn(first.styles.main![theme]!, 'projection'), false);
    assert.equal(Object.hasOwn(first.manifest.maps.main!.themes[theme]!, 'fontFaces'), false);
  }
});

test('written native styles bind POI priorities and overlay anchors to lowered layer indexes', async (t) => {
  const cwd = await fixture(t);
  const native = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '.', renderer: 'native'});
  t.after(() => disposeTileflowBuildArtifacts(native));
  assert.ok(native.nativeBuild);
  for (const {theme, layers: spans} of native.nativeBuild.transformations) {
    const files = native.files.filter(({fileName}) =>
      fileName.endsWith(`styles/main/${theme}.json`),
    );
    assert.equal(files.length, 2, 'Stable and generation styles are both checked.');
    for (const file of files) {
      const style = JSON.parse(String(file.source)) as MapLibreStyle;
      const metadata = style.metadata as {
        'tileflow:interaction-manifest': {
          domains: {poi: {layers: {layerId: string; priority: number}[]}};
        };
        'tileflow:overlay-placement-manifest': {anchors: Record<string, string | null>};
      };
      const ids = style.layers.map(({id}) => id as string);
      const poi = metadata['tileflow:interaction-manifest'].domains.poi.layers;
      const first = Math.min(...poi.map(({priority}) => priority));
      const shift = spans
        .filter(({outputStart}) => outputStart < first)
        .reduce((total, {outputCount}) => total + outputCount - 1, 0);
      assert.ok(shift > 0, 'Streets expands line layers below its POI layers.');
      for (const {layerId, priority} of poi) assert.equal(ids[priority], layerId, file.fileName);

      const anchors = Object.values(metadata['tileflow:overlay-placement-manifest'].anchors);
      const boundaries = anchors.map((anchor) =>
        anchor === null ? ids.length : ids.indexOf(anchor),
      );
      assert.ok(
        boundaries.every((index) => index >= 0),
        JSON.stringify(anchors),
      );
      assert.deepEqual(
        boundaries,
        [...boundaries].sort((left, right) => left - right),
      );
      for (const {outputStart, outputCount} of spans) {
        for (const branch of ids.slice(outputStart + 1, outputStart + outputCount))
          assert.equal(anchors.includes(branch), false, branch);
      }
    }
  }
});

test('uses independent web/native output inventories and retargets absolute asset roots once', async (t) => {
  const cwd = await fixture(t);
  const common = {
    cwd,
    outDir: 'public/tileflow',
    styleBaseUrl: '/tileflow',
    assetBaseUrl: '/tileflow',
  };
  await writeTileflowBuildArtifacts(common);
  const before = await readFile(join(cwd, 'public/tileflow/manifest.json'));
  await writeTileflowBuildArtifacts({...common, renderer: 'native'});
  assert.deepEqual(await readFile(join(cwd, 'public/tileflow/manifest.json')), before);
  const nativeRoot = join(cwd, 'public/tileflow/native');
  const native = JSON.parse(await readFile(join(nativeRoot, 'manifest.json'), 'utf8'));
  parseTileflowRuntimeManifest(native);
  for (const entry of Object.values(native.maps.main.themes) as {styleUrl: string}[]) {
    assert.match(entry.styleUrl, /^\/tileflow\/native\/generations\/[a-f0-9]{64}\/styles\/main\//u);
    const style = JSON.parse(await readFile(join(cwd, 'public', entry.styleUrl.slice(1)), 'utf8'));
    assert.match(
      style.sprite,
      /^\/tileflow\/native\/generations\/[a-f0-9]{64}\/icons\/main\/sprite$/u,
    );
    await readFile(join(cwd, 'public', style.sprite.slice(1) + '.png'));
    await readFile(join(cwd, 'public', style.sprite.slice(1) + '@2x.png'));
  }
  const nativeBefore = await snapshot(nativeRoot);
  await writeTileflowBuildArtifacts(common);
  assert.deepEqual(await snapshot(nativeRoot), nativeBefore);
});

test('keeps icon inheritance and both generated sprite densities byte-identical', async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'icons'));
  await writeFile(
    join(cwd, 'icons/coffee.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M1 1h22v22H1z"/></svg>',
  );
  await writeFile(join(cwd, 'tileflow.config.ts'), config("icons:[...streets.icons,'./icons'],"));
  const web = await createTileflowBuildArtifacts({cwd});
  const native = await createTileflowBuildArtifacts({cwd, renderer: 'native'});
  t.after(() => disposeTileflowBuildArtifacts(web));
  t.after(() => disposeTileflowBuildArtifacts(native));
  assert.deepEqual(
    native.assets.filter(({fileName}) => fileName.startsWith('icons/')),
    web.assets.filter(({fileName}) => fileName.startsWith('icons/')),
  );
  for (const [suffix, ratio] of [
    ['', 1],
    ['@2x', 2],
  ] as const) {
    const file = native.assets.find(({fileName}) => fileName === `icons/main/sprite${suffix}.json`);
    assert.ok(file);
    const index = JSON.parse(Buffer.from(file.source as Uint8Array).toString('utf8'));
    assert.equal(index.coffee.pixelRatio, ratio);
  }
  const badAssets = web.assets.map((asset) => {
    if (asset.fileName !== 'icons/main/sprite@2x.json') return asset;
    const index = JSON.parse(Buffer.from(asset.source as Uint8Array).toString('utf8'));
    index.coffee.pixelRatio = 1;
    return {...asset, source: JSON.stringify(index)};
  });
  assert.throws(
    () => prepareTileflowNativeStyles(web.styles, badAssets),
    TileflowNativeCompatibilityError,
  );
});

test('maps a licensed custom TTF by its exact full name without changing map identity', async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'fonts'));
  await cp(
    new URL('./fixtures/fonts/oxanium/Oxanium-Medium.ttf', import.meta.url),
    join(cwd, 'fonts/face.ttf'),
  );
  await cp(
    new URL('./fixtures/fonts/oxanium/LICENSE.txt', import.meta.url),
    join(cwd, 'fonts/LICENSE.txt'),
  );
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {defineMap,defineTheme} from '@tileflow/core';
import {streets,streetsThemes} from '@tileflow/maps';
const themes = Object.fromEntries(Object.entries(streetsThemes).map(([name,theme]) => [name,defineTheme(theme,{
  id:'custom-'+name,version:1,colorScheme:theme.colorScheme,
  tokens:{font:Object.fromEntries(Object.keys(theme.tokens.font).map(name=>[name,'Oxanium Medium']))}
})]));
export default defineMap({id:'main',version:1,extends:streets,themes,fonts:['./fonts']});\n`,
  );
  const web = await createTileflowBuildArtifacts({cwd, styleBaseUrl: '/tileflow'});
  const native = await createTileflowBuildArtifacts({
    cwd,
    renderer: 'native',
    styleBaseUrl: '/tileflow',
  });
  t.after(() => disposeTileflowBuildArtifacts(web));
  t.after(() => disposeTileflowBuildArtifacts(native));
  assert.equal(
    native.buildManifest.maps.main!.mapRevisionSha256,
    web.buildManifest.maps.main!.mapRevisionSha256,
  );
  assert.deepEqual(
    native.buildManifest.maps.main!.sourceAssets,
    web.buildManifest.maps.main!.sourceAssets,
  );
  for (const theme of Object.keys(native.styles.main!)) {
    const style = native.styles.main![theme]! as MapLibreStyle & {
      'font-faces': Record<string, string>;
    };
    assert.deepEqual(Object.keys(style['font-faces']), ['Oxanium Medium']);
    assert.match(
      style['font-faces']['Oxanium Medium']!,
      /^\/tileflow\/native\/fonts\/oxanium-medium-[a-f0-9]{64}\.ttf$/u,
    );
    assert.equal(style.metadata?.['tileflow:fontFaces'], undefined);
    assert.notEqual(
      native.buildManifest.maps.main!.themes[theme]!.styleSha256,
      web.buildManifest.maps.main!.themes[theme]!.styleSha256,
    );
  }
  const immutable = native.files.find(({fileName}) =>
    /^generations\/.*\/styles\/main\/light\.json$/u.test(fileName),
  );
  assert.ok(immutable);
  const faces = JSON.parse(String(immutable.source))['font-faces'];
  assert.match(faces['Oxanium Medium'], /^\/tileflow\/native\/generations\/[a-f0-9]{64}\/fonts\//u);
  await rm(join(cwd, 'fonts/LICENSE.txt'));
  await assert.rejects(
    createTileflowBuildArtifacts({cwd, renderer: 'native'}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeCompatibilityError);
      assert.equal(error.issues[0]?.code, 'NATIVE_FONT_UNAVAILABLE');
      return true;
    },
  );
});

for (const [label, extra, expectedPath] of [
  ['terrain displacement', "terrain:'3d',", '/terrain'],
] as const) {
  test(`rejects ${label} before replacing an existing native output`, async (t) => {
    const cwd = await fixture(t);
    await writeTileflowBuildArtifacts({cwd, renderer: 'native', outDir: 'output'});
    const before = await snapshot(join(cwd, 'output'));
    await writeFile(join(cwd, 'tileflow.config.ts'), config(extra));
    await assert.rejects(
      writeTileflowBuildArtifacts({cwd, renderer: 'native', outDir: 'output'}),
      (error: unknown) => {
        assert.ok(error instanceof TileflowNativeCompatibilityError);
        assert.ok(error.issues.some(({path}) => path.endsWith(expectedPath)));
        return true;
      },
    );
    assert.deepEqual(await snapshot(join(cwd, 'output')), before);
  });
}

test('forwards the renderer into watched generations and retains the last valid one on failure', async (t) => {
  const cwd = await fixture(t);
  const session = await createTileflowArtifactSession({
    cwd,
    renderer: 'native',
    watch: true,
    debounceMs: 10,
  });
  try {
    assert.equal(session.getState().status, 'ready');
    const previous = session.getLastGoodArtifacts();
    assert.ok(previous?.nativeBuild);
    const generation = session.getState().generation;
    let readyEvents = 0;
    session.subscribe((state) => {
      if (state.status === 'ready') readyEvents++;
    });
    await writeFile(join(cwd, 'tileflow.config.ts'), config("terrain:'3d',"));
    const deadline = Date.now() + 10_000;
    while (session.getState().status !== 'invalid' && Date.now() < deadline) await delay(25);
    const invalid = session.getState();
    assert.equal(invalid.status, 'invalid');
    if (invalid.status !== 'invalid') throw new Error('Expected an invalid generation.');
    assert.equal(invalid.lastGoodGeneration, generation);
    assert.equal(session.getLastGoodArtifacts(), previous);
    assert.equal(readyEvents, 0);
    assert.equal(invalid.diagnostics[0]?.renderer, 'native');
    assert.equal(invalid.diagnostics[0]?.profile, 'native-v1');
    assert.match(invalid.diagnostics[0]?.path ?? '', /^\/maps\/main\/themes\//u);
  } finally {
    await session.close();
  }
});

test('preserves native context in existing diagnostic envelopes without treating pointers as filesystem paths', () => {
  const error = new TileflowNativeCompatibilityError([
    createTileflowNativeDiagnostic(
      'NATIVE_UNSUPPORTED_SOURCE',
      '/maps/main/themes/light/style/sources/world/url',
    ),
  ]);
  const expected = [...error.issues];
  assert.deepEqual(createTileflowArtifactDiagnostics(error, '/tmp/project'), expected);
  const failure = createTileflowCommandFailureDocument('validate', error, '/tmp/project', {
    code: 'VALIDATION_FAILED',
    phase: 'validation',
  });
  assert.deepEqual(failure.diagnostics, expected);
  assert.equal(failure.renderer, 'native');
  assert.equal(failure.profile, 'native-v1');
  assert.equal(failure.schemaVersion, 1);
  const ordinary = createTileflowCommandFailureDocument(
    'validate',
    new Error('Invalid input.'),
    '/tmp/project',
    {code: 'VALIDATION_FAILED', phase: 'validation'},
  );
  assert.equal(Object.hasOwn(ordinary, 'renderer'), false);
  assert.equal(Object.hasOwn(ordinary, 'profile'), false);
});

test('rejects an unresolved local archive before the native snapshot/preparation path', async (t) => {
  const cwd = await fixture(t);
  const artifacts = await createTileflowBuildArtifacts({cwd});
  t.after(() => disposeTileflowBuildArtifacts(artifacts));
  const map = artifacts.project.maps.main!;
  const project = {
    maps: {
      main: {
        ...map,
        sources: {
          roads: hostedTileset({
            local: './missing.pmtiles',
            tileset: 'roads',
            attribution: 'Test fixture',
          }),
        },
      },
    },
  };
  assert.throws(
    () =>
      assertTileflowNativeCompiledStyles(project, {
        main: {
          light: {
            version: 8,
            name: 'Unresolved archive',
            sources: {roads: {type: 'vector', url: 'tileflow-pmtiles://./missing.pmtiles'}},
            layers: [],
          },
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeCompatibilityError);
      assert.equal(error.issues[0]?.code, 'NATIVE_UNSUPPORTED_SOURCE');
      assert.equal(error.issues[0]?.path, '/maps/main/themes/light/style/sources/roads/url');
      return true;
    },
  );
});

test('preserves the authored portable view instead of applying native runtime camera defaults', async (t) => {
  const cwd = await fixture(t);
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    config('view:{pitch:70,zoom:12,center:[-3.7,40.4]},'),
  );
  const artifacts = await createTileflowBuildArtifacts({cwd, renderer: 'native'});
  t.after(() => disposeTileflowBuildArtifacts(artifacts));
  assert.equal(artifacts.manifest.maps.main!.view?.pitch, 70);
  assert.deepEqual(artifacts.manifest.maps.main!.view?.center, [-3.7, 40.4]);
});

test('accepts locally built sprites served over HTTP only from the explicit preview origin', async (t) => {
  const cwd = await fixture(t);
  const origin = 'http://127.0.0.1:3333';
  // Native preview serves every locally built asset from its own absolute HTTP origin.
  const preview = {cwd, renderer: 'native' as const, assetBaseUrl: origin, styleBaseUrl: origin};
  for (const developmentOrigin of [undefined, 'http://127.0.0.1:3334', 'http://localhost:3333']) {
    await assert.rejects(
      createTileflowBuildArtifacts({...preview, developmentOrigin}),
      (error: unknown) => {
        assert.ok(error instanceof TileflowNativeCompatibilityError);
        assert.ok(
          error.issues.some(
            ({code, path}) =>
              code === 'NATIVE_UNSUPPORTED_SOURCE' &&
              /^\/maps\/main\/themes\/[^/]+\/style\/sprite$/u.test(path),
          ),
        );
        return true;
      },
    );
  }

  const session = await createTileflowArtifactSession({...preview, developmentOrigin: origin});
  t.after(() => session.close());
  const state = session.getState();
  assert.equal(state.status, 'ready', JSON.stringify(state));
  const artifacts = session.getLastGoodArtifacts();
  assert.ok(artifacts);
  const files = new Map(
    getTileflowArtifactFiles(artifacts).map((file) => [`${origin}/native/${file.fileName}`, file]),
  );
  const themes = Object.values(artifacts.manifest.maps.main!.themes);
  assert.equal(themes.length, Object.keys(artifacts.styles.main!).length);
  for (const {styleUrl} of themes) {
    const file = files.get(styleUrl);
    assert.ok(file, styleUrl);
    const style = JSON.parse(String(file.source)) as MapLibreStyle;
    assert.match(
      String(style.sprite),
      /^http:\/\/127\.0\.0\.1:3333\/native\/generations\/[a-f0-9]{64}\/icons\/main\/sprite$/u,
    );
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png'])
      assert.ok(files.has(`${style.sprite}${suffix}`), suffix);
    // A native client configured with the same development origin applies the same check.
    assert.deepEqual(
      validateTileflowNativePreparedStyle(style, {
        documentUrl: styleUrl,
        developmentOrigin: origin,
      }),
      [],
    );
  }
});

test('keeps other origins, web and written output outside the native preview HTTP exception', async (t) => {
  const cwd = await fixture(t);
  const origin = 'http://127.0.0.1:3333';
  const preview = {
    cwd,
    renderer: 'native' as const,
    assetBaseUrl: origin,
    styleBaseUrl: origin,
    developmentOrigin: origin,
  };
  await assert.rejects(
    createTileflowBuildArtifacts({...preview, apiBaseUrl: 'http://127.0.0.1:8787'}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeCompatibilityError);
      assert.ok(
        error.issues.some(
          ({code, path}) =>
            code === 'NATIVE_UNSUPPORTED_SOURCE' && /\/style\/sources\/[^/]+\/url$/u.test(path),
        ),
      );
      return true;
    },
  );
  const rejectsOrigin = (error: unknown) => {
    assert.ok(error instanceof TileflowNativeCompatibilityError);
    assert.deepEqual(
      error.issues.map(({code, path}) => [code, path]),
      [['NATIVE_RENDERER_UNSUPPORTED', '/developmentOrigin']],
    );
    return true;
  };
  await assert.rejects(createTileflowBuildArtifacts({...preview, renderer: 'web'}), rejectsOrigin);
  await assert.rejects(
    createTileflowBuildArtifacts({...preview, target: 'production'}),
    rejectsOrigin,
  );
  await assert.rejects(writeTileflowBuildArtifacts({...preview, outDir: 'output'}), rejectsOrigin);
  await assert.rejects(readdir(join(cwd, 'output')), {code: 'ENOENT'});
});

test('rejects an asset URL that exceeds the native limit only after generation retargeting', async (t) => {
  const cwd = await fixture(t);
  const suffix = '/native/icons/main/sprite';
  const origin = 'https://assets.example.test/';
  const assetBaseUrl = origin + 'a'.repeat(2048 - origin.length - suffix.length);
  await assert.rejects(
    createTileflowBuildArtifacts({cwd, renderer: 'native', assetBaseUrl}),
    (error: unknown) => {
      assert.ok(error instanceof TileflowNativeCompatibilityError);
      assert.ok(
        error.issues.some(
          ({code, path}) => code === 'NATIVE_UNSUPPORTED_SOURCE' && path.endsWith('/sprite'),
        ),
      );
      return true;
    },
  );
});
