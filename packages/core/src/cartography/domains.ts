export const tileflowLayerDomains = [
  'land',
  'water',
  'roads',
  'transit',
  'aeroways',
  'buildings',
  'boundaries',
  'labels',
  'poi',
] as const;

export type TileflowLayerDomain = (typeof tileflowLayerDomains)[number];
