import {
  type TileflowLayerContribution,
  type TileflowLayerSlot,
  tileflowLayerSlots,
  tileflowLayerTargetPattern,
  type TileflowSlotConstraint,
} from './contributions';
import {tileflowLayerDomains} from './domains';

export function assembleTileflowLayers(
  contributions: readonly TileflowLayerContribution[],
  extraConstraints: readonly TileflowSlotConstraint[] = [],
): Array<Record<string, unknown>> {
  const slotOrder = resolveSlotOrder(extraConstraints);
  const orderBySlot = new Map(slotOrder.map((slot, index) => [slot, index]));
  const ids = new Set<string>();
  const positions = new Set<string>();

  for (const contribution of contributions) {
    if (!contribution || typeof contribution !== 'object') {
      throw new Error('Tileflow contributions must be objects.');
    }
    if (contribution.kind !== 'layer') {
      throw new Error('Tileflow contributions must have kind "layer".');
    }
    if (
      !contribution.layer ||
      typeof contribution.layer !== 'object' ||
      Array.isArray(contribution.layer)
    ) {
      throw new Error('Tileflow layer contribution requires a layer object.');
    }
    const id = contribution.layer.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Tileflow layer ID must not be empty.');
    }
    if (typeof contribution.layer.type !== 'string' || !contribution.layer.type.trim()) {
      throw new Error(`Tileflow layer ${id} requires a non-empty type.`);
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate Tileflow layer ID: ${id}`);
    }
    ids.add(id);

    if (!tileflowLayerSlots.includes(contribution.slot)) {
      throw new Error(`Unknown Tileflow layer slot: ${String(contribution.slot)}`);
    }
    if (!tileflowLayerDomains.includes(contribution.owner)) {
      throw new Error(`Unknown Tileflow layer owner for ${id}: ${String(contribution.owner)}`);
    }
    if (
      typeof contribution.target !== 'string' ||
      !tileflowLayerTargetPattern.test(contribution.target)
    ) {
      throw new Error(`Tileflow layer ${id} requires a portable semantic target.`);
    }
    if (!Number.isSafeInteger(contribution.localOrder)) {
      throw new Error(`Tileflow layer ${id} requires an integer localOrder.`);
    }
    const position = `${contribution.slot}:${contribution.localOrder}`;
    if (positions.has(position)) {
      throw new Error(`Conflicting Tileflow layer order at ${position}.`);
    }
    positions.add(position);
  }

  return [...contributions]
    .sort((left, right) => {
      const slotDifference = orderBySlot.get(left.slot)! - orderBySlot.get(right.slot)!;
      return slotDifference || left.localOrder - right.localOrder;
    })
    .map((contribution) => cloneJson(contribution.layer));
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
