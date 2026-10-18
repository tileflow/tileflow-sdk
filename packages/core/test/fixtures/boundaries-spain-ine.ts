// A small, offline stand-in for Boundaries municipalities in the Community of Madrid. The INE codes
// and names are real; the registry IDs and the values are illustrative.

/** Properties of `boundary_area` polygons, as the tiles carry them, with their feature IDs. */
export const madridMunicipalityFeatures = [
  {id: 101, ine: '28079', name: 'Madrid'},
  {id: 102, ine: '28005', name: 'Alcalá de Henares'},
  {id: 103, ine: '28006', name: 'Alcobendas'},
  {id: 104, ine: '28007', name: 'Alcorcón'},
  {id: 105, ine: '28058', name: 'Fuenlabrada'},
  {id: 106, ine: '28065', name: 'Getafe'},
  {id: 107, ine: '28074', name: 'Leganés'},
  {id: 108, ine: '28092', name: 'Móstoles'},
].map(({id, ine, name}) => ({
  id,
  name,
  properties: {
    admin_depth: 2,
    admin_level: 8,
    class: 'municipality',
    class_tier: 'primary',
    iso_3166_1: 'ES',
    ref: `ES:INE:${ine}`,
  },
}));

/** The Community of Madrid itself, drawn as a region, which a municipality choropleth skips. */
export const madridRegionFeature = {
  id: 100,
  properties: {
    admin_depth: 1,
    admin_level: 4,
    class: 'region',
    class_tier: 'primary',
    iso_3166_1: 'ES',
    ref: 'ES-MD',
  },
};

/** An application's rows, keyed by bare INE municipality code as Spanish statistics publish them. */
export const madridRowsByIne: readonly {ine: string; value: number}[] = [
  {ine: '28079', value: 9.8},
  {ine: '28005', value: 12.4},
  {ine: '28006', value: 6.1},
  {ine: '28007', value: 10.9},
  {ine: '28058', value: 13.7},
  {ine: '28065', value: 11.2},
  {ine: '28074', value: 12.0},
  // Móstoles (28092) has no value.
];

/** Rows of a Boundaries lookup table, with the columns of a release in their order. */
export const madridLookupCsv = [
  'id,class,class_tier,class_rule,local_type,admin_level,admin_depth,ref,code_source,name,name_en,wikidata,iso_3166_1,iso_3166_2,nuts,parent_country,parent_dependency,parent_region,parent_province_or_county,parent_municipality,parent_district,label_lon,label_lat,bbox_west,bbox_south,bbox_east,bbox_north,area_km2,family,source,source_id,license',
  '100,region,primary,level,comunidad autónoma,4,1,ES-MD,openstreetmap,Comunidad de Madrid,Community of Madrid,Q5756,ES,ES-MD,ES30,1,,,,,,-3.71,40.49,-4.58,39.88,-3.05,41.17,8028.0,administrative,openstreetmap,relation/349055,ODbL-1.0',
  '100,province_or_county,primary,fill,provincia,4,2,ES:INE:28,openstreetmap,Comunidad de Madrid,Community of Madrid,Q5756,ES,ES-MD,ES300,1,,100,,,,-3.71,40.49,-4.58,39.88,-3.05,41.17,8028.0,administrative,openstreetmap,relation/349055,ODbL-1.0',
  '101,municipality,primary,level,municipio,8,3,ES:INE:28079,openstreetmap,Madrid,Madrid,Q2807,ES,,,1,,100,100,,,-3.70,40.42,-3.89,40.31,-3.52,40.64,604.3,administrative,openstreetmap,relation/5326784,ODbL-1.0',
  '102,municipality,primary,level,municipio,8,3,ES:INE:28005,openstreetmap,Alcalá de Henares,,Q5788,ES,,,1,,100,100,,,-3.36,40.48,-3.45,40.43,-3.29,40.56,87.7,administrative,openstreetmap,relation/341984,ODbL-1.0',
  '108,municipality,primary,level,municipio,8,3,ES:INE:28092,openstreetmap,"Móstoles, ""Madrid""",,Q19960,ES,,,1,,100,100,,,-3.86,40.32,-3.92,40.29,-3.83,40.36,45.4,administrative,openstreetmap,relation/341720,ODbL-1.0',
  '',
].join('\n');
