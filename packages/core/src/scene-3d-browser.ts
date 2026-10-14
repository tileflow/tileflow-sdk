// The 3D scene Tileflow's custom WebGL layers share on one map (3D buildings, 3D trees): the sun's
// light, one shadow map that every layer draws its depth into and reads its shade from, the frame
// its coordinates are in, and which layer darkens the flat map under the shadows. Layers find the
// scene by their map, as they share tile downloads by URL, so an application wires nothing: trees
// cast shadows on buildings and take theirs because both draw into the same map.
import {type TileflowSun} from './sun';

/** Tile units across a tile, as Tileflow's 3D layers lay out their meshes. */
export const tileflowSceneExtent = 8192;

// Shadows lengthen as the sun sets while they fade: they fall from a sun no lower than 3° and fade
// out between 7° and half a degree.
export const tileflowSceneShadowFloor = 3;
const shadowFade: readonly [number, number] = [0.5, 7];

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
  const linear = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
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
  const low = Math.min(
    1,
    Math.max(0, (sun.altitude - shadowFade[0]) / (shadowFade[1] - shadowFade[0])),
  );
  const strength = shadows
    ? Math.min(1, sun.shadowIntensity) * Math.min(1, sun.intensity * 4) * low * low * (3 - 2 * low)
    : 0;
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
    scene = createScene();
    scenes.set(map, scene);
  }
  return scene;
}

function createScene(): TileflowScene3D {
  const casters = new Set<TileflowSceneCaster>();
  let target: ShadowTarget | undefined;
  let key: string | undefined;
  let frame: TileflowSceneFrame | undefined;

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
    // No sun to cast from: the map drawn last stays, unread, until the sun returns.
    if (light.strength <= 0) return;
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
    const next = [
      ...light.shadowDirection.map((value) => value.toFixed(5)),
      zoom,
      left,
      top,
      right,
      bottom,
      tallest.toFixed(2),
      ...casting.map(({caster}) => caster.key()),
    ].join();
    if (next === key && frame) return;
    const scale = metres;
    const unit = tileflowSceneExtent * scale;
    const lightView = tileflowSunLightMatrix(light.shadowDirection, {
      min: [0, -(bottom + 1 - top) * unit, 0],
      max: [(right + 1 - left) * unit, 0, tallest],
    });
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
      context.uniform1i(uniforms.u_shadow_map!, 0);
      context.uniform1f(uniforms.u_shadow!, on ? strength : 0);
      if (!on || !frame || !target) return;
      context.uniformMatrix4fv(uniforms.u_light_matrix!, false, frame.light.matrix);
      context.uniform2f(uniforms.u_shadow_texel!, 1 / target.size, 1 / target.size);
      context.uniform1f(uniforms.u_depth_unit!, 1 / frame.light.depth);
      context.uniform1f(uniforms.u_normal_offset!, (frame.light.extent / target.size) * 1.2);
    },
    drawsGround(caster) {
      let first: TileflowSceneCaster | undefined;
      for (const entry of casters)
        if (!first || entry.groundOrder < first.groundOrder) first = entry;
      return first === caster;
    },
    release(context) {
      if (casters.size > 0 || !target || target.context !== context) return;
      context.deleteFramebuffer(target.framebuffer);
      context.deleteTexture(target.texture);
      target = undefined;
      frame = undefined;
      key = undefined;
    },
  };
}

/**
 * The sun's view of a box of buildings: an orthographic projection along `direction` (towards the
 * sun; x east, y north, z up, in metres) as a column-major matrix to clip space, with the metres its
 * depth runs over and the metres its wider side spans. It follows only the sun, never the camera,
 * so shadows hold still while the camera moves.
 */
export function tileflowSunLightMatrix(
  direction: readonly number[],
  box: Readonly<{min: readonly number[]; max: readonly number[]}>,
): {matrix: Float32Array; depth: number; extent: number} {
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
  const range = (axis: readonly number[]) => {
    let low = Infinity;
    let high = -Infinity;
    for (const x of [box.min[0]!, box.max[0]!])
      for (const y of [box.min[1]!, box.max[1]!])
        for (const z of [box.min[2]!, box.max[2]!]) {
          const value = dot([x, y, z], axis);
          low = Math.min(low, value);
          high = Math.max(high, value);
        }
    return [low, high] as const;
  };
  const pad = ([low, high]: readonly [number, number], extra: number) =>
    [low - extra, high + extra] as const;
  const [u0, u1] = range(right);
  const [v0, v1] = range(up);
  const [a0, a1] = pad([u0, u1], (u1 - u0) * 0.01 + 2);
  const [b0, b1] = pad([v0, v1], (v1 - v0) * 0.01 + 2);
  const [c0, c1] = pad(range(forward), 10);
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
  return {matrix, depth: hd * 2, extent: Math.max(hu, hv) * 2};
}
