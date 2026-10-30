import type {
  TileflowBoundaryFeatureState,
  TileflowDepthMarker,
  TileflowDepthMarkerHandle,
  TileflowDepthMarkers,
  TileflowDynamicImageHandle,
  TileflowEmphasis,
  TileflowEmphasisArea,
  TileflowMap3DAttachment,
  TileflowRouteInks,
  TileflowThemeController,
  TileflowThemeTransitionResult,
} from '@tileflow/core/browser';
import type {DataReference} from './data';
import {ProtocolError} from './protocol';
import type {
  BoundaryValuesRequest,
  DepthMarkersRequest,
  EmphasisRequest,
  ImagesRequest,
  StyleStateRequest,
  SunRequest,
  ViewModeRequest,
} from './scene-contract';

/** Decoded application image: RGBA pixels for the style, and a texture source for markers. */
export type DecodedImage = Readonly<{
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  texture: TexImageSource;
}>;

/** The parts of Core and of the runtime the scene drives; tests pass their own. */
export type SceneInput = Readonly<{
  themes: Pick<
    TileflowThemeController,
    'getRouteInks' | 'registerImage' | 'setEmphasis' | 'setState' | 'setSun'
  >;
  attachment: Pick<TileflowMap3DAttachment, 'setViewMode' | 'setVegetation'>;
  read: (reference: DataReference, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>;
  decode: (bytes: Uint8Array<ArrayBuffer>) => Promise<DecodedImage>;
  boundaries: (options: {
    family: BoundaryValuesRequest['family'];
    labels: boolean;
    state: string;
  }) => TileflowBoundaryFeatureState;
  depthMarkers: () => TileflowDepthMarkers;
  /** Called after a change that can alter the theme's route inks on screen. */
  inksChanged?: () => void;
}>;

const invalid = (message: string, reason?: 'invalidImage') =>
  new ProtocolError('invalidRequest', message, reason ? {reason, resource: 'image'} : undefined);

/** A theme controller result as a protocol answer; a request Core rejects is the caller's. */
function answer(result: TileflowThemeTransitionResult) {
  if (result.status === 'failed') {
    if (result.error instanceof TypeError) throw invalid(result.error.message);
    throw new ProtocolError('rendererFailed', 'The map could not apply the change.');
  }
  return {status: result.status};
}

function parseJSON(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    return undefined;
  }
}

const position = (value: unknown) =>
  Array.isArray(value) &&
  (value.length === 2 || value.length === 3) &&
  value.every((item) => typeof item === 'number' && Number.isFinite(item)) &&
  Math.abs(value[0] as number) <= 180 &&
  Math.abs(value[1] as number) <= 90;
const ring = (value: unknown) => Array.isArray(value) && value.length >= 4 && value.every(position);
const polygon = (value: unknown) => Array.isArray(value) && value.length >= 1 && value.every(ring);

/** A GeoJSON Polygon or MultiPolygon geometry, or undefined. Core bounds its size. */
export function emphasisArea(value: unknown): TileflowEmphasisArea | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const {type, coordinates} = value as {type?: unknown; coordinates?: unknown};
  if (type === 'Polygon' && polygon(coordinates))
    return {type, coordinates} as TileflowEmphasisArea;
  if (type === 'MultiPolygon' && Array.isArray(coordinates) && coordinates.every(polygon))
    return {type, coordinates} as TileflowEmphasisArea;
  return undefined;
}

/** Rows `[[key, value], …]` keyed as the polygons are, or undefined. */
export function boundaryRows(
  value: unknown,
  joinBy: 'id' | 'ref',
): {key: number | string; value: number | string | null}[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: {key: number | string; value: number | string | null}[] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length !== 2) return undefined;
    const [key, cell] = row as [unknown, unknown];
    const keyed =
      joinBy === 'id'
        ? typeof key === 'number' && Number.isSafeInteger(key) && key >= 0
        : typeof key === 'string' && key.length > 0 && key.length <= 256;
    const valued =
      cell === null ||
      (typeof cell === 'number' && Number.isFinite(cell)) ||
      (typeof cell === 'string' && cell.length <= 256);
    if (!keyed || !valued) return undefined;
    rows.push({key: key as number | string, value: cell as number | string | null});
  }
  return rows;
}

type HeldImage = {
  /** Identifies the image's data, pixel ratio and variants. */
  digest: string;
  /** The digest of its default image's data. */
  source: string;
  decoded: DecodedImage;
  /** Variant images by the digest of their data. */
  sources: ReadonlyMap<string, DecodedImage>;
  handle: TileflowDynamicImageHandle;
};

/**
 * The map's appearance and scene beyond its theme, driven through Core's controllers: the view
 * mode, vegetation, the sun, emphasis, style states, Boundaries values, application images and
 * depth markers. Each request replaces what the previous one of its kind asked for, so a host
 * can send its whole desired state again to a new renderer.
 */
export function createMapScene(input: SceneInput) {
  let disposed = false;
  let boundaries: {key: string; controller: TileflowBoundaryFeatureState} | undefined;
  const images = new Map<string, HeldImage>();
  let markers: TileflowDepthMarkers | undefined;
  const markerHandles = new Map<string, {handle: TileflowDepthMarkerHandle; image: string}>();
  let imageRevision = 0;

  async function decodeAll(
    references: readonly DataReference[],
    signal: AbortSignal,
  ): Promise<Map<string, DecodedImage>> {
    // Images the map already holds are not read or decoded again.
    const held = new Map<string, DecodedImage>();
    for (const image of images.values()) {
      held.set(image.source, image.decoded);
      for (const [digest, variant] of image.sources) held.set(digest, variant);
    }
    const distinct = new Map(references.map((reference) => [reference.sha256, reference]));
    const output = new Map<string, DecodedImage>();
    await Promise.all(
      [...distinct.values()].map(async (reference) => {
        const known = held.get(reference.sha256);
        if (known) {
          output.set(reference.sha256, known);
          return;
        }
        const bytes = await input.read(reference, signal);
        let image: DecodedImage;
        try {
          image = await input.decode(bytes);
        } catch {
          throw invalid('An application image could not be decoded.', 'invalidImage');
        }
        if (
          ![image.width, image.height].every(
            (side) => Number.isInteger(side) && side > 0 && side <= 2048,
          )
        )
          throw invalid('Application images are 1 to 2048 pixels on each side.', 'invalidImage');
        output.set(reference.sha256, image);
      }),
    );
    return output;
  }

  function releaseMarkersOf(name: string) {
    for (const [id, marker] of markerHandles)
      if (marker.image === name) {
        marker.handle.remove();
        markerHandles.delete(id);
      }
  }

  return {
    setViewMode(request: ViewModeRequest) {
      input.attachment.setViewMode(
        request.viewMode,
        request.duration > 0 ? {transition: {duration: request.duration, mode: 'grow'}} : undefined,
      );
      return null;
    },
    setVegetation(visible: boolean | null) {
      input.attachment.setVegetation(visible ?? undefined);
    },
    async setSun(request: SunRequest) {
      const sun =
        request.sun === null
          ? undefined
          : 'date' in request.sun
            ? {
                date: request.sun.date,
                ...(request.sun.location
                  ? {
                      location: [
                        request.sun.location.longitude,
                        request.sun.location.latitude,
                      ] as const,
                    }
                  : {}),
              }
            : request.sun;
      return answer(await input.themes.setSun(sun, {transition: {duration: request.duration}}));
    },
    async setEmphasis(request: EmphasisRequest, signal: AbortSignal) {
      let emphasis: TileflowEmphasis | undefined;
      if (request.emphasis) {
        const {keep, ...rest} = request.emphasis;
        let area: TileflowEmphasisArea | undefined;
        if (keep) {
          area = emphasisArea(parseJSON(await input.read(keep, signal)));
          if (!area)
            throw invalid('The emphasis keep area must be a GeoJSON Polygon or MultiPolygon.');
        }
        signal.throwIfAborted();
        emphasis = {...rest, ...(area ? {keep: area} : {})};
      }
      return answer(
        await input.themes.setEmphasis(emphasis, {transition: {duration: request.duration}}),
      );
    },
    async setStyleState(request: StyleStateRequest) {
      const result = await input.themes.setState(request.name, request.value, {
        transition: {duration: request.duration},
      });
      input.inksChanged?.();
      return answer(result);
    },
    routeInks(): TileflowRouteInks {
      return input.themes.getRouteInks();
    },
    async setBoundaryValues(request: BoundaryValuesRequest, signal: AbortSignal) {
      if (!request.values) {
        boundaries?.controller.dispose();
        boundaries = undefined;
        return null;
      }
      const rows = boundaryRows(
        parseJSON(await input.read(request.values.rows, signal)),
        request.values.joinBy,
      );
      if (!rows)
        throw invalid(
          `Boundaries rows must be [key, value] pairs keyed by ${request.values.joinBy}, with numbers, strings or null as values.`,
        );
      signal.throwIfAborted();
      const key = JSON.stringify([request.family, request.labels, request.state]);
      if (boundaries?.key !== key) {
        boundaries?.controller.dispose();
        boundaries = {
          key,
          controller: input.boundaries({
            family: request.family,
            labels: request.labels,
            state: request.state,
          }),
        };
      }
      try {
        boundaries.controller.set({joinBy: request.values.joinBy, rows});
      } catch (error) {
        throw invalid(
          error instanceof Error ? error.message : 'The Boundaries values were refused.',
        );
      }
      return null;
    },
    async setImages(request: ImagesRequest, signal: AbortSignal) {
      const revision = ++imageRevision;
      const references = request.images.flatMap((image) => [
        image.data,
        ...Object.values(image.variants ?? {}),
      ]);
      const decoded = await decodeAll(references, signal);
      signal.throwIfAborted();
      // A later request that already started wins; this one changes nothing.
      if (revision !== imageRevision || disposed) return {status: 'superseded'};
      // Every image is checked before the map changes, so a refused request changes nothing.
      const prepared = request.images.map((image) => {
        const base = decoded.get(image.data.sha256)!;
        const variants = Object.entries(image.variants ?? {}).map(
          ([theme, reference]) =>
            [theme, reference.sha256, decoded.get(reference.sha256)!] as const,
        );
        if (
          variants.some(
            ([, , variant]) => variant.width !== base.width || variant.height !== base.height,
          )
        )
          throw invalid(`The variants of image ${image.name} differ in size.`, 'invalidImage');
        const digest = JSON.stringify([
          image.data.sha256,
          image.pixelRatio,
          image.sdf,
          variants.map(([theme, sha256]) => [theme, sha256]),
        ]);
        return {image, base, variants, digest};
      });
      const wanted = new Set(request.images.map((image) => image.name));
      for (const [name, held] of images)
        if (!wanted.has(name)) {
          held.handle.dispose();
          images.delete(name);
          releaseMarkersOf(name);
        }
      for (const {image, base, variants, digest} of prepared) {
        const held = images.get(image.name);
        if (held?.digest === digest) continue;
        held?.handle.dispose();
        images.delete(image.name);
        const byTheme = new Map(variants.map(([theme, , variant]) => [theme, variant]));
        let handle: TileflowDynamicImageHandle;
        try {
          handle = input.themes.registerImage(image.name, {
            width: base.width,
            height: base.height,
            pixelRatio: image.pixelRatio,
            ...(image.sdf ? {sdf: true} : {}),
            render: ({theme}) => (byTheme.get(theme) ?? base).pixels,
          });
        } catch (error) {
          // For example a name the map's own icons already use.
          throw invalid(
            error instanceof Error ? error.message : `Image ${image.name} could not be added.`,
          );
        }
        images.set(image.name, {
          digest,
          source: image.data.sha256,
          decoded: base,
          sources: new Map(variants.map(([, sha256, variant]) => [sha256, variant])),
          handle,
        });
        // Markers showing the image take its new pixels.
        for (const marker of markerHandles.values())
          if (marker.image === image.name) marker.handle.update({image: base.texture});
      }
      return null;
    },
    setDepthMarkers(request: DepthMarkersRequest) {
      const missing = request.markers.filter((marker) => !images.has(marker.image));
      if (missing.length > 0)
        throw invalid(
          `Depth markers name images the map does not hold: ${[...new Set(missing.map((marker) => marker.image))].join(', ')}.`,
        );
      const wanted = new Set(request.markers.map((marker) => marker.id));
      for (const [id, marker] of markerHandles)
        if (!wanted.has(id)) {
          marker.handle.remove();
          markerHandles.delete(id);
        }
      for (const marker of request.markers) {
        const definition: TileflowDepthMarker = {
          lngLat: [marker.coordinate.longitude, marker.coordinate.latitude],
          image: images.get(marker.image)!.decoded.texture,
          size: marker.size,
          alignment: marker.alignment,
          anchor: marker.anchor,
          ...(marker.offset ? {offset: marker.offset} : {}),
          rotation: marker.rotation,
          altitude: marker.altitude,
          opacity: marker.opacity,
          occlude: marker.occlude,
        };
        const held = markerHandles.get(marker.id);
        if (held) {
          const {image, ...change} = definition;
          held.handle.update(held.image === marker.image ? change : definition);
          held.image = marker.image;
        } else {
          markers ??= input.depthMarkers();
          markerHandles.set(marker.id, {handle: markers.add(definition), image: marker.image});
        }
      }
      return null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      boundaries?.controller.dispose();
      boundaries = undefined;
      for (const held of images.values()) held.handle.dispose();
      images.clear();
      markers?.dispose();
      markers = undefined;
      markerHandles.clear();
    },
  };
}
