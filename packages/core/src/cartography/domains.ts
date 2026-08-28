import {type TileflowSemanticModuleName, tileflowSemanticModuleNames} from './domain-registry';

export type TileflowLayerDomain = TileflowSemanticModuleName | 'terrain';

/** The module portion is derived from the closed registry; terrain remains a compiler-owned domain. */
export const tileflowLayerDomains: readonly TileflowLayerDomain[] = Object.freeze([
  ...tileflowSemanticModuleNames,
  'terrain',
]);
