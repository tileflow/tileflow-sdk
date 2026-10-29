import type {ExpressionSpecification, GeoJSONSource, Map as MapLibreMap} from 'maplibre-gl';
import type {Clock, Producer} from './events';
import type {
  Fix,
  FollowMode,
  FollowRequest,
  LocationOptions,
  LocationUpdate,
} from './location-contract';
import type {EventName} from './protocol';

export type LocationMap = Pick<
  MapLibreMap,
  | 'on'
  | 'off'
  | 'jumpTo'
  | 'getCenter'
  | 'getZoom'
  | 'getBearing'
  | 'getPitch'
  | 'isStyleLoaded'
  | 'addSource'
  | 'getSource'
  | 'removeSource'
  | 'addLayer'
  | 'getLayer'
  | 'removeLayer'
  | 'moveLayer'
  | 'getLayersOrder'
  | 'addImage'
  | 'hasImage'
  | 'getCanvasContainer'
>;

/** Event data that marks a camera frame of location following, reported as one movement. */
export const locationFrame = {tileflowReason: 'location', tileflowLocation: true} as const;

/** Whether a MapLibre movement event is a frame of location following. */
export function isLocationFrame(event: unknown): boolean {
  return (event as {tileflowLocation?: unknown}).tileflowLocation === true;
}

export const locationSource = '__tileflow_location';
/** The puck's layers, bottom to top. They stay above every other layer. */
export const locationLayers = [
  `${locationSource}_accuracy`,
  `${locationSource}_bearing`,
  `${locationSource}_dot`,
] as const;
export const bearingImage = `${locationSource}_bearing`;

/** The longest a fix takes to glide to the next one; a slower provider is followed this fast. */
export const maximumGlideMs = 1000;
/** How long the direction indicator takes to turn to a new heading. */
export const headingGlideMs = 250;
/** Earth's circumference at the equator, in metres, as MapLibre's projection uses. */
const circumference = 40_075_016.686;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
/** The signed shortest turn from `from` to `to`, in degrees, in (-180, 180]. */
export function shortestTurn(from: number, to: number): number {
  const turn = (((to - from) % 360) + 360) % 360;
  return turn > 180 ? turn - 360 : turn;
}
/** An angle between two others along the shorter way round, in [0, 360). */
export function interpolateAngle(from: number, to: number, t: number): number {
  return (((from + shortestTurn(from, to) * t) % 360) + 360) % 360;
}
const mercatorY = (latitude: number) =>
  Math.log(Math.tan(Math.PI / 4 + (clamp(latitude, -85.05, 85.05) * Math.PI) / 360));
const latitudeOf = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** A point between two others, along the straight line on the map, across the antimeridian. */
export function interpolatePosition(
  from: {longitude: number; latitude: number},
  to: {longitude: number; latitude: number},
  t: number,
): {longitude: number; latitude: number} {
  if (t <= 0) return {longitude: from.longitude, latitude: from.latitude};
  if (t >= 1) return {longitude: to.longitude, latitude: to.latitude};
  const longitude = from.longitude + shortestTurn(from.longitude, to.longitude) * t;
  return {
    longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
    latitude: latitudeOf(mercatorY(from.latitude) * (1 - t) + mercatorY(to.latitude) * t),
  };
}

type Shown = {longitude: number; latitude: number; accuracy?: number; course?: number};

/** A fix between two others: position, accuracy and course glide together. */
export function interpolateFix(from: Shown, to: Shown, t: number): Shown {
  const position = interpolatePosition(from, to, t);
  const accuracy =
    from.accuracy === undefined || to.accuracy === undefined
      ? to.accuracy
      : from.accuracy + (to.accuracy - from.accuracy) * t;
  const course =
    from.course === undefined || to.course === undefined
      ? to.course
      : interpolateAngle(from.course, to.course, t);
  return {
    ...position,
    ...(accuracy === undefined ? {} : {accuracy}),
    ...(course === undefined ? {} : {course}),
  };
}

/**
 * The accuracy circle's radius in pixels at zoom 0. MapLibre draws the world 512 pixels wide at
 * zoom 0, so the radius doubles with each zoom level.
 */
export function accuracyRadiusAtZoom0(meters: number, latitude: number): number {
  return (
    (meters * 512) / (circumference * Math.cos((clamp(latitude, -85.05, 85.05) * Math.PI) / 180))
  );
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const blue = '#1a73e8';
const grey = '#8e8e93';

/** A cone that points north from the centre, for the puck's direction indicator. */
export function drawBearingImage():
  {width: number; height: number; data: Uint8ClampedArray} | undefined {
  if (typeof document === 'undefined') return undefined;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  const middle = size / 2;
  const gradient = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
  gradient.addColorStop(0, 'rgba(26, 115, 232, 0.7)');
  gradient.addColorStop(1, 'rgba(26, 115, 232, 0)');
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(middle, middle);
  context.arc(middle, middle, middle, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
  context.closePath();
  context.fill();
  const {data} = context.getImageData(0, 0, size, size);
  return {width: size, height: size, data};
}

type Transition = {
  started: number;
  duration: number;
  from: {longitude: number; latitude: number; zoom: number; bearing: number; pitch: number};
  minimumZoom?: number;
  pitch?: number;
  bearing?: number;
};

/**
 * The person's location on the map: a puck drawn by the renderer, which glides between fixes and
 * shows the accuracy, the heading or course and whether the fix is stale, and the follow modes that
 * keep the camera on it.
 *
 * Following moves the camera frame by frame with the puck and reports one movement per glide, with
 * the reason `location`. A person's gesture, or a camera movement the application asks for, ends
 * following and reports `followModeChanged`. While a finger rests on the map the camera holds
 * still, so the gesture it starts is never cut short.
 */
export function createLocationController(
  map: LocationMap,
  output: {
    emit: (event: EventName, produce: Producer) => void;
    /** The camera starts or stops moving to follow the location. */
    motion: (moving: boolean) => void;
    clock: Clock;
    frame?: (callback: () => void) => unknown;
    cancelFrame?: (handle: unknown) => void;
    /** The direction indicator's image; none leaves the indicator out. */
    bearingImage?: () => ReturnType<typeof drawBearingImage>;
  },
) {
  const {clock} = output;
  const frame = output.frame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = output.cancelFrame ?? ((handle) => cancelAnimationFrame(handle as number));
  let options: LocationOptions = {
    enabled: false,
    bearing: 'none',
    accuracy: true,
    staleAfterMs: 30_000,
  };
  /** The glide in progress: from what was shown to the latest fix. */
  let glide: {from: Shown; to: Shown; started: number; duration: number} | undefined;
  let received: number | undefined;
  let heading: {from: number; to: number; started: number} | undefined;
  let stale = false;
  let staleTimer: unknown;
  let mode: FollowMode = 'none';
  let request: FollowRequest | undefined;
  let transition: Transition | undefined;
  let pointers = 0;
  let moving = false;
  let pending: unknown;
  let drawn: string | undefined;
  let disposed = false;
  const container = map.getCanvasContainer();

  const position = (now: number): Shown | undefined => {
    if (!glide) return undefined;
    const t = glide.duration > 0 ? clamp((now - glide.started) / glide.duration, 0, 1) : 1;
    return t >= 1 ? glide.to : interpolateFix(glide.from, glide.to, t);
  };
  const direction = (now: number): number | undefined => {
    if (!heading) return undefined;
    const t = clamp((now - heading.started) / headingGlideMs, 0, 1);
    return t >= 1 ? heading.to : interpolateAngle(heading.from, heading.to, t);
  };
  /** What the puck's direction indicator shows, if anything. */
  const indicator = (now: number, shown: Shown | undefined) =>
    options.bearing === 'heading'
      ? direction(now)
      : options.bearing === 'course'
        ? shown?.course
        : undefined;
  const gliding = (now: number) =>
    (glide !== undefined && now - glide.started < glide.duration) ||
    (heading !== undefined && now - heading.started < headingGlideMs) ||
    (transition !== undefined && now - transition.started < transition.duration);

  const installed = () => map.getSource(locationSource) !== undefined;
  const data = (now: number) => {
    const shown = position(now);
    if (!shown) return {type: 'FeatureCollection' as const, features: []};
    const bearing = indicator(now, shown);
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {type: 'Point' as const, coordinates: [shown.longitude, shown.latitude]},
          properties: {
            radius:
              options.accuracy && shown.accuracy
                ? accuracyRadiusAtZoom0(shown.accuracy, shown.latitude)
                : 0,
            stale,
            ...(bearing === undefined ? {} : {bearing}),
          },
        },
      ],
    };
  };
  const draw = (now: number) => {
    if (!options.enabled || !installed()) return;
    const next = data(now);
    const key = JSON.stringify(next);
    if (key === drawn) return;
    drawn = key;
    (map.getSource(locationSource) as GeoJSONSource).setData(next);
  };
  const colour = ['case', ['get', 'stale'], grey, blue] as ExpressionSpecification;
  /** Adds the puck to the style, which loses it when a theme replaces the style. */
  const install = () => {
    if (disposed || !options.enabled || !map.isStyleLoaded()) return;
    if (!map.hasImage(bearingImage)) {
      const image = (output.bearingImage ?? drawBearingImage)();
      if (image) map.addImage(bearingImage, image, {pixelRatio: 2});
    }
    if (!installed()) {
      drawn = undefined;
      map.addSource(locationSource, {type: 'geojson', data: data(clock.now())});
      drawn = JSON.stringify(data(clock.now()));
    }
    const [accuracy, bearing, dot] = locationLayers;
    if (!map.getLayer(accuracy))
      map.addLayer({
        id: accuracy,
        type: 'circle',
        source: locationSource,
        filter: ['>', ['get', 'radius'], 0],
        paint: {
          // Metres become pixels: the radius doubles with each zoom level.
          'circle-radius': [
            'interpolate',
            ['exponential', 2],
            ['zoom'],
            0,
            ['get', 'radius'],
            24,
            ['*', ['get', 'radius'], 2 ** 24],
          ],
          'circle-color': colour,
          'circle-opacity': 0.12,
          'circle-stroke-color': colour,
          'circle-stroke-opacity': 0.3,
          'circle-stroke-width': 1,
          'circle-pitch-alignment': 'map',
          'circle-pitch-scale': 'map',
        },
      } as Parameters<MapLibreMap['addLayer']>[0]);
    if (!map.getLayer(bearing))
      map.addLayer({
        id: bearing,
        type: 'symbol',
        source: locationSource,
        filter: ['has', 'bearing'],
        layout: {
          'icon-image': bearingImage,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {'icon-opacity': ['case', ['get', 'stale'], 0.4, 1]},
      } as Parameters<MapLibreMap['addLayer']>[0]);
    if (!map.getLayer(dot))
      map.addLayer({
        id: dot,
        type: 'circle',
        source: locationSource,
        paint: {
          'circle-radius': 7,
          'circle-color': colour,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
          'circle-pitch-alignment': 'viewport',
        },
      } as Parameters<MapLibreMap['addLayer']>[0]);
    raise();
  };
  /** Keeps the puck above layers that arrive later, such as application content and 3D. */
  const raise = () => {
    const order = map.getLayersOrder();
    const top = order.slice(-locationLayers.length);
    if (locationLayers.every((id, index) => top[index] === id)) return;
    for (const id of locationLayers) if (map.getLayer(id)) map.moveLayer(id);
  };
  const uninstall = () => {
    for (const id of [...locationLayers].reverse()) if (map.getLayer(id)) map.removeLayer(id);
    if (installed()) map.removeSource(locationSource);
    drawn = undefined;
  };

  const settle = () => {
    if (!moving) return;
    moving = false;
    output.motion(false);
  };
  /** Moves the camera to where following puts it now. */
  const followFrame = (now: number) => {
    if (mode === 'none' || pointers > 0) return;
    const shown = position(now);
    if (!shown) return;
    const bearing =
      mode === 'heading'
        ? direction(now)
        : mode === 'course'
          ? shown.course
          : // The position mode turns only while it starts, for example to north.
            transition?.bearing;
    let target: {
      center: [number, number];
      zoom?: number;
      bearing?: number;
      pitch?: number;
    } = {center: [shown.longitude, shown.latitude], ...(bearing === undefined ? {} : {bearing})};
    if (transition) {
      const t =
        transition.duration > 0 ? clamp((now - transition.started) / transition.duration, 0, 1) : 1;
      const eased = easeInOut(t);
      const {from} = transition;
      const center = interpolatePosition(from, shown, eased);
      const zoom = Math.max(from.zoom, transition.minimumZoom ?? from.zoom);
      target = {
        center: [center.longitude, center.latitude],
        zoom: from.zoom + (zoom - from.zoom) * eased,
        bearing: interpolateAngle(from.bearing, bearing ?? from.bearing, eased),
        pitch: from.pitch + ((transition.pitch ?? from.pitch) - from.pitch) * eased,
      };
      if (t >= 1) transition = undefined;
    }
    if (!moving) {
      moving = true;
      output.motion(true);
    }
    map.jumpTo(target, locationFrame);
  };
  const tick = () => {
    pending = undefined;
    if (disposed) return;
    const now = clock.now();
    draw(now);
    followFrame(now);
    if (gliding(now)) schedule();
    else settle();
  };
  const schedule = () => {
    if (pending === undefined && !disposed) pending = frame(tick);
  };

  /** Starts the camera's way to the location; a later fix restarts it if none is known yet. */
  const startTransition = () => {
    if (!request || mode === 'none' || !glide) return;
    const center = map.getCenter().wrap();
    transition = {
      started: clock.now(),
      duration: request.duration,
      from: {
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
      ...(request.minimumZoom === undefined ? {} : {minimumZoom: request.minimumZoom}),
      ...(request.pitch === undefined ? {} : {pitch: request.pitch}),
      ...(request.bearing === undefined || mode !== 'position' ? {} : {bearing: request.bearing}),
    };
    schedule();
  };
  const markStale = () => {
    staleTimer = undefined;
    stale = true;
    draw(clock.now());
  };

  // A finger on the map holds the camera, so a gesture can start; a gesture then ends following.
  const press = () => {
    pointers += 1;
  };
  const release = () => {
    pointers = Math.max(0, pointers - 1);
    if (pointers === 0 && mode !== 'none') schedule();
  };
  const wheel = () => stopFollowing('gesture');
  container.addEventListener('pointerdown', press);
  container.addEventListener('pointerup', release);
  container.addEventListener('pointercancel', release);
  container.addEventListener('wheel', wheel, {passive: true});
  const onStyle = () => {
    install();
    draw(clock.now());
  };
  map.on('style.load', onStyle);
  map.on('idle', onStyle);

  function stopFollowing(reason: 'api' | 'gesture') {
    if (mode === 'none') return;
    const revision = request?.revision ?? 0;
    mode = 'none';
    request = undefined;
    transition = undefined;
    settle();
    output.emit('followModeChanged', () => ({mode: 'none', reason, revision}));
  }

  return {
    get mode() {
      return mode;
    },
    setOptions(next: LocationOptions) {
      const previous = options;
      options = next;
      if (!next.enabled) {
        uninstall();
        return;
      }
      if (previous.staleAfterMs !== next.staleAfterMs && received !== undefined && !stale) {
        // The fix's age is measured again against the new limit.
        if (staleTimer !== undefined) clock.cancel(staleTimer);
        const remaining = next.staleAfterMs - (clock.now() - received);
        if (remaining <= 0) stale = true;
        else staleTimer = clock.schedule(markStale, remaining);
      }
      install();
      draw(clock.now());
    },
    update(update: LocationUpdate) {
      const now = clock.now();
      if (update.location === null) {
        glide = undefined;
        received = undefined;
        if (staleTimer !== undefined) clock.cancel(staleTimer);
        staleTimer = undefined;
        stale = false;
      } else if (update.location) {
        const {age, ...fix}: Fix = update.location;
        const to: Shown = fix;
        const shown = position(now);
        // A fix glides from what is shown for as long as the provider took to send it.
        const duration =
          shown && received !== undefined ? clamp(now - received, 0, maximumGlideMs) : 0;
        const first = !glide;
        glide = {from: shown ?? to, to, started: now, duration};
        received = now - age;
        stale = false;
        if (staleTimer !== undefined) clock.cancel(staleTimer);
        const remaining = options.staleAfterMs - age;
        if (remaining <= 0) stale = true;
        else staleTimer = clock.schedule(markStale, remaining);
        if (first && mode !== 'none' && !transition) startTransition();
      }
      if (update.heading === null) heading = undefined;
      else if (update.heading) {
        const from = direction(now) ?? update.heading.direction;
        heading = {from, to: update.heading.direction, started: now};
      }
      draw(now);
      schedule();
    },
    /** Starts, changes or ends following. Nothing is reported for the host's own requests. */
    follow(next: FollowRequest) {
      mode = next.mode;
      if (mode === 'none') {
        request = undefined;
        transition = undefined;
        settle();
        return;
      }
      request = next;
      startTransition();
    },
    /** Ends following because a person or the application moved the camera. */
    stopFollowing,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pending !== undefined) cancelFrame(pending);
      if (staleTimer !== undefined) clock.cancel(staleTimer);
      container.removeEventListener('pointerdown', press);
      container.removeEventListener('pointerup', release);
      container.removeEventListener('pointercancel', release);
      container.removeEventListener('wheel', wheel);
      map.off('style.load', onStyle);
      map.off('idle', onStyle);
      settle();
    },
  };
}
export type LocationController = ReturnType<typeof createLocationController>;
