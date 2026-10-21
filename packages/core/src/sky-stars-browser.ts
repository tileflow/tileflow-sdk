import {createAtmosphereStars} from './atmosphere';
import {readTileflowSky, tileflowSkyMetadataKey, tileflowSkyStarVisibility} from './sky';
import {tileflowColourChannels} from './theme-blend';

export const tileflowSkyStarsLayerId = 'tileflow-sky-stars';

/** The MapLibre GL JS map capabilities the stars use; importing this module loads no renderer. */
export type TileflowSkyStarsMap = {
  addLayer(layer: object, beforeId?: string): unknown;
  getBearing(): number;
  getLayer(id: string): unknown;
  getPitch(): number;
  getSky?(): unknown;
  getStyle(): unknown;
  getTerrain?(): unknown;
  getVerticalFieldOfView?(): number;
  isStyleLoaded(): boolean | void;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  removeLayer(id: string): unknown;
};

type Program = {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  vao: WebGLVertexArrayObject;
  count: number;
  uniforms: Record<
    'right' | 'up' | 'forward' | 'scale' | 'pixelRatio' | 'brightness',
    WebGLUniformLocation | null
  >;
};

const vertexSource = `#version 300 es
in vec3 a_direction;
in vec2 a_star;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_forward;
uniform vec2 u_scale;
uniform float u_pixel_ratio;
uniform float u_brightness;
out float v_alpha;
out float v_radius;
out float v_size;
void main() {
  float depth = dot(a_direction, u_forward);
  // A star smaller than a pixel keeps a pixel's footprint and gives up brightness instead.
  v_radius = max(a_star.x, 0.8) * u_pixel_ratio;
  v_size = ceil(v_radius * 2.0 + 2.0);
  // Low stars fade into the horizon's haze.
  v_alpha = a_star.y * min(1.0, a_star.x / 0.8) * u_brightness * smoothstep(0.01, 0.12, a_direction.z);
  if (depth < 0.05 || v_alpha <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vec2 screen = vec2(dot(a_direction, u_right), dot(a_direction, u_up)) / depth * u_scale;
  // A 2D custom layer draws at its own fixed depth, behind everything already on the ground.
  gl_Position = vec4(screen, 0.0, 1.0);
  gl_PointSize = v_size;
}`;

const fragmentSource = `#version 300 es
precision mediump float;
in float v_alpha;
in float v_radius;
in float v_size;
out vec4 fragColor;
void main() {
  float distance = length(gl_PointCoord - 0.5) * v_size;
  float coverage = 1.0 - smoothstep(v_radius - 0.5, v_radius + 0.5, distance);
  float alpha = min(1.0, v_alpha) * coverage;
  fragColor = vec4(vec3(0.816, 0.89, 1.0) * alpha, alpha);
}`;

/**
 * Stars in the dark sky above the horizon, for maps whose sky declares them. They shine as the
 * sky darkens, so a night theme shows them and a blend from dusk brings them in. The layer sits
 * under every other layer and draws only where nothing else has, so buildings and trees hide the
 * stars behind them. Follows style replacements; the returned function removes the layer.
 */
export function attachTileflowSkyStars(map: TileflowSkyStarsMap): () => void {
  let disposed = false;
  let stars = 0;
  let program: Program | undefined;

  const layer = {
    id: tileflowSkyStarsLayerId,
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
    render(gl: WebGL2RenderingContext) {
      // 3D terrain draws custom 2D layers into its ground texture, which is no place for stars.
      if (!program || stars <= 0 || map.getTerrain?.()) return;
      const sky = map.getSky?.() as Record<string, unknown> | undefined;
      const colour = typeof sky?.['sky-color'] === 'string' ? sky['sky-color'] : undefined;
      const channels = colour ? tileflowColourChannels(colour) : null;
      const brightness = channels
        ? (stars / 0.6) * tileflowSkyStarVisibility([channels[0], channels[1], channels[2]])
        : 0;
      if (brightness <= 0) return;
      const fov = ((map.getVerticalFieldOfView?.() ?? 36.87) * Math.PI) / 180;
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      if (!(width > 0 && height > 0 && fov > 0)) return;
      const pitch = (map.getPitch() * Math.PI) / 180;
      const bearing = (map.getBearing() * Math.PI) / 180;
      const canvas = gl.canvas as {clientHeight?: number};
      const pixelRatio = canvas.clientHeight ? height / canvas.clientHeight : 1;
      const tangent = Math.tan(fov / 2);
      // East, north and up; the camera looks down at zero pitch and towards the horizon at 90.
      const sinBearing = Math.sin(bearing);
      const cosBearing = Math.cos(bearing);
      const sinPitch = Math.sin(pitch);
      const cosPitch = Math.cos(pitch);
      gl.useProgram(program.program);
      gl.uniform3f(program.uniforms.right, cosBearing, -sinBearing, 0);
      gl.uniform3f(program.uniforms.up, sinBearing * cosPitch, cosBearing * cosPitch, sinPitch);
      gl.uniform3f(
        program.uniforms.forward,
        sinBearing * sinPitch,
        cosBearing * sinPitch,
        -cosPitch,
      );
      gl.uniform2f(program.uniforms.scale, height / width / tangent, 1 / tangent);
      gl.uniform1f(program.uniforms.pixelRatio, pixelRatio);
      gl.uniform1f(program.uniforms.brightness, brightness);
      gl.bindVertexArray(program.vao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, program.count);
      gl.bindVertexArray(null);
    },
  };

  function sync(): void {
    if (disposed) return;
    const style = map.getStyle() as
      {layers?: {id: string}[]; metadata?: Record<string, unknown>} | undefined;
    stars = readTileflowSky(style?.metadata?.[tileflowSkyMetadataKey])?.starIntensity ?? 0;
    const present = Boolean(map.getLayer(tileflowSkyStarsLayerId));
    try {
      if (stars <= 0) {
        if (present) map.removeLayer(tileflowSkyStarsLayerId);
        return;
      }
      if (present || !map.isStyleLoaded()) return;
      map.addLayer(layer, style?.layers?.[0]?.id);
    } catch {
      // The style is mid-update; the next style event retries.
    }
  }

  map.on('styledata', sync);
  map.on('idle', sync);
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    map.off('styledata', sync);
    map.off('idle', sync);
    try {
      if (map.getLayer(tileflowSkyStarsLayerId)) map.removeLayer(tileflowSkyStarsLayerId);
    } catch {
      // A map already removed has no layers left to remove.
    }
  };
}

/**
 * The star field on the sky's dome, from the same deterministic generator as the globe's space.
 * A street view sees only a narrow band of sky above the horizon, so the dome holds many more.
 */
export function tileflowSkyStarField(): Float32Array {
  const stars = createAtmosphereStars(2400);
  const data = new Float32Array(stars.length * 5);
  for (const [index, star] of stars.entries()) {
    // A uniform height spreads the stars evenly over the dome.
    const azimuth = star.x * Math.PI * 2;
    const up = star.y;
    const across = Math.sqrt(1 - up * up);
    data.set(
      [across * Math.sin(azimuth), across * Math.cos(azimuth), up, star.radius, star.alpha],
      index * 5,
    );
  }
  return data;
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
    // Without WebGL 2 shaders the sky simply has no stars.
    return undefined;
  }
  const field = tileflowSkyStarField();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, field, gl.STATIC_DRAW);
  for (const [name, size, offset] of [
    ['a_direction', 3, 0],
    ['a_star', 2, 12],
  ] as const) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 20, offset);
  }
  gl.bindVertexArray(null);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    buffer,
    vao,
    count: field.length / 5,
    uniforms: {
      right: uniform('u_right'),
      up: uniform('u_up'),
      forward: uniform('u_forward'),
      scale: uniform('u_scale'),
      pixelRatio: uniform('u_pixel_ratio'),
      brightness: uniform('u_brightness'),
    },
  };
}
