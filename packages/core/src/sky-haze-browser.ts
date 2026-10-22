import {tileflowSceneReach} from './scene-3d-browser';
import {tileflowSkyLayerId} from './sky-browser';
import {
  tileflowSkyGroundDepth,
  tileflowSkyHaze,
  type TileflowSkyHaze,
  type TileflowSkyHazeReach,
} from './sky-haze';

export const tileflowSkyHazeLayerId = 'tileflow-sky-haze';

/** The MapLibre GL JS map capabilities the haze reads; importing this module loads no renderer. */
export type TileflowSkyHazeView = {
  getBearing?(): number;
  getCanvas?(): {clientHeight: number};
  getCenter?(): {lat: number; lng: number};
  getPitch(): number;
  getSky?(): unknown;
  getVerticalFieldOfView?(): number;
  getZoom?(): number;
};

/** What MapLibre passes a custom layer's render that the haze reads. */
export type TileflowSkyHazeArgs = {
  fov?: number;
  defaultProjectionData?: {projectionTransition?: number};
};

/** The haze of the view a custom layer draws now, from the map's sky; undefined where none shows. */
export function tileflowSkyHazeOf(
  map: TileflowSkyHazeView,
  args?: TileflowSkyHazeArgs,
  context?: WebGL2RenderingContext,
): TileflowSkyHaze | undefined {
  const sky = map.getSky?.() as Record<string, unknown> | undefined;
  if (!sky) return undefined;
  const pixelRatio = globalThis.devicePixelRatio || 1;
  const height =
    map.getCanvas?.().clientHeight || (context ? context.drawingBufferHeight / pixelRatio : 0);
  const fov = fovOf(map, args);
  const aspect = context ? context.drawingBufferWidth / context.drawingBufferHeight : undefined;
  const reach = reachOf(map, height / 2 / Math.tan(fov / 2));
  return tileflowSkyHaze({
    horizonColor: sky['horizon-color'],
    pitch: map.getPitch(),
    fov,
    height,
    globe: args?.defaultProjectionData?.projectionTransition ?? 0,
    ...(reach && aspect ? {reach, aspect} : {}),
  });
}

/**
 * The disc Tileflow's 3D buildings cover on this map, in camera distances along and across the
 * view, so the haze can hide where the 3D city ends.
 */
function reachOf(map: TileflowSkyHazeView, distance: number): TileflowSkyHazeReach | undefined {
  const reach = tileflowSceneReach(map);
  const centre = map.getCenter?.();
  const zoom = map.getZoom?.();
  if (!reach || !centre || zoom === undefined || !(distance > 0)) return undefined;
  const cos = Math.cos((centre.lat * Math.PI) / 180);
  // MapLibre's camera distance in metres: CSS pixels times metres per pixel at the centre.
  const metres = (distance * 40_075_016.686 * cos) / (512 * 2 ** zoom);
  const east = (reach.lng - centre.lng) * 111_320 * cos;
  const north = (reach.lat - centre.lat) * 111_320;
  const bearing = ((map.getBearing?.() ?? 0) * Math.PI) / 180;
  return {
    ahead: (east * Math.sin(bearing) + north * Math.cos(bearing)) / metres,
    across: (east * Math.cos(bearing) - north * Math.sin(bearing)) / metres,
    radius: reach.radius / metres,
  };
}

/** The vertical field of view, in radians. */
function fovOf(map: TileflowSkyHazeView, args?: TileflowSkyHazeArgs): number {
  return args?.fov ?? ((map.getVerticalFieldOfView?.() ?? 36.87) * Math.PI) / 180;
}

/**
 * Sets a 3D program's haze (`tileflowHazeFragment`): clip space's w, which its vertex passes on, is
 * the view depth in the camera's units.
 */
export function bindTileflowSkyHaze(
  context: WebGL2RenderingContext,
  uniforms: Record<string, WebGLUniformLocation | null | undefined>,
  haze: TileflowSkyHaze | undefined,
): void {
  if (!haze) {
    context.uniform3f(uniforms.u_haze ?? null, 0, 0, 1);
    return;
  }
  context.uniform3fv(uniforms.u_haze_colour ?? null, haze.colour);
  context.uniform3f(
    uniforms.u_haze ?? null,
    haze.strength,
    haze.start * haze.distance,
    haze.end * haze.distance,
  );
}

/** The map capabilities the haze layer uses. */
export type TileflowSkyHazeMap = TileflowSkyHazeView & {
  addLayer(layer: object, beforeId?: string): unknown;
  getLayer(id: string): unknown;
  getLayersOrder?(): string[];
  getStyle(): unknown;
  getTerrain?(): unknown;
  moveLayer?(id: string, beforeId?: string): unknown;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  removeLayer(id: string): unknown;
};

type Program = {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  uniforms: Record<'rows' | 'view' | 'pitch' | 'haze' | 'colour', WebGLUniformLocation | null>;
};

const vertexSource = `#version 300 es
in float a_corner;
uniform vec2 u_rows; // the band's bottom and top, in clip space
void main() {
  // A 2D custom layer draws at its own fixed depth, over the flat layers beneath it.
  gl_Position = vec4(mod(a_corner, 2.0) * 2.0 - 1.0, a_corner < 1.5 ? u_rows.x : u_rows.y, 0.0, 1.0);
}`;

// Flat ground's view depth follows from the row alone: seen at rise r (the tangent of the angle
// above the view's centre), it lies cos p / (cos p - r sin p) times the camera's distance away.
const fragmentSource = `#version 300 es
precision highp float;
uniform vec2 u_view; // the view centre's row and the camera's distance to it, in pixels
uniform vec2 u_pitch; // its cosine and sine
uniform vec3 u_haze; // strength; where it starts and is complete, in multiples of that distance
uniform vec3 u_haze_colour;
out vec4 fragColor;
void main() {
  float rise = (gl_FragCoord.y - u_view.x) / u_view.y;
  float below = u_pitch.x - u_pitch.y * rise;
  float depth = below > 0.0 ? u_pitch.x / below : u_haze.z;
  float alpha = u_haze.x * smoothstep(u_haze.y, u_haze.z, depth);
  fragColor = vec4(u_haze_colour * alpha, alpha);
}`;

/**
 * The distance haze over the flat map, for maps with a sky: a band of the sky's horizon colour from
 * where the haze starts up to the horizon, thickening with the flat ground's distance, so the
 * ground meets the sky in the colour the sky starts with. It sits under the first 3D layer (or,
 * without one, the first label layer); Tileflow's 3D buildings, trees and models haze themselves
 * in their own shaders, and labels drawn above it stay clear. It shows only above 45° of pitch,
 * costs one quad, and follows style replacements; the returned function removes it.
 */
export function attachTileflowSkyHaze(map: TileflowSkyHazeMap): () => void {
  let disposed = false;
  let program: Program | undefined;

  const layer = {
    id: tileflowSkyHazeLayerId,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map: unknown, gl: WebGL2RenderingContext) {
      program = createProgram(gl);
    },
    onRemove(_map: unknown, gl: WebGL2RenderingContext) {
      if (!program) return;
      gl.deleteVertexArray(program.vao);
      gl.deleteBuffer(program.buffer);
      gl.deleteProgram(program.program);
      program = undefined;
    },
    render(gl: WebGL2RenderingContext, args?: TileflowSkyHazeArgs) {
      // 3D terrain draws custom 2D layers into its ground texture and fogs itself.
      if (!program || map.getTerrain?.()) return;
      const haze = tileflowSkyHazeOf(map, args, gl);
      if (!haze) return;
      const height = gl.drawingBufferHeight;
      const tangent = Math.tan(fovOf(map, args) / 2);
      const pitch = (map.getPitch() * Math.PI) / 180;
      const cos = Math.cos(pitch);
      const sin = Math.sin(pitch);
      // From the row where the haze starts to just past the horizon line, where MapLibre's ground
      // ends a little beyond it.
      const riseAt = (depth: number) => (cos * (1 - 1 / depth)) / sin;
      const bottom = Math.max(-1, riseAt(haze.start) / tangent);
      // The band reaches the horizon line even when the haze is complete nearer.
      const ground = tileflowSkyGroundDepth(map.getPitch(), haze.horizon);
      const top = Math.min(1, riseAt(ground * 1.02) / tangent);
      if (!(top > bottom)) return;
      gl.useProgram(program.program);
      gl.uniform2f(program.uniforms.rows, bottom, top);
      gl.uniform2f(program.uniforms.view, height / 2, height / 2 / tangent);
      gl.uniform2f(program.uniforms.pitch, cos, sin);
      gl.uniform3f(program.uniforms.haze, haze.strength, haze.start, haze.end);
      gl.uniform3fv(program.uniforms.colour, haze.colour);
      gl.bindVertexArray(program.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
    },
  };

  /**
   * The layer the haze goes under: the first 3D layer, whose depth the flat band must not cover;
   * without one, the first label layer; without either, none for the top.
   */
  function anchor(order: readonly string[]): string | undefined {
    let label: string | undefined;
    for (const id of order) {
      if (id === tileflowSkyHazeLayerId || id === tileflowSkyLayerId) continue;
      const layer = map.getLayer(id) as
        {type?: string; implementation?: {renderingMode?: string}} | undefined;
      if (layer?.type === 'fill-extrusion' || layer?.implementation?.renderingMode === '3d')
        return id;
      if (layer?.type === 'symbol') label ??= id;
    }
    return label;
  }

  function sync(): void {
    if (disposed) return;
    try {
      // MapLibre's getSky() throws before the first style or after setStyle(null).
      const sky = map.getSky?.() as Record<string, unknown> | undefined;
      const wanted = typeof sky?.['horizon-color'] === 'string';
      const present = Boolean(map.getLayer(tileflowSkyHazeLayerId));
      if (!wanted) {
        if (present) map.removeLayer(tileflowSkyHazeLayerId);
        return;
      }
      // A style still loading its sources already takes layers; one still parsing throws.
      const order =
        map.getLayersOrder?.() ??
        ((map.getStyle() as {layers?: {id: string}[]} | undefined)?.layers ?? []).map(
          (entry) => entry.id,
        );
      const beforeId = anchor(order);
      if (!present) {
        map.addLayer(layer, beforeId);
        return;
      }
      // 3D layers attach after the style loads: keep the haze under the first of them.
      const next = order[order.indexOf(tileflowSkyHazeLayerId) + 1];
      if (next !== beforeId) map.moveLayer?.(tileflowSkyHazeLayerId, beforeId);
    } catch {
      // The style is absent or mid-update; the next style event retries.
    }
  }

  // A map still loading tiles may not reach idle for a while; style.load comes once it can attach.
  map.on('style.load', sync);
  map.on('styledata', sync);
  map.on('idle', sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    map.off('style.load', sync);
    map.off('styledata', sync);
    map.off('idle', sync);
    try {
      if (map.getLayer(tileflowSkyHazeLayerId)) map.removeLayer(tileflowSkyHazeLayerId);
    } catch {
      // A map already removed has no layers left to remove.
    }
  };
}

function createProgram(gl: WebGL2RenderingContext): Program | undefined {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return undefined;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return undefined;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = vertex && fragment ? gl.createProgram() : null;
  const buffer = program ? gl.createBuffer() : null;
  const vao = buffer ? gl.createVertexArray() : null;
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  if (vertex) gl.deleteShader(vertex);
  if (fragment) gl.deleteShader(fragment);
  if (!program || !buffer || !vao || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (vao) gl.deleteVertexArray(vao);
    // Without WebGL 2 shaders the flat map simply stays clear.
    return undefined;
  }
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // Bottom left, bottom right, top left, top right.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 2, 3]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'a_corner');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 4, 0);
  gl.bindVertexArray(null);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    buffer,
    vao,
    uniforms: {
      rows: uniform('u_rows'),
      view: uniform('u_view'),
      pitch: uniform('u_pitch'),
      haze: uniform('u_haze'),
      colour: uniform('u_haze_colour'),
    },
  };
}
