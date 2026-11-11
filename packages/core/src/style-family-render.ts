import {
  extractTileflowColorPrograms,
  restoreTileflowColorPrograms,
  type TileflowColorBindings,
  tileflowColorMetadataKey,
} from './color-program';
import {
  createTileflowStyleFamily,
  expandTileflowStyleFamily,
  readTileflowFamilyValue,
  type TileflowStyleFamily,
} from './style-family';
import {planTileflowThemeBlend} from './theme-blend';

const preparedFamilies = new WeakMap<TileflowStyleFamily, TileflowStyleFamily>();

/** Prepare feature-dependent paint once, before the first style is installed in the renderer. */
export function prepareTileflowStyleFamilyForRendering(
  family: TileflowStyleFamily,
): TileflowStyleFamily {
  const cached = preparedFamilies.get(family);
  if (cached) return cached;
  if (
    readTileflowFamilyValue(family, ['metadata', 'tileflow:family-prepared'], family.themes[0]!) ===
    1
  )
    return family;
  if (!family.updates.appearanceOnly || family.themes.length < 2) return family;
  const styles = expandTileflowStyleFamily(family);
  const plan = planTileflowThemeBlend(
    family.themes.map((name) => restoreTileflowColorPrograms(styles[name]!)),
    {iconImages: 'mix'},
  );
  const first = plan.styleAt(0);
  const descendants = (id: string) =>
    first.layers
      .map((layer) => String(layer.id))
      .filter(
        (name) =>
          name === id || name.startsWith(`${id}::branch-`) || name.startsWith(`${id}::theme-`),
      );
  // The renderer may use filtered branches or opacity copies, but downloads one shared document.
  // Metadata still describes each theme's own 3D design, sun, routes and semantic identity.
  const prepared = createTileflowStyleFamily(
    Object.fromEntries(
      family.themes.map((name, index) => {
        const style = plan.styleAt(index);
        const metadata: Record<string, unknown> = {
          ...styles[name]!.metadata,
          'tileflow:family-prepared': 1,
          ...(plan.images.length
            ? {'tileflow:family-images': plan.images, 'tileflow:family-image-theme': name}
            : {}),
          // A split physical layer must retain the planner's interaction mapping.
          ...(style.metadata?.['tileflow:interaction-manifest']
            ? {'tileflow:interaction-manifest': style.metadata['tileflow:interaction-manifest']}
            : {}),
          ...(style.metadata?.['tileflow:overlay-placement-manifest']
            ? {
                'tileflow:overlay-placement-manifest':
                  style.metadata['tileflow:overlay-placement-manifest'],
              }
            : {}),
        };
        // Align references before validating/factoring; never mutate the validated template.
        const vegetation = metadata['tileflow:vegetation'] as {flatLayers?: string[]} | undefined;
        if (Array.isArray(vegetation?.flatLayers))
          metadata['tileflow:vegetation'] = {
            ...vegetation,
            flatLayers: vegetation.flatLayers.flatMap(descendants),
          };
        const display = metadata['tileflow:vegetation-display'] as
          {flatLayers?: {id: string; visible: boolean}[]} | undefined;
        if (Array.isArray(display?.flatLayers))
          metadata['tileflow:vegetation-display'] = {
            ...display,
            flatLayers: display.flatLayers.flatMap((layer) =>
              descendants(layer.id).map((id) => ({...layer, id})),
            ),
          };
        const colors = styles[name]!.metadata?.[tileflowColorMetadataKey] as
          TileflowColorBindings | undefined;
        const preparedStyle = {...style, transition: {duration: 0, delay: 0}, metadata};
        // Restore metadata's own semantic references, then reindex paint bindings after splitting.
        if (colors) {
          const restoredMetadata = restoreTileflowColorPrograms(styles[name]!).metadata!;
          for (const key of Object.keys(restoredMetadata))
            if (
              key !== 'tileflow:interaction-manifest' &&
              key !== 'tileflow:overlay-placement-manifest' &&
              key !== 'tileflow:vegetation-display'
            )
              preparedStyle.metadata[key] =
                key === 'tileflow:vegetation'
                  ? {
                      ...(restoredMetadata[key] as object),
                      flatLayers: (metadata[key] as {flatLayers?: string[]}).flatLayers,
                    }
                  : restoredMetadata[key];
        }
        return [
          name,
          colors
            ? extractTileflowColorPrograms(preparedStyle, colors.tokens, colors.knobs)
            : preparedStyle,
        ];
      }),
    ),
  );
  if (!prepared.updates.appearanceOnly)
    throw new TypeError('Family preparation changed its structural contract.');
  preparedFamilies.set(family, prepared);
  preparedFamilies.set(prepared, prepared);
  return prepared;
}

/** Values evaluated on a feature can only switch once; animating them would repeatedly rebuild tiles. */
export function tileflowPaintReadsFeature(value: unknown): boolean {
  if (!Array.isArray(value) || value[0] === 'literal') return false;
  return (
    [
      'get',
      'has',
      'id',
      'feature-state',
      'geometry-type',
      'properties',
      'within',
      'distance',
    ].includes(String(value[0])) || value.some(tileflowPaintReadsFeature)
  );
}
