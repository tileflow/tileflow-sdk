/** Exact World/OSM network identities; short names such as EMT are ambiguous worldwide. */
export const streetsTransitNetworks = [
  {id: 'transit-madrid-metro', networks: ['Metro de Madrid']},
  {id: 'transit-madrid-cercanias', networks: ['Cercanías Madrid']},
  {id: 'transit-madrid-emt', networks: ['EMT Madrid']},
] as const;
