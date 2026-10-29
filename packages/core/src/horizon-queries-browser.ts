/** The part of a MapLibre GL JS transform that scales feature-query padding with the pitch. */
type HorizonTransform = {
  maxPitchScaleFactor(): number;
  readonly pitch: number;
  readonly centerPoint: {readonly y: number};
  readonly cameraToCenterDistance: number;
};

/** A MapLibre GL JS map whose feature queries keep working once the horizon is in view. */
export type TileflowHorizonQueryMap = {
  queryRenderedFeatures(...args: never[]): unknown;
};

/** MapLibre's mercator horizon: the ground is drawn up to 85% of the way to the true horizon. */
const horizonShare = 0.85;
const maximumHorizonAngle = (89.25 * Math.PI) / 180;

/**
 * How many times farther from the camera the ground at the top of the view lies than the ground at
 * its centre, sampled no higher than the horizon. `centerY` is the centre's distance from the top
 * of the view, which padding moves, and `cameraToCenterDistance` the camera's focal length, both
 * in CSS pixels.
 */
export function tileflowHorizonScaleFactor(view: {
  pitch: number;
  centerY: number;
  cameraToCenterDistance: number;
}): number {
  const pitch = (view.pitch * Math.PI) / 180;
  const horizon = Math.min(
    Math.tan(Math.PI / 2 - pitch) * horizonShare,
    Math.tan(maximumHorizonAngle - pitch),
  );
  const top = Math.min(view.centerY / view.cameraToCenterDistance, horizon);
  // Along a ray `top` above the view axis, depth grows by 1 / (1 - tan(pitch) · tan(angle)).
  return 1 / (1 - Math.tan(pitch) * top);
}

/**
 * Keep point and box feature queries working at steep pitches.
 *
 * MapLibre GL JS widens each query by how much more ground a pixel covers at the top of the view
 * than at its centre. Once the pitch shows sky at the top of the view, that sample lies behind the
 * camera, the factor turns negative and queries for circles, lines and fills find nothing
 * ([maplibre/maplibre-gl-js#2994](https://github.com/maplibre/maplibre-gl-js/issues/2994)). Where
 * the renderer's factor is not positive, this samples the ground at the horizon instead, as the
 * proposed upstream fix does
 * ([maplibre/maplibre-gl-js#8770](https://github.com/maplibre/maplibre-gl-js/pull/8770)). Correct
 * factors are left unchanged. Returns a function that restores the map.
 */
export function attachTileflowHorizonQueries(map: TileflowHorizonQueryMap): () => void {
  const target = map as TileflowHorizonQueryMap & {
    _camera?: {transform?: Partial<HorizonTransform>};
    transform?: Partial<HorizonTransform>;
  };
  const query = target.queryRenderedFeatures;
  if (typeof query !== 'function') return () => {};
  const own = Object.prototype.hasOwnProperty.call(target, 'queryRenderedFeatures');
  // Each corrected transform with its own factor, if it had one rather than its class's.
  const corrected = new Map<
    Partial<HorizonTransform>,
    HorizonTransform['maxPitchScaleFactor'] | undefined
  >();
  const correct = (transform: Partial<HorizonTransform> | undefined) => {
    const original = transform?.maxPitchScaleFactor;
    if (!transform || typeof original !== 'function' || corrected.has(transform)) return;
    const own = Object.prototype.hasOwnProperty.call(transform, 'maxPitchScaleFactor');
    corrected.set(transform, own ? original : undefined);
    transform.maxPitchScaleFactor = function (this: HorizonTransform) {
      const value = original.call(this);
      if (value > 0 && Number.isFinite(value)) return value;
      const fallback = tileflowHorizonScaleFactor({
        pitch: this.pitch,
        centerY: this.centerPoint.y,
        cameraToCenterDistance: this.cameraToCenterDistance,
      });
      return fallback > 0 && Number.isFinite(fallback) ? fallback : value;
    };
  };
  const wrapped = function (this: unknown, ...args: never[]) {
    // The renderer replaces its transform when the projection changes.
    correct(target._camera?.transform ?? target.transform);
    return query.apply(this, args);
  };
  target.queryRenderedFeatures = wrapped;
  return () => {
    if (target.queryRenderedFeatures === wrapped) {
      if (own) target.queryRenderedFeatures = query;
      else delete (target as Partial<TileflowHorizonQueryMap>).queryRenderedFeatures;
    }
    for (const [transform, original] of corrected) {
      if (original) transform.maxPitchScaleFactor = original;
      else delete transform.maxPitchScaleFactor;
    }
    corrected.clear();
  };
}
