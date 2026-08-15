import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {
  createTileflowArtifactDiagnostics,
  createTileflowArtifactSession,
  createTileflowDevRequestHandler,
  resolveTileflowPreview,
  type TileflowArtifactSession,
  type TileflowArtifactSessionState,
} from '../src/index';
import {createTileflowArtifactSessionWithBuilder} from '../src/session';

test('refreshes transitive JSON imports and preserves last-good artifacts across invalid edits', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#112233"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');

  const session = await createTileflowArtifactSession({cwd});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'ready');
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#112233');

  await writeFile(join(cwd, 'tokens.json'), '{"water":"#445566"}\n', 'utf8');
  await session.refresh('test token edit');
  assert.equal(session.getState().generation, 2);
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#445566');

  await writeFile(join(cwd, 'tileflow.config.ts'), invalidConfig, 'utf8');
  await session.refresh('test invalid edit');
  const invalid = session.getState();
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.generation, 3);
  assert.equal(invalid.lastGoodGeneration, 2);
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#445566');
  assert.deepEqual(
    invalid.status === 'invalid'
      ? invalid.diagnostics.map((diagnostic) => Object.keys(diagnostic))
      : [],
    [['code', 'message', 'path', 'phase']],
  );
  if (invalid.status === 'invalid') {
    assert.equal(invalid.diagnostics[0]?.code, 'CONFIG_INVALID');
    assert.equal(invalid.diagnostics[0]?.phase, 'config-validation');
  }

  const handler = createTileflowDevRequestHandler({session});
  const status = await handler(new Request('http://localhost/__status'));
  assert.deepEqual(await status.json(), {
    schemaVersion: 1,
    generation: 3,
    status: 'invalid',
    lastGoodGeneration: 2,
    diagnostics: invalid.status === 'invalid' ? invalid.diagnostics : [],
  });
  const lastGoodStyle = await handler(new Request('http://localhost/styles/main.json'));
  assert.equal(lastGoodStyle.status, 200);
  assert.equal(waterColorFromStyle(await lastGoodStyle.json()), '#445566');

  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  await session.refresh('test recovery');
  assert.equal(session.getState().status, 'ready');
  assert.equal(session.getState().generation, 4);
});

test('watches conservative transitive inputs and emits monotonic building/ready states', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#102030"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  const states: TileflowArtifactSessionState[] = [];
  session.subscribe((state) => states.push(state));

  await writeFile(join(cwd, 'tokens.json'), '{"water":"#abcdef"}\n', 'utf8');
  const ready = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation >= 2,
  );
  assert.equal(ready.status, 'ready');
  assert.equal(waterColor(session.getLastGoodArtifacts()), '#abcdef');
  assert.deepEqual(
    states.slice(-2).map((state) => state.status),
    ['building', 'ready'],
  );
  assert.ok(
    states.every(
      (state, index) => index === 0 || state.generation >= states[index - 1]!.generation,
    ),
  );
});

test('publishes only the newest overlapping refresh generation', async () => {
  let build = 0;
  const session = await createTileflowArtifactSessionWithBuilder({}, async () => {
    build += 1;
    const current = build;
    if (current === 2) await new Promise((resolveWait) => setTimeout(resolveWait, 80));
    if (current === 3) await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    return {
      assets: [],
      manifest: {version: 1, maps: {}, styles: {}},
      project: {maps: {[`generation-${current}`]: {}}},
      styles: {},
      watchPaths: [],
    };
  });

  try {
    await Promise.all([session.refresh('slow'), session.refresh('newest')]);
    const state = session.getState();
    assert.equal(state.status, 'ready');
    assert.equal(state.generation, 3);
    assert.deepEqual(Object.keys(session.getLastGoodArtifacts()?.project.maps ?? {}), [
      'generation-3',
    ]);
  } finally {
    await session.close();
  }
});

test('redacts external absolute paths from watched-build diagnostic messages', async (t) => {
  const cwd = await createFixture(t);
  const external = join(cwd, '..', 'private-fixture', 'secret.json');
  const diagnostics = createTileflowArtifactDiagnostics(
    new Error(`Unable to read ${external}`),
    cwd,
  );

  assert.equal(JSON.stringify(diagnostics).includes(external), false);
  assert.match(diagnostics[0]?.message ?? '', /external path/);

  const windowsDiagnostics = createTileflowArtifactDiagnostics(
    {issues: [{message: 'Unable to read input', path: 'C:\\Users\\alice\\secret.json'}]},
    cwd,
  );
  assert.equal(windowsDiagnostics[0]?.path, '(external)');
});

test('preserves bounded code/phase diagnostics with deterministic URL-safe ordering', async (t) => {
  const cwd = await createFixture(t);
  const issues = Array.from({length: 40}, (_, index) => ({
    message:
      `https://user:secret@example.test/private/${index}?token=hidden ` +
      `Bearer bearer-secret tf_live_${'a'.repeat(32)} sk_live_private ${'x'.repeat(350)}`,
    path: `maps.zeta.layers.${String(39 - index).padStart(2, '0')}`,
  }));
  const diagnostics = createTileflowArtifactDiagnostics(
    Object.assign(new Error('invalid'), {
      code: 'STYLE_INVALID',
      issues,
      phase: 'style-validation',
    }),
    cwd,
  );

  assert.equal(diagnostics.length, 32);
  assert.equal(diagnostics[0]?.path, 'maps.zeta.layers.00');
  assert.equal(diagnostics.at(-1)?.path, 'maps.zeta.layers.31');
  assert.equal(
    diagnostics.every((item) => item.code === 'STYLE_INVALID'),
    true,
  );
  assert.equal(
    diagnostics.every((item) => item.phase === 'style-validation'),
    true,
  );
  assert.equal(
    diagnostics.every((item) => item.message.length <= 300),
    true,
  );
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /user:secret|token=hidden|private\/|bearer-secret|tf_live_|sk_live_private/,
  );
  assert.match(diagnostics[0]?.message ?? '', /https:\/\/example\.test/);
});

test('serves pinned local preview assets and a cancellable session event stream', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tokens.json'), '{"water":"#112233"}\n', 'utf8');
  await writeFile(join(cwd, 'tokens.ts'), tokenModule, 'utf8');
  await writeFile(join(cwd, 'tileflow.config.ts'), validConfig, 'utf8');
  const session = await createTileflowArtifactSession({cwd});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  const handler = createTileflowDevRequestHandler({session});

  const preview = await (await handler(new Request('http://localhost/'))).text();
  assert.doesNotMatch(preview, /unpkg|fonts\.googleapis|fonts\.gstatic/);
  assert.match(preview, /__runtime\/maplibre-gl\.js/);
  assert.match(preview, /__events/);
  assert.match(preview, /new URL\(location\.href\)\.searchParams/);
  assert.match(preview, /delete resolved\.bounds/);
  assert.match(preview, /history\.replaceState\(history\.state, "", url\.href\)/);
  assert.match(preview, /map\.on\("moveend", \(\) => writeCameraToUrl\(map\)\)/);

  const [javascript, stylesheet] = await Promise.all([
    handler(new Request('http://localhost/__runtime/maplibre-gl.js')),
    handler(new Request('http://localhost/__runtime/maplibre-gl.css')),
  ]);
  assert.match(javascript.headers.get('content-type') ?? '', /javascript/);
  assert.ok((await javascript.text()).length > 1_000_000);
  assert.match(stylesheet.headers.get('content-type') ?? '', /text\/css/);

  const events = await handler(new Request('http://localhost/__events'));
  const reader = events.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /event: ready/);
  await reader.cancel();
});

test('selects map and scene previews with their configured cameras and viewport', async (t) => {
  const cwd = await createFixture(t);
  await writeFile(join(cwd, 'tileflow.config.ts'), previewConfig, 'utf8');
  t.after(async () => rm(cwd, {force: true, recursive: true}));

  const project = {
    maps: {
      first: {},
      second: {view: {bearing: 12, center: [2, 3] as [number, number], pitch: 35, zoom: 9}},
    },
    scenes: {
      bounds: {
        map: 'second',
        camera: {
          type: 'bounds' as const,
          bounds: [1, 2, 3, 4] as [number, number, number, number],
          padding: 24,
        },
        viewport: {width: 800, height: 600},
      },
      mobile: {
        map: 'second',
        camera: {type: 'center' as const, center: [2.5, 3.5] as [number, number], zoom: 14},
        viewport: {width: 390, height: 844, dpr: 2 as const},
      },
      product: {
        map: 'second',
        camera: {type: 'center' as const, center: [2, 3] as [number, number], zoom: 9},
        viewport: {width: 800, height: 600},
        target: {kind: 'application' as const, path: '/maps'},
      },
    },
  };

  assert.deepEqual(resolveTileflowPreview(project, {map: 'second'}), {
    camera: {type: 'center', center: [2, 3], zoom: 9, bearing: 12, pitch: 35},
    label: 'second',
    mapName: 'second',
  });
  assert.deepEqual(resolveTileflowPreview(project, {scene: 'bounds'}), {
    camera: {
      type: 'bounds',
      bounds: [1, 2, 3, 4],
      padding: 24,
      bearing: 0,
      pitch: 0,
    },
    label: 'second / bounds · 800×600',
    mapName: 'second',
    viewport: {width: 800, height: 600, dpr: 1},
  });
  assert.throws(() => resolveTileflowPreview(project, {map: 'first', scene: 'mobile'}), /either/);
  assert.throws(() => resolveTileflowPreview(project, {map: 'missing'}), /Unknown Tileflow map/);
  assert.throws(
    () => resolveTileflowPreview(project, {scene: 'product'}),
    /targets an application/,
  );

  const mapResponse = await createTileflowDevRequestHandler({cwd, map: 'second'})(
    new Request('http://localhost/'),
  );
  const mapHtml = await mapResponse.text();
  assert.equal(mapResponse.status, 200);
  assert.match(mapHtml, /\/styles\/second\.json/);
  assert.match(mapHtml, /"center":\[2,3\]/);
  assert.match(mapHtml, /"pitch":35/);
  assert.match(mapHtml, /"zoom":9/);
  assert.doesNotMatch(mapHtml, /-3\.7038/);
  assert.match(mapHtml, /cameraRanges/);
  assert.match(mapHtml, /getAll\(name\)/);

  const sceneResponse = await createTileflowDevRequestHandler({cwd, scene: 'mobile'})(
    new Request('http://localhost/'),
  );
  const sceneHtml = await sceneResponse.text();
  assert.equal(sceneResponse.status, 200);
  assert.match(sceneHtml, /width: 390px/);
  assert.match(sceneHtml, /height: 844px/);
  assert.match(sceneHtml, /second \/ mobile/);

  const boundsResponse = await createTileflowDevRequestHandler({cwd, scene: 'bounds'})(
    new Request('http://localhost/'),
  );
  const boundsHtml = await boundsResponse.text();
  assert.match(boundsHtml, /"bounds":\[\[1,2\],\[3,4\]\]/);

  const persisted = runPreviewScript(
    boundsHtml,
    'http://localhost/?keep=this&lng=-3.7038&lat=40.4168&zoom=15.25&bearing=12&pitch=35',
  );
  assert.equal(JSON.stringify(persisted.mapOptions?.center), '[-3.7038,40.4168]');
  assert.equal(persisted.mapOptions?.zoom, 15.25);
  assert.equal('bounds' in (persisted.mapOptions ?? {}), false);
  assert.equal('fitBoundsOptions' in (persisted.mapOptions ?? {}), false);
  persisted.emit('load');
  const persistedUrl = new URL(persisted.currentUrl());
  assert.equal(persistedUrl.searchParams.get('keep'), 'this');
  assert.equal(persistedUrl.searchParams.get('lng'), '-3.7038');
  assert.equal(persistedUrl.searchParams.get('lat'), '40.4168');
  assert.equal(persistedUrl.searchParams.get('zoom'), '15.25');
  assert.equal(persistedUrl.searchParams.get('bearing'), '12');
  assert.equal(persistedUrl.searchParams.get('pitch'), '35');

  const invalidCamera = runPreviewScript(
    mapHtml,
    'http://localhost/?lng=-3.7038&lat=40.4168&zoom=99&bearing=0&pitch=0',
  );
  assert.equal(JSON.stringify(invalidCamera.mapOptions?.center), '[2,3]');
  assert.equal(invalidCamera.mapOptions?.zoom, 9);

  const missingResponse = await createTileflowDevRequestHandler({cwd, map: 'missing'})(
    new Request('http://localhost/'),
  );
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), {error: 'Unknown Tileflow map: missing'});
});

test('watches added, changed, removed, and newly effective local icon directories', async (t) => {
  const cwd = await createFixture(t);
  await mkdir(join(cwd, 'icons-a'));
  await mkdir(join(cwd, 'icons-b'));
  await writeFile(join(cwd, 'icons-a', 'base.svg'), svg('#111111'));
  await writeFile(join(cwd, 'icons-a', 'pin.svg'), svg('#222222'));
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#333333'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons-a'));
  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(cwd, {force: true, recursive: true});
  });
  assert.equal(session.getState().status, 'ready');
  const initial = assetFingerprint(session);

  const initialGeneration = session.getState().generation;
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#343434'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, initialGeneration);

  await writeFile(join(cwd, 'icons-a', 'added.svg'), svg('#444444'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 2);
  const added = assetFingerprint(session);
  assert.notEqual(added, initial);

  await writeFile(join(cwd, 'icons-a', 'pin.svg'), svg('#555555'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 3);
  const changed = assetFingerprint(session);
  assert.notEqual(changed, added);

  await unlink(join(cwd, 'icons-a', 'pin.svg'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 4);
  assert.notEqual(assetFingerprint(session), changed);

  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('./icons-b'));
  await waitForState(session, (state) => state.status === 'ready' && state.generation >= 5);
  const switched = assetFingerprint(session);
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const switchedGeneration = session.getState().generation;
  await writeFile(join(cwd, 'icons-b', 'other.svg'), svg('#777777'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > switchedGeneration,
  );
  assert.notEqual(assetFingerprint(session), switched);
});

test('adds and unwatches icon directories outside the config tree', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'tileflow-dev-external-watch-'));
  const cwd = join(parent, 'project');
  const iconsA = join(parent, 'icons-a');
  const iconsB = join(parent, 'icons-b');
  await mkdir(cwd);
  await mkdir(iconsA);
  await mkdir(iconsB);
  await writeFile(join(iconsA, 'pin.svg'), svg('#111111'));
  await writeFile(join(iconsB, 'pin.svg'), svg('#222222'));
  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('../icons-a'));

  const session = await createTileflowArtifactSession({cwd, debounceMs: 10, watch: true});
  t.after(async () => {
    await session.close();
    await rm(parent, {force: true, recursive: true});
  });

  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const initialGeneration = session.getState().generation;
  await writeFile(join(iconsA, 'pin.svg'), svg('#333333'));
  const changed = await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > initialGeneration,
  );

  await writeFile(join(cwd, 'tileflow.config.ts'), iconConfig('../icons-b'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > changed.generation,
  );
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  const switchedGeneration = session.getState().generation;

  await writeFile(join(iconsA, 'pin.svg'), svg('#444444'));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  assert.equal(session.getState().generation, switchedGeneration);

  await writeFile(join(iconsB, 'pin.svg'), svg('#555555'));
  await waitForState(
    session,
    (state) => state.status === 'ready' && state.generation > switchedGeneration,
  );
});

const tokenModule = `import tokens from './tokens.json';\nexport default tokens;\n`;
const validConfig = `import tokens from './tokens.ts';
export default {
  maps: {
    main: {
      basemap: {type: 'streets', basemapVersion: 2, variant: 'light'},
      theme: {colors: {water: tokens.water}}
    }
  }
};
`;
const invalidConfig = `export default {maps: {main: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, unsupported: true}}};\n`;
const previewConfig = `export default {
  maps: {
    first: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}},
    second: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, view: {bearing: 12, center: [2, 3], pitch: 35, zoom: 9}}
  },
  scenes: {
    bounds: {
      map: 'second',
      camera: {type: 'bounds', bounds: [1, 2, 3, 4], padding: 24},
      viewport: {width: 800, height: 600}
    },
    mobile: {
      map: 'second',
      camera: {type: 'center', center: [2.5, 3.5], zoom: 14},
      viewport: {width: 390, height: 844, dpr: 2}
    }
  }
};
`;

async function createFixture(t: test.TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'tileflow-dev-session-'));
  return cwd;
}

function waterColor(
  artifacts: ReturnType<TileflowArtifactSession['getLastGoodArtifacts']>,
): unknown {
  return waterColorFromStyle(artifacts?.styles.main);
}

function waterColorFromStyle(style: unknown): unknown {
  const layers = (style as {layers?: Array<{id?: string; paint?: Record<string, unknown>}>})
    ?.layers;
  return layers?.find((layer) => layer.id === 'streets-water')?.paint?.['fill-color'];
}

function waitForState(
  session: TileflowArtifactSession,
  predicate: (state: TileflowArtifactSessionState) => boolean,
  timeoutMs = 15_000,
): Promise<TileflowArtifactSessionState> {
  const current = session.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolveState, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for artifact state after ${timeoutMs} ms.`));
    }, timeoutMs);
    const unsubscribe = session.subscribe((state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolveState(state);
    });
  });
}

function iconConfig(source: string): string {
  return `export default {icons: {local: {source: '${source}'}}, maps: {main: {basemap: {type: 'streets', basemapVersion: 2, variant: 'light'}, icons: 'local'}}};\n`;
}

function runPreviewScript(
  html: string,
  href: string,
): {
  currentUrl(): string;
  emit(eventName: string): void;
  mapOptions: Record<string, unknown> | undefined;
} {
  const script = /<script>\s*([\s\S]*?)<\/script>\s*<\/body>/.exec(html)?.[1];
  assert.ok(script, 'expected an inline preview script');

  let mapOptions: Record<string, unknown> | undefined;
  let currentUrl = href;
  const listeners = new Map<string, () => void>();
  const elements = new Map<string, {style: {display: string}; textContent: string}>();

  class FakeMap {
    readonly camera: {bearing: number; center: [number, number]; pitch: number; zoom: number};

    constructor(options: Record<string, unknown>) {
      mapOptions = options;
      this.camera = {
        bearing: Number(options.bearing ?? 0),
        center: (options.center as [number, number] | undefined) ?? [0, 0],
        pitch: Number(options.pitch ?? 0),
        zoom: Number(options.zoom ?? 0),
      };
    }

    addControl(): void {}

    getBearing(): number {
      return this.camera.bearing;
    }

    getCenter(): {lat: number; lng: number} {
      return {lat: this.camera.center[1], lng: this.camera.center[0]};
    }

    getPitch(): number {
      return this.camera.pitch;
    }

    getZoom(): number {
      return this.camera.zoom;
    }

    on(eventName: string, listener: () => void): void {
      listeners.set(eventName, listener);
    }
  }

  class FakeEventSource {
    addEventListener(): void {}
  }

  runInNewContext(script, {
    EventSource: FakeEventSource,
    URL,
    document: {
      getElementById(id: string) {
        const element = {style: {display: ''}, textContent: ''};
        elements.set(id, element);
        return element;
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, nextUrl: string) {
        currentUrl = nextUrl;
      },
      state: null,
    },
    location: {href, reload() {}},
    maplibregl: {Map: FakeMap, NavigationControl: class {}},
  });

  return {
    currentUrl: () => currentUrl,
    emit(eventName) {
      listeners.get(eventName)?.();
    },
    mapOptions,
  };
}

function svg(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="${color}"/></svg>`;
}

function assetFingerprint(session: TileflowArtifactSession): string {
  const assets = session.getLastGoodArtifacts()?.assets ?? [];
  return assets
    .map((asset) =>
      typeof asset.source === 'string'
        ? asset.source
        : Buffer.from(asset.source).toString('base64'),
    )
    .join('|');
}
