// Tileflow's street lights: a custom WebGL2 layer that lights a Tileflow map's streets at night
// from its own vector tiles. Lamps the data maps (World's street lamps, with their height, type and
// colour where mapped) shine where they stand, with a pool of light on the ground and a glowing
// head; streets and pavements the data maps as lit, without their lamps, take a soft light along
// them that claims no lamp's place. As the controller's sun darkens the map the lights switch on
// one by one, and they go out as day comes.
import {cameraFrame, createCameraTiles} from './camera-tiles-browser';
import {
  placeTileflowStreetLights,
  tileflowStreetLightBytes,
  type TileflowStreetLightEstimate,
  type TileflowStreetLightPlacement,
} from './street-lights';
import {resolveTileflowSun, tileflowDefaultSunPreset, type TileflowSun} from './sun';
import {tileflowColourChannels} from './theme-blend';
import type {TileflowTileRequestTransform} from './tile-reader';

/** The MapLibre GL JS map capabilities the street lights use. */
export type TileflowStreetLightsMap = {
  addLayer(layer: object, beforeId?: string): unknown;
  getBearing(): number;
  getCenter(): {lat: number; lng: number};
  getLayer(id: string): unknown;
  getPitch(): number;
  getSource(id: string): unknown;
  getStyle(): unknown;
  getZoom(): number;
  isStyleLoaded(): boolean | void;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  removeLayer(id: string): unknown;
  triggerRepaint(): unknown;
};

export type TileflowStreetLightsOptions = Readonly<{
  map: TileflowStreetLightsMap;
  /** The theme controller, whose sun switches the lights on and off. */
  controller?: {getSun?(): TileflowSun};
  /** The vector source to read; defaults to `tileflow`, a Tileflow map's World source. */
  source?: string;
  /**
   * Where soft light is estimated where the data maps no lamps: `lit` (the default) along the
   * streets and pavements the data maps as lit; `streets` also along the streets the data says
   * nothing about, wherever it maps few lamps, which invents light as night windows do; `none`
   * nowhere, so only mapped lamps shine.
   */
  estimate?: TileflowStreetLightEstimate;
  /** The light of the lamps whose data gives no colour, as a CSS colour; a warm white by default. */
  color?: string;
  /** How bright the lights shine, from 0 to 2; defaults to 1. */
  intensity?: number;
  /** The zoom from which the lights shine. Defaults to 14. */
  minzoom?: number;
  /** The most tiles lit round the camera, from 1 to 64; defaults to 25. */
  maxTiles?: number;
  /** The layer to draw before; defaults to the style's `above-buildings` placement. */
  beforeId?: string;
  /** The map's request rules, for the tiles the layer reads. */
  transformRequest?: TileflowTileRequestTransform;
}>;

export type TileflowStreetLights = {
  /** How far the lights have switched on, from 0 by day to 1 at night. */
  readonly on: number;
  /** Tiles lit, lamps, and how many of them the data maps or the layer estimates. */
  readonly stats: Readonly<{tiles: number; lamps: number; mapped: number; estimated: number}>;
  /** Takes the layer off the map and lets go of its buffers. */
  dispose(): void;
};

export const tileflowStreetLightsLayerId = 'tileflow-street-lights';
// World's street lamps and the streets' `lit` are at z15.
const preferredZoom = 15;
// The lights switch on as the map's brightness (the sun's `brightness`) falls through this range,
// each lamp at its own moment, and are all on below it.
const switchOn: readonly [number, number] = [0.07, 0.2];

type LightTile = {
  placement: TileflowStreetLightPlacement;
  gl?: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer};
};
type Program = {program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null>};
type ProjectionArgs = {
  getProjectionData(params: {
    tileID: {canonical: {x: number; y: number; z: number}; wrap: number};
  }): {
    mainMatrix: Float32Array | number[];
    tileMercatorCoords: Float32Array | number[];
    clippingPlane: Float32Array | number[];
    projectionTransition: number;
    fallbackMatrix: Float32Array | number[];
  };
  shaderData: {variantName: string; vertexShaderPrelude: string; define: string};
};

/**
 * Creates the street lights and puts their layer on the map. They read the source's z15 tiles round
 * the camera once the controller's sun darkens the map, and shine from `minzoom`.
 */
export function createTileflowStreetLights(
  options: TileflowStreetLightsOptions,
): TileflowStreetLights {
  const {map} = options;
  const minzoom = options.minzoom ?? 14;
  const maxTiles = Math.round(options.maxTiles ?? 25);
  const intensity = options.intensity ?? 1;
  if (!Number.isFinite(minzoom) || minzoom < 0 || minzoom > 24)
    throw new RangeError('Tileflow street lights minzoom must be a zoom from 0 to 24.');
  if (!(maxTiles >= 1 && maxTiles <= 64))
    throw new RangeError('Tileflow street lights maxTiles must be from 1 to 64.');
  if (!(intensity >= 0 && intensity <= 2))
    throw new RangeError('Tileflow street lights intensity must be from 0 to 2.');
  const estimate = options.estimate ?? 'lit';
  if (!['streets', 'lit', 'none'].includes(estimate))
    throw new RangeError('Tileflow street lights estimate must be streets, lit or none.');
  const colour = tileflowColourChannels(options.color ?? '#ffcf8f');
  if (!colour) throw new RangeError('Tileflow street lights color must be a CSS colour.');

  let gl: WebGL2RenderingContext | undefined;
  let programs: Partial<Record<'pool' | 'head', Program>> = {};
  let variant: string | undefined;
  let corners: WebGLBuffer | undefined;
  let disposed = false;
  let lastUpdate = 0;

  const camera = createCameraTiles<LightTile>({
    map,
    source: options.source ?? 'tileflow',
    layers: ['street_furniture', 'transportation', 'sidewalk'],
    zoom: preferredZoom,
    minzoom,
    maxTiles,
    ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
    active: () => onNow() > 0,
    build(tile, tileMetres) {
      const placement = placeTileflowStreetLights(
        {
          ...(tile.layers.street_furniture ? {streetFurniture: tile.layers.street_furniture} : {}),
          ...(tile.layers.transportation ? {transportation: tile.layers.transportation} : {}),
          ...(tile.layers.sidewalk ? {sidewalks: tile.layers.sidewalk} : {}),
        },
        {tileMetres, estimate},
      );
      return placement ? {placement} : emptyTile;
    },
    empty: emptyTile,
    release(value) {
      if (gl) release(gl, value);
    },
    changed() {},
  });

  function release(context: WebGL2RenderingContext, tile: LightTile): void {
    if (!tile.gl) return;
    context.deleteVertexArray(tile.gl.vao);
    context.deleteBuffer(tile.gl.vbo);
    tile.gl = undefined;
  }

  function sunNow(): TileflowSun {
    return options.controller?.getSun?.() ?? resolveTileflowSun(tileflowDefaultSunPreset);
  }

  /** How far the lights have switched on, from 0 by day to 1 at night. */
  function onNow(): number {
    const brightness = sunNow().brightness;
    return Math.min(1, Math.max(0, (switchOn[1] - brightness) / (switchOn[1] - switchOn[0])));
  }

  const layer = {
    id: tileflowStreetLightsLayerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      gl = context;
      corners = context.createBuffer()!;
      context.bindBuffer(context.ARRAY_BUFFER, corners);
      context.bufferData(
        context.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        context.STATIC_DRAW,
      );
    },
    onRemove(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      for (const entry of camera.all()) if (entry.value) release(context, entry.value);
      for (const program of Object.values(programs))
        if (program) context.deleteProgram(program.program);
      if (corners) context.deleteBuffer(corners);
      programs = {};
      variant = undefined;
      corners = undefined;
      gl = undefined;
    },
    render(context: WebGLRenderingContext | WebGL2RenderingContext, args: ProjectionArgs) {
      if (!isWebGL2(context)) return;
      const on = onNow();
      if (on <= 0 || intensity <= 0 || map.getZoom() < minzoom - 0.5) return;
      // A sun that sets with the camera still reads the tiles it now needs.
      const now = performance.now();
      if (now - lastUpdate > 1000) {
        lastUpdate = now;
        if (camera.ready().length === 0) camera.update();
      }
      try {
        if (variant !== args.shaderData.variantName) link(context, args.shaderData);
      } catch {
        return;
      }
      upload(context);
      draw(context, args, on);
    },
  };

  function upload(context: WebGL2RenderingContext): void {
    let budget = 4;
    for (const {value: tile} of camera.ready()) {
      if (tile.gl || !corners) continue;
      if (budget-- <= 0) {
        map.triggerRepaint();
        break;
      }
      const vao = context.createVertexArray()!;
      context.bindVertexArray(vao);
      context.bindBuffer(context.ARRAY_BUFFER, corners);
      context.enableVertexAttribArray(0);
      context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
      const vbo = context.createBuffer()!;
      context.bindBuffer(context.ARRAY_BUFFER, vbo);
      context.bufferData(context.ARRAY_BUFFER, tile.placement.lamps, context.STATIC_DRAW);
      const stride = tileflowStreetLightBytes;
      const instance = (
        index: number,
        size: number,
        type: number,
        normalised: boolean,
        offset: number,
      ) => {
        context.enableVertexAttribArray(index);
        context.vertexAttribPointer(index, size, type, normalised, stride, offset);
        context.vertexAttribDivisor(index, 1);
      };
      instance(1, 2, context.UNSIGNED_SHORT, false, 0);
      instance(2, 1, context.UNSIGNED_SHORT, false, 4);
      instance(3, 2, context.UNSIGNED_BYTE, false, 6);
      instance(4, 4, context.UNSIGNED_BYTE, true, 8);
      context.bindVertexArray(null);
      tile.gl = {vao, vbo};
    }
  }

  function project(
    context: WebGL2RenderingContext,
    program: Program,
    args: ProjectionArgs,
    x: number,
    y: number,
  ) {
    const data = args.getProjectionData({tileID: {canonical: {x, y, z: camera.zoom}, wrap: 0}});
    const uniforms = program.uniforms;
    context.uniformMatrix4fv(uniforms.u_projection_matrix!, false, data.mainMatrix);
    context.uniform4fv(uniforms.u_projection_tile_mercator_coords!, data.tileMercatorCoords);
    context.uniform4fv(uniforms.u_projection_clipping_plane!, data.clippingPlane);
    context.uniform1f(uniforms.u_projection_transition!, data.projectionTransition);
    context.uniformMatrix4fv(uniforms.u_projection_fallback_matrix!, false, data.fallbackMatrix);
  }

  function draw(context: WebGL2RenderingContext, args: ProjectionArgs, on: number): void {
    const tiles = camera.ready().filter((entry) => entry.value.gl);
    if (tiles.length === 0) return;
    context.depthMask(false);
    context.enable(context.BLEND);
    context.blendFuncSeparate(context.ONE, context.ONE, context.ZERO, context.ONE);
    for (const name of ['pool', 'head'] as const) {
      const program = programs[name];
      if (!program) continue;
      const u = program.uniforms;
      context.useProgram(program.program);
      context.uniform1f(u.u_on!, on);
      context.uniform1f(u.u_intensity!, intensity);
      context.uniform1f(u.u_metres!, camera.metres);
      context.uniform3f(u.u_colour!, colour![0], colour![1], colour![2]);
      context.uniform2f(u.u_viewport!, context.drawingBufferWidth, context.drawingBufferHeight);
      for (const {x, y, value} of tiles) {
        project(context, program, args, x, y);
        context.bindVertexArray(value.gl!.vao);
        context.drawArraysInstanced(
          context.TRIANGLE_STRIP,
          0,
          4,
          value.placement.lamps.length / tileflowStreetLightBytes,
        );
      }
    }
    context.bindVertexArray(null);
    context.depthMask(true);
  }

  function link(context: WebGL2RenderingContext, shaderData: ProjectionArgs['shaderData']): void {
    const projected = `${shaderData.vertexShaderPrelude}\n${shaderData.define}`;
    const next: typeof programs = {};
    for (const [name, vertexText, fragmentText] of [
      ['pool', poolVertex(projected), poolFragment],
      ['head', headVertex(projected), headFragment],
    ] as const) {
      const shader = (type: number, source: string) => {
        const object = context.createShader(type)!;
        context.shaderSource(object, source);
        context.compileShader(object);
        return object;
      };
      const program = context.createProgram()!;
      const vertex = shader(context.VERTEX_SHADER, vertexText);
      const fragment = shader(context.FRAGMENT_SHADER, fragmentText);
      context.attachShader(program, vertex);
      context.attachShader(program, fragment);
      for (const [index, attribute] of [
        'a_corner',
        'a_pos',
        'a_height',
        'a_light',
        'a_colour',
      ].entries())
        context.bindAttribLocation(program, index, attribute);
      context.linkProgram(program);
      const failed = !context.getProgramParameter(program, context.LINK_STATUS);
      const log = failed
        ? `${context.getShaderInfoLog(vertex) ?? ''} ${context.getShaderInfoLog(fragment) ?? ''}`
        : '';
      context.deleteShader(vertex);
      context.deleteShader(fragment);
      if (failed) {
        context.deleteProgram(program);
        for (const made of Object.values(next)) if (made) context.deleteProgram(made.program);
        throw new Error(`Tileflow street lights shaders failed to link: ${log}`);
      }
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const count = context.getProgramParameter(program, context.ACTIVE_UNIFORMS) as number;
      for (let index = 0; index < count; index += 1) {
        const info = context.getActiveUniform(program, index);
        if (info) uniforms[info.name] = context.getUniformLocation(program, info.name);
      }
      next[name] = {program, uniforms};
    }
    for (const program of Object.values(programs))
      if (program) context.deleteProgram(program.program);
    programs = next;
    variant = shaderData.variantName;
  }

  // --- The layer on the map ---

  function beforeId(): string | undefined {
    if (options.beforeId) return map.getLayer(options.beforeId) ? options.beforeId : undefined;
    const style = map.getStyle() as
      {layers?: {id: string; type?: string}[]; metadata?: Record<string, unknown>} | undefined;
    const anchors = (
      style?.metadata?.['tileflow:overlay-placement-manifest'] as
        {anchors?: Record<string, string | null>} | undefined
    )?.anchors;
    const anchor = anchors?.['above-buildings'];
    if (typeof anchor === 'string' && map.getLayer(anchor)) return anchor;
    return style?.layers?.find((entry) => entry.type === 'symbol')?.id;
  }

  function attach(): void {
    if (disposed || map.getLayer(tileflowStreetLightsLayerId) || !map.isStyleLoaded()) return;
    try {
      map.addLayer(layer, beforeId());
    } catch {
      // The style is mid-update; the next style event retries.
    }
  }

  // A style still loading takes the layer once it has loaded.
  const onStyle = () => attach();
  map.on('styledata', onStyle);
  map.on('idle', onStyle);
  attach();
  cameraFrame(() => camera.update());

  return {
    get on() {
      return onNow();
    },
    get stats() {
      let lit = 0;
      let lamps = 0;
      let mapped = 0;
      let estimated = 0;
      for (const {value} of camera.ready()) {
        lit += 1;
        lamps += value.placement.lamps.length / tileflowStreetLightBytes;
        mapped += value.placement.mapped;
        estimated += value.placement.estimated;
      }
      return {tiles: lit, lamps, mapped, estimated};
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      map.off('styledata', onStyle);
      map.off('idle', onStyle);
      try {
        if (map.getLayer(tileflowStreetLightsLayerId)) map.removeLayer(tileflowStreetLightsLayerId);
      } catch {
        // A map already removed has no layers left to remove.
      }
      camera.dispose();
    },
  };
}

const emptyTile: LightTile = Object.freeze({
  placement: Object.freeze({lamps: new Uint8Array(0), mapped: 0, estimated: 0}),
});

function isWebGL2(context: unknown): context is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
}

// --- Shaders ---

const lamp = `
in vec2 a_corner; // the quad's corner, from -1 to 1
in vec2 a_pos; // the lamp in the tile, 0 to 8192
in float a_height; // decimetres
in vec2 a_light; // the reach of its light in metres; flags (mapped, own colour)
in vec4 a_colour; // its own colour; a seed
uniform float u_on; // how far the lights have switched on, 0 to 1
uniform float u_intensity; // how bright they shine, 0 to 2
uniform float u_metres; // metres per tile unit
uniform vec3 u_colour; // the light of lamps without their own
uniform vec2 u_viewport; // pixels
out vec2 v_corner;
out vec3 v_light;
out float v_mapped;

// Each lamp switches on at its own moment of the dusk, and flares as it comes on.
float switched() {
  float threshold = 0.05 + 0.85 * a_colour.a;
  float since = u_on - threshold;
  float flare = 1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.06, since));
  return smoothstep(0.0, 0.04, since) * flare * u_intensity;
}

vec3 colourOf() {
  return mod(floor(a_light.y / 2.0), 2.0) > 0.5 ? a_colour.rgb : u_colour;
}

float pixelsOf(vec4 clip, vec4 other) {
  vec2 a = clip.xy / clip.w;
  vec2 b = other.xy / other.w;
  return length((b - a) * u_viewport * 0.5);
}
`;

const poolVertex = (projected: string) => `#version 300 es
${projected}
${lamp}
void main() {
  float on = switched();
  float reach = a_light.x / u_metres;
  vec4 centre = projectTileFor3D(a_pos, 0.0);
  float pixels = pixelsOf(centre, projectTileFor3D(a_pos + vec2(reach, 0.0), 0.0));
  // Far away a pool keeps a few pixels' size and spreads its light over them, so nothing sparkles.
  float grow = max(1.0, 3.0 / max(pixels, 0.001));
  gl_Position = on <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectTileFor3D(a_pos + a_corner * reach * grow, 0.0);
  v_corner = a_corner;
  v_light = colourOf() * on / (grow * grow);
  v_mapped = mod(a_light.y, 2.0);
}`;

const poolFragment = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec3 v_light;
in float v_mapped;
out vec4 fragColor;
void main() {
  float d = dot(v_corner, v_corner);
  if (d > 1.0) discard;
  // A mapped lamp's pool, bright under it; estimated light, a faint glow along the street.
  float light = v_mapped > 0.5 ? exp(-d * 4.0) * 0.42 + exp(-d * 30.0) * 0.32 : exp(-d * 3.0) * 0.14;
  fragColor = vec4(v_light * light * (1.0 - d), 0.0);
}`;

const headVertex = (projected: string) => `#version 300 es
${projected}
${lamp}
void main() {
  float on = switched();
  float height = a_height * 0.1;
  vec4 centre = projectTileFor3D(a_pos, height);
  // The lamp's head is about a metre across; far away it fades rather than shrinking below a pixel.
  float pixels = pixelsOf(centre, projectTileFor3D(a_pos + vec2(1.0 / u_metres, 0.0), height));
  float size = clamp(pixels * 1.4, 1.5, 7.0);
  // Only a mapped lamp shows its head.
  float shown = smoothstep(0.25, 0.9, pixels) * mod(a_light.y, 2.0);
  if (on <= 0.0 || shown <= 0.0 || centre.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = centre + vec4(a_corner * size * 2.0 / u_viewport * centre.w, 0.0, 0.0);
  v_corner = a_corner;
  v_light = mix(colourOf(), vec3(1.0), 0.45) * on * shown;
  v_mapped = 1.0;
}`;

const headFragment = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec3 v_light;
out vec4 fragColor;
void main() {
  float d = dot(v_corner, v_corner);
  if (d > 1.0) discard;
  fragColor = vec4(v_light * (exp(-d * 5.0) * 1.1 + exp(-d * 1.5) * 0.25) * (1.0 - d), 0.0);
}`;
