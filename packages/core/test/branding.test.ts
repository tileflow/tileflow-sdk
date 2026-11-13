import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindTileflowBrandingSources,
  parseTileflowBrandingPolicy,
  readTileflowBrandingSources,
  rememberTileflowBrandingSources,
} from '../src/branding';
import {attachTileflowBranding, type TileflowBrandingMap} from '../src/branding-browser';
import {loadTileflowRuntimeStyle} from '../src/style-resources-browser';
import {
  createTileflowContourProtocolUrl,
  type TileflowContourDemSource,
} from '../src/terrain/contour-protocol';

const mapId = 'map_0123456789abcdef';
const secondId = 'map_fedcba9876543210';
const catalog = 'https://api.tileflow.dev/tiles/world/tiles.json';
const style = (url = catalog) => ({
  version: 8 as const,
  sources: {base: {type: 'vector' as const, url}},
  layers: [{id: 'land', type: 'fill' as const, source: 'base', 'source-layer': 'land'}],
});
const policy = (required: boolean, id = mapId, validForMs = 900_000, revision = '2') => ({
  mapId: id,
  catalogLogoRequired: required,
  revision,
  validForMs,
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function fixture(initial = style(), fetcher?: typeof fetch) {
  const events = new Map<string, Set<() => void>>();
  const nodes = new Set<object>();
  let anchors = 0;
  const createElement = (tag: string) => {
    if (tag === 'a') anchors++;
    const node = {
      style: {},
      setAttribute() {},
      appendChild() {},
      remove() {
        nodes.delete(node);
      },
    };
    return node;
  };
  const container = {
    style: {visibility: ''},
    inert: false,
    dataset: {} as Record<string, string>,
    ownerDocument: {createElement, createElementNS: (_: string, tag: string) => createElement(tag)},
    appendChild(node: object) {
      nodes.add(node);
    },
  };
  let current: ReturnType<typeof style> | undefined = initial;
  const map = {
    getContainer: () => container,
    getStyle: () => current,
    on(event: string, fn: () => void) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(fn);
    },
    off(event: string, fn: () => void) {
      events.get(event)?.delete(fn);
    },
  } as unknown as TileflowBrandingMap;
  const emit = (event: string) => {
    for (const fn of [...(events.get(event) ?? [])]) fn();
  };
  const dispose = attachTileflowBranding(map, {fetch: fetcher});
  return {
    container,
    map,
    nodes,
    events,
    dispose,
    anchors: () => anchors,
    emit,
    replace(next: ReturnType<typeof style>) {
      current = next;
      emit('styledata');
    },
  };
}

test('catalog identity follows referenced delivery URLs, never SDK use, source names or schemas', () => {
  assert.deepEqual(readTileflowBrandingSources(style()), [{apiUrl: 'https://api.tileflow.dev'}]);
  for (const url of [
    'https://own.example/tiles/world/tiles.json',
    'https://api.tileflow.dev/tiles/tls_123/tiles.json',
  ])
    assert.deepEqual(readTileflowBrandingSources(style(url)), []);
  assert.deepEqual(readTileflowBrandingSources({...style(), layers: []}), []);
  assert.deepEqual(
    readTileflowBrandingSources({
      ...style(),
      layers: style().layers.map((layer) => ({...layer, layout: {visibility: 'none'}})),
    }),
    [],
  );
  assert.deepEqual(
    readTileflowBrandingSources({...style(), layers: [], terrain: {source: 'base'}}),
    [{apiUrl: 'https://api.tileflow.dev'}],
  );
  assert.deepEqual(readTileflowBrandingSources(style(`${catalog}?map=${mapId}`)), [
    {apiUrl: 'https://api.tileflow.dev', mapId},
  ]);
  assert.deepEqual(
    readTileflowBrandingSources(style('/tiles/world/tiles.json'), {
      baseUrl: 'https://api.tileflow.dev/maps/map/style.json',
    }),
    [{apiUrl: 'https://api.tileflow.dev'}],
  );
  assert.throws(() => readTileflowBrandingSources(style(`${catalog}?map=invalid`)));
});

test('a style carrying World’s TileJSON keeps its catalog identity through the catalog edge', () => {
  const edge =
    'https://world.tileflow.dev/tiles/world/world-v1-a3dea8b5-43fa-425f-ae4b-798be8c166e4/{z}/{x}/{y}.pbf';
  const inlined = {...style(), sources: {base: {type: 'vector' as const, tiles: [edge]}}};
  assert.deepEqual(readTileflowBrandingSources(inlined), [{apiUrl: 'https://api.tileflow.dev'}]);
  // The edge counts only for Tileflow's own API, never a self-hosted one.
  assert.deepEqual(readTileflowBrandingSources(inlined, {apiUrl: 'https://api.example.test'}), []);
});

test('contours retain the delivery identity of their DEM without a separate terrain source', () => {
  const contours = (dem: TileflowContourDemSource) => ({
    sources: {
      contours: {
        type: 'vector',
        tiles: [
          createTileflowContourProtocolUrl({
            ...dem,
            demMaxzoom: 14,
            maxzoom: 14,
            overzoom: 0,
            multiplier: 1,
            encoding: 'terrarium',
            thresholds: {0: [500, 1000]},
          }),
        ],
      },
    },
    layers: [{id: 'contours', type: 'line', source: 'contours'}],
  });
  const terrain = 'https://api.tileflow.dev/tiles/terrain/tiles.json';
  assert.deepEqual(readTileflowBrandingSources(contours({demTileJson: terrain})), [
    {apiUrl: 'https://api.tileflow.dev'},
  ]);
  assert.deepEqual(
    readTileflowBrandingSources(contours({demTileJson: `${terrain}?map=${mapId}`})),
    [{apiUrl: 'https://api.tileflow.dev', mapId}],
  );
  assert.deepEqual(
    readTileflowBrandingSources(
      contours({demUrl: `https://api.tileflow.dev/tiles/terrain/{z}/{x}/{y}.png?map=${mapId}`}),
    ),
    [{apiUrl: 'https://api.tileflow.dev', mapId}],
  );
  assert.deepEqual(
    readTileflowBrandingSources(contours({demTileJson: 'https://customer.example/elevation.json'})),
    [],
  );
});

test('TileJSON expansion preserves catalog identity and source replacement invalidates it', async () => {
  const prepared = await loadTileflowRuntimeStyle(
    {style: style(`${catalog}?map=${mapId}`)},
    {
      fetch: async () => Response.json({tiles: ['https://cdn.example/{z}/{x}/{y}.pbf']}),
    },
  );
  assert.deepEqual(readTileflowBrandingSources(prepared.style), [
    {apiUrl: 'https://api.tileflow.dev', mapId},
  ]);
  prepared.style.sources.base = {type: 'vector', tiles: ['https://own.example/{z}/{x}/{y}.pbf']};
  assert.deepEqual(readTileflowBrandingSources(prepared.style), []);
  const input = style();
  const provenance = rememberTileflowBrandingSources(input);
  bindTileflowBrandingSources(input, provenance);
  assert.deepEqual(readTileflowBrandingSources(input), [{apiUrl: 'https://api.tileflow.dev'}]);
});

test('policy rejects wrong identity, unknown decisions, invalid revisions and unbounded leases', () => {
  for (const value of [
    policy(false, secondId),
    {...policy(false), catalogLogoRequired: 'false'},
    policy(false, mapId, 0),
    policy(false, mapId, 900_001),
    policy(false, mapId, 1000, '-1'),
  ])
    assert.throws(() => parseTileflowBrandingPolicy(value, mapId));
});

test('public and own sources do not contact billing; removing the last catalog source removes its mark', () => {
  const f = fixture(style(), async () => {
    throw new Error('No billing read expected');
  });
  try {
    assert.equal(f.nodes.size, 1);
    assert.equal(attachTileflowBranding(f.map), f.dispose);
    f.replace(style('https://own.example/tiles.json'));
    assert.equal(f.nodes.size, 0);
    assert.equal(f.container.style.visibility, '');
  } finally {
    f.dispose();
  }
  assert.equal(
    [...f.events.values()].every((listeners) => !listeners.size),
    true,
  );
});

test('paid first paint never creates a provisional logo and Free confirms before presentation', async () => {
  for (const required of [false, true]) {
    let resolve!: (response: Response) => void;
    const f = fixture(style(`${catalog}?map=${mapId}`), async (url, init) => {
      assert.equal(url, `https://api.tileflow.dev/maps/${mapId}/branding`);
      assert.equal(init?.cache, 'no-store');
      return new Promise<Response>((done) => {
        resolve = done;
      });
    });
    try {
      assert.equal(f.container.style.visibility, 'hidden');
      assert.equal(f.anchors(), 0);
      resolve(Response.json(policy(required)));
      await flush();
      assert.equal(f.container.style.visibility, '');
      assert.equal(f.anchors(), Number(required));
    } finally {
      f.dispose();
    }
  }
});

test('a delayed response cannot authorize a different map and removal cancels pending requests', async () => {
  const requests: {signal: AbortSignal; resolve(response: Response): void}[] = [];
  const f = fixture(
    style(`${catalog}?map=${mapId}`),
    async (_, init) =>
      new Promise<Response>((resolve) => {
        requests.push({signal: init!.signal!, resolve});
      }),
  );
  try {
    f.replace(style(`${catalog}?map=${secondId}`));
    assert.equal(requests[0]!.signal.aborted, true);
    requests[0]!.resolve(Response.json(policy(false)));
    await flush();
    assert.equal(f.container.dataset.tileflowBranding, 'pending');
    requests[1]!.resolve(Response.json(policy(true, secondId)));
    await flush();
    assert.equal(f.nodes.size, 1);
  } finally {
    f.emit('remove');
  }
  assert.equal(f.nodes.size, 0);
});

test('renewal failure preserves an unexpired paid lease, then hides without falling back to Free', async (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  let calls = 0;
  const f = fixture(style(`${catalog}?map=${mapId}`), async () => {
    calls++;
    return calls === 1
      ? Response.json(policy(false, mapId, 3000))
      : new Response(null, {status: 503});
  });
  try {
    await flush();
    time = 2100;
    f.emit('styledata');
    await flush();
    assert.equal(f.container.dataset.tileflowBranding, 'none');
    time = 3100;
    f.emit('styledata');
    assert.equal(f.container.dataset.tileflowBranding, 'pending');
    assert.equal(f.anchors(), 0);
  } finally {
    f.dispose();
  }
});

test('native projection retains the hosted Map across protected resource rewrites', () => {
  const input = style();
  const remembered = rememberTileflowBrandingSources(input, {mapId});
  input.sources.base.url = 'tileflow-native://resource/opaque';
  bindTileflowBrandingSources(input, remembered);
  assert.deepEqual(readTileflowBrandingSources(input), [
    {apiUrl: 'https://api.tileflow.dev', mapId},
  ]);
});
