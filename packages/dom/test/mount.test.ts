import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowMap, type TileflowMapStatus} from '../src/index';
import {loadTileflowMapLibre, setTileflowMapLibreModuleLoader} from '../src/maplibre';
import {emptyStyle, json, settle, themedManifest, until, useFakeBrowser} from './fake-maplibre';

let sites = 0;
/** A fresh origin per test: manifests are cached per URL. */
const site = () => `https://maps${(sites += 1)}.example.test`;

/** Answers the manifest and each theme's style; `hold` delays a style until released. */
function tileflowSite(baseUrl: string, options: {fail?: string[]; themes?: string[]} = {}) {
  const held = new Map<string, () => void>();
  const holds = new Set<string>();
  return {
    held,
    hold: (theme: string) => holds.add(theme),
    release(theme: string) {
      holds.delete(theme);
      held.get(theme)?.();
      held.delete(theme);
    },
    async respond(url: string): Promise<Response> {
      if (url === `${baseUrl}/manifest.json`) return json(themedManifest(baseUrl, options.themes));
      const theme = /\/([a-z]+)\.json$/u.exec(url)?.[1];
      if (!theme || !url.startsWith(baseUrl)) return new Response('', {status: 204});
      if (holds.has(theme)) await new Promise<void>((resolve) => held.set(theme, resolve));
      if (options.fail?.includes(theme)) return new Response('unavailable', {status: 503});
      return json(emptyStyle(theme));
    },
  };
}

const shownTheme = (style: unknown) => (style as {name?: string} | undefined)?.name;

test('mounts a map, reaches idle, and two maps keep their own resources', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  const errors = t.mock.method(console, 'error', () => undefined);
  const source = {manifestUrl: `${base}/manifest.json`, map: 'madrid'};

  const first = createTileflowMap(browser.container(), {source, theme: 'dark'});
  const second = createTileflowMap(browser.container(), {navigationControl: true, source});
  await Promise.all([first.ready, second.ready]);
  await until(
    () => second.getStatus().readiness === 'idle',
    () => second.getStatus(),
  );
  assert.equal(browser.maps.length, 2);
  assert.equal(shownTheme(browser.maps[0]!.getStyle()), 'dark');
  assert.equal(second.getStatus().theme, 'light');
  const protocols = [...browser.protocols.keys()];

  first.destroy();
  assert.equal(browser.maps[0]!.removed, true);
  assert.equal(first.getMap(), null);
  // The shared protocols stay for the other map, which keeps working.
  assert.deepEqual([...browser.protocols.keys()], protocols);
  second.setTheme('dusk');
  await until(() => shownTheme(browser.maps[1]!.getStyle()) === 'dusk');
  await until(
    () => second.getStatus().readiness === 'idle',
    () => second.getStatus(),
  );
  second.destroy();
  assert.equal(browser.maps[1]!.removeCalls, 1);
  assert.equal(errors.mock.callCount(), 0);
});

test('a map destroyed while its style loads is never created', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  tileflow.hold('light');
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  const source = {manifestUrl: `${base}/manifest.json`, map: 'madrid'};

  const map = createTileflowMap(browser.container(), {source});
  await until(() => tileflow.held.has('light'));
  map.destroy();
  tileflow.release('light');
  await settle(20);
  assert.equal(browser.maps.length, 0);
  await assert.rejects(map.ready, {name: 'AbortError'});
});

test('the camera and colours set while the map loads apply when it is created', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  tileflow.hold('light');
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  const map = createTileflowMap(browser.container(), {
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
  });
  await until(() => tileflow.held.has('light'));
  map.setView({center: [2.17, 41.38], zoom: 15});
  tileflow.release('light');
  await map.ready;
  const created = browser.maps[0]!;
  assert.deepEqual(created.options.center, [2.17, 41.38]);
  assert.equal(created.options.zoom, 15);
  map.destroy();
});

test('getMap().remove() takes the controller down with the map, without errors', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  const errors = t.mock.method(console, 'error', () => undefined);
  const container = browser.container();
  const statuses: TileflowMapStatus[] = [];
  const map = createTileflowMap(container, {
    navigationControl: true,
    onStatusChange: (status) => statuses.push(status),
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
    theme: 'system',
  });
  const mapLibreMap = await map.ready;
  assert.ok(mapLibreMap);
  assert.equal(browser.colorScheme.listenerCount(), 1);
  const fake = browser.maps[0]!;
  const listenersBefore = fake.listenerCount();
  assert.ok(listenersBefore > 0);

  mapLibreMap.remove();

  assert.equal(errors.mock.callCount(), 0, String(errors.mock.calls[0]?.arguments));
  assert.equal(fake.removeCalls, 1);
  assert.equal(map.getMap(), null);
  assert.equal(map.getThemeController(), null);
  // The rest stops once MapLibre's own `remove` listeners have run.
  await settle();
  assert.equal(errors.mock.callCount(), 0, String(errors.mock.calls[0]?.arguments));
  assert.equal(container.getAttribute('data-tileflow-state'), null);
  assert.equal(browser.colorScheme.listenerCount(), 0);
  // Later calls, including the controller's own destroy, are safe and do nothing.
  const reported = statuses.length;
  map.setTheme('dark');
  map.destroy();
  map.destroy();
  await settle(10);
  assert.equal(statuses.length, reported);
  assert.equal(fake.removeCalls, 1);
  assert.equal(errors.mock.callCount(), 0);
});

test('a system theme change during the first load shows the current preference', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  tileflow.hold('light');
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  const map = createTileflowMap(browser.container(), {
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
    theme: 'system',
  });
  await until(() => tileflow.held.has('light'));
  browser.colorScheme.set(true);
  tileflow.release('light');
  await map.ready;
  await until(() => shownTheme(browser.maps[0]!.getStyle()) === 'dark');
  await until(
    () => map.getStatus().readiness === 'idle',
    () => map.getStatus(),
  );
  assert.equal(map.getStatus().theme, 'dark');
  map.destroy();
  assert.equal(browser.colorScheme.listenerCount(), 0);
});

test('a system subscription is released when the map cannot start', async (t) => {
  const base = site();
  const browser = useFakeBrowser(t, (url) =>
    url.endsWith('manifest.json')
      ? json(themedManifest(base))
      : new Response('unavailable', {status: 503}),
  );
  t.mock.method(console, 'error', () => undefined);
  const codes: string[] = [];
  const map = createTileflowMap(browser.container(), {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
    theme: 'system',
  });
  await assert.rejects(map.ready);
  assert.deepEqual(codes, ['runtime']);
  assert.equal(map.getStatus().readiness, 'error');
  map.destroy();
  assert.equal(browser.colorScheme.listenerCount(), 0);
});

test('a failed theme change leaves the applied selection, still following the system', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base, {fail: ['dusk']});
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  t.mock.method(console, 'error', () => undefined);
  const codes: string[] = [];
  const map = createTileflowMap(browser.container(), {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
    theme: 'system',
  });
  await map.ready;
  await until(
    () => map.getStatus().readiness === 'idle',
    () => map.getStatus(),
  );
  const fake = browser.maps[0]!;

  // The system turns dark while dark is slow; dusk replaces that change and fails.
  tileflow.hold('dark');
  browser.colorScheme.set(true);
  await until(() => tileflow.held.has('dark'));
  map.setTheme('dusk');
  await until(
    () => codes.includes('theme'),
    () => codes,
  );
  tileflow.release('dark');

  // The map is back on the system's theme, and reports what it shows.
  await until(
    () => shownTheme(fake.getStyle()) === 'dark',
    () => shownTheme(fake.getStyle()),
  );
  await settle(20);
  assert.equal(map.getStatus().theme, 'dark');
  assert.equal(map.getStatus().readiness, 'error');
  assert.ok(!fake.appliedStyles.some((style) => shownTheme(style) === 'dusk'));

  // It keeps following the system until the application picks another theme.
  browser.colorScheme.set(false);
  await until(
    () => shownTheme(fake.getStyle()) === 'light',
    () => shownTheme(fake.getStyle()),
  );
  assert.equal(map.getStatus().theme, 'light');
  map.setTheme('dark');
  await until(
    () => map.getStatus().readiness === 'idle',
    () => map.getStatus(),
  );
  assert.equal(shownTheme(fake.getStyle()), 'dark');
  assert.deepEqual(codes, ['theme']);
  map.destroy();
});

test('a failed theme on one source does not prevent the next source loading that theme', async (t) => {
  const firstBase = site();
  const secondBase = site();
  const firstSite = tileflowSite(firstBase, {fail: ['dark']});
  const secondSite = tileflowSite(secondBase);
  const browser = useFakeBrowser(t, (url) =>
    url.startsWith(firstBase) ? firstSite.respond(url) : secondSite.respond(url),
  );
  const codes: string[] = [];
  const map = createTileflowMap(browser.container(), {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: `${firstBase}/manifest.json`, map: 'madrid'},
    theme: 'light',
  });
  await map.ready;
  map.setTheme('dark');
  await until(() => codes.includes('theme'));
  assert.equal(shownTheme(browser.maps[0]!.getStyle()), 'light');

  map.update({source: {manifestUrl: `${secondBase}/manifest.json`, map: 'madrid'}});
  await until(
    () => browser.maps.length === 2 && map.getStatus().readiness === 'idle',
    () => map.getStatus(),
  );
  assert.equal(shownTheme(browser.maps[1]!.getStyle()), 'dark');
  assert.equal(map.getStatus().theme, 'dark');
  assert.equal(browser.maps[0]!.removeCalls, 1);
  assert.deepEqual(codes, ['theme']);
  map.destroy();
});

test('a failed theme that stood in for a failure stays on the applied theme', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base, {fail: ['dark', 'dusk']});
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  t.mock.method(console, 'error', () => undefined);
  const codes: string[] = [];
  const map = createTileflowMap(browser.container(), {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
    theme: 'system',
  });
  await map.ready;
  const fake = browser.maps[0]!;
  // Dusk fails, the system has turned dark, and dark fails too: the map stays on light.
  browser.colorScheme.set(true);
  map.setTheme('dusk');
  await settle(60);
  assert.equal(shownTheme(fake.getStyle()), 'light');
  assert.equal(map.getStatus().theme, 'light');
  const reported = codes.length;
  await settle(60);
  assert.equal(codes.length, reported, 'no request is retried on its own');
  map.destroy();
});

test('an unknown theme name keeps a valid change that is on its way', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  t.mock.method(console, 'error', () => undefined);
  const codes: string[] = [];
  const map = createTileflowMap(browser.container(), {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
    theme: 'light',
  });
  await map.ready;
  const fake = browser.maps[0]!;
  browser.colorScheme.set(true);
  tileflow.hold('dark');
  map.setTheme('system');
  await until(() => tileflow.held.has('dark'));
  map.setTheme('nowhere');
  tileflow.release('dark');

  await until(
    () => shownTheme(fake.getStyle()) === 'dark',
    () => shownTheme(fake.getStyle()),
  );
  await settle(20);
  assert.equal(map.getStatus().theme, 'dark');
  assert.equal(map.getStatus().readiness, 'error');
  assert.deepEqual(codes, ['theme']);
  // The system selection it fell back to is still followed.
  browser.colorScheme.set(false);
  await until(
    () => shownTheme(fake.getStyle()) === 'light',
    () => shownTheme(fake.getStyle()),
  );
  map.destroy();
});

test('destroying while a theme waits for the style settles the change and reports nothing', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  const errors = t.mock.method(console, 'error', () => undefined);
  const codes: string[] = [];
  const map = createTileflowMap(browser.container(), {
    onError: (event) => codes.push(event.code),
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
  });
  // The map exists but its first style has not finished loading.
  await until(() => browser.maps.length === 1);
  map.update({colors: {'surface.land': '#ffffff'}, theme: 'dark'});
  map.destroy();
  await settle(40);
  assert.deepEqual(codes, []);
  assert.equal(errors.mock.callCount(), 0);
});

test('interactions that cannot start leave the map, and start again when their data changes', async (t) => {
  const base = site();
  const tileflow = tileflowSite(base);
  const browser = useFakeBrowser(t, (url) => tileflow.respond(url));
  t.mock.method(console, 'error', () => undefined);
  const marker = (id: string) =>
    ({ariaLabel: id, coordinate: [-3.7, 40.4], id, kind: 'marker'}) as const;
  browser.failingEvents.add('zoom');
  const map = createTileflowMap(browser.container(), {
    annotations: [marker('sol')],
    source: {manifestUrl: `${base}/manifest.json`, map: 'madrid'},
  });
  const mapLibreMap = await map.ready;
  const fake = browser.maps[0]!;
  const failed = () =>
    map.getStatus().diagnostics.some(({message}) => /could not start/u.test(message));
  await until(failed, () => map.getStatus());
  assert.equal(map.getMap(), mapLibreMap);
  assert.equal(fake.removed, false);
  // What the interactions acquired before failing was released.
  assert.equal(fake.listeners.get('click')?.length ?? 0, 0);

  browser.failingEvents.clear();
  map.setAnnotations([marker('sol'), marker('callao')]);
  await until(
    () => !failed(),
    () => map.getStatus(),
  );
  assert.ok((fake.listeners.get('zoom')?.length ?? 0) > 0);
  assert.equal(map.getMap(), mapLibreMap);
  map.destroy();
  assert.equal(fake.listenerCount(), 0);
});

test('MapLibre is loaded once, and again after a failed load', async (t) => {
  let loads = 0;
  let fail = true;
  const fake = useFakeBrowser(t, () => new Response('', {status: 404}));
  setTileflowMapLibreModuleLoader(() => {
    loads += 1;
    return fail ? Promise.reject(new Error('offline')) : Promise.resolve(fake.module);
  });
  await assert.rejects(loadTileflowMapLibre(), /offline/u);
  fail = false;
  const [first, second] = await Promise.all([loadTileflowMapLibre(), loadTileflowMapLibre()]);
  assert.equal(first, second);
  assert.equal(loads, 2);
});
