import type {TileflowLayerDomain} from './domains';

export const tileflowLayerSlots = [
  'background',
  'land',
  'terrain',
  'hydro',
  'building-areas',
  'transport-areas',
  'transport-tunnel-shadow',
  'transport-tunnel-casing',
  'transport-tunnel-fill',
  'transport-pedestrian-areas',
  'aeroways',
  'transport-surface-shadow',
  'transport-surface-casing',
  'transport-surface-fill',
  'transport-bridge-shadow',
  'transport-bridge-casing',
  'transport-bridge-fill',
  'transport-symbols',
  'boundaries',
  'buildings',
  'vegetation',
  'symbols',
] as const;

export type TileflowLayerSlot = (typeof tileflowLayerSlots)[number];

/**
 * Public paint bands: stable names for consecutive compiler slots. Render passes, target
 * placements and overlays address band edges instead of physical slots.
 */
export const tileflowLayerBands = [
  'land',
  'relief',
  'water',
  'roads',
  'boundaries',
  'buildings',
  'vegetation',
  'labels',
] as const;

export type TileflowLayerBand = (typeof tileflowLayerBands)[number];

const bandSlots: Readonly<
  Record<TileflowLayerBand, readonly [TileflowLayerSlot, TileflowLayerSlot]>
> = {
  land: ['background', 'land'],
  relief: ['terrain', 'terrain'],
  water: ['hydro', 'hydro'],
  roads: ['transport-areas', 'transport-symbols'],
  boundaries: ['boundaries', 'boundaries'],
  buildings: ['buildings', 'buildings'],
  vegetation: ['vegetation', 'vegetation'],
  labels: ['symbols', 'symbols'],
};

/** A band edge: `below-roads` is the start of the roads band, `above-roads` its end. */
export type TileflowBandPlacement = `${'above' | 'below'}-${TileflowLayerBand}`;

export const tileflowBandPlacements: readonly TileflowBandPlacement[] = tileflowLayerBands.flatMap(
  (band) => [`below-${band}`, `above-${band}`] as const,
);

/** The slot a layer placed at a band edge belongs to. */
export function tileflowBandPlacementSlot(placement: TileflowBandPlacement): TileflowLayerSlot {
  const [side, band] = splitBandPlacement(placement);
  return bandSlots[band][side === 'below' ? 0 : 1];
}

/**
 * Index at which a band edge falls in an ordered layer list: before the first layer whose slot
 * follows the edge. Layers without a slot rank (for example inserted overlays) are skipped.
 */
export function tileflowBandPlacementIndex(
  slotRanks: readonly (number | undefined)[],
  placement: TileflowBandPlacement,
): number {
  const [side, band] = splitBandPlacement(placement);
  const [first, last] = bandSlots[band];
  const threshold =
    side === 'below' ? tileflowLayerSlots.indexOf(first) : tileflowLayerSlots.indexOf(last) + 1;
  const index = slotRanks.findIndex((rank) => rank !== undefined && rank >= threshold);
  return index < 0 ? slotRanks.length : index;
}

function splitBandPlacement(
  placement: TileflowBandPlacement,
): ['above' | 'below', TileflowLayerBand] {
  const separator = placement.indexOf('-');
  return [
    placement.slice(0, separator) as 'above' | 'below',
    placement.slice(separator + 1) as TileflowLayerBand,
  ];
}

/**
 * Portable dotted identifier for one semantic layer-family contribution.
 *
 * V1 reserves a lowercase domain-like first segment. Following segments are
 * case-preserving portable identifiers so existing camelCase semantic names
 * remain stable.
 */
export const tileflowSemanticTargetPattern = /^[a-z][a-z0-9-]*(?:\.[A-Za-z0-9_-]+)*$/u;

/** One lowercase-initial portable render-stack name. Dots belong only to full targets. */
export const tileflowRenderStackOperationNamePattern = /^[a-z][A-Za-z0-9_-]*$/u;

/** Compiler-only provenance. These keys are removed before Style JSON leaves core. */
export const tileflowCompilerMetadataKeys = Object.freeze({
  owner: 'tileflow:compiler-owner',
  slot: 'tileflow:compiler-slot',
  target: 'tileflow:compiler-target',
} as const);

/** Explicit semantic cohort declaration consumed by the physical planner. */
export type TileflowPhysicalFamilyDeclaration = Readonly<{
  group: string;
  kind: 'fill' | 'road-hatch' | 'road-label' | 'road-line' | 'waterway';
  member: string;
  outputKey?: string;
  variant?: string;
}>;

export type TileflowLayerContribution = {
  family?: TileflowPhysicalFamilyDeclaration;
  kind: 'layer';
  layer: Record<string, unknown> & {id: string; type: string};
  localOrder: number;
  owner: TileflowLayerDomain;
  slot: TileflowLayerSlot;
  target: string;
};

export type TileflowSlotConstraint = {
  after: TileflowLayerSlot;
  before: TileflowLayerSlot;
};
