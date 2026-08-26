import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowAnnotationRegistry,
  createTileflowOverlayStateController,
  type TileflowAnnotationRegistry,
  type TileflowAnnotationRegistryAdapter,
} from '../src/maplibre';
import type {TileflowInteractionTargetRef} from '../src/contracts';

type Definition = {fail?: boolean; id: string; value: number};
type Instance = {id: string; removed: number; value: number};

function createFixture(
  overrides: Partial<
    TileflowAnnotationRegistryAdapter<
      {externalOrder: string[]; log: string[]},
      string,
      Definition,
      Instance
    >
  > = {},
) {
  const context = {externalOrder: [] as string[], log: [] as string[]};
  const adapter: TileflowAnnotationRegistryAdapter<typeof context, string, Definition, Instance> = {
    context,
    create(_context, definition) {
      context.log.push(`create:${definition.id}`);
      if (definition.fail) throw new Error(`create failed:${definition.id}`);
      return {id: definition.id, removed: 0, value: definition.value};
    },
    getKey: (definition) => definition.id,
    remove(instance) {
      context.log.push(`remove:${instance.id}`);
      instance.removed += 1;
    },
    reorder(_context, entries) {
      context.externalOrder = entries.map(({key}) => key);
      context.log.push(`reorder:${context.externalOrder.join(',')}`);
    },
    update(instance, _context, next) {
      context.log.push(`update:${instance.id}:${next.value}`);
      instance.value = next.value;
      if (next.fail) throw new Error(`update failed:${instance.id}`);
    },
    ...overrides,
  };
  return {adapter, context};
}

test('reconciles create, update, remove, and reorder while preserving keyed instances', () => {
  const {adapter, context} = createFixture();
  const registry = createTileflowAnnotationRegistry(adapter);
  const a = {id: 'a', value: 1};
  const b = {id: 'b', value: 2};

  registry.reconcile([a, b]);
  const aInstance = registry.get('a')?.instance;
  const bInstance = registry.get('b')?.instance;
  context.log.length = 0;

  registry.reconcile([{id: 'b', value: 3}, a, {id: 'c', value: 4}]);

  assert.equal(registry.get('a')?.instance, aInstance);
  assert.equal(registry.get('b')?.instance, bInstance);
  assert.equal(registry.get('b')?.instance.value, 3);
  assert.deepEqual(
    registry.entries().map(({key}) => key),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(context.externalOrder, ['b', 'a', 'c']);
  assert.deepEqual(context.log, ['create:c', 'update:b:3', 'reorder:b,a,c']);

  registry.reconcile([a, {id: 'c', value: 4}]);
  assert.equal(bInstance?.removed, 1);
  assert.equal(registry.size, 2);
});

test('validates duplicate keys before invoking lifecycle callbacks', () => {
  const {adapter, context} = createFixture();
  const registry = createTileflowAnnotationRegistry(adapter);

  assert.throws(
    () =>
      registry.reconcile([
        {id: 'same', value: 1},
        {id: 'same', value: 2},
      ]),
    /Duplicate Tileflow annotation key/,
  );
  assert.deepEqual(context.log, []);
  assert.equal(registry.size, 0);
});

test('rolls back newly created instances when construction fails', () => {
  const {adapter, context} = createFixture();
  const registry = createTileflowAnnotationRegistry(adapter);
  const original = {id: 'original', value: 1};
  registry.reconcile([original]);
  const originalInstance = registry.get('original')?.instance;
  context.log.length = 0;

  assert.throws(
    () =>
      registry.reconcile([
        original,
        {id: 'temporary', value: 2},
        {fail: true, id: 'broken', value: 3},
      ]),
    /create failed:broken/,
  );

  assert.equal(registry.get('original')?.instance, originalInstance);
  assert.deepEqual(
    registry.entries().map(({key}) => key),
    ['original'],
  );
  assert.deepEqual(context.log, ['create:temporary', 'create:broken', 'remove:temporary']);
});

test('rolls back successful and partially failed updates in reverse order', () => {
  const {adapter, context} = createFixture();
  const registry = createTileflowAnnotationRegistry(adapter);
  registry.reconcile([
    {id: 'a', value: 1},
    {id: 'b', value: 2},
  ]);
  const a = registry.get('a')?.instance;
  const b = registry.get('b')?.instance;
  context.log.length = 0;

  assert.throws(
    () =>
      registry.reconcile([
        {id: 'a', value: 10},
        {fail: true, id: 'b', value: 20},
        {id: 'temporary', value: 30},
      ]),
    /update failed:b/,
  );

  assert.equal(a?.value, 1);
  assert.equal(b?.value, 2);
  assert.equal(registry.get('temporary'), undefined);
  assert.deepEqual(context.log, [
    'create:temporary',
    'update:a:10',
    'update:b:20',
    'update:b:2',
    'update:a:1',
    'remove:temporary',
  ]);
});

test('rolls back external ordering, updates, and additions when reorder fails', () => {
  let failOrder = false;
  const {adapter, context} = createFixture({
    reorder(_context, entries) {
      context.externalOrder = entries.map(({key}) => key);
      context.log.push(`reorder:${context.externalOrder.join(',')}`);
      if (failOrder) {
        failOrder = false;
        throw new Error('reorder failed');
      }
    },
  });
  const registry = createTileflowAnnotationRegistry(adapter);
  registry.reconcile([
    {id: 'a', value: 1},
    {id: 'b', value: 2},
  ]);
  const a = registry.get('a')?.instance;
  context.log.length = 0;
  failOrder = true;

  assert.throws(
    () =>
      registry.reconcile([
        {id: 'b', value: 2},
        {id: 'a', value: 10},
        {id: 'c', value: 3},
      ]),
    /reorder failed/,
  );

  assert.equal(a?.value, 1);
  assert.deepEqual(context.externalOrder, ['a', 'b']);
  assert.deepEqual(
    registry.entries().map(({key}) => key),
    ['a', 'b'],
  );
  assert.deepEqual(context.log, [
    'create:c',
    'update:b:2',
    'update:a:10',
    'reorder:b,a,c',
    'reorder:a,b',
    'update:a:1',
    'update:b:2',
    'remove:c',
  ]);
});

test('commits removals logically, retries failed cleanup, and disposes idempotently', () => {
  const removalAttempts = new Map<string, number>();
  const {adapter} = createFixture({
    remove(instance) {
      const attempts = (removalAttempts.get(instance.id) ?? 0) + 1;
      removalAttempts.set(instance.id, attempts);
      if (instance.id === 'a' && attempts === 1) throw new Error('temporary cleanup failure');
      instance.removed += 1;
    },
  });
  const registry = createTileflowAnnotationRegistry(adapter);
  registry.reconcile([
    {id: 'a', value: 1},
    {id: 'b', value: 2},
  ]);

  assert.throws(() => registry.reconcile([{id: 'b', value: 2}]), /Unable to remove/);
  assert.equal(registry.get('a'), undefined);
  assert.equal(registry.size, 1);

  registry.dispose();
  registry.dispose();
  assert.equal(removalAttempts.get('a'), 2);
  assert.equal(removalAttempts.get('b'), 1);
  assert.equal(registry.size, 0);
  assert.throws(() => registry.reconcile([]), /registry is disposed/);
});

test('rejects reentrant reconciliation and restores the outer transaction', () => {
  const registry: TileflowAnnotationRegistry<string, Definition, Instance> =
    createTileflowAnnotationRegistry({
      context: undefined,
      create(_context, definition) {
        if (definition.id === 'reentrant') registry.reconcile([]);
        return {id: definition.id, removed: 0, value: definition.value};
      },
      getKey: ({id}) => id,
      remove(instance) {
        instance.removed += 1;
      },
      update() {},
    });

  assert.throws(
    () => registry.reconcile([{id: 'reentrant', value: 1}]),
    /mutation is already in progress/,
  );
  assert.equal(registry.size, 0);
  registry.reconcile([{id: 'recovered', value: 2}]);
  assert.equal(registry.size, 1);
});

type Target = {id: string; kind: 'annotation'};

test('overlay state uses semantic target equality and owns one popup', () => {
  const changes: string[] = [];
  const controller = createTileflowOverlayStateController<Target>({
    areTargetsEqual: (left, right) => left.kind === right.kind && left.id === right.id,
    onChange(state, _previous, reason) {
      changes.push(`${reason}:${state.popup?.id ?? '-'}:${state.tooltip?.id ?? '-'}`);
    },
  });
  const a = {id: 'a', kind: 'annotation'} as const;
  const equivalentA = {id: 'a', kind: 'annotation'} as const;
  const b = {id: 'b', kind: 'annotation'} as const;

  assert.equal(controller.setTooltip(a), true);
  assert.equal(controller.setTooltip(equivalentA), false);
  assert.equal(controller.setPopup(equivalentA), true);
  assert.deepEqual(controller.getState(), {popup: equivalentA, tooltip: null});
  assert.equal(controller.setTooltip(a), false, 'an open popup suppresses its own tooltip');
  assert.equal(controller.setTooltip(b), true);
  assert.equal(controller.clearTarget(equivalentA), true);
  assert.deepEqual(controller.getState(), {popup: null, tooltip: b});
  assert.deepEqual(changes, [
    'tooltip:open:-:a',
    'popup:open:a:-',
    'tooltip:open:a:b',
    'target:remove:-:b',
  ]);
});

test('overlay target reconciliation, subscriptions, and disposal are idempotent', () => {
  const controller = createTileflowOverlayStateController<Target>();
  const reasons: string[] = [];
  const unsubscribe = controller.subscribe((_state, _previous, reason) => reasons.push(reason));
  const a = {id: 'a', kind: 'annotation'} as const;
  const b = {id: 'b', kind: 'annotation'} as const;

  controller.setPopup(a);
  controller.setTooltip(b);
  assert.equal(
    controller.reconcileTargets((target) => target.id === 'a'),
    true,
  );
  unsubscribe();
  unsubscribe();
  controller.dispose();
  controller.dispose();

  assert.deepEqual(controller.getState(), {popup: null, tooltip: null});
  assert.equal(controller.setPopup(b), false);
  assert.equal(
    controller.reconcileTargets(() => true),
    false,
  );
  assert.deepEqual(reasons, ['popup:open', 'tooltip:open', 'targets:reconcile']);
});

test('overlay state accepts complete serializable interaction target references', () => {
  const controller = createTileflowOverlayStateController<TileflowInteractionTargetRef>({
    areTargetsEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  });
  const semanticTarget = {
    domain: 'poi',
    featureId: 'poi-42',
    kind: 'semantic-feature',
  } as const;
  const mapTarget = {coordinate: [-3.7, 40.4], kind: 'map'} as const;

  controller.setPopup(semanticTarget);
  controller.setTooltip(mapTarget);
  assert.deepEqual(controller.getState(), {
    popup: semanticTarget,
    tooltip: mapTarget,
  });
});

test('maplibre adapter module evaluates without browser globals', async () => {
  const globals = ['document', 'navigator', 'requestAnimationFrame', 'window'] as const;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const name of globals) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new Error(`${name} was read during module evaluation`);
      },
    });
  }

  try {
    const specifier = new URL(`../src/maplibre.ts?ssr=${Date.now()}`, import.meta.url).href;
    const imported = await import(specifier);
    assert.equal(typeof imported.createTileflowAnnotationRegistry, 'function');
  } finally {
    for (const name of globals) {
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
});
