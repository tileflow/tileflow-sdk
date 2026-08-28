import type {MapLibreStyle} from '../types';
import {
  tileflowCompilerMetadataKeys,
  type TileflowLayerSlot,
  tileflowLayerSlots,
  tileflowSemanticTargetPattern,
} from './contributions';
import {type TileflowLayerDomain, tileflowLayerDomains} from './domains';

/** Version of the opt-in, read-only physical-output inspection sidecar. */
export const tileflowStyleInspectionSchemaVersion = 1 as const;

export type TileflowStyleInspectionRenderOperation = {
  readonly kind: 'pass' | 'refinement';
  readonly owner: TileflowLayerDomain;
  readonly target: string;
};

/** One semantic contribution represented by a compiled physical style layer. */
export type TileflowStyleInspectionContribution = {
  readonly owner: TileflowLayerDomain;
  readonly slot: TileflowLayerSlot;
  readonly target: string;
  /** Ordered semantic render operations represented by this contribution. */
  readonly operations: readonly TileflowStyleInspectionRenderOperation[];
};

export type TileflowStyleInspectionLayer = {
  /** Opaque physical output identity for diagnostics; never a public authoring target. */
  readonly id: string;
  readonly index: number;
  readonly type: string;
  /** Multiple entries are expected when the physical planner combines semantic layers. */
  readonly contributions: readonly TileflowStyleInspectionContribution[];
};

/**
 * Opt-in, read-only cartographic provenance for diagnostics and build tooling.
 * Physical IDs are output observations, not stable or addressable authoring APIs.
 * This object is never embedded in Style JSON.
 */
export type TileflowStyleInspection = {
  readonly schemaVersion: typeof tileflowStyleInspectionSchemaVersion;
  readonly map: string;
  readonly theme: string;
  readonly layers: readonly TileflowStyleInspectionLayer[];
};

export type TileflowInspectedStyle = {
  readonly style: MapLibreStyle;
  readonly inspection: TileflowStyleInspection;
};

/** Compiler-private carrier. It is stripped together with owner/slot/target metadata. */
export const tileflowCompilerProvenanceMetadataKey = 'tileflow:compiler-provenance';

export function createTileflowCompilerProvenance(
  owner: TileflowLayerDomain,
  slot: TileflowLayerSlot,
  target: string,
): readonly TileflowStyleInspectionContribution[] {
  return [{operations: [], owner, slot, target}];
}

/** Append one render operation to compiler-private provenance. */
export function appendTileflowCompilerRenderOperation(
  layer: Record<string, unknown>,
  operation: TileflowStyleInspectionRenderOperation,
  fallbackSlot?: string,
): readonly TileflowStyleInspectionContribution[] | undefined {
  const contributions = readTileflowCompilerProvenance(layer);
  const matchingIndex = contributions.findIndex(
    (contribution) =>
      contribution.owner === operation.owner && contribution.target === operation.target,
  );

  if (matchingIndex >= 0) {
    return contributions.map((contribution, index) =>
      index === matchingIndex
        ? {...contribution, operations: [...contribution.operations, {...operation}]}
        : contribution,
    );
  }

  const slot = requireLayerSlot(fallbackSlot);
  if (!slot) return contributions.length > 0 ? contributions : undefined;
  return [
    ...contributions,
    {operations: [{...operation}], owner: operation.owner, slot, target: operation.target},
  ];
}

/** Preserve every semantic origin when the physical planner emits one physical cohort. */
export function withMergedTileflowCompilerProvenance<T extends Record<string, unknown>>(
  layer: T,
  members: readonly Record<string, unknown>[],
): T {
  const contributions = members.flatMap((member) => readTileflowCompilerProvenance(member));
  if (contributions.length === 0) return layer;
  return {
    ...layer,
    metadata: {
      ...asRecord(layer.metadata),
      [tileflowCompilerProvenanceMetadataKey]: contributions,
    },
  };
}

export function readTileflowCompilerProvenance(
  layer: Record<string, unknown>,
): TileflowStyleInspectionContribution[] {
  const metadata = asRecord(layer.metadata);
  const raw = metadata[tileflowCompilerProvenanceMetadataKey];
  if (Array.isArray(raw)) {
    const parsed = raw.flatMap((value) => {
      const contribution = parseContribution(value);
      return contribution ? [contribution] : [];
    });
    if (parsed.length > 0) return parsed;
  }

  const owner = requireLayerDomain(metadata[tileflowCompilerMetadataKeys.owner]);
  const slot = requireLayerSlot(metadata[tileflowCompilerMetadataKeys.slot]);
  const target = metadata[tileflowCompilerMetadataKeys.target];
  return owner && slot && typeof target === 'string' && tileflowSemanticTargetPattern.test(target)
    ? [{operations: [], owner, slot, target}]
    : [];
}

export function createTileflowStyleInspection(
  map: string,
  theme: string,
  layers: readonly Record<string, unknown>[],
): TileflowStyleInspection {
  return {
    schemaVersion: tileflowStyleInspectionSchemaVersion,
    map,
    theme,
    layers: layers.map((layer, index) => ({
      id: typeof layer.id === 'string' ? layer.id : '',
      index,
      type: typeof layer.type === 'string' ? layer.type : '',
      contributions: readTileflowCompilerProvenance(layer),
    })),
  };
}

function parseContribution(value: unknown): TileflowStyleInspectionContribution | undefined {
  const input = asRecord(value);
  const owner = requireLayerDomain(input.owner);
  const slot = requireLayerSlot(input.slot);
  const target = input.target;
  if (
    !owner ||
    !slot ||
    typeof target !== 'string' ||
    !tileflowSemanticTargetPattern.test(target)
  ) {
    return undefined;
  }
  const operations = Array.isArray(input.operations)
    ? input.operations.flatMap((operation) => {
        const parsed = parseRenderOperation(operation);
        return parsed ? [parsed] : [];
      })
    : [];
  return {operations, owner, slot, target};
}

function parseRenderOperation(value: unknown): TileflowStyleInspectionRenderOperation | undefined {
  const input = asRecord(value);
  const owner = requireLayerDomain(input.owner);
  const target = input.target;
  if (
    (input.kind !== 'pass' && input.kind !== 'refinement') ||
    !owner ||
    typeof target !== 'string' ||
    !tileflowSemanticTargetPattern.test(target)
  ) {
    return undefined;
  }
  return {kind: input.kind, owner, target};
}

function requireLayerDomain(value: unknown): TileflowLayerDomain | undefined {
  return typeof value === 'string' && tileflowLayerDomains.includes(value as TileflowLayerDomain)
    ? (value as TileflowLayerDomain)
    : undefined;
}

function requireLayerSlot(value: unknown): TileflowLayerSlot | undefined {
  return typeof value === 'string' && tileflowLayerSlots.includes(value as TileflowLayerSlot)
    ? (value as TileflowLayerSlot)
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
