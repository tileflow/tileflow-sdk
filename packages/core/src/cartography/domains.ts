export const tileflowLayerDomains = [
  'addresses',
  'land',
  'terrain',
  'landforms',
  'water',
  'roads',
  'transit',
  'aeroways',
  'buildings',
  'vegetation',
  'boundaries',
  'labels',
  'poi',
] as const;

export type TileflowLayerDomain = (typeof tileflowLayerDomains)[number];
