import type {
  OpenMapTilesFieldBindings,
  OpenMapTilesLayerBindings,
  OpenMapTilesSchema,
  ResolvedTileflowData,
} from '../data';
import type {TileflowMap} from '../maps/types';
import {
  appendTileflowCompilerEffect,
  tileflowCompilerProvenanceMetadataKey,
} from './compiler-inspection';
import {tileflowCompilerMetadataKeys, tileflowLayerTargetPattern} from './contributions';
import {type TileflowLayerDomain, tileflowLayerDomains} from './domains';
import {type TileflowStreetsModuleName, tileflowStreetsModuleNames} from './streets-recipe';

type TileflowSemanticFieldReference = {
  readonly kind: 'tileflow-semantic-field';
  readonly name: keyof OpenMapTilesFieldBindings;
};

type TileflowSemanticLayerReference = {
  readonly kind: 'tileflow-semantic-layer';
  readonly name: keyof OpenMapTilesLayerBindings;
};

export type TileflowModuleLayerPlacement = {after: string} | {before: string};

export type TileflowModuleEffect =
  | {
      kind: 'patch';
      owner: TileflowStreetsModuleName;
      patch: Record<string, unknown>;
      requires?: readonly TileflowLayerDomain[];
      target: string;
    }
  | {
      kind: 'add';
      layer: Record<string, unknown> & {id: string; type: string};
      owner: TileflowStreetsModuleName;
      placement: TileflowModuleLayerPlacement;
      requires?: readonly TileflowLayerDomain[];
      target: string;
    }
  | {
      kind: 'remove';
      owner: TileflowStreetsModuleName;
      requires?: readonly TileflowLayerDomain[];
      target: string;
    };

// Core and @tileflow/maps must agree on the private carrier even when their bundlers inline
// different copies of this module. A local Symbol() would silently discard every official effect.
const tileflowModuleEffects: unique symbol = Symbol.for('@tileflow/core/module-effects/v1');

type MapWithModuleEffects = TileflowMap & {
  [tileflowModuleEffects]?: readonly TileflowModuleEffect[];
};

type ResolvedWithModuleEffects = object & {
  [tileflowModuleEffects]?: readonly TileflowModuleEffect[];
};

/** Compiler-private authoring field reference. Official maps never capture physical data fields. */
export function semanticField(
  name: keyof OpenMapTilesFieldBindings,
): TileflowSemanticFieldReference {
  return {kind: 'tileflow-semantic-field', name};
}

/** Compiler-private authoring layer reference. Official maps never capture physical source layers. */
export function semanticLayer(
  name: keyof OpenMapTilesLayerBindings,
): TileflowSemanticLayerReference {
  return {kind: 'tileflow-semantic-layer', name};
}

export function patchModuleLayer(
  owner: TileflowStreetsModuleName,
  target: string,
  patch: Record<string, unknown>,
  options: {requires?: readonly TileflowLayerDomain[]} = {},
): TileflowModuleEffect {
  return {
    kind: 'patch',
    owner: requireModuleOwner(owner),
    patch: cloneJson(patch),
    ...(options.requires ? {requires: options.requires.map(requireLayerDomain)} : {}),
    target: requireTarget(owner, target),
  };
}

export function addModuleLayer(
  owner: TileflowStreetsModuleName,
  target: string,
  layer: Record<string, unknown> & {id: string; type: string},
  placement: TileflowModuleLayerPlacement,
  options: {requires?: readonly TileflowLayerDomain[]} = {},
): TileflowModuleEffect {
  const semanticPlacement =
    'before' in placement
      ? {before: requireTarget(owner, placement.before)}
      : {after: requireTarget(owner, placement.after)};
  return {
    kind: 'add',
    layer: cloneJson(layer),
    owner: requireModuleOwner(owner),
    placement: semanticPlacement,
    ...(options.requires ? {requires: options.requires.map(requireLayerDomain)} : {}),
    target: requireTarget(owner, target),
  };
}

export function removeModuleLayer(
  owner: TileflowStreetsModuleName,
  target: string,
  options: {requires?: readonly TileflowLayerDomain[]} = {},
): TileflowModuleEffect {
  return {
    kind: 'remove',
    owner: requireModuleOwner(owner),
    ...(options.requires ? {requires: options.requires.map(requireLayerDomain)} : {}),
    target: requireTarget(owner, target),
  };
}

/**
 * Attach compiler-private effects without adding a public string key to a map definition.
 * The empty return type deliberately keeps the symbol out of public authoring inference.
 */
export function internalModuleEffects(effects: readonly TileflowModuleEffect[]): {} {
  return {[tileflowModuleEffects]: effects.map(cloneJson)};
}

/** Resolve private effects with the same domain-atomic semantics as public modules. */
export function attachResolvedModuleEffects(
  resolved: object,
  lineage: readonly TileflowMap[],
): void {
  const byOwner = new Map<TileflowStreetsModuleName, readonly TileflowModuleEffect[]>();

  for (let index = lineage.length - 1; index >= 0; index -= 1) {
    const map = lineage[index] as MapWithModuleEffects;
    if (isRecord(map.modules)) {
      for (const owner of tileflowStreetsModuleNames) {
        // An explicit `undefined` has the same meaning as omitting an optional
        // authoring field. Keep public module inheritance and private
        // owner-scoped effects in lockstep.
        if (Object.hasOwn(map.modules, owner) && map.modules[owner] !== undefined) {
          byOwner.delete(owner);
        }
      }
    }

    const ownEffects = map[tileflowModuleEffects] ?? [];
    const grouped = new Map<TileflowStreetsModuleName, TileflowModuleEffect[]>();
    for (const effect of ownEffects) {
      if (
        !isRecord(map.modules) ||
        !Object.hasOwn(map.modules, effect.owner) ||
        map.modules[effect.owner] === undefined
      ) {
        throw new Error(
          `Tileflow internal effect ${effect.target} requires its map to declare module owner ${effect.owner}.`,
        );
      }
      const effects = grouped.get(effect.owner) ?? [];
      effects.push(effect);
      grouped.set(effect.owner, effects);
    }
    for (const [owner, effects] of grouped) byOwner.set(owner, effects);
  }

  Object.defineProperty(resolved, tileflowModuleEffects, {
    configurable: false,
    // Symbols never enter Object.keys/JSON/schema contracts, while enumeration
    // lets ordinary object spread retain compiler-private official semantics.
    enumerable: true,
    value: [...byOwner.values()].flat().map(cloneJson),
    writable: false,
  });
}

/** Preserve private resolved effects across strict schema parsing. */
export function copyResolvedModuleEffects(source: unknown, target: object): void {
  if (!isRecord(source)) return;
  const effects = (source as ResolvedWithModuleEffects)[tileflowModuleEffects];
  if (!effects) return;
  Object.defineProperty(target, tileflowModuleEffects, {
    configurable: false,
    enumerable: true,
    value: effects.map(cloneJson),
    writable: false,
  });
}

export function getResolvedModuleEffects(input: object): readonly TileflowModuleEffect[] {
  return (input as ResolvedWithModuleEffects)[tileflowModuleEffects] ?? [];
}

export function bindSemanticReferences<T>(value: T, data: ResolvedTileflowData): T {
  return bindSemanticValue(value, data.schema) as T;
}

export function applyTileflowModuleEffects(
  input: readonly Record<string, unknown>[],
  effects: readonly TileflowModuleEffect[],
  data: ResolvedTileflowData,
): Array<Record<string, unknown>> {
  let layers = input.map(cloneJson);

  for (const rawEffect of orderModuleEffects(effects)) {
    const effect = bindSemanticReferences(rawEffect, data);
    if (effect.kind === 'add') {
      if (findTargetIndex(layers, effect.target) >= 0) {
        throw new Error(`Tileflow module add defines duplicate semantic target: ${effect.target}`);
      }
      if (findLayerIdIndex(layers, effect.layer.id) >= 0) {
        throw new Error(`Tileflow module add defines duplicate layer ID: ${effect.layer.id}`);
      }
      const anchor =
        'before' in effect.placement ? effect.placement.before : effect.placement.after;
      const anchorIndex = findTargetIndex(layers, anchor);
      if (anchorIndex < 0) {
        throw new Error(
          `Tileflow module add ${effect.target} targets unknown semantic placement: ${anchor}`,
        );
      }
      const insertionIndex = 'before' in effect.placement ? anchorIndex : anchorIndex + 1;
      const layer = markEffect(
        effect.layer,
        effect.owner,
        effect.target,
        'add',
        semanticSlot(layers[anchorIndex]!),
      );
      layers = [...layers.slice(0, insertionIndex), layer, ...layers.slice(insertionIndex)];
      continue;
    }

    const index = findTargetIndex(layers, effect.target);
    if (index < 0) {
      throw new Error(
        `Tileflow module ${effect.kind} targets unknown semantic contribution: ${effect.target}`,
      );
    }
    const previous = layers[index]!;
    const actualOwner = semanticOwner(previous);
    if (actualOwner !== effect.owner) {
      throw new Error(
        `Tileflow module ${effect.kind} owner mismatch for ${effect.target}: expected ${effect.owner}, found ${actualOwner ?? 'none'}.`,
      );
    }

    if (effect.kind === 'remove') {
      layers = [...layers.slice(0, index), ...layers.slice(index + 1)];
      continue;
    }

    const previousMetadata = asRecord(previous.metadata);
    const patchedMetadata = mergeRecords(previous.metadata, effect.patch.metadata);
    const next = {
      ...previous,
      ...cloneJson(effect.patch),
      id: previous.id,
      ...(mergeRecords(previous.layout, effect.patch.layout)
        ? {layout: mergeRecords(previous.layout, effect.patch.layout)}
        : {}),
      ...(mergeRecords(previous.paint, effect.patch.paint)
        ? {paint: mergeRecords(previous.paint, effect.patch.paint)}
        : {}),
      ...(patchedMetadata
        ? {
            metadata: {
              ...patchedMetadata,
              ...preserveCompilerMetadata(previousMetadata),
            },
          }
        : {}),
    };
    layers = [...layers];
    layers[index] = markEffect(next, effect.owner, effect.target, 'patch');
  }

  return layers;
}

function orderModuleEffects(
  effects: readonly TileflowModuleEffect[],
): readonly TileflowModuleEffect[] {
  const additions = new Map(
    effects.filter((effect) => effect.kind === 'add').map((effect) => [effect.target, effect]),
  );
  const visiting = new Set<string>();
  const visited = new Set<TileflowModuleEffect>();
  const ordered: TileflowModuleEffect[] = [];

  const visit = (effect: TileflowModuleEffect): void => {
    if (visited.has(effect)) return;
    if (visiting.has(effect.target)) {
      throw new Error(`Circular Tileflow module effect placement at ${effect.target}.`);
    }
    visiting.add(effect.target);
    if (effect.kind === 'add') {
      const anchor =
        'before' in effect.placement ? effect.placement.before : effect.placement.after;
      const dependency = additions.get(anchor);
      if (dependency) visit(dependency);
    }
    visiting.delete(effect.target);
    visited.add(effect);
    ordered.push(effect);
  };

  for (const effect of effects) visit(effect);
  return ordered;
}

export const tileflowModuleEffectMetadataKey = 'tileflow:compiler-effect';

function markEffect(
  layer: Record<string, unknown>,
  owner: TileflowStreetsModuleName,
  target: string,
  kind: 'add' | 'patch',
  fallbackSlot?: string,
): Record<string, unknown> {
  const metadata = asRecord(layer.metadata);
  // Adds derive their compiler slot exclusively from the semantic anchor. Do not
  // let authored layer metadata forge compiler-private provenance.
  const slot = kind === 'add' ? fallbackSlot : (semanticSlot(layer) ?? fallbackSlot);
  const provenanceSource =
    kind === 'add'
      ? {
          metadata: {
            [tileflowCompilerMetadataKeys.owner]: owner,
            [tileflowCompilerMetadataKeys.slot]: slot,
            [tileflowCompilerMetadataKeys.target]: target,
          },
        }
      : layer;
  const provenance = appendTileflowCompilerEffect(provenanceSource, {kind, owner, target}, slot);
  return {
    ...layer,
    metadata: {
      ...metadata,
      [tileflowCompilerMetadataKeys.owner]: owner,
      ...(slot ? {[tileflowCompilerMetadataKeys.slot]: slot} : {}),
      [tileflowCompilerMetadataKeys.target]: target,
      [tileflowModuleEffectMetadataKey]: kind,
      ...(provenance ? {[tileflowCompilerProvenanceMetadataKey]: provenance} : {}),
    },
  };
}

function preserveCompilerMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    [...Object.values(tileflowCompilerMetadataKeys), tileflowCompilerProvenanceMetadataKey]
      .filter((key) => Object.hasOwn(metadata, key))
      .map((key) => [key, metadata[key]]),
  );
}

function semanticOwner(layer: Record<string, unknown>): string | undefined {
  const value = asRecord(layer.metadata)[tileflowCompilerMetadataKeys.owner];
  return typeof value === 'string' ? value : undefined;
}

function semanticTarget(layer: Record<string, unknown>): string | undefined {
  const value = asRecord(layer.metadata)[tileflowCompilerMetadataKeys.target];
  return typeof value === 'string' ? value : undefined;
}

function semanticSlot(layer: Record<string, unknown>): string | undefined {
  const value = asRecord(layer.metadata)[tileflowCompilerMetadataKeys.slot];
  return typeof value === 'string' ? value : undefined;
}

function findTargetIndex(layers: readonly Record<string, unknown>[], target: string): number {
  return layers.findIndex((layer) => semanticTarget(layer) === target);
}

function findLayerIdIndex(layers: readonly Record<string, unknown>[], id: string): number {
  return layers.findIndex((layer) => layer.id === id);
}

function bindSemanticValue(value: unknown, schema: OpenMapTilesSchema): unknown {
  if (isSemanticFieldReference(value)) {
    const binding = schema.fields[value.name];
    if (!binding) throw new Error(`Tileflow data schema does not provide field ${value.name}.`);
    return binding;
  }
  if (isSemanticLayerReference(value)) {
    const binding = schema.layers[value.name];
    if (!binding) throw new Error(`Tileflow data schema does not provide layer ${value.name}.`);
    return binding;
  }
  if (Array.isArray(value)) return value.map((item) => bindSemanticValue(item, schema));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, bindSemanticValue(item, schema)]),
  );
}

function isSemanticFieldReference(value: unknown): value is TileflowSemanticFieldReference {
  return (
    isRecord(value) && value.kind === 'tileflow-semantic-field' && typeof value.name === 'string'
  );
}

function isSemanticLayerReference(value: unknown): value is TileflowSemanticLayerReference {
  return (
    isRecord(value) && value.kind === 'tileflow-semantic-layer' && typeof value.name === 'string'
  );
}

function requireModuleOwner(owner: TileflowStreetsModuleName): TileflowStreetsModuleName {
  if (!tileflowStreetsModuleNames.includes(owner)) {
    throw new Error(`Unknown Tileflow module effect owner: ${String(owner)}`);
  }
  return owner;
}

function requireLayerDomain(domain: TileflowLayerDomain): TileflowLayerDomain {
  if (!tileflowLayerDomains.includes(domain)) {
    throw new Error(`Unknown Tileflow layer domain: ${String(domain)}`);
  }
  return domain;
}

function requireTarget(owner: TileflowStreetsModuleName, target: string): string {
  if (!tileflowLayerTargetPattern.test(target)) {
    throw new Error(`Tileflow module effect requires a portable semantic target: ${target}`);
  }
  if (target !== owner && !target.startsWith(`${owner}.`)) {
    throw new Error(`Tileflow module effect target ${target} must belong to owner ${owner}.`);
  }
  return target;
}

function mergeRecords(left: unknown, right: unknown): Record<string, unknown> | undefined {
  if (!isRecord(left) && !isRecord(right)) return undefined;
  return {...(isRecord(left) ? left : {}), ...(isRecord(right) ? right : {})};
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
