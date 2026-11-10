const clusterMetadataKey = 'tileflow:cluster';
/** Derived line-background stacks are drawn as cells, so they cannot set a cluster's count. */
const lineBackgroundStack = / lines-v1-t\d+-l\d+-p\d+$/u;

type Json = Readonly<Record<string, unknown>>;

/**
 * Gives a `clusterOverlay()` count layer the style's label font. Other layers and counts with their
 * own font return unchanged; `undefined` means the style has no label font to share.
 */
export function withTileflowClusterLabelFont<TLayer extends Json>(
  layer: TLayer,
  styleLayers: readonly Json[],
): TLayer | undefined {
  const metadata = layer.metadata as Json | undefined;
  const layout = (layer.layout ?? {}) as Json;
  if ((metadata?.[clusterMetadataKey] as Json | undefined)?.role !== 'count') return layer;
  if (layout['text-font'] !== undefined) return layer;
  for (const candidate of styleLayers) {
    const font = (candidate.layout as Json | undefined)?.['text-font'];
    if (
      Array.isArray(font) &&
      font.length > 0 &&
      font.every((face) => typeof face === 'string' && !lineBackgroundStack.test(face))
    ) {
      return {...layer, layout: {...layout, 'text-font': font}};
    }
  }
  return undefined;
}
