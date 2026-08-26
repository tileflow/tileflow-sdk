import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {defineMap, serializeCanonicalJson} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {streets} from '@tileflow/maps';
import {linkWorkspacePackages} from '../../../test-support/workspace-packages';
import {selectTileflowCaptureSceneNames} from '../src/capture';
import {
  createTileflowCaptureBrowserEnvironment,
  createTileflowCaptureReceipt,
  createTileflowCaptureRendererIdentity,
  createTileflowCaptureSession,
  parseTileflowCaptureReceipt,
  resolveTileflowApplicationUrl,
  serializeTileflowCaptureReceipt,
  type TileflowCaptureDataInput,
  TileflowCaptureError,
  tileflowCaptureRuntime,
} from '../src/index';
import {readPngDimensions} from '../src/standalone';

const madrid = defineMap({id: 'madrid', version: 1, extends: streets});

const project: TileflowBuildCatalog = {
  maps: {madrid},
  scenes: {
    narrow: {
      map: 'madrid',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 320, height: 640},
    },
    desktop: {
      map: 'madrid',
      camera: {type: 'center', center: [0, 0], zoom: 1},
      viewport: {width: 1_200, height: 800},
    },
  },
};

const dataIdentity: TileflowCaptureDataInput = {
  archiveSha256: 'd'.repeat(64),
  contractSha256: 'e'.repeat(64),
  dataContractSha256: 'f'.repeat(64),
  descriptorSha256: 'c'.repeat(64),
  kind: 'tileflow-world',
  product: 'world-v1',
  releaseId: 'world-v1-capture-fixture',
  schema: 'openmaptiles',
  schemaVersion: 1,
  sourceId: 'tileflow',
};

const vectorDataIdentity: TileflowCaptureDataInput = {
  kind: 'vector-tiles',
  schema: 'openmaptiles',
  schemaVersion: 1,
  sourceId: 'tileflow',
};

test('sorts and validates scene selection deterministically', () => {
  assert.deepEqual(selectTileflowCaptureSceneNames({project}, ['narrow', 'desktop', 'narrow']), [
    'desktop',
    'narrow',
  ]);
  assert.throws(
    () => selectTileflowCaptureSceneNames({project}, ['missing']),
    /Available scenes: desktop, narrow/,
  );
  assert.throws(() => selectTileflowCaptureSceneNames({project}, []), /Select at least one/);
});

test('does not select inherited Object.prototype members as scenes', () => {
  const projectWithoutScenes: TileflowBuildCatalog = {
    maps: {madrid},
    scenes: {},
  };

  for (const sceneName of ['constructor', 'toString']) {
    assert.throws(
      () => selectTileflowCaptureSceneNames({project: projectWithoutScenes}, [sceneName]),
      /portable Tileflow capture scene name/,
    );
  }

  const nonPortableProject: TileflowBuildCatalog = {
    maps: {madrid},
    scenes: {CON: project.scenes!.desktop!},
  };
  assert.throws(
    () => selectTileflowCaptureSceneNames({project: nonPortableProject}, ['CON']),
    /portable Tileflow capture scene name/,
  );
});

test('keeps credentials and arbitrary repository environment out of Chromium', () => {
  const environment = createTileflowCaptureBrowserEnvironment({
    HOME: '/safe-home',
    LANG: 'en_US.UTF-8',
    PATH: '/safe-path',
    TILEFLOW_API_KEY: 'tf_secret',
    CUSTOMER_TOKEN: 'customer-secret',
  });

  assert.deepEqual(environment, {
    HOME: '/safe-home',
    LANG: 'en_US.UTF-8',
    PATH: '/safe-path',
  });
  assert.equal(environment.TILEFLOW_API_KEY, undefined);
  assert.equal(environment.CUSTOMER_TOKEN, undefined);
});

test('preserves the non-secret Windows runtime environment Chromium needs to start', () => {
  const environment = createTileflowCaptureBrowserEnvironment({
    APPDATA: 'C:\\Users\\agent\\AppData\\Roaming',
    HOME: '',
    LANG: '',
    LOCALAPPDATA: 'C:\\Users\\agent\\AppData\\Local',
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Users\\agent\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\agent\\AppData\\Local\\Temp',
    USERPROFILE: 'C:\\Users\\agent',
    TILEFLOW_API_KEY: 'tf_secret',
  });

  assert.equal(environment.HOME, 'C:\\Users\\agent');
  for (const name of ['APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE']) {
    assert.equal(typeof environment[name], 'string', name);
  }
  assert.equal(environment.TILEFLOW_API_KEY, undefined);
});

test('serializes deterministic, path-free capture receipts', () => {
  const renderer = createTileflowCaptureRendererIdentity();
  const receipt = createTileflowCaptureReceipt({
    data: dataIdentity,
    dpr: 2,
    height: 200,
    map: 'madrid',
    networkDependent: false,
    pngSha256: 'a'.repeat(64),
    renderer,
    scene: 'desktop',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map',
    width: 320,
  });
  const serialized = serializeTileflowCaptureReceipt(receipt);

  assert.equal(serialized.endsWith('\n'), true);
  assert.deepEqual(JSON.parse(serialized), receipt);
  assert.equal(serialized.includes(process.cwd()), false);
  assert.equal(serialized.includes('timestamp'), false);
  assert.equal(receipt.image.physicalWidth, 640);
  assert.equal(receipt.image.physicalHeight, 400);
  assert.equal(renderer.playwright, '1.62.1');
  assert.equal(tileflowCaptureRuntime.chromiumRevision, '1234');
});

test('capture receipts preserve expanded vector source identity', () => {
  const expanded: TileflowCaptureDataInput = {
    ...vectorDataIdentity,
    url: '/tiles.json',
    capabilities: {
      businessCorridor: true,
      bathymetry: true,
      globalLandcover: false,
      tree: false,
    },
    bindings: {fields: {class: 'kind/value'}, layers: {road: 'roads-世界'}},
    semantics: {parkLayer: 'protected-only'},
  };
  const receipt = createTileflowCaptureReceipt({
    data: expanded,
    dpr: 1,
    height: 64,
    map: 'madrid',
    networkDependent: true,
    pngSha256: 'a'.repeat(64),
    renderer: createTileflowCaptureRendererIdentity(),
    scene: 'expanded',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map',
    width: 64,
  });

  assert.deepEqual(receipt.data.bindings, expanded.bindings);
  assert.deepEqual(receipt.data.capabilities, expanded.capabilities);
  assert.deepEqual(receipt.data.semantics, {parkLayer: 'protected-only'});
  assert.equal(receipt.data.source?.kind, 'root-relative');
  assert.match(receipt.data.source?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal('url' in receipt.data, false);
  assert.deepEqual(receipt.verification, {data: 'rendered', style: 'rendered'});
});

test('receipt source identity strips origins and rotating URL secrets', () => {
  const common = {
    dpr: 1 as const,
    height: 64,
    map: 'madrid',
    networkDependent: true,
    pngSha256: 'a'.repeat(64),
    renderer: createTileflowCaptureRendererIdentity(),
    scene: 'remote',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map' as const,
    width: 64,
  };
  const first = createTileflowCaptureReceipt({
    ...common,
    data: {
      ...vectorDataIdentity,
      url: 'https://tiles.example/private.json?token=first#secret',
    },
  });
  const second = createTileflowCaptureReceipt({
    ...common,
    data: {
      ...vectorDataIdentity,
      url: 'https://tiles.example/private.json?token=second#other',
    },
  });
  const serialized = serializeTileflowCaptureReceipt(first);

  assert.deepEqual(first.data.source, second.data.source);
  assert.equal(serialized.includes('tiles.example'), false);
  assert.equal(serialized.includes('private.json'), false);
  assert.equal(serialized.includes('first'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('application receipts label configured style and data as expected but unverified', () => {
  const receipt = createTileflowCaptureReceipt({
    data: dataIdentity,
    dpr: 1,
    height: 64,
    map: 'madrid',
    networkDependent: false,
    pngSha256: 'a'.repeat(64),
    renderer: createTileflowCaptureRendererIdentity(),
    scene: 'application',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'application',
    width: 64,
  });

  assert.deepEqual(receipt.verification, {
    data: 'expected-unverified',
    style: 'expected-unverified',
  });

  const {verification: _verification, ...legacyCommon} = receipt;
  const legacy = {
    ...legacyCommon,
    schemaVersion: 2,
    data: {
      generation: 'v1',
      kind: 'tileflow-world',
      schema: 'openmaptiles',
      schemaVersion: 1,
      sourceId: 'tileflow',
      url: 'http://127.0.0.1:8080/tiles.json?token=legacy-secret',
    },
  };
  const parsedLegacy = parseTileflowCaptureReceipt(serializeCanonicalJson(legacy));
  assert.deepEqual(parsedLegacy.verification, receipt.verification);
  assert.equal(parsedLegacy.data.source?.kind, 'loopback');
  assert.equal(serializeTileflowCaptureReceipt(parsedLegacy).includes('legacy-secret'), false);
});

test('emits one exact receipt shape with explicit data identity', () => {
  const common = {
    dpr: 1 as const,
    data: dataIdentity,
    height: 64,
    map: 'madrid',
    networkDependent: true,
    pngSha256: 'a'.repeat(64),
    renderer: createTileflowCaptureRendererIdentity(),
    scene: 'pinned',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map' as const,
    width: 64,
  };
  const unpinned = createTileflowCaptureReceipt({
    ...common,
    data: {
      kind: 'vector-tiles',
      schema: 'openmaptiles',
      schemaVersion: 1,
      sourceId: 'tileflow',
    },
  });
  const pinned = createTileflowCaptureReceipt(common);

  assert.equal(unpinned.schemaVersion, 3);
  assert.deepEqual(unpinned.data, {
    kind: 'vector-tiles',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
  assert.equal(pinned.schemaVersion, 3);
  assert.deepEqual(pinned.data, dataIdentity);
  assert.deepEqual(Object.keys(unpinned).sort(), Object.keys(pinned).sort());
  assert.deepEqual(JSON.parse(serializeTileflowCaptureReceipt(pinned)), pinned);
  for (const field of [
    'archiveSha256',
    'contractSha256',
    'dataContractSha256',
    'descriptorSha256',
    'product',
    'releaseId',
  ] as const) {
    const incomplete = structuredClone(pinned) as unknown as {
      data: Record<string, unknown>;
    };
    delete incomplete.data[field];
    assert.throws(
      () => serializeTileflowCaptureReceipt(incomplete as never),
      /missing or unsupported/,
      field,
    );
  }
  const mixed = structuredClone(pinned) as unknown as {data: Record<string, unknown>};
  mixed.data.generation = 'v1';
  assert.throws(() => serializeTileflowCaptureReceipt(mixed as never), /missing or unsupported/);
  assert.throws(
    () =>
      createTileflowCaptureReceipt({
        ...common,
        data: {
          kind: 'tileflow-world',
          product: 'world-v1',
          schema: 'openmaptiles',
          schemaVersion: 1,
          sourceId: 'tileflow',
        } as never,
      }),
    /missing or unsupported/,
  );
  assert.throws(
    () =>
      createTileflowCaptureReceipt({
        ...common,
        data: {
          ...dataIdentity,
          semantics: {parkLayer: 'ordinary-parks'} as never,
        },
      }),
    /data\.semantics\.parkLayer/,
  );

  const legacyWorld = parseTileflowCaptureReceipt(
    serializeCanonicalJson({
      ...pinned,
      schemaVersion: 2,
      data: {
        kind: 'tileflow-world',
        revision: '2026-06-07',
        schema: 'openmaptiles',
        schemaVersion: 1,
        sourceId: 'tileflow',
      },
    }),
  );
  assert.equal(legacyWorld.schemaVersion, 2);
  assert.equal(JSON.parse(serializeTileflowCaptureReceipt(legacyWorld)).schemaVersion, 2);
  assert.deepEqual(legacyWorld.data, {
    kind: 'tileflow-world',
    revision: '2026-06-07',
    schema: 'openmaptiles',
    schemaVersion: 1,
    sourceId: 'tileflow',
  });
});

test('reads PNG dimensions and rejects non-PNG bytes', () => {
  const header = new Uint8Array(24);
  header.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(header.buffer);
  view.setUint32(16, 640);
  view.setUint32(20, 400);

  assert.deepEqual(readPngDimensions(header), {width: 640, height: 400});
  assert.throws(() => readPngDimensions(new Uint8Array([1, 2, 3])), /valid PNG/);
});

test('accepts only credential-free loopback application origins and URLs', () => {
  assert.deepEqual(
    resolveTileflowApplicationUrl({appOrigin: 'http://127.0.0.1:4173', path: '/maps?theme=dark'}),
    {origin: 'http://127.0.0.1:4173', url: 'http://127.0.0.1:4173/maps?theme=dark'},
  );
  assert.deepEqual(
    resolveTileflowApplicationUrl({appUrl: 'http://localhost:3000/one-off?mode=proof', path: '/'}),
    {origin: 'http://localhost:3000', url: 'http://localhost:3000/one-off?mode=proof'},
  );
  for (const value of [
    'https://example.com',
    'http://0.0.0.0:3000',
    'http://user:password@localhost:3000',
    'file:///tmp/proof.html',
    'http://localhost:3000/#secret',
  ]) {
    assert.throws(() => resolveTileflowApplicationUrl({appUrl: value, path: '/'}), /loopback|URL/);
  }
  assert.throws(
    () => resolveTileflowApplicationUrl({appOrigin: 'http://localhost:3000/path', path: '/'}),
    /without credentials, path, query, or fragment/,
  );
  assert.throws(
    () =>
      resolveTileflowApplicationUrl({
        appOrigin: 'http://localhost:3000',
        appUrl: 'http://localhost:3000/proof',
        path: '/',
      }),
    /either an application origin or a full application URL/,
  );
  assert.throws(
    () =>
      resolveTileflowApplicationUrl({
        appUrl: `http://localhost:3000/proof?value=${'x'.repeat(4_096)}`,
        path: '/',
      }),
    /length|bounded|URL/,
  );
  assert.throws(
    () =>
      resolveTileflowApplicationUrl({
        appOrigin: `http://${'a'.repeat(1_024)}.localhost:3000`,
        path: `/${'x'.repeat(2_047)}`,
      }),
    /length|bounded|URL/,
  );
});

test('closed sessions reject before loading executable repository config', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-capture-closed-'));
  await linkWorkspacePackages(cwd);
  const marker = join(cwd, 'config-executed');
  await writeFile(
    join(cwd, 'tileflow.config.ts'),
    `import {writeFileSync} from 'node:fs';
import {defineMap} from '@tileflow/core';
import {streets} from '@tileflow/maps';
writeFileSync(${JSON.stringify(marker)}, 'executed');
export default defineMap({id: 'main', version: 1, extends: streets});
`,
  );
  const session = createTileflowCaptureSession({cwd});

  try {
    await session.close();
    await assert.rejects(
      () => session.captureAll(),
      (error: unknown) =>
        error instanceof TileflowCaptureError && error.code === 'BROWSER_START_FAILED',
    );
    await assert.rejects(() => readFile(marker), /ENOENT/);
  } finally {
    await rm(cwd, {force: true, recursive: true});
  }
});

test('receipt creation rejects invalid public input instead of serializing it', () => {
  assert.throws(
    () =>
      createTileflowCaptureReceipt({
        data: dataIdentity,
        dpr: 2,
        height: 1.25,
        map: 'madrid',
        networkDependent: false,
        pngSha256: 'a'.repeat(64),
        renderer: createTileflowCaptureRendererIdentity(),
        scene: 'desktop',
        sceneSha256: 'b'.repeat(64),
        styleSha256: 'c'.repeat(64),
        target: 'map',
        width: 1.25,
      }),
    /dimensions|receipt/i,
  );
  assert.throws(
    () =>
      createTileflowCaptureReceipt({
        data: dataIdentity,
        dpr: 1,
        height: 64,
        map: 'madrid',
        networkDependent: false,
        pngSha256: 'a'.repeat(64),
        renderer: createTileflowCaptureRendererIdentity(),
        scene: '__proto__',
        sceneSha256: 'b'.repeat(64),
        styleSha256: 'c'.repeat(64),
        target: 'map',
        width: 64,
      }),
    /scene\.name|receipt/i,
  );

  const valid = createTileflowCaptureReceipt({
    data: dataIdentity,
    dpr: 1,
    height: 64,
    map: 'madrid',
    networkDependent: false,
    pngSha256: 'a'.repeat(64),
    renderer: createTileflowCaptureRendererIdentity(),
    scene: 'desktop',
    sceneSha256: 'b'.repeat(64),
    styleSha256: 'c'.repeat(64),
    target: 'map',
    width: 64,
  });
  assert.throws(
    () =>
      serializeTileflowCaptureReceipt({
        ...valid,
        networkDependent: 'yes',
      } as unknown as typeof valid),
    /network dependency|receipt/i,
  );
});
