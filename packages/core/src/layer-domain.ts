/**
 * Layer metadata naming the semantic module that owns a compiled layer, such as `roads` or `water`.
 * Runtime features that address a module, such as map emphasis, read it instead of physical layer
 * IDs. Layers that a theme blend splits or copies keep it.
 */
export const tileflowLayerDomainMetadataKey = 'tileflow:domain' as const;
