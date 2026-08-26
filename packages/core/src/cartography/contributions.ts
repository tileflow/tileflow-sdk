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

/** Portable dotted identifier used to trace a physical layer to its semantic authoring target. */
export const tileflowLayerTargetPattern = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** Compiler-only provenance. These keys are removed before Style JSON leaves core. */
export const tileflowCompilerMetadataKeys = Object.freeze({
  owner: 'tileflow:compiler-owner',
  slot: 'tileflow:compiler-slot',
  target: 'tileflow:compiler-target',
} as const);

export type TileflowLayerContribution = {
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
