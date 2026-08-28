import {openMapTiles, resolveTileflowData, vectorTiles} from '../src';
import {
  readTileflowCompilerProvenance,
  tileflowCompilerProvenanceMetadataKey,
} from '../src/cartography/compiler-inspection';
import {
  tileflowCompilerMetadataKeys,
  type TileflowLayerContribution,
  type TileflowLayerSlot,
  tileflowLayerSlots,
  type TileflowPhysicalFamilyDeclaration,
} from '../src/cartography/contributions';
import {
  createTileflowLayerFamilyIR,
  lowerTileflowDomainIR,
  physicalLayerIdForSemanticKey,
  type TileflowPhysicalIdResolver,
} from '../src/cartography/domain-ir';
import {type TileflowLayerDomain, tileflowLayerDomains} from '../src/cartography/domains';
import {assembleTileflowLayerFamilies} from '../src/cartography/graph';
import {planTileflowLayerFamilies} from '../src/cartography/physical-planner';
import {
  applyCompiledRenderStacks as applyCompiledRenderStacksIR,
  type TileflowCompiledRenderOperation,
} from '../src/cartography/render-stack';

type Layer = Record<string, unknown> & {id: string; type: string};

const fallbackData = resolveTileflowData(
  vectorTiles({
    attribution: 'Layer IR test fixture',
    schema: openMapTiles(),
    url: 'https://example.test/layer-ir.json',
  }),
);

/** Test-only physical view over the semantic graph and final lowering boundary. */
export function assembleTileflowLayers(
  contributions: readonly TileflowLayerContribution[],
): Layer[] {
  const families = contributions.map(createTileflowLayerFamilyIR);
  return [
    ...lowerTileflowDomainIR(
      assembleTileflowLayerFamilies(families),
      fallbackData,
      fixturePhysicalIds(contributions),
    ).layers,
  ];
}

/** Test-only physical view used to retain MapLibre expression-equivalence assertions. */
export function planTileflowLayers(input: readonly Layer[]): Layer[] {
  const originalByKey = new Map(input.map((layer) => [layer.id, layer]));
  const families = input.map((layer, index) =>
    createTileflowLayerFamilyIR(toContribution(layer, index)),
  );
  const planned = planTileflowLayerFamilies(families);
  const fixtureIds = fixturePhysicalIds(input.map(toContribution));
  return lowerTileflowDomainIR(planned, fallbackData, fixtureIds).layers.map((layer) => {
    const original = originalByKey.get(layer.id);
    if (!original) return layer;
    const metadata = original.metadata;
    if (metadata === undefined) {
      const {metadata: _metadata, ...withoutMetadata} = layer;
      return withoutMetadata as Layer;
    }
    const emittedMetadata = asRecord(layer.metadata);
    const originalMetadata = asRecord(metadata);
    if (!Object.hasOwn(originalMetadata, tileflowCompilerProvenanceMetadataKey)) {
      delete emittedMetadata[tileflowCompilerProvenanceMetadataKey];
    }
    return {...layer, metadata: emittedMetadata};
  });
}

export function applyCompiledRenderStacks(
  input: readonly Layer[],
  operations: readonly TileflowCompiledRenderOperation[],
): Layer[] {
  const families = input.map((layer, index) =>
    createTileflowLayerFamilyIR(toContribution(layer, index)),
  );
  return [
    ...lowerTileflowDomainIR(
      applyCompiledRenderStacksIR(families, operations),
      fallbackData,
      fixturePhysicalIds(input.map(toContribution)),
    ).layers,
  ];
}

function fixturePhysicalIds(
  contributions: readonly TileflowLayerContribution[],
): TileflowPhysicalIdResolver {
  const originals = new Map(contributions.map(({layer, target}) => [target, layer.id]));
  return (semanticKey) => originals.get(semanticKey) ?? physicalLayerIdForSemanticKey(semanticKey);
}

function toContribution(layer: Layer, localOrder: number): TileflowLayerContribution {
  const provenance = readTileflowCompilerProvenance(layer);
  const metadata = asRecord(layer.metadata);
  const first = provenance[0];
  const rawOwner = first?.owner ?? metadata[tileflowCompilerMetadataKeys.owner];
  const rawSlot = first?.slot ?? metadata[tileflowCompilerMetadataKeys.slot];
  const rawTarget = first?.target ?? metadata[tileflowCompilerMetadataKeys.target];
  const owner = isDomain(rawOwner) ? rawOwner : 'land';
  const slot = isSlot(rawSlot) ? rawSlot : 'land';
  const target =
    typeof rawTarget === 'string' && rawTarget.length > 0
      ? rawTarget
      : `${owner}.fixture.layer${localOrder}`;
  const family = testPhysicalFamily(target);
  return {kind: 'layer', layer, localOrder, owner, slot, target, ...(family ? {family} : {})};
}

function testPhysicalFamily(target: string): TileflowPhysicalFamilyDeclaration | undefined {
  const roadLine = /^roads\.classes\.([^.]+)\.(tunnel|surface|bridge)\.(shadow|casing|fill)$/u.exec(
    target,
  );
  if (roadLine) {
    const [, member, structure, phase] = roadLine;
    const cohort = ['motorway', 'trunk'].includes(member!)
      ? 'major'
      : ['primary', 'secondary', 'tertiary'].includes(member!)
        ? 'arterial'
        : ['minor', 'service', 'track'].includes(member!)
          ? 'local'
          : 'path';
    return {
      group: `${structure}:${phase}:${cohort}`,
      kind: 'road-line',
      member: member!,
      outputKey: `roads.cohorts.${structure}.${cohort}.${phase}`,
    };
  }
  const hatch = /^roads\.classes\.([^.]+)\.(tunnel|surface|bridge)\.hatch$/u.exec(target);
  if (hatch) {
    return {
      group: hatch[2]!,
      kind: 'road-hatch',
      member: hatch[1]!,
      outputKey: `roads.cohorts.${hatch[2]}.hatch`,
    };
  }
  const label = /^labels\.roads\.([^.]+)$/u.exec(target);
  if (label) return {group: 'roads', kind: 'road-label', member: label[1]!};
  const fill = /^land\.(landcover|landuse)\.([^.]+)\.fill$/u.exec(target);
  if (fill) {
    return {
      group: `land.${fill[1]}`,
      kind: 'fill',
      member: fill[2]!,
      outputKey: `land.cohorts.${fill[1]}`,
    };
  }
  const water = /^water\.(?:(intermittent)\.)?waterways\.([^.]+)$/u.exec(target);
  return water
    ? {
        group: water[2]!,
        kind: 'waterway',
        member: water[2]!,
        variant: water[1] ? 'intermittent' : 'regular',
      }
    : undefined;
}

function isDomain(value: unknown): value is TileflowLayerDomain {
  return typeof value === 'string' && tileflowLayerDomains.includes(value as TileflowLayerDomain);
}

function isSlot(value: unknown): value is TileflowLayerSlot {
  return typeof value === 'string' && tileflowLayerSlots.includes(value as TileflowLayerSlot);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? {...(value as Record<string, unknown>)}
    : {};
}
