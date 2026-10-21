// The 3D scene Tileflow's custom WebGL layers share on one map (3D buildings, 3D trees): the sun's
// light, one shadow map that every layer draws its depth into and reads its shade from, the frame
// its coordinates are in, and which layer darkens the flat map under the shadows. Layers find the
// scene by their map, as they share tile downloads by URL, so an application wires nothing: trees
// cast shadows on buildings and take theirs because both draw into the same map.
import {type TileflowSun} from './sun';

/** Tile units across a tile, as Tileflow's 3D layers lay out their meshes. */
export const tileflowSceneExtent = 8192;

// Limit the projected shadow direction to 15°; the actual light keeps its authored altitude.
export const tileflowSceneShadowFloor = 15;

/** The light a scene is drawn in, from a sun, in linear colour. */
export type TileflowSceneLight = Readonly<{
  /** Towards the sun: x east, y north, z up. */
  direction: readonly number[];
  sunLight: number[];
  skyLight: number[];
  /** The colour the flat map is multiplied by in full shade. */
  groundShadow: number[];
  /** Towards the sun, never lower than the shadow floor. */
  shadowDirection: number[];
  /** How dark shadows fall now, from 0 (none) to 1. */
  strength: number;
  /** 0 by day, 1 at night. */
  night: number;
}>;

/** The light of a sun for the scene's layers; `shadows: false` keeps every shadow off. */
export function tileflowSceneLight(sun: TileflowSun, shadows = true): TileflowSceneLight {
  // Match the gamma-2.2 radiance used by the directional/ambient shadow receiver.
  const linear = (value: number) => value ** 2.2;
  const sunLight = sun.rgb.map((channel) => linear(channel) * sun.intensity);
  const skyLight = sun.ambient.rgb.map((channel) => linear(channel) * sun.ambient.intensity);
  const up = sun.direction[2];
  const groundShadow = skyLight.map((sky, channel) => {
    const lit = sky + sunLight[channel]! * Math.max(0, up);
    return lit > 1e-5 ? (sky / lit) ** (1 / 2.2) : 1;
  });
  const floor = (Math.max(tileflowSceneShadowFloor, sun.altitude) * Math.PI) / 180;
  const azimuth = (sun.azimuth * Math.PI) / 180;
  const shadowDirection = [
    Math.sin(azimuth) * Math.cos(floor),
    Math.cos(azimuth) * Math.cos(floor),
    Math.sin(floor),
  ];
  // Sun intensity already fades at the horizon in resolveTileflowSun. Do not attenuate
  // the authored shadow intensity again: radiance controls how much light shade removes.
  const strength = shadows && sun.intensity > 0 ? Math.min(1, sun.shadowIntensity) : 0;
  const night = Math.min(1, Math.max(0, (0.14 - sun.brightness) / 0.09));
  return {
    direction: sun.direction,
    sunLight,
    skyLight,
    groundShadow,
    shadowDirection,
    strength,
    night,
  };
}

/** What a layer casts into the scene's shadow map. */
export type TileflowSceneCaster = {
  /**
   * The tiles it casts from, at its zoom, and its tallest point in metres as shown now; undefined
   * while it casts nothing.
   */
  bounds():
    {zoom: number; tiles: readonly [number, number, number, number]; tallest: number} | undefined;
  /** Changes whenever the depth it draws would change. */
  key(): string;
  /** Draws its depth from the sun, in the scene's frame. */
  drawDepth(context: WebGL2RenderingContext, frame: TileflowSceneFrame): void;
  /** Which layer darkens the flat map when several can: the lowest. */
  readonly groundOrder: number;
};

/** The frame the scene's shadow coordinates are in, for one drawing of the shadow map. */
export type TileflowSceneFrame = Readonly<{
  zoom: number;
  /** A tile corner at `zoom`, the origin of the scene's metres. */
  origin: readonly [number, number];
  /** Metres per tile unit at the scene's latitude. */
  metres: number;
  /** The sun's view: clip space from the scene's metres (x east, y north, z up). */
  light: Readonly<{matrix: Float32Array; depth: number; extent: number}>;
  /** A tile's corner from the origin, in tile units, for a tile at `zoom` (the scene's by default). */
  offsetOf(tile: {x: number; y: number}, zoom?: number): [number, number];
  /** The tiles the casters stand on, at the scene's zoom, and their tallest point in metres. */
  tiles: readonly [number, number, number, number];
  tallest: number;
}>;

type ShadowTarget = {
  context: WebGL2RenderingContext;
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  size: number;
  failed: boolean;
};

export type TileflowScene3D = {
  /** Adds a caster; the returned function takes it out again. */
  register(caster: TileflowSceneCaster): () => void;
  /**
   * Draws the shadow map when the light or any caster changed. Every layer calls it from its
   * prerender; after the first in a frame it costs a comparison.
   */
  prepare(context: WebGL2RenderingContext, light: TileflowSceneLight, metres: number): void;
  /** The frame of the shadow map drawn last, or undefined when no shadow falls. */
  frame(): TileflowSceneFrame | undefined;
  /** Binds the shadow map and its uniforms to a program that reads it, on texture unit 0. */
  bindShadow(
    context: WebGL2RenderingContext,
    uniforms: Record<string, WebGLUniformLocation | null>,
    strength: number,
  ): void;
  /** Whether this caster darkens the flat map, as the first in `groundOrder` of the registered. */
  drawsGround(caster: TileflowSceneCaster): boolean;
  /** Lets go of the shadow map once no caster is left. */
  release(context: WebGL2RenderingContext): void;
};

const scenes = new WeakMap<object, TileflowScene3D>();

/** The 3D scene of a map, made on first use. */
export function tileflowScene3D(map: object): TileflowScene3D {
  let scene = scenes.get(map);
  if (!scene) {
    scene = createScene(map);
    scenes.set(map, scene);
  }
  return scene;
}

function createScene(map: object): TileflowScene3D {
  const casters = new Set<TileflowSceneCaster>();
  let target: ShadowTarget | undefined;
  let key: string | undefined;
  let frame: TileflowSceneFrame | undefined;
  // The light's view fitted last and the frame it is in, kept by a moving camera.
  let fitted: {frame: string; fit: ShadowFit} | undefined;

  function ensureTarget(context: WebGL2RenderingContext): ShadowTarget {
    if (target && target.context === context) return target;
    const size = Math.min(4096, context.getParameter(context.MAX_TEXTURE_SIZE) as number);
    const texture = context.createTexture()!;
    context.bindTexture(context.TEXTURE_2D, texture);
    context.texStorage2D(context.TEXTURE_2D, 1, context.DEPTH_COMPONENT16, size, size);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(
      context.TEXTURE_2D,
      context.TEXTURE_COMPARE_MODE,
      context.COMPARE_REF_TO_TEXTURE,
    );
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_COMPARE_FUNC, context.LEQUAL);
    context.bindTexture(context.TEXTURE_2D, null);
    const framebuffer = context.createFramebuffer()!;
    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(
      context.FRAMEBUFFER,
      context.DEPTH_ATTACHMENT,
      context.TEXTURE_2D,
      texture,
      0,
    );
    context.drawBuffers([context.NONE]);
    context.readBuffer(context.NONE);
    const complete =
      context.checkFramebufferStatus(context.FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE;
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    target = {context, texture, framebuffer, size, failed: !complete};
    key = undefined;
    return target;
  }

  function prepare(
    context: WebGL2RenderingContext,
    light: TileflowSceneLight,
    metres: number,
  ): void {
    // Do not allocate a full depth texture for a scene with no solar shadows.
    if (light.strength <= 0) return;
    const shadow = ensureTarget(context);
    if (shadow.failed) return;
    const casting: {
      caster: TileflowSceneCaster;
      bounds: NonNullable<ReturnType<TileflowSceneCaster['bounds']>>;
    }[] = [];
    for (const caster of casters) {
      const bounds = caster.bounds();
      if (bounds) casting.push({caster, bounds});
    }
    if (casting.length === 0) {
      frame = undefined;
      key = undefined;
      return;
    }
    // The scene's zoom is the deepest its casters read; shallower tiles are scaled to it.
    const zoom = Math.max(...casting.map(({bounds}) => bounds.zoom));
    let [left, top, right, bottom, tallest] = [Infinity, Infinity, -Infinity, -Infinity, 0];
    for (const {bounds} of casting) {
      const factor = 2 ** (zoom - bounds.zoom);
      left = Math.min(left, bounds.tiles[0] * factor);
      top = Math.min(top, bounds.tiles[1] * factor);
      right = Math.max(right, (bounds.tiles[2] + 1) * factor - 1);
      bottom = Math.max(bottom, (bounds.tiles[3] + 1) * factor - 1);
      tallest = Math.max(tallest, bounds.tallest);
    }
    const origin = [left, top] as const;
    const scale = metres;
    const unit = tileflowSceneExtent * scale;
    // While the camera moves, the light's view takes a margin round the visible area and is kept
    // while it still covers it, so the depth pass is not drawn again on every frame. MapLibre draws
    // a frame once the camera stops, which fits the light's view to the visible area again.
    const moving = (map as {isMoving?(): boolean}).isMoving?.() === true;
    const fitFrame = [...light.shadowDirection, zoom, left, top, scale, shadow.size].join();
    const lightView = tileflowSunLightMatrix(
      light.shadowDirection,
      {
        min: [0, -(bottom + 1 - top) * unit, 0],
        max: [(right + 1 - left) * unit, 0, tallest],
      },
      {
        receivers: viewportReceivers(map, zoom, origin, scale, tallest),
        resolution: shadow.size,
        origin: [origin[0] * unit, -origin[1] * unit, 0],
        gridScale: unit * 2 ** zoom,
        ...(moving
          ? {
              margin: movingShadowMargin,
              ...(fitted?.frame === fitFrame ? {previous: fitted.fit} : {}),
            }
          : {}),
      },
    );
    fitted = {frame: fitFrame, fit: lightView.fit};
    const next = [
      ...light.shadowDirection.map((value) => value.toFixed(5)),
      zoom,
      left,
      top,
      right,
      bottom,
      tallest.toFixed(2),
      scale,
      ...lightView.matrix,
      ...casting.map(({caster}) => caster.key()),
    ].join();
    if (next === key && frame) return;
    const offsetOf = (tile: {x: number; y: number}, tileZoom = zoom): [number, number] => {
      const factor = 2 ** (zoom - tileZoom);
      return [
        (tile.x * factor - origin[0]) * tileflowSceneExtent,
        (tile.y * factor - origin[1]) * tileflowSceneExtent,
      ];
    };
    frame = {
      zoom,
      origin,
      metres: scale,
      light: lightView,
      offsetOf,
      tiles: [left, top, right, bottom],
      tallest,
    };
    key = next;
    context.bindFramebuffer(context.FRAMEBUFFER, shadow.framebuffer);
    context.viewport(0, 0, shadow.size, shadow.size);
    context.disable(context.BLEND);
    context.disable(context.CULL_FACE);
    context.disable(context.STENCIL_TEST);
    context.disable(context.SCISSOR_TEST);
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LESS);
    context.depthMask(true);
    context.depthRange(0, 1);
    context.clearDepth(1);
    context.clear(context.DEPTH_BUFFER_BIT);
    context.enable(context.POLYGON_OFFSET_FILL);
    context.polygonOffset(1.5, 4);
    try {
      for (const {caster} of casting) caster.drawDepth(context, frame);
    } finally {
      context.bindVertexArray(null);
      context.disable(context.POLYGON_OFFSET_FILL);
      context.bindFramebuffer(context.FRAMEBUFFER, null);
      context.viewport(0, 0, context.drawingBufferWidth, context.drawingBufferHeight);
    }
  }

  return {
    register(caster) {
      casters.add(caster);
      key = undefined;
      return () => {
        casters.delete(caster);
        key = undefined;
      };
    },
    prepare(context, light, metres) {
      try {
        prepare(context, light, metres);
      } catch {
        if (target) target.failed = true;
        frame = undefined;
      }
    },
    frame: () => (target && !target.failed ? frame : undefined),
    bindShadow(context, uniforms, strength) {
      const on = strength > 0 && frame && target && !target.failed;
      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, target?.texture ?? null);
      context.uniform1i(uniforms.u_shadow_map ?? null, 0);
      context.uniform1f(uniforms.u_shadow ?? null, on ? strength : 0);
      if (!on || !frame || !target) return;
      context.uniformMatrix4fv(uniforms.u_light_matrix ?? null, false, frame.light.matrix);
      context.uniform1f(uniforms.u_depth_unit ?? null, 1 / frame.light.depth);
      context.uniform1f(
        uniforms.u_normal_offset ?? null,
        Math.min(0.15, Math.max(0.02, (frame.light.extent / target.size) * 0.5)),
      );
    },
    drawsGround(caster) {
      let first: TileflowSceneCaster | undefined;
      for (const entry of casters) {
        if (!entry.bounds()) continue;
        if (!first || entry.groundOrder < first.groundOrder) first = entry;
      }
      return first === caster;
    },
    release(context) {
      if (casters.size > 0 || !target || target.context !== context) return;
      context.deleteFramebuffer(target.framebuffer);
      context.deleteTexture(target.texture);
      target = undefined;
      frame = undefined;
      key = undefined;
      fitted = undefined;
    },
  };
}

// The share of the visible span a moving camera's light view adds on each side.
const movingShadowMargin = 0.25;

type ShadowPoint = readonly number[];
type ShadowBox = Readonly<{min: ShadowPoint; max: ShadowPoint}>;
type ShadowRange = readonly [number, number];
/** The light-space ranges a light view covers: across and up the shadow map, and along the light. */
type ShadowFit = Readonly<{right: ShadowRange; up: ShadowRange; depth: ShadowRange}>;
type ShadowView = Readonly<{
  /** Visible receiver points, in the caster box's metre frame. All casters still draw. */
  receivers?: readonly ShadowPoint[];
  /** Snap to world-aligned texels; omit for an unsnapped mathematical projection. */
  resolution?: number;
  origin?: ShadowPoint;
  /** Metres per fixed world unit; keeps texel quantization independent of latitude scale. */
  gridScale?: number;
  /** A share of the focused span added on each side, so a moving view stays inside the fit. */
  margin?: number;
  /**
   * A fit in the same frame and light, kept on each axis while it covers the view and is at most
   * half again as wide as a new fit would be.
   */
  previous?: ShadowFit;
}>;

/**
 * Ground and raised corners of the visible frustum, using public MapLibre camera methods only.
 * An unsafe horizon, terrain or unavailable camera API keeps the conservative full-scene fit.
 */
function viewportReceivers(
  input: object,
  zoom: number,
  origin: readonly [number, number],
  metres: number,
  tallest: number,
): ShadowPoint[] | undefined {
  const map = input as {
    getCanvas?(): {clientWidth: number; clientHeight: number};
    getCenter?(): {lng: number; lat: number};
    getBearing?(): number;
    getPitch?(): number;
    getZoom?(): number;
    getVerticalFieldOfView?(): number;
    getCenterElevation?(): number;
    getTerrain?(): unknown;
    project?(point: {lng: number; lat: number}): {x: number; y: number};
    unproject?(point: [number, number]): {lng: number; lat: number};
  };
  try {
    if (
      typeof map.getCanvas !== 'function' ||
      typeof map.getCenter !== 'function' ||
      typeof map.getBearing !== 'function' ||
      typeof map.getPitch !== 'function' ||
      typeof map.getZoom !== 'function' ||
      typeof map.getVerticalFieldOfView !== 'function' ||
      typeof map.project !== 'function' ||
      typeof map.unproject !== 'function'
    )
      return undefined;
    if (map.getTerrain?.()) return undefined;
    if (map.getCenterElevation && Math.abs(map.getCenterElevation()) > 1e-5) return undefined;
    const {clientWidth: width, clientHeight: height} = map.getCanvas();
    const pitch = map.getPitch();
    const fov = map.getVerticalFieldOfView();
    if (!(width > 0 && height > 0 && fov > 0 && fov < 90 && pitch >= 0 && pitch + fov / 2 < 85))
      return undefined;
    const count = 2 ** zoom;
    const unit = tileflowSceneExtent * metres;
    const centre = map.getCenter();
    const centreX = ((centre.lng + 180) / 360) * count;
    const point = ({lng, lat}: {lng: number; lat: number}): number[] => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) >= 85.051129)
        throw new Error('Unprojected shadow receiver is outside Mercator.');
      const x = ((lng + 180) / 360) * count;
      const wrappedX = x + Math.round((centreX - x) / count) * count;
      const phi = (lat * Math.PI) / 180;
      const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * count;
      return [(wrappedX - origin[0]) * unit, -(y - origin[1]) * unit, 0];
    };
    const pixels: [number, number][] = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ];
    const ground = pixels.map((pixel) => point(map.unproject!(pixel)));
    const centrePoint = point(centre);
    // MapLibre's public zoom uses a 512-pixel Mercator world. The field of view supplies
    // the camera distance; intersect the same corner rays with the raised receiver plane.
    const pixel = unit / (512 * 2 ** (map.getZoom() - zoom));
    const distance = (height * pixel) / (2 * Math.tan((fov * Math.PI) / 360));
    const angle = (pitch * Math.PI) / 180;
    const bearing = (map.getBearing() * Math.PI) / 180;
    const elevation = distance * Math.cos(angle);
    if (!(elevation > 0.1 && Number.isFinite(elevation))) return undefined;
    const camera = [
      centrePoint[0]! - distance * Math.sin(angle) * Math.sin(bearing),
      centrePoint[1]! - distance * Math.sin(angle) * Math.cos(bearing),
      elevation,
    ];
    // A declared globe becomes planar at street zooms; its name cannot decide the fit.
    // Check the public corner rays instead. project(center) includes asymmetric map padding.
    const screenCentre = map.project(centre);
    const right = [Math.cos(bearing), -Math.sin(bearing), 0];
    const forward = [
      Math.sin(bearing) * Math.sin(angle),
      Math.cos(bearing) * Math.sin(angle),
      -Math.cos(angle),
    ];
    const up = [
      Math.sin(bearing) * Math.cos(angle),
      Math.cos(bearing) * Math.cos(angle),
      Math.sin(angle),
    ];
    const dot = (a: number[], b: number[]) =>
      a.reduce((sum, value, index) => sum + value * b[index]!, 0);
    for (const [index, corner] of ground.entries()) {
      const ray = corner.map((value, axis) => value - camera[axis]!);
      const depth = dot(ray, forward);
      if (!(depth > 0)) return undefined;
      const x = screenCentre.x + (dot(ray, right) / depth) * (distance / pixel);
      const y = screenCentre.y - (dot(ray, up) / depth) * (distance / pixel);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x - pixels[index]![0]) > Math.max(2, width * 0.005) ||
        Math.abs(y - pixels[index]![1]) > Math.max(2, height * 0.005)
      )
        return undefined;
    }
    // All corner rays point downward here. Geometry above the camera cannot enter the view.
    const fraction = Math.min(Math.max(0, tallest) / elevation, 1);
    return [
      ...ground,
      ...ground.map((corner) =>
        corner.map((value, index) => value + (camera[index]! - value) * fraction),
      ),
    ];
  } catch {
    return undefined;
  }
}

/**
 * The sun's orthographic view, in metres, with room for each caster's shadow to reach the ground.
 * Optional receivers concentrate XY resolution without dropping offscreen casters along a ray;
 * quantized extents and a world-anchored texel grid keep stationary shadows stable during pans.
 */
export function tileflowSunLightMatrix(
  direction: readonly number[],
  box: ShadowBox,
  view: ShadowView = {},
): {matrix: Float32Array; depth: number; extent: number; fit: ShadowFit} {
  const length = Math.hypot(direction[0]!, direction[1]!, direction[2]!) || 1;
  const towards = direction.map((value) => value / length);
  const forward = towards.map((value) => -value);
  const cross = (a: readonly number[], b: readonly number[]) => [
    a[1]! * b[2]! - a[2]! * b[1]!,
    a[2]! * b[0]! - a[0]! * b[2]!,
    a[0]! * b[1]! - a[1]! * b[0]!,
  ];
  const normalize = (v: readonly number[]) => {
    const size = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
    return v.map((value) => value / size);
  };
  const hint = Math.abs(towards[2]!) > 0.99 ? [0, 1, 0] : [0, 0, 1];
  const right = normalize(cross(forward, hint));
  const up = cross(right, forward);
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const corners: number[][] = [];
  for (const x of [box.min[0]!, box.max[0]!])
    for (const y of [box.min[1]!, box.max[1]!])
      for (const z of [box.min[2]!, box.max[2]!]) corners.push([x, y, z]);
  const range = (axis: readonly number[], points: readonly ShadowPoint[]) => {
    let low = Infinity;
    let high = -Infinity;
    for (const point of points) {
      const value = dot(point, axis);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    return [low, high] as const;
  };
  const pad = ([low, high]: readonly [number, number], extra: number) =>
    [low - extra, high + extra] as const;
  const receivers = view.receivers?.length ? view.receivers : corners;
  const margin = Math.max(0, view.margin ?? 0);
  const keeps = (previous: ShadowRange | undefined, [low, high]: ShadowRange) =>
    previous !== undefined &&
    previous[0] <= low &&
    previous[1] >= high &&
    previous[1] - previous[0] <= (high - low) * (1 + 2 * margin) * 1.5;
  const fit = (axis: ShadowPoint, previous: ShadowRange | undefined): ShadowRange => {
    const [low, high] = range(axis, receivers);
    const extra = (high - low) * 0.01 + 2;
    if (keeps(previous, [low - extra, high + extra])) return previous!;
    if (!(view.resolution && view.resolution >= 1))
      return pad([low, high], extra + (high - low + extra * 2) * margin);
    const span = (high - low + extra * 2) * (1 + 2 * margin);
    // Quantize in a stable Mercator frame. Quantizing metre extents while the absolute
    // world origin changes with cos(latitude) shifts texels even on centimetre pans.
    // Convert back for drawing: meshes retain their current physical metre scale.
    const gridScale = view.gridScale && view.gridScale > 0 ? view.gridScale : 1;
    const gridSpan = span / gridScale;
    const quantum = 2 ** Math.floor(Math.log2(gridSpan)) / 16;
    const extent = Math.ceil(gridSpan / quantum) * quantum * gridScale;
    const texel = extent / view.resolution;
    const offset = dot(view.origin ?? [0, 0, 0], axis);
    const centre = Math.round(((low + high) / 2 + offset) / texel) * texel - offset;
    return [centre - extent / 2, centre + extent / 2] as const;
  };
  const [a0, a1] = fit(right, view.previous?.right);
  const [b0, b1] = fit(up, view.previous?.up);
  // A ground endpoint has the same light-space XY as its roof, but is farther from the
  // sun. Extend depth only: widening the XY box would waste the newly focused resolution.
  const endpoints =
    towards[2]! > 1e-5
      ? corners.map(([x, y, z]) => [
          x! - (z! * towards[0]!) / towards[2]!,
          y! - (z! * towards[1]!) / towards[2]!,
          0,
        ])
      : [];
  const reach = range(forward, [...corners, ...endpoints, ...receivers]);
  const [c0, c1] = keeps(view.previous?.depth, pad(reach, 10))
    ? view.previous!.depth
    : pad(reach, 10 + (reach[1] - reach[0]) * margin);
  const hu = (a1 - a0) / 2;
  const hv = (b1 - b0) / 2;
  const hd = (c1 - c0) / 2;
  const rows = [
    [...right.map((value) => value / hu), -(a1 + a0) / 2 / hu],
    [...up.map((value) => value / hv), -(b1 + b0) / 2 / hv],
    [...forward.map((value) => value / hd), -(c1 + c0) / 2 / hd],
    [0, 0, 0, 1],
  ];
  const matrix = new Float32Array(16);
  for (let row = 0; row < 4; row += 1)
    for (let column = 0; column < 4; column += 1) matrix[column * 4 + row] = rows[row]![column]!;
  return {
    matrix,
    depth: hd * 2,
    extent: Math.max(hu, hv) * 2,
    fit: {right: [a0, a1], up: [b0, b1], depth: [c0, c1]},
  };
}
