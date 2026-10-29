import type {AttributionControl, Map as MapLibreMap} from 'maplibre-gl';
import type {Animation, Bounds, Corner, Fit, Insets, Limits, MoveCamera} from './camera-contract';
import {maximumAnimationMs} from './camera-contract';
import {ProtocolError} from './errors';
import {cameraReason, type Producer} from './events';
import type {Camera, CameraReason, EventName} from './protocol';

export type CameraMap = Pick<
  MapLibreMap,
  | 'on'
  | 'jumpTo'
  | 'easeTo'
  | 'flyTo'
  | 'stop'
  | 'getCenter'
  | 'getZoom'
  | 'getBearing'
  | 'getPitch'
  | 'getBounds'
  | 'cameraForBounds'
  | 'setPadding'
  | 'isMoving'
  | 'setMinZoom'
  | 'setMaxZoom'
  | 'setMinPitch'
  | 'setMaxPitch'
  | 'setMaxBounds'
  | 'getContainer'
  | 'addControl'
  | 'removeControl'
>;
/** How a movement the application asked for ended. */
export type CameraCompletion = 'finished' | 'cancelled' | 'interrupted';

type Movement = {
  id: number;
  /** Set when the application or the SDK stopped or replaced the movement. */
  cancelled: boolean;
  /** The animation evaluated its last frame, or the movement completed when it started. */
  complete: boolean;
  settle: (completion: CameraCompletion) => void;
};
/** Data a movement's MapLibre events carry, so its end can be told from other movements. */
type MovementData = {tileflowReason: 'api' | 'gesture'; tileflowMovement: number};
const none: Insets = {top: 0, left: 0, bottom: 0, right: 0};

/** A cubic Bézier timing function through (0, 0) and (1, 1), as CSS `cubic-bezier()`. */
export function cubicBezier([x1, y1, x2, y2]: readonly [number, number, number, number]) {
  const curve = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  return (x: number) => {
    if (x <= 0 || x >= 1) return Math.min(Math.max(x, 0), 1);
    // Bisection converges for every valid curve; x(t) is monotonic when x1 and x2 lie in [0, 1].
    let low = 0;
    let high = 1;
    let t = x;
    for (let step = 0; step < 32; step += 1) {
      const value = curve(x1, x2, t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return curve(y1, y2, t);
  };
}
/** MapLibre's own default easing. */
const standardEasing = [0.25, 0.1, 0.25, 1] as const;

/**
 * Bounds with longitudes in [-180, 180]. A view wider than the world spans it whole; one that
 * crosses the antimeridian ends with an east edge west of its west edge.
 */
export function normalizeBounds(west: number, south: number, east: number, north: number): Bounds {
  const width = east - west;
  if (width >= 360) return {west: -180, south, east: 180, north};
  const start = ((((west + 180) % 360) + 360) % 360) - 180;
  const end = start + width;
  return {west: start, south, east: end > 180 ? end - 360 : end, north};
}
const lngLatBounds = ({west, south, east, north}: Bounds): [[number, number], [number, number]] => [
  [west, south],
  [east < west ? east + 360 : east, north],
];

/**
 * The camera of one map: movements with an outcome, limits, insets and camera events.
 *
 * Each movement the application asks for answers once it ends: `finished` when it reached its
 * target, `cancelled` when the application stopped or replaced it, and `interrupted` when a person
 * took over the map or the map moved for another reason.
 */
export function createCameraController(
  map: CameraMap,
  output: {
    emit: (event: EventName, produce: Producer) => void;
    wants: (event: EventName) => boolean;
    frame?: (callback: () => void) => unknown;
    cancelFrame?: (handle: unknown) => void;
    /** Movement events that something else reports, such as each frame of a shot. */
    ignores?: (event: unknown) => boolean;
    /** Called when a person's gesture starts moving the camera. */
    gesture?: () => void;
  },
) {
  const frame = output.frame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = output.cancelFrame ?? ((handle) => cancelAnimationFrame(handle as number));
  /** Movements that have not ended yet; the last one started is the active one. */
  const movements = new Map<number, Movement>();
  let active: Movement | undefined;
  let sequence = 0;
  let reason: CameraReason = 'system';
  let revision = 0;
  let pendingFrame: unknown;
  let insets = none;
  let paddingPending = false;
  let attribution: {control: AttributionControl; corner: Corner} | undefined;
  let shotMoving = false;
  let disposed = false;

  const camera = (): Camera => {
    const center = map.getCenter().wrap();
    return {
      longitude: center.lng,
      latitude: center.lat,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
  };
  const emitCamera = (event: 'cameraMoveStarted' | 'cameraMoved' | 'cameraMoveEnded') => {
    const current = reason;
    output.emit(event, () => ({camera: camera(), reason: current, revision: ++revision}));
  };
  const applyPadding = () => {
    paddingPending = false;
    if (!disposed) map.setPadding({...insets}, {tileflowReason: 'system'});
  };

  map.on('movestart', (event) => {
    if (output.ignores?.(event)) return;
    reason = cameraReason(event);
    if (reason === 'gesture') output.gesture?.();
    emitCamera('cameraMoveStarted');
  });
  map.on('move', (event) => {
    // A gesture can take over a movement that an animation started.
    if (cameraReason(event) === 'gesture') reason = 'gesture';
    if (pendingFrame !== undefined || !output.wants('cameraMoved')) return;
    pendingFrame = frame(() => {
      pendingFrame = undefined;
      emitCamera('cameraMoved');
    });
  });
  map.on('moveend', (event) => {
    if (output.ignores?.(event)) return;
    if (pendingFrame !== undefined) cancelFrame(pendingFrame);
    pendingFrame = undefined;
    emitCamera('cameraMoveEnded');
    const movement = movements.get((event as Partial<MovementData>).tileflowMovement ?? 0);
    movement?.settle(
      movement.cancelled ? 'cancelled' : movement.complete ? 'finished' : 'interrupted',
    );
    // Changing the padding jumps the camera, which would stop a movement in progress.
    if (paddingPending && !map.isMoving()) queueMicrotask(() => paddingPending && applyPadding());
  });

  /** Marks the movement in progress as stopped by the application or the SDK. */
  const cancelActive = () => {
    if (active) active.cancelled = true;
  };

  function options(command: MoveCamera) {
    if (command.target) {
      const {center, ...rest} = command.target;
      return {
        ...rest,
        ...(center ? {center: [center.longitude, center.latitude] as [number, number]} : {}),
      };
    }
    const fitted = cameraFor(command.fit!);
    if (!fitted)
      throw new ProtocolError(
        'invalidRequest',
        'The bounds do not fit the view with this padding.',
      );
    return fitted;
  }
  function cameraFor(fit: Fit) {
    const result = map.cameraForBounds(lngLatBounds(fit.bounds), {
      padding: fit.padding ?? 0,
      ...(fit.bearing === undefined ? {} : {bearing: fit.bearing}),
      ...(fit.maxZoom === undefined ? {} : {maxZoom: fit.maxZoom}),
    });
    return result ? {...result, ...(fit.pitch === undefined ? {} : {pitch: fit.pitch})} : undefined;
  }

  function start(
    target: ReturnType<typeof options>,
    animation: Animation,
    data: MovementData,
    movement: Movement,
  ) {
    const curve = cubicBezier(
      animation.type === 'jump' ? standardEasing : (animation.easing ?? standardEasing),
    );
    // The animation's last frame evaluates its easing at 1: anything that ends it earlier
    // interrupted it.
    const easing = (t: number) => {
      if (t >= 1) movement.complete = true;
      return curve(t);
    };
    switch (animation.type) {
      case 'jump':
        map.jumpTo(target, data);
        break;
      case 'ease':
        map.easeTo({...target, duration: animation.duration, easing}, data);
        break;
      case 'fly': {
        const {type: _, easing: __, ...fly} = animation;
        // A flight longer than the limit jumps instead, so it never outlives its request.
        map.flyTo({...target, ...fly, easing, maxDuration: maximumAnimationMs}, data);
        break;
      }
    }
  }

  return {
    camera,
    /** Runs one movement and answers when it ends, however it ends. */
    move(command: MoveCamera, signal: AbortSignal) {
      const target = options(command);
      cancelActive();
      const id = ++sequence;
      const data: MovementData = {tileflowReason: command.reason, tileflowMovement: id};
      return new Promise<{completion: CameraCompletion; camera: Camera}>((resolve) => {
        const abort = () => {
          if (active !== movement) return;
          movement.cancelled = true;
          map.stop();
        };
        const movement: Movement = {
          id,
          cancelled: false,
          // Movements that complete while they start, such as jumps, are never interrupted.
          complete: true,
          settle: (completion) => {
            if (!movements.delete(id)) return;
            if (active === movement) active = undefined;
            signal.removeEventListener('abort', abort);
            resolve({completion, camera: camera()});
          },
        };
        movements.set(id, movement);
        active = movement;
        signal.addEventListener('abort', abort, {once: true});
        try {
          start(target, command.animation, data, movement);
        } catch (error) {
          movements.delete(id);
          if (active === movement) active = undefined;
          throw error;
        }
        if (!movements.has(id)) return;
        movement.complete = false;
        // A movement that changes nothing may never start: nothing can interrupt it.
        if (!map.isMoving()) movement.settle('finished');
      });
    },
    /** Stops any movement, including one a person started. */
    stop() {
      cancelActive();
      map.stop();
    },
    cameraForBounds(fit: Fit): Camera | null {
      const result = cameraFor(fit);
      if (!result?.center) return null;
      const center = result.center as {lng: number; lat: number};
      return {
        longitude: center.lng,
        latitude: center.lat,
        zoom: result.zoom ?? map.getZoom(),
        bearing: result.bearing ?? map.getBearing(),
        pitch: result.pitch ?? map.getPitch(),
      };
    },
    visibleBounds(): Bounds {
      const bounds = map.getBounds();
      return normalizeBounds(
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      );
    },
    setLimits(limits: Limits) {
      // Reset first, so new limits never cross the previous ones while they are applied.
      map.setMinZoom(null);
      map.setMinPitch(null);
      map.setMaxZoom(limits.maxZoom);
      map.setMinZoom(limits.minZoom);
      map.setMaxPitch(limits.maxPitch);
      map.setMinPitch(limits.minPitch);
      map.setMaxBounds(limits.bounds ? lngLatBounds(limits.bounds) : null);
    },
    /**
     * Space covered at each edge, for example by system bars or a sheet. The camera centres on the
     * rest of the view, and the attribution and notices stay inside it.
     */
    setInsets(next: Insets) {
      const changed = (Object.keys(next) as (keyof Insets)[]).some(
        (edge) => next[edge] !== insets[edge],
      );
      insets = next;
      placeCorners();
      if (!changed) return;
      if (map.isMoving()) paddingPending = true;
      else applyPadding();
    },
    /** A shot moves the camera frame by frame; it starts and ends one movement. */
    reportShot(moving: boolean) {
      if (moving === shotMoving || disposed) return;
      shotMoving = moving;
      reason = 'api';
      emitCamera(moving ? 'cameraMoveStarted' : 'cameraMoveEnded');
    },
    /** Places the attribution in `corner`; `refresh` replaces it in place, as its entries change. */
    setAttribution(corner: Corner, create: () => AttributionControl, refresh = false) {
      if (attribution?.corner === corner && !refresh) return;
      if (attribution) map.removeControl(attribution.control);
      attribution = {control: create(), corner};
      map.addControl(attribution.control, corner);
    },
    dispose() {
      disposed = true;
      if (pendingFrame !== undefined) cancelFrame(pendingFrame);
      for (const movement of [...movements.values()]) movement.settle('cancelled');
    },
  };

  function placeCorners() {
    const container = map.getContainer();
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      const element = container.querySelector<HTMLElement>(`.maplibregl-ctrl-${corner}`);
      if (!element) continue;
      const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'right'];
      element.style[vertical] = `${insets[vertical]}px`;
      element.style[horizontal] = `${insets[horizontal]}px`;
    }
  }
}
export type CameraController = ReturnType<typeof createCameraController>;
