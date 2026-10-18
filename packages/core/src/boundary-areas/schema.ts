/** Administrative and neighbourhood classes of the Boundaries tileset, from the largest. */
export const tileflowBoundaryClasses = [
  'country',
  'dependency',
  'region',
  'province_or_county',
  'municipality',
  'district',
  'neighbourhood',
] as const;

export type TileflowBoundaryClass = (typeof tileflowBoundaryClasses)[number];

/** `primary` is the level that covers a country with its class; `secondary` is any other. */
export const tileflowBoundaryClassTiers = ['primary', 'secondary'] as const;

export type TileflowBoundaryClassTier = (typeof tileflowBoundaryClassTiers)[number];

/**
 * Version 1 of the Boundaries tile schema. Polygons carry only the properties needed to filter and
 * join them; labels and the lookup table carry the rest.
 */
export const tileflowBoundaryAreasV1Schema = Object.freeze({
  classes: tileflowBoundaryClasses,
  /** First zoom at which each class appears, by tier. */
  classMinzoom: Object.freeze({
    country: Object.freeze({primary: 0, secondary: 0}),
    dependency: Object.freeze({primary: 0, secondary: 0}),
    region: Object.freeze({primary: 3, secondary: 3}),
    province_or_county: Object.freeze({primary: 6, secondary: 7}),
    municipality: Object.freeze({primary: 8, secondary: 8}),
    district: Object.freeze({primary: 10, secondary: 10}),
    neighbourhood: Object.freeze({primary: 11, secondary: 11}),
  }) satisfies Readonly<
    Record<TileflowBoundaryClass, Readonly<Record<TileflowBoundaryClassTier, number>>>
  >,
  fields: Object.freeze({
    adminDepth: 'admin_depth',
    adminLevel: 'admin_level',
    class: 'class',
    classTier: 'class_tier',
    iso31661: 'iso_3166_1',
    iso31662: 'iso_3166_2',
    name: 'name',
    nuts: 'nuts',
    ref: 'ref',
    wikidata: 'wikidata',
  }),
  layers: Object.freeze({areas: 'boundary_area', labels: 'boundary_label'}),
  /** Properties present on `boundary_area` polygons. */
  areaProperties: Object.freeze([
    'class',
    'class_tier',
    'admin_level',
    'admin_depth',
    'ref',
    'iso_3166_1',
  ] as const),
  maxzoom: 12,
  minzoom: 0,
  product: 'boundaries-v1',
  schemaVersion: 1,
  tiers: tileflowBoundaryClassTiers,
});

/**
 * Boundaries families. Each one has its own license, attribution, TileJSON path and style source
 * ID; families are never merged.
 */
export const tileflowBoundaryFamilies = Object.freeze({
  boundaries: Object.freeze({
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL-1.0',
    path: '/tiles/boundaries/tiles.json',
    sourceId: 'tileflow-boundaries',
  }),
});

export type TileflowBoundaryFamily = keyof typeof tileflowBoundaryFamilies;

export function isTileflowBoundaryFamily(value: unknown): value is TileflowBoundaryFamily {
  return typeof value === 'string' && Object.hasOwn(tileflowBoundaryFamilies, value);
}

export function isTileflowBoundaryClass(value: unknown): value is TileflowBoundaryClass {
  return (
    typeof value === 'string' && (tileflowBoundaryClasses as readonly string[]).includes(value)
  );
}
