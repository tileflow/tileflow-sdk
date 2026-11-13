/**
 * A stand-in for `maplibre-gl` and the page it runs in, close enough to MapLibre for the map
 * controller to mount, change themes and be taken down in Node. What MapLibre does when a map is
 * removed is copied on purpose: controls are removed before `remove` fires, the style is gone
 * afterwards, and a control removed twice fails like MapLibre's own.
 */
import type test from 'node:test';
import {setTileflowMapLibreModuleLoader, type TileflowMapLibre} from '../src/maplibre';

type Listener = (event?: unknown) => void;
type Control = {onAdd(map: unknown): unknown; onRemove(map: unknown): void};

/** A DOM element with what the map and its attachments touch. */
export class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly classList = {
    add: () => undefined,
    contains: () => false,
    remove: () => undefined,
    toggle: () => false,
  };
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & {setProperty(): void; removeProperty(): void} = {
    removeProperty: () => undefined,
    setProperty: () => undefined,
  } as never;
  className = '';
  clientHeight = 300;
  clientWidth = 400;
  parentElement: FakeElement | null = null;
  textContent = '';
  title = '';

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName = 'DIV',
  ) {}

  get isConnected() {
    return this.parentElement !== null;
  }
  addEventListener() {}
  removeEventListener() {}
  append(...nodes: FakeElement[]) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node: FakeElement) {
    node.remove();
    node.parentElement = this;
    this.children.push(node);
    return node;
  }
  contains(node: FakeElement) {
    return this.children.includes(node);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  getBoundingClientRect() {
    return {
      bottom: this.clientHeight,
      height: this.clientHeight,
      left: 0,
      right: this.clientWidth,
      top: 0,
      width: this.clientWidth,
      x: 0,
      y: 0,
    };
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  removeChild(node: FakeElement) {
    node.remove();
    return node;
  }
  replaceChildren(...nodes: FakeElement[]) {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
}

export class FakeDocument {
  readonly defaultView: FakeWindow;
  readonly body: FakeElement;
  readonly documentElement: FakeElement;
  readonly hidden = false;
  readonly visibilityState = 'visible';
  constructor() {
    this.defaultView = new FakeWindow(this);
    this.body = this.createElement('body');
    this.documentElement = this.createElement('html');
  }
  addEventListener() {}
  removeEventListener() {}
  createElement(tagName: string) {
    return new FakeElement(this, tagName.toUpperCase());
  }
  createElementNS(_namespace: string, tagName: string) {
    return this.createElement(tagName);
  }
  createTextNode(text: string) {
    const node = this.createElement('#text');
    node.textContent = text;
    return node;
  }
}

/** Animation frames run on timers, so a map reaches `idle` without a screen. */
export class FakeWindow {
  constructor(readonly document: FakeDocument) {}
  cancelAnimationFrame(frame: number) {
    clearTimeout(frame);
  }
  requestAnimationFrame(callback: (time: number) => void) {
    return setTimeout(() => callback(Date.now()), 0) as unknown as number;
  }
  addEventListener() {}
  removeEventListener() {}
  getComputedStyle() {
    return {getPropertyValue: () => ''};
  }
  matchMedia(query: string) {
    return {
      addEventListener: () => undefined,
      addListener: () => undefined,
      matches: false,
      media: query,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    };
  }
  setTimeout = setTimeout;
  clearTimeout = clearTimeout;
}

class Evented {
  readonly listeners = new Map<string, Listener[]>();
  on(type: string, layersOrListener: unknown, maybeListener?: Listener) {
    const listener = (maybeListener ?? layersOrListener) as Listener;
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
    return {unsubscribe: () => this.off(type, listener)};
  }
  once(type: string, listener: Listener) {
    const wrapped = (event?: unknown) => {
      this.off(type, wrapped);
      listener(event);
    };
    return this.on(type, wrapped);
  }
  off(type: string, layersOrListener: unknown, maybeListener?: Listener) {
    const listener = (maybeListener ?? layersOrListener) as Listener;
    const list = this.listeners.get(type);
    if (list?.includes(listener)) list.splice(list.indexOf(listener), 1);
    return this;
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({type, ...event});
    return this;
  }
  listenerCount() {
    let count = 0;
    for (const list of this.listeners.values()) count += list.length;
    return count;
  }
}

export type FakeMapLibre = ReturnType<typeof createFakeMapLibre>;

export function createFakeMapLibre() {
  const maps: FakeMap[] = [];
  const protocols = new Map<string, unknown>();
  /** Map events whose subscription throws, to make a part of the map fail to start. */
  const failingEvents = new Set<string>();
  let workerUrl = '';

  class FakeMap extends Evented {
    override on(type: string, layersOrListener: unknown, maybeListener?: Listener) {
      if (failingEvents.has(type)) throw new Error(`The fake map refuses ${type} listeners.`);
      return super.on(type, layersOrListener, maybeListener);
    }

    readonly controls: Control[] = [];
    readonly options: Record<string, unknown>;
    readonly container: FakeElement;
    readonly canvas: FakeElement;
    readonly canvasContainer: FakeElement;
    style: {_loaded: boolean; stylesheet: unknown} | null;
    removed = false;
    removeCalls = 0;
    readonly appliedStyles: unknown[] = [];
    camera: {bearing?: number; center?: unknown; pitch?: number; zoom?: number};

    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      this.container = options.container as FakeElement;
      this.canvas = this.container.ownerDocument.createElement('canvas');
      this.canvasContainer = this.container.ownerDocument.createElement('div');
      this.container.append(this.canvasContainer);
      this.camera = {
        bearing: options.bearing as number,
        center: options.center,
        pitch: options.pitch as number,
        zoom: options.zoom as number,
      };
      this.style = {_loaded: false, stylesheet: options.style};
      this.appliedStyles.push(options.style);
      maps.push(this);
      setTimeout(() => this.finishStyle(true), 0);
    }

    private finishStyle(first: boolean) {
      if (this.removed || !this.style) return;
      this.style._loaded = true;
      this.fire('styledata', {dataType: 'style'});
      this.fire('style.load');
      if (first) this.fire('load');
      this.fire('idle');
    }

    private assertStyle() {
      if (!this.style) throw new TypeError("Cannot read properties of null (reading 'getLayer')");
    }

    addControl(control: Control) {
      this.controls.push(control);
      control.onAdd(this);
      return this;
    }
    removeControl(control: Control) {
      const index = this.controls.indexOf(control);
      if (index > -1) this.controls.splice(index, 1);
      control.onRemove(this);
      return this;
    }
    remove() {
      this.removeCalls += 1;
      if (this.removed) throw new Error('The fake map was removed twice.');
      for (const control of this.controls) control.onRemove(this);
      this.controls.length = 0;
      this.style = null;
      this.container.replaceChildren();
      this.removed = true;
      this.fire('remove');
    }
    setStyle(style: unknown) {
      this.assertStyle();
      this.appliedStyles.push(style);
      this.style = {_loaded: false, stylesheet: style};
      setTimeout(() => this.finishStyle(false), 0);
      return this;
    }
    getStyle() {
      return this.style ? (this.style.stylesheet as object) : undefined;
    }
    isStyleLoaded() {
      return this.style?._loaded === true;
    }
    loaded() {
      return this.isStyleLoaded();
    }
    getLayer() {
      this.assertStyle();
      return undefined;
    }
    getSource() {
      this.assertStyle();
      return undefined;
    }
    getLayersOrder() {
      return [];
    }
    addLayer() {
      this.assertStyle();
      return this;
    }
    addSource() {
      this.assertStyle();
      return this;
    }
    removeLayer() {
      this.assertStyle();
      return this;
    }
    removeSource() {
      this.assertStyle();
      return this;
    }
    setLayoutProperty() {
      this.assertStyle();
      return this;
    }
    setPaintProperty() {
      this.assertStyle();
      return this;
    }
    getCanvas() {
      return this.canvas;
    }
    getCanvasContainer() {
      return this.canvasContainer;
    }
    getContainer() {
      return this.container;
    }
    getZoom() {
      return this.camera.zoom ?? 0;
    }
    getPitch() {
      return this.camera.pitch ?? 0;
    }
    getBearing() {
      return this.camera.bearing ?? 0;
    }
    getCenter() {
      return {lat: 0, lng: 0};
    }
    getBounds() {
      return {getEast: () => 1, getNorth: () => 1, getSouth: () => -1, getWest: () => -1};
    }
    jumpTo(camera: FakeMap['camera']) {
      Object.assign(this.camera, camera);
      return this;
    }
    fitBounds() {
      return this;
    }
    easeTo() {
      return this;
    }
    resize() {
      return this;
    }
    triggerRepaint() {}
    project() {
      return {x: 0, y: 0};
    }
    unproject() {
      return {lat: 0, lng: 0};
    }
    queryRenderedFeatures() {
      return [];
    }
    getGlobalState() {
      return {};
    }
    setGlobalStateProperty() {
      return this;
    }
  }

  /** MapLibre's NavigationControl fails when it is removed a second time. */
  class FakeNavigationControl {
    private map: FakeMap | undefined;
    onAdd(map: FakeMap) {
      this.map = map;
      return map.container.ownerDocument.createElement('div');
    }
    onRemove() {
      // MapLibre reads `this._map.off(...)` and then deletes it.
      this.map!.off('move', () => undefined);
      this.map = undefined;
    }
  }

  class FakePositioned {
    map: FakeMap | undefined;
    constructor(readonly options: unknown = {}) {}
    addTo(map: FakeMap) {
      this.map = map;
      return this;
    }
    remove() {
      this.map = undefined;
      return this;
    }
    setLngLat() {
      return this;
    }
    setDOMContent() {
      return this;
    }
    getElement() {
      return (this.options as {element?: unknown}).element;
    }
  }

  const module = {
    Map: FakeMap,
    Marker: FakePositioned,
    NavigationControl: FakeNavigationControl,
    Popup: FakePositioned,
    addProtocol: (name: string, handler: unknown) => void protocols.set(name, handler),
    getWorkerUrl: () => workerUrl,
    removeProtocol: (name: string) => void protocols.delete(name),
    setWorkerUrl: (url: string) => void (workerUrl = url),
  };
  return {failingEvents, maps, module: module as unknown as TileflowMapLibre, protocols};
}

/** Serves the fake renderer, a fake page and the given responses for the length of one test. */
export function useFakeBrowser(
  t: test.TestContext,
  respond: (url: string) => Promise<Response> | Response,
) {
  const fake = createFakeMapLibre();
  setTileflowMapLibreModuleLoader(() => Promise.resolve(fake.module));
  const document = new FakeDocument();
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    ResizeObserver: globals.ResizeObserver,
    fetch: globals.fetch,
    matchMedia: globals.matchMedia,
  };
  const colorScheme = {dark: false, listeners: new Set<(event: {matches: boolean}) => void>()};
  globals.ResizeObserver = class {
    disconnect() {}
    observe() {}
    unobserve() {}
  };
  const requests: string[] = [];
  globals.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    return respond(url);
  }) as typeof fetch;
  globals.matchMedia = (query: string) => ({
    addEventListener: (_type: string, listener: (event: {matches: boolean}) => void) =>
      colorScheme.listeners.add(listener),
    addListener: (listener: (event: {matches: boolean}) => void) =>
      colorScheme.listeners.add(listener),
    get matches() {
      return query.includes('dark') ? colorScheme.dark : !colorScheme.dark;
    },
    media: query,
    removeEventListener: (_type: string, listener: (event: {matches: boolean}) => void) =>
      colorScheme.listeners.delete(listener),
    removeListener: (listener: (event: {matches: boolean}) => void) =>
      colorScheme.listeners.delete(listener),
  });
  t.after(() => {
    setTileflowMapLibreModuleLoader();
    Object.assign(globals, saved);
  });
  return {
    ...fake,
    colorScheme: {
      listenerCount: () => colorScheme.listeners.size,
      set(dark: boolean) {
        colorScheme.dark = dark;
        for (const listener of [...colorScheme.listeners]) listener({matches: dark});
      },
    },
    container: () => document.createElement('div') as unknown as HTMLElement,
    requests,
  };
}

/** A manifest with one map and a light and a dark theme that follow the system. */
export function themedManifest(baseUrl: string, themes = ['light', 'dark', 'dusk']) {
  return {
    maps: {
      madrid: {
        defaultTheme: 'light',
        systemThemes: {dark: 'dark', light: 'light'},
        themes: Object.fromEntries(
          themes.map((theme) => [
            theme,
            {
              colorScheme: theme === 'light' ? 'light' : 'dark',
              fontFaces: [],
              styleUrl: `${baseUrl}/${theme}.json`,
            },
          ]),
        ),
        view: {center: [-3.7, 40.4], zoom: 12},
      },
    },
    version: 1,
  };
}

/** A style with no sources, so nothing else is fetched. */
export function emptyStyle(name: string) {
  return {layers: [], metadata: {'tileflow:theme': name}, name, sources: {}, version: 8};
}

export const json = (value: unknown) =>
  new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});

export const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check` holds, or fails after a while with what it last saw. */
export async function until(check: () => boolean, describe: () => unknown = () => '', ms = 2000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out: ${JSON.stringify(describe())}`);
    await settle(5);
  }
}
