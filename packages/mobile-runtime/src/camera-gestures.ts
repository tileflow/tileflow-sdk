import type {Map as MapLibreMap, MapMouseEvent} from 'maplibre-gl';
import type {Gestures} from './camera-contract';
import type {Producer} from './events';
import type {EventName} from './protocol';

type GestureMap = Pick<
  MapLibreMap,
  | 'on'
  | 'easeTo'
  | 'getZoom'
  | 'unproject'
  | 'getContainer'
  | 'getCanvasContainer'
  | 'dragPan'
  | 'scrollZoom'
  | 'doubleClickZoom'
  | 'touchZoomRotate'
  | 'dragRotate'
  | 'touchPitch'
  | 'keyboard'
  | 'cooperativeGestures'
>;
/** How long a press must hold still before it is a long press, as on iOS and Android. */
const longPressMs = 500;
/** How far a pointer may move, in CSS pixels, before it is no longer a press or a tap. */
const slop = 10;
const doubleTapMs = 300;
const doubleTapDistance = 30;

/**
 * Gestures a person makes on the map: which of them move the camera, when each starts and ends,
 * long presses, and how far a double tap zooms.
 */
export function createGestureController(
  map: GestureMap,
  output: {
    emit: (event: EventName, produce: Producer) => void;
    signal: AbortSignal;
    /** The annotations under a point, which taps and long presses report. */
    annotations?: (point: {x: number; y: number}) => unknown[];
    /** Whether an annotation drag holds the pointer, so a still finger is not a long press. */
    dragging?: () => boolean;
  },
) {
  const {signal} = output;
  let gestures: Gestures | undefined;
  const active = new Set<string>();
  for (const [start, end, gesture] of [
    ['dragstart', 'dragend', 'pan'],
    ['zoomstart', 'zoomend', 'zoom'],
    ['rotatestart', 'rotateend', 'rotate'],
    ['pitchstart', 'pitchend', 'pitch'],
  ] as const) {
    // Only movements a person makes carry the input event that caused them.
    map.on(start, (event: {originalEvent?: unknown}) => {
      if (!event.originalEvent || active.has(gesture)) return;
      active.add(gesture);
      output.emit('gestureStarted', () => ({gesture}));
    });
    map.on(end, () => {
      if (active.delete(gesture)) output.emit('gestureEnded', () => ({gesture}));
    });
  }

  // A press that holds still is a long press; the click that follows it is not a tap.
  const container = map.getCanvasContainer();
  let press: {x: number; y: number; timer: ReturnType<typeof setTimeout>} | undefined;
  let swallowClickUntil = 0;
  const release = () => {
    if (press) clearTimeout(press.timer);
    press = undefined;
  };
  container.addEventListener(
    'pointerdown',
    (event) => {
      release();
      if (!event.isPrimary) return;
      const x = event.clientX;
      const y = event.clientY;
      press = {
        x,
        y,
        timer: setTimeout(() => {
          press = undefined;
          if (output.dragging?.()) return;
          const bounds = container.getBoundingClientRect();
          const point = {x: x - bounds.left, y: y - bounds.top};
          const coordinate = map.unproject([point.x, point.y]).wrap();
          swallowClickUntil = performance.now() + 1000;
          const annotations = output.annotations?.(point) ?? [];
          output.emit('longPress', () => ({
            coordinate: {longitude: coordinate.lng, latitude: coordinate.lat},
            point,
            ...(annotations.length ? {annotations} : {}),
          }));
        }, longPressMs),
      };
    },
    {signal},
  );
  container.addEventListener(
    'pointermove',
    (event) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > slop) release();
    },
    {signal},
  );
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'])
    container.addEventListener(type, release, {signal});
  // Capturing on the map's own container runs before MapLibre and the map's interactions.
  map.getContainer().addEventListener(
    'click',
    (event) => {
      if (performance.now() >= swallowClickUntil) return;
      swallowClickUntil = 0;
      event.stopPropagation();
    },
    {capture: true, signal},
  );

  // MapLibre zooms one level per double tap; another amount needs its own recognizer.
  let lastTap: {time: number; x: number; y: number} | undefined;
  map.on('click', (event: MapMouseEvent) => {
    if (!gestures?.zoom || !gestures.doubleTapZoom || gestures.doubleTapZoomDelta === 1) return;
    const now = performance.now();
    const {x, y} = event.point;
    if (
      lastTap &&
      now - lastTap.time <= doubleTapMs &&
      Math.hypot(x - lastTap.x, y - lastTap.y) <= doubleTapDistance
    ) {
      lastTap = undefined;
      map.easeTo(
        {zoom: map.getZoom() + gestures.doubleTapZoomDelta, around: event.lngLat, duration: 300},
        {originalEvent: event.originalEvent},
      );
      return;
    }
    lastTap = {time: now, x, y};
  });

  return {
    apply(next: Gestures) {
      gestures = next;
      const {pan, zoom, rotate, pitch, doubleTapZoom, doubleTapZoomDelta, cooperative} = next;
      const toggle = (handler: {enable(): void; disable(): void}, enabled: boolean) => {
        if (enabled) handler.enable();
        else handler.disable();
      };
      toggle(map.dragPan, pan);
      toggle(map.scrollZoom, zoom);
      toggle(map.doubleClickZoom, zoom && doubleTapZoom && doubleTapZoomDelta === 1);
      toggle(map.touchZoomRotate, zoom);
      if (zoom) {
        if (rotate) map.touchZoomRotate.enableRotation();
        else map.touchZoomRotate.disableRotation();
      }
      toggle(map.dragRotate, rotate);
      toggle(map.touchPitch, pitch);
      toggle(map.keyboard, pan || zoom || rotate || pitch);
      toggle(map.cooperativeGestures, cooperative);
    },
  };
}
