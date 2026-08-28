import {
  type TileflowLayerSlot,
  tileflowLayerSlots,
  tileflowSemanticTargetPattern,
  type TileflowSlotConstraint,
} from './contributions';
import type {TileflowLayerFamilyIR} from './domain-ir';
import {tileflowLayerDomains} from './domains';

export function assembleTileflowLayerFamilies(
  families: readonly TileflowLayerFamilyIR[],
  extraConstraints: readonly TileflowSlotConstraint[] = [],
): TileflowLayerFamilyIR[] {
  const slotOrder = resolveSlotOrder(extraConstraints);
  const orderBySlot = new Map(slotOrder.map((slot, index) => [slot, index]));
  const ids = new Set<string>();
  const positions = new Set<string>();

  for (const family of families) {
    if (!family || typeof family !== 'object') {
      throw new Error('Tileflow layer families must be objects.');
    }
    if (family.kind !== 'tileflow-layer-family') {
      throw new Error('Tileflow layer families must have kind "tileflow-layer-family".');
    }
    const key = family.key;
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Tileflow layer-family key must not be empty.');
    }
    if (typeof family.renderer !== 'string' || !family.renderer.trim()) {
      throw new Error(`Tileflow layer family ${key} requires a non-empty renderer.`);
    }
    if (ids.has(key)) {
      throw new Error(`Duplicate Tileflow layer-family key: ${key}`);
    }
    ids.add(key);

    if (!tileflowLayerSlots.includes(family.slot)) {
      throw new Error(`Unknown Tileflow layer slot: ${String(family.slot)}`);
    }
    if (!tileflowLayerDomains.includes(family.owner)) {
      throw new Error(`Unknown Tileflow layer owner for ${key}: ${String(family.owner)}`);
    }
    if (typeof family.target !== 'string' || !tileflowSemanticTargetPattern.test(family.target)) {
      throw new Error(`Tileflow layer family ${key} requires a portable semantic target.`);
    }
    const localOrder = family.order;
    if (!Number.isSafeInteger(localOrder)) {
      throw new Error(`Tileflow layer family ${key} requires an integer order.`);
    }
    const position = `${family.slot}:${localOrder}`;
    if (positions.has(position)) {
      throw new Error(`Conflicting Tileflow layer order at ${position}.`);
    }
    positions.add(position);
  }

  return [...families]
    .sort((left, right) => {
      const slotDifference = orderBySlot.get(left.slot)! - orderBySlot.get(right.slot)!;
      return slotDifference || left.order - right.order;
    })
    .map(cloneJson);
}

export function resolveSlotOrder(
  extraConstraints: readonly TileflowSlotConstraint[] = [],
): TileflowLayerSlot[] {
  const edges = new Map<TileflowLayerSlot, Set<TileflowLayerSlot>>(
    tileflowLayerSlots.map((slot) => [slot, new Set()]),
  );
  const indegree = new Map(tileflowLayerSlots.map((slot) => [slot, 0]));
  const constraints: TileflowSlotConstraint[] = [
    ...tileflowLayerSlots.slice(1).map((slot, index) => ({
      after: slot,
      before: tileflowLayerSlots[index]!,
    })),
    ...extraConstraints,
  ];

  for (const {before, after} of constraints) {
    const outgoing = edges.get(before);
    if (!outgoing || !edges.has(after)) {
      throw new Error(`Unknown Tileflow layer slot constraint: ${before} -> ${after}`);
    }
    if (!outgoing.has(after)) {
      outgoing.add(after);
      indegree.set(after, indegree.get(after)! + 1);
    }
  }

  const declaredOrder = new Map(tileflowLayerSlots.map((slot, index) => [slot, index]));
  const available = tileflowLayerSlots.filter((slot) => indegree.get(slot) === 0);
  const resolved: TileflowLayerSlot[] = [];

  while (available.length > 0) {
    available.sort((left, right) => declaredOrder.get(left)! - declaredOrder.get(right)!);
    const slot = available.shift()!;
    resolved.push(slot);
    for (const next of edges.get(slot)!) {
      const nextIndegree = indegree.get(next)! - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) available.push(next);
    }
  }

  if (resolved.length !== tileflowLayerSlots.length) {
    throw new Error('Tileflow layer order constraints contain a cycle.');
  }

  return resolved;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
