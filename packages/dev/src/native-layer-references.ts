import type {MapLibreStyle} from '@tileflow/core';
import type {TileflowNativeBuildRecord} from '@tileflow/core/native-profile';

type Changes = TileflowNativeBuildRecord['transformations'][number]['layers'];
type Json = Record<string, unknown>;
const overlayKeys = [
  'above-water',
  'below-roads',
  'above-roads',
  'above-buildings',
  'below-labels',
  'above-labels',
];
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Json;
}
function identifier(layer: Json): string {
  if (typeof layer.id !== 'string' || !layer.id.length) throw new Error();
  return layer.id;
}

/**
 * Rebind physical layer references only after the existing bounded representation lowering
 * completes. Ordered numeric spans are the only correspondence; anything unproven is undefined.
 */
export function rebindNativeLayerReferences(
  input: MapLibreStyle,
  lowered: MapLibreStyle,
  changes: Changes,
): MapLibreStyle | undefined {
  try {
    const originalIndexes = new Map<string, number>();
    const finalIndexes = new Map<string, number>();
    const starts = new Map<string, number>();
    const transformed = new Map<number, Changes[number]>();
    let previous = -1;
    for (const change of changes) {
      if (
        !Number.isSafeInteger(change.inputLayer) ||
        change.inputLayer <= previous ||
        change.inputLayer >= input.layers.length ||
        !Number.isSafeInteger(change.outputStart) ||
        !Number.isSafeInteger(change.outputCount) ||
        change.outputCount < 1 ||
        change.outputCount > 32 ||
        !Array.isArray(change.properties) ||
        !['line-cap', 'line-dasharray', 'line-cap,line-dasharray'].includes(
          change.properties.join(','),
        )
      )
        throw new Error();
      previous = change.inputLayer;
      transformed.set(change.inputLayer, change);
    }
    for (const [index, layer] of lowered.layers.entries()) {
      const id = identifier(layer);
      if (finalIndexes.has(id)) throw new Error();
      finalIndexes.set(id, index);
    }
    let offset = 0;
    for (const [index, layer] of input.layers.entries()) {
      const id = identifier(layer);
      if (originalIndexes.has(id)) throw new Error();
      originalIndexes.set(id, index);
      starts.set(id, offset);
      const change = transformed.get(index);
      if (change && (change.outputStart !== offset || layer.type !== 'line')) throw new Error();
      const count = change?.outputCount ?? 1;
      if (offset + count > lowered.layers.length) throw new Error();
      for (let branch = 0; branch < count; branch++) {
        const candidate = lowered.layers[offset + branch]!;
        if (!change && identifier(candidate) !== id) throw new Error();
        if (
          candidate.type !== layer.type ||
          candidate.source !== layer.source ||
          candidate['source-layer'] !== layer['source-layer']
        )
          throw new Error();
      }
      offset += count;
    }
    if (offset !== lowered.layers.length) throw new Error();
    // Copy only the rewritten metadata; the lowered layers and key order are returned unchanged.
    const metadata = lowered.metadata === undefined ? undefined : {...object(lowered.metadata)};
    const originalMetadata = input.metadata === undefined ? undefined : object(input.metadata);
    if (originalMetadata?.['tileflow:overlay-placement-manifest'] !== undefined) {
      if (!metadata) throw new Error();
      const overlay = object(originalMetadata['tileflow:overlay-placement-manifest']);
      const anchors = object(overlay.anchors);
      if (
        overlay.schemaVersion !== 1 ||
        Object.keys(anchors).length !== overlayKeys.length ||
        overlayKeys.some((key) => !Object.hasOwn(anchors, key))
      )
        throw new Error();
      const updated: Record<string, string | null> = {};
      for (const key of overlayKeys) {
        const anchor = anchors[key];
        if (anchor === null) {
          updated[key] = null;
          continue;
        }
        if (typeof anchor !== 'string' || !starts.has(anchor)) throw new Error();
        // Anchors are insertion-before boundaries; an expanded layer starts at its first branch.
        updated[key] = identifier(lowered.layers[starts.get(anchor)!]!);
      }
      metadata['tileflow:overlay-placement-manifest'] = {...overlay, anchors: updated};
    }
    if (originalMetadata?.['tileflow:interaction-manifest'] !== undefined) {
      if (!metadata) throw new Error();
      const manifest = object(originalMetadata['tileflow:interaction-manifest']);
      if (manifest.version !== 2) throw new Error();
      const domains = object(manifest.domains);
      let rebound = manifest;
      if (domains.poi !== undefined) {
        const poi = object(domains.poi);
        if (!Array.isArray(poi.layers) || poi.layers.length > 256) throw new Error();
        const seen = new Set<string>();
        const layers = poi.layers.map((value) => {
          const entry = object(value);
          if (typeof entry.layerId !== 'string' || seen.has(entry.layerId)) throw new Error();
          const index = originalIndexes.get(entry.layerId);
          if (
            index === undefined ||
            index !== entry.priority ||
            transformed.has(index) ||
            !finalIndexes.has(entry.layerId)
          )
            throw new Error();
          const original = input.layers[index]!;
          if (original.source !== entry.source || original['source-layer'] !== entry.sourceLayer)
            throw new Error();
          seen.add(entry.layerId);
          return {...entry, priority: finalIndexes.get(entry.layerId)!};
        });
        rebound = {...manifest, domains: {...domains, poi: {...poi, layers}}};
      }
      metadata['tileflow:interaction-manifest'] = rebound;
    }
    return metadata === undefined ? {...lowered} : {...lowered, metadata};
  } catch {
    return undefined;
  }
}
