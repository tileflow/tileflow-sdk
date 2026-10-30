import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowElevationProfile,
  type TileflowElevationProfileMap,
} from '../src/maplibre-entry';

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  parentElement: FakeElement | null = null;
  readonly style: Record<string, unknown> & {setProperty(name: string, value: string): void} = {
    setProperty(name: string, value: string) {
      this[name] = value;
    },
  };
  private text = '';

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  get firstChild() {
    return this.children[0] ?? null;
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.text = value;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  removeChild(node: FakeElement) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentElement = null;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  getBoundingClientRect() {
    return {left: 0, top: 0, width: 400, height: 160};
  }
  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({preventDefault() {}, button: 0, pointerId: 1, ...event});
  }
  find(predicate: (element: FakeElement) => boolean): FakeElement | null {
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly defaultView = {
    matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
  };
  createElement(tag: string) {
    return new FakeElement(this, tag);
  }
  createElementNS(_namespace: string, tag: string) {
    return new FakeElement(this, tag);
  }
}

function fakeMap() {
  const document = new FakeDocument();
  const container = document.createElement('div');
  const sources = new Map<string, {data: unknown; setData(data: unknown): void}>();
  const layers = new Map<string, Record<string, unknown>>();
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  let styleLoaded = true;
  const map = {
    getContainer: () => container,
    addSource(id: string, source: {data: unknown}) {
      if (!styleLoaded) throw new Error('Style is not done loading');
      sources.set(id, {
        data: source.data,
        setData(data: unknown) {
          this.data = data;
        },
      });
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => sources.delete(id),
    addLayer(layer: {id: string}) {
      if (!styleLoaded) throw new Error('Style is not done loading');
      layers.set(layer.id, layer);
    },
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => layers.delete(id),
    on(type: string, listener: (event: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    off(type: string, listener: (event: unknown) => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((candidate) => candidate !== listener),
      );
    },
    project: ([lng, lat]: [number, number]) => ({x: lng * 100_000, y: -lat * 100_000}),
  };
  const fire = (type: string, event: unknown = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  const features = () =>
    (sources.get('tileflow-elevation-profile')?.data as {features: {properties: {kind: string}}[]})
      .features;
  return {
    map: map as unknown as TileflowElevationProfileMap,
    sources,
    layers,
    listeners,
    fire,
    features,
    unloadStyle() {
      styleLoaded = false;
      sources.clear();
      layers.clear();
    },
    loadStyle() {
      styleLoaded = true;
      fire('style.load');
    },
  };
}

const gpx = `<gpx version="1.1"><trk><name>Climb</name><trkseg>
<trkpt lat="45.0000" lon="6.0000"><ele>1000</ele></trkpt>
<trkpt lat="45.0010" lon="6.0000"><ele>1020</ele></trkpt>
<trkpt lat="45.0020" lon="6.0000"><ele>1050</ele></trkpt>
<trkpt lat="45.0030" lon="6.0000"><ele>1040</ele></trkpt>
</trkseg></trk></gpx>`;

test('the control adds its source and layers, and removes them with its listeners', () => {
  const harness = fakeMap();
  const control = createTileflowElevationProfile();
  const element = control.onAdd(harness.map) as unknown as FakeElement;
  assert.equal(element.getAttribute('role'), 'group');
  assert.equal(element.getAttribute('aria-label'), 'Elevation profile');
  assert.deepEqual(
    [...harness.layers.keys()],
    [
      'tileflow-elevation-profile-line',
      'tileflow-elevation-profile-selection',
      'tileflow-elevation-profile-hover',
    ],
  );
  assert.equal(control.getDefaultPosition(), 'bottom-left');
  control.onRemove();
  assert.equal(harness.layers.size, 0);
  assert.equal(harness.sources.size, 0);
  for (const type of ['style.load', 'mousemove', 'mouseout'])
    assert.equal(harness.listeners.get(type)?.length ?? 0, 0, type);
});

test('a GPX track with elevations is profiled without any request', async () => {
  const harness = fakeMap();
  let requests = 0;
  const control = createTileflowElevationProfile({
    apiKey: 'tf_public_example',
    fetch: (async () => {
      requests += 1;
      return Response.json({});
    }) as typeof fetch,
  });
  const element = control.onAdd(harness.map) as unknown as FakeElement;
  const profile = await control.setData(gpx);
  assert.equal(requests, 0);
  assert.equal(profile.summary.ascent, 50);
  assert.equal(profile.summary.descent, 10);
  assert.deepEqual(
    harness.features().map((feature) => feature.properties.kind),
    ['line'],
  );
  assert.match(element.textContent, /Distance/u);
  assert.match(element.textContent, /1,050 m/u);
  control.setUnit('imperial');
  assert.match(element.textContent, /3,445 ft/u);
});

test('a line without heights is sampled by the Elevation API in metres', async () => {
  const harness = fakeMap();
  const bodies: unknown[] = [];
  const control = createTileflowElevationProfile({
    apiKey: 'tf_public_example',
    maxSamples: 200,
    fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({
        schemaVersion: 1,
        unit: 'meters',
        dataset: {releaseId: 'mapterhorn-0.0.11', zoom: 12},
        attribution: '© Mapterhorn (https://mapterhorn.com/attribution)',
        usage: {units: 1},
        interval: 30,
        samples: [
          [6, 45, 1000, 0],
          [6, 45.0003, 1003, 33.4],
        ],
        lines: [[0, 1]],
        summary: {
          distance: 33.4,
          ascent: 3,
          descent: 0,
          minElevation: 1000,
          maxElevation: 1003,
          startElevation: 1000,
          endElevation: 1003,
          maxGrade: 9,
          minGrade: 9,
        },
      });
    }) as typeof fetch,
  });
  const element = control.onAdd(harness.map) as unknown as FakeElement;
  const profile = await control.setData({
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [6, 45],
        [6, 45.0003],
      ],
    },
  });
  assert.deepEqual(bodies, [
    {
      line: {
        type: 'LineString',
        coordinates: [
          [6, 45],
          [6, 45.0003],
        ],
      },
      maxSamples: 200,
    },
  ]);
  assert.equal(profile.attribution, '© Mapterhorn (https://mapterhorn.com/attribution)');
  assert.match(element.textContent, /© Mapterhorn/u);
});

test('without heights or an API key the control explains what is missing', async () => {
  const harness = fakeMap();
  const errors: unknown[] = [];
  const control = createTileflowElevationProfile({onError: (error) => errors.push(error)});
  const element = control.onAdd(harness.map) as unknown as FakeElement;
  await assert.rejects(
    control.setData({
      type: 'LineString',
      coordinates: [
        [6, 45],
        [6, 45.001],
      ],
    }),
    /API key/u,
  );
  assert.equal(errors.length, 1);
  assert.match(element.textContent, /an API key is needed/u);
});

test('hovering the line on the map moves the chart and the map point', async () => {
  const harness = fakeMap();
  const hovered: unknown[] = [];
  const control = createTileflowElevationProfile({onHover: (point) => hovered.push(point)});
  control.onAdd(harness.map);
  await control.setData(gpx);
  harness.fire('mousemove', {
    point: {x: 600_000, y: -4_500_100},
    lngLat: {lng: 6, lat: 45.001},
  });
  const point = hovered.at(-1) as {elevation: number; index: number};
  assert.equal(point.elevation, 1020);
  assert.equal(point.index, 1);
  assert.ok(harness.features().some((feature) => feature.properties.kind === 'hover'));
  // Far from the line, the hover ends.
  harness.fire('mousemove', {point: {x: 0, y: 0}, lngLat: {lng: 6, lat: 45.001}});
  assert.equal(hovered.at(-1), null);
});

test('a selected stretch is measured and drawn on the map', async () => {
  const harness = fakeMap();
  const selections: unknown[] = [];
  const control = createTileflowElevationProfile({
    onSelect: (selection) => selections.push(selection),
  });
  const element = control.onAdd(harness.map) as unknown as FakeElement;
  const profile = await control.setData(gpx);
  control.select(0, profile.samples[2]![3]);
  const selection = selections.at(-1) as {profile: {summary: {ascent: number}}};
  assert.equal(selection.profile.summary.ascent, 50);
  assert.ok(harness.features().some((feature) => feature.properties.kind === 'selection'));
  assert.match(element.textContent, /Selection/u);
  control.clearSelection();
  assert.equal(selections.at(-1), null);
});

test('the control waits for the style and redraws after a style change', async () => {
  const harness = fakeMap();
  harness.unloadStyle();
  const control = createTileflowElevationProfile();
  control.onAdd(harness.map);
  await control.setData(gpx);
  assert.equal(harness.layers.size, 0);
  harness.loadStyle();
  assert.equal(harness.layers.size, 3);
  assert.deepEqual(
    harness.features().map((feature) => feature.properties.kind),
    ['line'],
  );
});

test('the chart is a keyboard slider over the profile', async () => {
  const harness = fakeMap();
  const control = createTileflowElevationProfile();
  const element = control.onAdd(harness.map) as unknown as FakeElement;
  await control.setData(gpx);
  const chart = element.find((node) => node.getAttribute('role') === 'slider')!;
  assert.equal(chart.getAttribute('tabindex'), '0');
  chart.dispatch('keydown', {key: 'End'});
  assert.match(chart.getAttribute('aria-valuetext') ?? '', /1,040 m/u);
  chart.dispatch('keydown', {key: 'Home'});
  assert.match(chart.getAttribute('aria-valuetext') ?? '', /1,000 m/u);
});
