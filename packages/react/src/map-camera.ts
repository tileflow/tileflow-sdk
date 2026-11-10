import type {TileflowAnnotation} from '@tileflow/interactions';

/** `[west, south, east, north]` or `[[west, south], [east, north]]`, in degrees. */
export type TileflowBounds =
  | readonly [west: number, south: number, east: number, north: number]
  | readonly [southWest: readonly [number, number], northEast: readonly [number, number]];

export type TileflowFitBoundsOptions = Readonly<{
  /** Milliseconds the camera takes to move. The first view is always set without moving. */
  duration?: number;
  /** The highest zoom the fit may use. */
  maxZoom?: number;
  /** Space kept clear around the bounds, in pixels. */
  padding?: number | Readonly<{bottom: number; left: number; right: number; top: number}>;
}>;

export type TileflowCameraFit = Readonly<{
  bounds: [[number, number], [number, number]];
  options: TileflowFitBoundsOptions;
}>;

export type TileflowCameraFitResolution = Readonly<{
  /** Why the request cannot be shown; the camera stays where it is. */
  error?: string;
  fit?: TileflowCameraFit;
  /** Equal for equal requests, so the camera moves only when the request changes. */
  key: string;
}>;

/** The space annotations keep from the map's edge when `fitAnnotations` sets none. */
const defaultAnnotationPadding = 48;
/** A single annotation would otherwise fill the map at the highest zoom there is. */
const defaultAnnotationMaxZoom = 15;

/**
 * What the camera should show, or nothing. `bounds` wins over `fitAnnotations`; the annotations'
 * bounds are used only when `bounds` is left out.
 */
export function resolveTileflowCameraFit(input: {
  annotations?: readonly TileflowAnnotation[];
  bounds?: TileflowBounds;
  fitAnnotations?: boolean | TileflowFitBoundsOptions;
  fitBoundsOptions?: TileflowFitBoundsOptions;
}): TileflowCameraFitResolution {
  if (input.bounds !== undefined) {
    const bounds = normalizeBounds(input.bounds);
    if (!bounds) {
      return {
        error:
          'bounds must be [west, south, east, north] or [[west, south], [east, north]] in degrees, with latitudes from -90 to 90.',
        key: 'invalid',
      };
    }
    const options = input.fitBoundsOptions ?? {};
    return {fit: {bounds, options}, key: JSON.stringify([bounds, options])};
  }
  if (!input.fitAnnotations) return {key: ''};
  const given = input.fitAnnotations === true ? {} : input.fitAnnotations;
  const coordinates = (input.annotations ?? []).map((annotation) => annotation.coordinate);
  if (coordinates.length === 0) return {key: ''};
  const bounds: [[number, number], [number, number]] = [
    [
      Math.min(...coordinates.map(([longitude]) => longitude)),
      Math.min(...coordinates.map(([, latitude]) => latitude)),
    ],
    [
      Math.max(...coordinates.map(([longitude]) => longitude)),
      Math.max(...coordinates.map(([, latitude]) => latitude)),
    ],
  ];
  const options = {
    maxZoom: defaultAnnotationMaxZoom,
    padding: defaultAnnotationPadding,
    ...given,
  };
  const rounded = bounds.map((corner) => corner.map(round)) as typeof bounds;
  return {fit: {bounds, options}, key: JSON.stringify([rounded, options])};
}

function normalizeBounds(bounds: TileflowBounds): [[number, number], [number, number]] | undefined {
  const flat: unknown[] = Array.isArray(bounds[0])
    ? [...(bounds[0] as readonly number[]), ...(bounds[1] as readonly number[])]
    : [...bounds];
  if (
    flat.length !== 4 ||
    !flat.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    return undefined;
  }
  const [west, south, east, north] = flat as [number, number, number, number];
  if (south < -90 || south > 90 || north < -90 || north > 90 || south > north) return undefined;
  return [
    [round(west), round(south)],
    [round(east), round(north)],
  ];
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
