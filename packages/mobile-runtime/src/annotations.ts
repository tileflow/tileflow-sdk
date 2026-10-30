import type {AnnotationLayers, TrackedPoints} from './annotations-contract';
import type {Producer} from './events';
import type {FeatureCollection} from './geojson';
import type {EventName} from './protocol';

type Point = {x: number; y: number};
type LngLat = {lng: number; lat: number};
type Geometry = NonNullable<FeatureCollection['features'][number]['geometry']>;
type FeatureId = string | number;
type Listener = () => void;

/** How far from a touch, in CSS pixels, an annotation still counts as touched. */
export const touchTolerance = 6;
/** How far a pointer moves, in CSS pixels, before a press on a draggable annotation drags it. */
export const dragSlop = 3;
/** How often, at most, the renderer reads the terrain to hide points behind it. */
export const terrainCheckMs = 100;
/** Positions are reported to a hundredth of a CSS pixel. */
const precision = 100;

/** The MapLibre capabilities annotations use; tests pass their own. */
export type AnnotationMap = {
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  project(location: [number, number]): Point;
  unproject(point: [number, number]): LngLat;
  getCenter(): LngLat;
  getCanvasContainer(): HTMLElement;
  dragPan: {isEnabled(): boolean; enable(): void; disable(): void};
  terrain?: unknown;
  _camera?: {transform?: AnnotationTransform};
  transform?: AnnotationTransform;
};
type AnnotationTransform = {
  width: number;
  height: number;
  isLocationOccluded?(location: LngLat, terrain?: unknown, elevation?: number): boolean;
  isPointOnMapSurface?(point: Point, terrain?: unknown): boolean;
};

/** What the registry offers annotations: hits, stored geometry and moving a feature. */
export type AnnotationStyle = {
  hitTest(
    point: Point,
    layers: readonly string[],
    tolerance: number,
  ): {layer: string; source: string; id: FeatureId; properties: Record<string, unknown>}[];
  featureGeometry(source: string, id: FeatureId): Geometry | undefined;
  moveFeature(source: string, id: FeatureId, geometry: Geometry): boolean;
};

/** A longitude moved by whole turns to lie nearest `center`, so points across the antimeridian show. */
export function wrapNear(longitude: number, center: number): number {
  return longitude + 360 * Math.round((center - longitude) / 360);
}

/** A geometry with every position moved by `move`. */
export function mapPositions(geometry: Geometry, move: (position: number[]) => number[]): Geometry {
  const walk = (value: unknown): unknown =>
    Array.isArray(value) && typeof value[0] === 'number'
      ? move(value as number[])
      : (value as unknown[]).map(walk);
  return {
    ...geometry,
    coordinates: walk((geometry as {coordinates: unknown}).coordinates),
  } as Geometry;
}

/** Whether two flat position lists differ by more than the reported precision. */
function samePositions(a: readonly (number | null)[], b: readonly (number | null)[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

/**
 * Annotations in the renderer: hits for taps and long presses on the application's annotation
 * layers, drags of draggable annotations, and the screen positions of the points the host tracks
 * for native views, reported once per frame that moves them.
 */
export function createAnnotationController(
  map: AnnotationMap,
  output: {
    emit: (event: EventName, produce: Producer) => void;
    /** Whether the host subscribes to an event, so nothing is computed for nobody. */
    wants: (event: EventName) => boolean;
    style: () => AnnotationStyle | undefined;
    /** Milliseconds since the Unix epoch, comparable with the host's clock. */
    now?: () => number;
    frame?: (callback: () => void) => unknown;
    signal: AbortSignal;
  },
) {
  const now = output.now ?? (() => performance.timeOrigin + performance.now());
  const frame = output.frame ?? ((callback: () => void) => requestAnimationFrame(callback));
  let layers: readonly string[] = [];
  let tracked: TrackedPoints = {revision: 0, points: []};
  let reported: {revision: number; positions: (number | null)[]} | undefined;
  let covered: boolean[] = [];
  let terrainCheckedAt = -Infinity;
  let pending = false;
  let disposed = false;
  const transform = () => map._camera?.transform ?? map.transform;

  /** Where each tracked point is on screen, or null where the globe or terrain hides it. */
  function positions(): (number | null)[] {
    const view = transform();
    const center = map.getCenter().lng;
    const terrain = map.terrain;
    const checkTerrain = Boolean(terrain) && now() - terrainCheckedAt >= terrainCheckMs;
    if (checkTerrain) terrainCheckedAt = now();
    if (!terrain) covered = [];
    const output: (number | null)[] = [];
    tracked.points.forEach(([longitude, latitude], index) => {
      const location = {lng: wrapNear(longitude, center), lat: latitude};
      const point = map.project([location.lng, location.lat]);
      let hidden =
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        view?.isLocationOccluded?.(location) === true ||
        // At a steep pitch, a point beyond the horizon projects above it.
        view?.isPointOnMapSurface?.(point) === false;
      if (!hidden && terrain && view) {
        const inView =
          point.x >= 0 && point.y >= 0 && point.x <= view.width && point.y <= view.height;
        if (checkTerrain)
          covered[index] = inView && view.isLocationOccluded?.(location, terrain) === true;
        hidden = covered[index] === true;
      }
      output.push(
        hidden ? null : Math.round(point.x * precision) / precision,
        hidden ? null : Math.round(point.y * precision) / precision,
      );
    });
    return output;
  }

  /** Reports the positions of the frame just drawn when they changed. */
  const report = () => {
    if (disposed || !output.wants('trackedPointsMoved')) return;
    if (tracked.points.length === 0 && reported?.revision === tracked.revision) return;
    const time = now();
    const next = positions();
    if (reported?.revision === tracked.revision && samePositions(reported.positions, next)) return;
    reported = {revision: tracked.revision, positions: next};
    output.emit('trackedPointsMoved', () => ({revision: tracked.revision, time, positions: next}));
  };
  /** Reports on the next frame even when the map does not draw one, as after new points. */
  const reportSoon = () => {
    if (pending) return;
    pending = true;
    frame(() => {
      pending = false;
      report();
    });
  };
  map.on('render', report);
  map.on('resize', reportSoon);

  /** The annotations under a point, topmost first, for taps and long presses. */
  function hits(point: Point) {
    const style = output.style();
    if (!style || layers.length === 0) return [];
    return style
      .hitTest(point, layers, touchTolerance)
      .slice(0, 16)
      .map(({layer, id}) => ({layer, id: String(id)}));
  }

  // A pan that starts on a draggable annotation moves it instead of the map.
  const container = map.getCanvasContainer();
  type Drag = {
    pointer: number;
    start: Point;
    layer: string;
    source: string;
    id: FeatureId;
    geometry: Geometry;
    /** The start geometry's positions on screen, so the annotation keeps its place under the finger. */
    anchors: Geometry;
    moved: boolean;
    panEnabled: boolean;
    reportPending: boolean;
    last: {geometry: Geometry; point: Point};
  };
  let drag: Drag | undefined;
  const local = (event: PointerEvent): Point => {
    const bounds = container.getBoundingClientRect();
    return {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
  };
  const emitDrag = (phase: 'started' | 'moved' | 'ended', current: Drag) => {
    const {geometry, point} = current.last;
    output.emit('annotationDragged', () => ({
      phase,
      layer: current.layer,
      id: String(current.id),
      geometry,
      point,
    }));
  };
  /** Ends a drag where the annotation is, giving the map its pan back. */
  const finish = () => {
    const current = drag;
    if (!current) return;
    drag = undefined;
    if (current.panEnabled) map.dragPan.enable();
    if (current.moved) emitDrag('ended', current);
  };
  container.addEventListener(
    'pointerdown',
    (event) => {
      finish();
      if (!event.isPrimary || layers.length === 0) return;
      const style = output.style();
      const point = local(event);
      const hit = style?.hitTest(point, layers, touchTolerance)[0];
      if (!style || !hit || hit.properties.draggable !== true) return;
      const geometry = style.featureGeometry(hit.source, hit.id);
      if (!geometry) return;
      const center = map.getCenter().lng;
      const anchors = mapPositions(geometry, ([longitude, latitude, ...rest]) => {
        const projected = map.project([wrapNear(longitude!, center), latitude!]);
        return [projected.x, projected.y, ...rest];
      });
      const panEnabled = map.dragPan.isEnabled();
      // MapLibre reads its touch and mouse events after this one, so the map does not pan.
      if (panEnabled) map.dragPan.disable();
      drag = {
        pointer: event.pointerId,
        start: point,
        layer: hit.layer,
        source: hit.source,
        id: hit.id,
        geometry,
        anchors,
        moved: false,
        panEnabled,
        reportPending: false,
        last: {geometry, point},
      };
    },
    {capture: true, signal: output.signal},
  );
  container.addEventListener(
    'pointermove',
    (event) => {
      const current = drag;
      if (!current || event.pointerId !== current.pointer) return;
      const point = local(event);
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      if (!current.moved && Math.hypot(dx, dy) <= dragSlop) return;
      const geometry = mapPositions(current.anchors, ([x, y, ...rest]) => {
        const location = map.unproject([x! + dx, y! + dy]);
        return [wrapNear(location.lng, 0), Math.max(-85, Math.min(85, location.lat)), ...rest];
      });
      if (!output.style()?.moveFeature(current.source, current.id, geometry)) return;
      current.last = {geometry, point};
      if (!current.moved) {
        current.moved = true;
        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          // The pointer already ended.
        }
        emitDrag('started', current);
        return;
      }
      // Moves are reported once per frame, with the latest position.
      if (current.reportPending) return;
      current.reportPending = true;
      frame(() => {
        current.reportPending = false;
        if (drag === current) emitDrag('moved', current);
      });
    },
    {signal: output.signal},
  );
  container.addEventListener('pointerup', () => finish(), {signal: output.signal});
  container.addEventListener('pointercancel', () => finish(), {signal: output.signal});

  return {
    hits,
    /** Whether a drag holds the pointer, so the press is not also a long press. */
    get dragging() {
      return drag?.moved === true;
    },
    setLayers(request: AnnotationLayers) {
      layers = request.layers;
      if (drag && !layers.includes(drag.layer)) finish();
    },
    setTrackedPoints(request: TrackedPoints) {
      tracked = request;
      covered = [];
      terrainCheckedAt = -Infinity;
      reportSoon();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off('render', report);
      map.off('resize', reportSoon);
      if (drag?.panEnabled) map.dragPan.enable();
      drag = undefined;
    },
  };
}
export type AnnotationController = ReturnType<typeof createAnnotationController>;
