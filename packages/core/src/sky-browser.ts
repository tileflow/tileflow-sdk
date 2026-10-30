import {createAtmosphereStars} from './atmosphere';
import {
  readTileflowSky,
  tileflowSkyAtSun,
  tileflowSkyGlowStrength,
  tileflowSkyMetadataKey,
  type TileflowSkySun,
  tileflowSkySunKey,
  tileflowSkyStarVisibility,
} from './sky';
import {readTileflowSunPreset} from './sun';
import {tileflowColourChannels} from './theme-blend';

export const tileflowSkyLayerId = 'tileflow-sky';

/** The MapLibre GL JS map capabilities the sky layer uses; importing this module loads no renderer. */
export type TileflowSkyMap = {
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

type Camera = {
  right: readonly number[];
  up: readonly number[];
  forward: readonly number[];
  scale: readonly [number, number];
  pixelRatio: number;
};

type Programs = {
  glow: {program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer};
  stars: {program: WebGLProgram; vao: WebGLVertexArrayObject; buffer: WebGLBuffer; count: number};
};

// Screen positions of the sky dome: `screen = (d·right, d·up) / (d·forward) * scale`.
const cameraUniforms = `uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_forward;
uniform vec2 u_scale;`;

const glowVertex = `#version 300 es
in vec2 a_screen;
out vec2 v_screen;
void main() {
  v_screen = a_screen;
  // A 2D custom layer draws at its own fixed depth, behind everything already on the ground.
  gl_Position = vec4(a_screen, 0.0, 1.0);
}`;

const glowFragment = `#version 300 es
precision highp float;
${cameraUniforms}
uniform vec3 u_sun;
uniform vec3 u_glow;
uniform float u_strength;
uniform float u_disc;
in vec2 v_screen;
out vec4 fragColor;
void main() {
  vec3 ray = normalize(u_forward + v_screen.x / u_scale.x * u_right + v_screen.y / u_scale.y * u_up);
  float angle = acos(clamp(dot(ray, u_sun), -1.0, 1.0));
  // The warm light hugs the horizon on the sun's side and gathers into a golden halo round it.
  float horizon = exp(-max(ray.z, 0.0) / 0.2);
  float halo = exp(-angle / 0.05);
  float glow = u_strength * (0.6 * exp(-angle / 0.7) * horizon + 0.35 * exp(-angle / 0.16) + 0.5 * halo);
  float disc = u_disc * (1.0 - smoothstep(0.006, 0.011, angle));
  float alpha = clamp(glow * 0.85 + disc, 0.0, 1.0);
  vec3 colour = mix(u_glow, vec3(1.0, 0.9, 0.68), clamp(halo * u_strength * 0.7, 0.0, 1.0));
  colour = mix(colour, vec3(1.0, 0.96, 0.84), clamp(disc, 0.0, 1.0));
  fragColor = vec4(colour * alpha, alpha);
}`;

const starsVertex = `#version 300 es
in vec3 a_direction;
in vec2 a_star;
${cameraUniforms}
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
  gl_Position = vec4(vec2(dot(a_direction, u_right), dot(a_direction, u_up)) / depth * u_scale, 0.0, 1.0);
  gl_PointSize = v_size;
}`;

const starsFragment = `#version 300 es
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
 * Light in the sky above the horizon, for maps that declare a sky: a glow on the horizon towards
 * a low sun, the sun's disc as it sets or rises, and stars as the sky darkens. The sun is the one
 * a theme controller shows, so a sun an application places by date brings its glow; without a
 * controller, the theme's own sun. The layer sits under every other layer and draws only where
 * nothing else has, so buildings and trees stand in front. Follows style replacements; the
 * returned function removes the layer.
 */
export function attachTileflowSky(map: TileflowSkyMap): () => void {
  let disposed = false;
  let programs: Programs | undefined;

  const layer = {
    id: tileflowSkyLayerId,
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map: unknown, gl: WebGL2RenderingContext) {
      programs = createPrograms(gl);
    },
    onRemove(_map: unknown, gl: WebGL2RenderingContext) {
      if (!programs) return;
      for (const part of [programs.glow, programs.stars]) {
        gl.deleteVertexArray(part.vao);
        gl.deleteBuffer(part.buffer);
        gl.deleteProgram(part.program);
      }
      programs = undefined;
    },
    render(gl: WebGL2RenderingContext) {
      // 3D terrain draws custom 2D layers into its ground texture, which is no place for the sky.
      if (!programs || map.getTerrain?.()) return;
      const pitch = map.getPitch();
      const fovDegrees = map.getVerticalFieldOfView?.() ?? 36.87;
      // Nothing above the horizon is on screen.
      if (pitch + fovDegrees / 2 < 85) return;
      const style = map.getStyle() as {metadata?: Record<string, unknown>} | undefined;
      const sky = readTileflowSky(style?.metadata?.[tileflowSkyMetadataKey]);
      if (!sky) return;
      const camera = cameraOf(gl, pitch, map.getBearing(), fovDegrees);
      if (!camera) return;
      const sun = sunOf(map, style?.metadata);
      const glow = tileflowSkyGlowStrength(sun.altitude);
      const disc =
        glow > 0 ? smooth(-0.8, 0.3, sun.altitude) * (1 - smooth(20, 35, sun.altitude)) : 0;
      const shown = map.getSky?.() as Record<string, unknown> | undefined;
      const skyColour = typeof shown?.['sky-color'] === 'string' ? shown['sky-color'] : undefined;
      const skyChannels = skyColour ? tileflowColourChannels(skyColour) : null;
      const stars = skyChannels
        ? (sky.starIntensity / 0.6) *
          tileflowSkyStarVisibility([skyChannels[0], skyChannels[1], skyChannels[2]])
        : 0;
      if (glow <= 0 && stars <= 0) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (glow > 0) {
        // A sun an application placed takes the glow of its hour from the family's skies.
        const glowColour =
          sun.source !== 'theme' && sky.timesOfDay
            ? tileflowSkyAtSun(sky.timesOfDay, sun).glowColor
            : sky.glowColor;
        const channels = tileflowColourChannels(glowColour) ?? [1, 0.78, 0.54, 1];
        const {program, vao} = programs.glow;
        gl.useProgram(program);
        setCamera(gl, program, camera);
        gl.uniform3f(gl.getUniformLocation(program, 'u_sun'), ...sun.direction);
        gl.uniform3f(
          gl.getUniformLocation(program, 'u_glow'),
          channels[0],
          channels[1],
          channels[2],
        );
        gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), glow);
        gl.uniform1f(gl.getUniformLocation(program, 'u_disc'), disc);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (stars > 0) {
        const {program, vao, count} = programs.stars;
        gl.useProgram(program);
        setCamera(gl, program, camera);
        gl.uniform1f(gl.getUniformLocation(program, 'u_pixel_ratio'), camera.pixelRatio);
        gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), stars);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.POINTS, 0, count);
      }
      gl.bindVertexArray(null);
    },
  };

  function sync(): void {
    if (disposed) return;
    const style = map.getStyle() as
      {layers?: {id: string}[]; metadata?: Record<string, unknown>} | undefined;
    const declared = readTileflowSky(style?.metadata?.[tileflowSkyMetadataKey]) !== undefined;
    const present = Boolean(map.getLayer(tileflowSkyLayerId));
    try {
      if (!declared) {
        if (present) map.removeLayer(tileflowSkyLayerId);
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
      if (map.getLayer(tileflowSkyLayerId)) map.removeLayer(tileflowSkyLayerId);
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

/** The sun the controller shows on this map, or the theme's own sun. */
function sunOf(map: object, metadata: unknown): TileflowSkySun {
  const published = (map as Record<symbol, unknown>)[tileflowSkySunKey] as
    TileflowSkySun | undefined;
  if (published && Array.isArray(published.direction)) return published;
  const preset = readTileflowSunPreset(metadata);
  const azimuth = ((preset?.azimuth ?? 210) * Math.PI) / 180;
  const altitude = ((preset?.altitude ?? 60) * Math.PI) / 180;
  return {
    azimuth: preset?.azimuth ?? 210,
    altitude: preset?.altitude ?? 60,
    direction: [
      Math.sin(azimuth) * Math.cos(altitude),
      Math.cos(azimuth) * Math.cos(altitude),
      Math.sin(altitude),
    ],
    source: 'theme',
  };
}

function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** East, north and up; the camera looks down at zero pitch and towards the horizon at 90. */
function cameraOf(
  gl: WebGL2RenderingContext,
  pitchDegrees: number,
  bearingDegrees: number,
  fovDegrees: number,
): Camera | undefined {
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const fov = (fovDegrees * Math.PI) / 180;
  if (!(width > 0 && height > 0 && fov > 0)) return undefined;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const bearing = (bearingDegrees * Math.PI) / 180;
  const canvas = gl.canvas as {clientHeight?: number};
  const tangent = Math.tan(fov / 2);
  const [sinBearing, cosBearing] = [Math.sin(bearing), Math.cos(bearing)];
  const [sinPitch, cosPitch] = [Math.sin(pitch), Math.cos(pitch)];
  return {
    right: [cosBearing, -sinBearing, 0],
    up: [sinBearing * cosPitch, cosBearing * cosPitch, sinPitch],
    forward: [sinBearing * sinPitch, cosBearing * sinPitch, -cosPitch],
    scale: [height / width / tangent, 1 / tangent],
    pixelRatio: canvas.clientHeight ? height / canvas.clientHeight : 1,
  };
}

function setCamera(gl: WebGL2RenderingContext, program: WebGLProgram, camera: Camera): void {
  gl.uniform3fv(gl.getUniformLocation(program, 'u_right'), camera.right);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_up'), camera.up);
  gl.uniform3fv(gl.getUniformLocation(program, 'u_forward'), camera.forward);
  gl.uniform2fv(gl.getUniformLocation(program, 'u_scale'), camera.scale);
}

function createPrograms(gl: WebGL2RenderingContext): Programs | undefined {
  const glow = link(gl, glowVertex, glowFragment);
  const stars = link(gl, starsVertex, starsFragment);
  if (!glow || !stars) {
    // Without WebGL 2 shaders the sky keeps MapLibre's gradient alone.
    if (glow) gl.deleteProgram(glow);
    if (stars) gl.deleteProgram(stars);
    return undefined;
  }
  const field = tileflowSkyStarField();
  return {
    // One triangle covers the whole screen.
    glow: {
      program: glow,
      ...geometry(gl, glow, new Float32Array([-1, -1, 3, -1, -1, 3]), [['a_screen', 2, 0]], 8),
    },
    stars: {
      program: stars,
      count: field.length / 5,
      ...geometry(
        gl,
        stars,
        field,
        [
          ['a_direction', 3, 0],
          ['a_star', 2, 12],
        ],
        20,
      ),
    },
  };
}

function link(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
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
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
  }
  if (vertex) gl.deleteShader(vertex);
  if (fragment) gl.deleteShader(fragment);
  if (program && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return undefined;
  }
  return program ?? undefined;
}

function geometry(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  data: Float32Array,
  attributes: readonly (readonly [string, number, number])[],
  stride: number,
): {vao: WebGLVertexArrayObject; buffer: WebGLBuffer} {
  const vao = gl.createVertexArray()!;
  const buffer = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const [name, size, offset] of attributes) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  }
  gl.bindVertexArray(null);
  return {vao, buffer};
}
