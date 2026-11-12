import assert from 'node:assert/strict';
import test from 'node:test';
import {createTileflowAppearanceBinding} from '../src/browser';

/** A page the tests can restyle: its variables, its observers and its colour-scheme query. */
function createPage(initial: Record<string, string>) {
  let variables = {...initial};
  const observed: {options: unknown; target: unknown}[] = [];
  const observers = new Set<{callback: () => void; disconnected: boolean}>();
  const schemeListeners = new Set<() => void>();
  const documentElement = {name: 'html'};
  const body = {name: 'body'};
  class FakeMutationObserver {
    readonly state = {callback: () => undefined as void, disconnected: false};
    constructor(callback: () => void) {
      this.state.callback = callback;
      observers.add(this.state);
    }
    observe(target: unknown, options: unknown) {
      observed.push({options, target});
    }
    disconnect() {
      this.state.disconnected = true;
      observers.delete(this.state);
    }
  }
  const reads: string[] = [];
  const view = {
    getComputedStyle: () => ({
      getPropertyValue: (name: string) => {
        reads.push(name);
        return variables[name] ?? '';
      },
    }),
    matchMedia: (query: string) => ({
      addEventListener: (_event: string, listener: () => void) => schemeListeners.add(listener),
      matches: false,
      media: query,
      removeEventListener: (_event: string, listener: () => void) =>
        schemeListeners.delete(listener),
    }),
    MutationObserver: FakeMutationObserver,
  };
  const element = {ownerDocument: {body, defaultView: view, documentElement}} as unknown as Element;
  return {
    body,
    documentElement,
    element,
    observed,
    observers,
    reads,
    schemeListeners,
    /** Restyles the page, then tells the observers, as the browser would. */
    mutate(next: Record<string, string>) {
      variables = {...next};
      for (const observer of [...observers]) observer.callback();
    },
    switchScheme(next: Record<string, string>) {
      variables = {...next};
      for (const listener of [...schemeListeners]) listener();
    },
  };
}

function setup(variables: Record<string, string>, options: {withElement?: boolean} = {}) {
  const page = createPage(variables);
  const calls: unknown[] = [];
  const errors: [string, string][] = [];
  const binding = createTileflowAppearanceBinding({
    controller: {
      setColors: (colors: unknown) => {
        calls.push(colors);
        return Promise.resolve({status: 'applied', theme: 'light'});
      },
      setEmphasis: () => Promise.resolve({status: 'applied', theme: 'light'}),
    } as never,
    element: options.withElement === false ? undefined : page.element,
    map: {isStyleLoaded: () => true, off: () => undefined, on: () => undefined},
    onError: (error, part) => errors.push([part, error.message]),
  });
  return {binding, calls, errors, page};
}

const light = {'--primary': '#1d4ed8', '--surface': 'oklch(0.97 0 0)'};
const dark = {'--primary': '#93c5fd', '--surface': 'oklch(0.2 0 0)'};

test('reads CSS variables from the element before the controller sees the colours', () => {
  const {binding, calls} = setup(light);
  binding.update({
    colors: {
      'surface.land': 'var(--surface)',
      'surface.water': 'color-mix(in oklab, var(--primary) 40%, var(--missing, white))',
      'surface.park': '#00ff00',
    },
  });
  assert.deepEqual(calls, [
    {
      'surface.land': 'oklch(0.97 0 0)',
      'surface.park': '#00ff00',
      'surface.water': 'color-mix(in oklab, #1d4ed8 40%, white)',
    },
  ]);
});

test('reads them again when <html> or <body> change, and shows only what changed', () => {
  const {binding, calls, page} = setup(light);
  binding.update({colors: {'surface.land': 'var(--surface)'}});
  assert.equal(calls.length, 1);
  assert.deepEqual(
    page.observed.map(({target, options}) => [target, options]),
    [
      [page.documentElement, {attributeFilter: ['class', 'style', 'data-theme'], attributes: true}],
      [page.body, {attributeFilter: ['class', 'style', 'data-theme'], attributes: true}],
    ],
  );

  // A class change that leaves this variable alone shows nothing again.
  page.mutate({...light, '--primary': '#000000'});
  assert.equal(calls.length, 1);

  // A change that gives the variable another value shows the new colour.
  page.mutate(dark);
  assert.deepEqual(calls.at(-1), {'surface.land': 'oklch(0.2 0 0)'});
  assert.equal(calls.length, 2);

  // Two changes in a row with the same result apply once.
  page.mutate(dark);
  assert.equal(calls.length, 2);
});

test('reads them again when the preferred colour scheme changes', () => {
  const {binding, calls, page} = setup(light);
  binding.update({colors: {'surface.land': 'var(--surface)'}});
  assert.equal(page.schemeListeners.size, 1);
  page.switchScheme(dark);
  assert.deepEqual(calls.at(-1), {'surface.land': 'oklch(0.2 0 0)'});
});

test('a variable with no value and no fallback is reported once, by name, and shows nothing', () => {
  const {binding, calls, errors, page} = setup({});
  binding.update({colors: {'surface.land': 'var(--primary)'}});
  assert.equal(calls.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]![0], 'colors');
  assert.match(errors[0]![1], /"surface\.land"/u);
  assert.match(errors[0]![1], /--primary has no value and no fallback/u);

  // The page changes without giving the variable a value: the same failure is not reported again.
  page.mutate({'--other': '#111111'});
  assert.equal(errors.length, 1);

  // Once the variable has a value, the colour shows.
  page.mutate(light);
  assert.deepEqual(calls, [{'surface.land': '#1d4ed8'}]);
});

test('a variable that disappears keeps the colours that are showing and reports', () => {
  const {binding, calls, errors, page} = setup(light);
  binding.update({colors: {'surface.land': 'var(--surface)'}});
  page.mutate({});
  assert.equal(calls.length, 1);
  assert.equal(errors.length, 1);
  page.mutate(light);
  assert.equal(calls.length, 1, 'the colours are the ones already showing');
});

test('stops watching the page when no colour uses a variable, and on dispose', () => {
  const {binding, page} = setup(light);
  binding.update({colors: {'surface.land': 'var(--surface)'}});
  assert.equal(page.observers.size, 1);
  assert.equal(page.schemeListeners.size, 1);

  binding.update({colors: {'surface.land': '#111111'}});
  assert.equal(page.observers.size, 0);
  assert.equal(page.schemeListeners.size, 0);

  binding.update({colors: {'surface.land': 'var(--surface)'}});
  assert.equal(page.observers.size, 1);
  binding.dispose();
  assert.equal(page.observers.size, 0);
  assert.equal(page.schemeListeners.size, 0);
});

test('plain colours never touch the page', () => {
  const {binding, page} = setup(light);
  binding.update({colors: {'surface.land': '#111111'}});
  assert.equal(page.reads.length, 0);
  assert.equal(page.observers.size, 0);
});

test('without an element, a variable goes to the controller unresolved to be rejected there', () => {
  const {binding, calls} = setup(light, {withElement: false});
  binding.update({colors: {'surface.land': 'var(--surface)'}});
  assert.deepEqual(calls, [{'surface.land': 'var(--surface)'}]);
});

test('emphasis still shows when a colour cannot be resolved', async () => {
  const page = createPage({});
  const emphasis: unknown[] = [];
  const binding = createTileflowAppearanceBinding({
    controller: {
      setColors: () => Promise.resolve({status: 'applied', theme: 'light'}),
      setEmphasis: (value: unknown) => {
        emphasis.push(value);
        return Promise.resolve({status: 'applied', theme: 'light'});
      },
    } as never,
    element: page.element,
    map: {isStyleLoaded: () => true, off: () => undefined, on: () => undefined},
  });
  binding.update({colors: {a: 'var(--nope)'}, emphasis: {labels: 0.5}});
  assert.deepEqual(emphasis, [{labels: 0.5}]);
});
