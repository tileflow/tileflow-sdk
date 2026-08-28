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
