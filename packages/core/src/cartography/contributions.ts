import type {TileflowLayerDomain} from './domains';

export const tileflowLayerSlots = [
  'background',
  'land',
  'hydro',
  'terrain',
  'buildings',
  'transport-tunnel-shadow',
  'transport-tunnel-casing',
  'transport-tunnel-fill',
  'aeroways',
  'transport-surface-shadow',
  'transport-surface-casing',
  'transport-surface-fill',
  'transport-bridge-shadow',
  'transport-bridge-casing',
  'transport-bridge-fill',
  'boundaries',
  'symbols',
] as const;

export type TileflowLayerSlot = (typeof tileflowLayerSlots)[number];

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
