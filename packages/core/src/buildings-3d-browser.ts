// Tileflow's 3D buildings renderer: a custom WebGL2 layer that raises the buildings of the map's
// own vector tiles round the camera and lights them from the theme controller's sun, with shadows
// cast on the buildings and on the flat map, contact shadow at the foot of the walls, and, at
// night, flood lights at the foot of shops, busy places, landmarks and towers, and the ground floors
// of the places busy at night lit in their own colours. It shows, hides and grows the city without
// laying out any source, so it is a 3D switch and an animatable height.
import {
  meshTileflowBuildings,
  tileflowBuildingExtent,
  type TileflowBuildingMesh,
  tileflowBuildingVertexBytes,
} from './buildings-3d-mesh';
import {
  tileflowBuildingAttributes,
  tileflowBuildingBandFragment,
  tileflowBuildingBandVertex,
  tileflowBuildingDepthFragment,
  tileflowBuildingDepthVertex,
  tileflowBuildingFloodFragment,
  tileflowBuildingFragment,
  tileflowBuildingGroundFragment,
  tileflowBuildingGroundVertex,
  tileflowBuildingVertex,
} from './buildings-3d-shaders';
import {cameraFrame, createCameraTiles} from './camera-tiles-browser';
import {resolveTileflowSun, tileflowDefaultSunPreset, type TileflowSun} from './sun';
import {tileflowColourChannels} from './theme-blend';
import type {TileflowTileRequestTransform} from './tile-reader';

/** The MapLibre GL JS map capabilities the renderer uses. */
export type TileflowBuildings3DMap = {
  addLayer(layer: object, beforeId?: string): unknown;
  getCenter(): {lat: number; lng: number};
  getBearing(): number;
  getLayer(id: string): unknown;
  getPaintProperty(layer: string, name: string): unknown;
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

/** Where the renderer reads the sun and the themes: a Tileflow theme controller. */
export type TileflowBuildings3DThemes = {
  getBlend?(): {position: number; themes: readonly string[]} | undefined;
  getCurrent?(): {theme?: string};
  getSun?(): TileflowSun;
};

export type TileflowBuildings3DOptions = Readonly<{
  map: TileflowBuildings3DMap;
  /** The theme controller, for the sun and, with `color`, the themes on screen. */
  controller?: TileflowBuildings3DThemes;
  /** The vector source to read; defaults to `tileflow`, a Tileflow map's World source. */
  source?: string;
  /** The source layer with the buildings; defaults to `building`. */
  sourceLayer?: string;
  /**
   * The source layer with the places, for the night use of buildings in tiles whose buildings do
   * not carry World's `night_use`; defaults to `poi`.
   */
  placesLayer?: string;
  /**
   * A building's colour for a theme, from its feature properties, as a CSS colour. Each building
   * is coloured once per theme, and the renderer mixes the colours of the themes either side of
   * a blend's position. Without it, buildings take the theme's 3D building colour.
   */
  color?: (
    properties: Readonly<Record<string, string | number | boolean>>,
    theme: string,
  ) => string;
  /** Shadows from the sun, on the buildings and the flat map; defaults to true. */
  shadows?: boolean;
  /** Contact shadow at the foot of the walls and in tight corners; defaults to true. */
  occlusion?: boolean;
  /**
   * At night, flood light at the foot of shops, busy places and landmarks (World's
   * `building_tone`) and of towers, on the wall and the ground, and the ground floor windows of
   * buildings with places busy at night (World's `night_use`) lit and spilling onto the pavement:
   * bars and clubs in neon or a warm light, theatres and cinemas in white, places to eat in amber.
   * Defaults to true.
   */
  floodLights?: boolean;
  /** Invented night windows, lit by rooms; decoration, not data. Defaults to false. */
  windows?: boolean;
  /** The zoom from which buildings stand; below it they sink into the flat map. Defaults to 14.5. */
  minzoom?: number;
  /** The most tiles raised round the camera, from 1 to 64; defaults to 25. */
  maxTiles?: number;
  /** The layer to draw before; defaults to the style's `above-buildings` placement. */
  beforeId?: string;
  /** The map's request rules, for the tiles the renderer reads. */
  transformRequest?: TileflowTileRequestTransform;
}>;

export type TileflowBuildings3DChange = Readonly<{transition?: Readonly<{duration?: number}>}>;

export type TileflowBuildings3D = {
  /** Raises the buildings out of the ground; resolves once they stand. */
  show(options?: TileflowBuildings3DChange): Promise<void>;
  /** Sinks the buildings back into the flat map; resolves once they are gone. */
  hide(options?: TileflowBuildings3DChange): Promise<void>;
  /** Eases the buildings to `scale` of their height, from 0 (flat) to 1. */
  grow(scale: number, options?: TileflowBuildings3DChange): Promise<void>;
  /** The height scale shown now. */
  readonly scale: number;
  /** Tiles raised, buildings and vertices, for diagnostics. */
  readonly stats: Readonly<{tiles: number; buildings: number; vertices: number}>;
  /** Takes the layer off the map and lets go of its buffers. */
  dispose(): void;
};

export const tileflowBuildings3DLayerId = 'tileflow-buildings-3d';
// World's buildings carry their heights at z15; a source that stops earlier is read at its maxzoom.
const preferredZoom = 15;
const defaultTransition = 800;
// Shadows lengthen as the sun sets while they fade: they fall from a sun no lower than 3° and fade
// out between 7° and half a degree.
const shadowFloor = 3;
const shadowFade: readonly [number, number] = [0.5, 7];
const occlusion = {ground: 8, groundStrength: 0.42, wall: 0.36, corner: 3};
const flood = {reach: 10, colour: [1, 0.7, 0.4] as const};
const paletteWidth = 256;
// Street lights draw over the buildings, so their lamps can hide behind them.
const streetLightsLayerId = 'tileflow-street-lights';

type Program = {program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null>};
type Linking = {
  name: string;
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  variant: string;
};
type BuildingTile = {
  mesh: TileflowBuildingMesh;
  gl?: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer};
  palette?: {texture: WebGLTexture; key: string; rows: number};
};
type TileEntry = {x: number; y: number; value: BuildingTile};
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
 * Creates the renderer and puts its layer on the map, flat until `show()`. It reads the source's
 * z15 tiles round the camera, the zoom at which World's buildings carry their heights.
 */
export function createTileflowBuildings3D(
  options: TileflowBuildings3DOptions,
): TileflowBuildings3D {
  const {map} = options;
  const sourceId = options.source ?? 'tileflow';
  const sourceLayer = options.sourceLayer ?? 'building';
  const placesLayer = options.placesLayer ?? 'poi';
  const minzoom = options.minzoom ?? 14.5;
  const maxTiles = Math.round(options.maxTiles ?? 25);
  if (!Number.isFinite(minzoom) || minzoom < 0 || minzoom > 24)
    throw new RangeError('Tileflow 3D buildings minzoom must be a zoom from 0 to 24.');
  if (!(maxTiles >= 1 && maxTiles <= 64))
    throw new RangeError('Tileflow 3D buildings maxTiles must be from 1 to 64.');
  const shadowsOn = options.shadows !== false;
  const occlusionOn = options.occlusion !== false;
  const floodOn = options.floodLights !== false;
  const windowsOn = options.windows === true;

  let scale = 0;
  let target = 0;
  let blank: WebGLTexture | undefined;
  let motion:
    {from: number; to: number; start: number; duration: number; done: () => void} | undefined;
  let gl: WebGL2RenderingContext | undefined;
  let programs: Partial<Record<'buildings' | 'depth' | 'ground' | 'band' | 'flood', Program>> = {};
  let variant: string | undefined;
  let linking: Linking[] | undefined;
  let shadow:
    | {
        texture: WebGLTexture;
        framebuffer: WebGLFramebuffer;
        size: number;
        failed: boolean;
        key?: string;
        light?: {matrix: Float32Array; depth: number; extent: number};
      }
    | undefined;
  let ground: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer} | undefined;
  let disposed = false;
  let colourCache: {text: string; rgb: [number, number, number]} | undefined;

  const layer = {
    id: tileflowBuildings3DLayerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      gl = context;
      createShadowMap(context);
      createGround(context);
      // A sampler always has a colour texture to read, palette or not.
      blank = context.createTexture()!;
      context.bindTexture(context.TEXTURE_2D, blank);
      context.texImage2D(
        context.TEXTURE_2D,
        0,
        context.RGBA8,
        1,
        1,
        0,
        context.RGBA,
        context.UNSIGNED_BYTE,
        new Uint8Array([216, 208, 192, 255]),
      );
    },
    onRemove(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      for (const entry of camera.all()) if (entry.value) release(context, entry.value);
      for (const program of Object.values(programs))
        if (program) context.deleteProgram(program.program);
      for (const entry of linking ?? []) context.deleteProgram(entry.program);
      if (shadow) {
        context.deleteFramebuffer(shadow.framebuffer);
        context.deleteTexture(shadow.texture);
      }
      if (ground) {
        context.deleteVertexArray(ground.vao);
        context.deleteBuffer(ground.vbo);
      }
      if (blank) context.deleteTexture(blank);
      blank = undefined;
      programs = {};
      linking = undefined;
      variant = undefined;
      shadow = undefined;
      ground = undefined;
      gl = undefined;
    },
    prerender(context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context) || !programs.depth || visibleScale() <= 0) return;
      try {
        renderShadows(context);
      } catch {
        if (shadow) shadow.failed = true;
      }
    },
    render(context: WebGLRenderingContext | WebGL2RenderingContext, args: ProjectionArgs) {
      if (!isWebGL2(context)) return;
      try {
        if (
          variant !== args.shaderData.variantName &&
          linking?.[0]?.variant !== args.shaderData.variantName
        )
          link(context, args.shaderData);
        if (linking && !linked(context)) {
          map.triggerRepaint();
          return;
        }
      } catch {
        return;
      }
      if (visibleScale() <= 0) return;
      upload(context);
      draw(context, args);
    },
  };

  // --- Tiles round the camera ---

  const camera = createCameraTiles<BuildingTile>({
    map,
    source: sourceId,
    layers: [sourceLayer, placesLayer],
    zoom: preferredZoom,
    minzoom,
    maxTiles,
    ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
    active: () => target > 0 || scale > 0,
    build(tile, tileMetres) {
      const decoded = tile.layers[sourceLayer];
      // A tile without buildings stays flat.
      if (!decoded) return emptyTile;
      const places = tile.layers[placesLayer];
      const mesh = meshTileflowBuildings(decoded, {tileMetres, ...(places ? {places} : {})});
      return mesh ? {mesh} : emptyTile;
    },
    empty: emptyTile,
    release(value) {
      if (gl) release(gl, value);
    },
    changed() {
      if (shadow) shadow.key = undefined;
    },
  });

  function release(context: WebGL2RenderingContext, tile: BuildingTile): void {
    if (tile.gl) {
      context.deleteVertexArray(tile.gl.vao);
      context.deleteBuffer(tile.gl.vbo);
      context.deleteBuffer(tile.gl.ibo);
      tile.gl = undefined;
    }
    if (tile.palette) {
      context.deleteTexture(tile.palette.texture);
      tile.palette = undefined;
    }
  }

  /** Uploads up to two meshed tiles a frame. */
  function upload(context: WebGL2RenderingContext): void {
    let budget = 2;
    for (const {value: entry} of camera.ready()) {
      if (entry.gl) continue;
      if (budget-- <= 0) {
        map.triggerRepaint();
        break;
      }
      const vao = context.createVertexArray()!;
      context.bindVertexArray(vao);
      const vbo = context.createBuffer()!;
      context.bindBuffer(context.ARRAY_BUFFER, vbo);
      context.bufferData(context.ARRAY_BUFFER, entry.mesh.vertices, context.STATIC_DRAW);
      for (const [
        index,
        [, size, type, normalised, offset],
      ] of tileflowBuildingAttributes.entries()) {
        context.enableVertexAttribArray(index);
        context.vertexAttribPointer(
          index,
          size,
          context[type],
          normalised,
          tileflowBuildingVertexBytes,
          offset,
        );
      }
      const ibo = context.createBuffer()!;
      context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, ibo);
      context.bufferData(context.ELEMENT_ARRAY_BUFFER, entry.mesh.indices, context.STATIC_DRAW);
      context.bindVertexArray(null);
      entry.gl = {vao, vbo, ibo};
      if (shadow) shadow.key = undefined;
    }
  }

  // --- Colours ---

  /** The themes a palette covers and where the blend stands between them. */
  function themesOnScreen(): {
    themes: readonly string[];
    lower: number;
    upper: number;
    mix: number;
  } {
    const blend = options.controller?.getBlend?.();
    if (blend && blend.themes.length > 0) {
      const position = Math.min(blend.themes.length - 1, Math.max(0, blend.position));
      const lower = Math.floor(position);
      return {
        themes: blend.themes,
        lower,
        upper: Math.min(blend.themes.length - 1, lower + 1),
        mix: position - lower,
      };
    }
    const theme = options.controller?.getCurrent?.().theme ?? 'default';
    return {themes: [theme], lower: 0, upper: 0, mix: 0};
  }

  /** A tile's colours per theme, one texel per building, when the application colours them. */
  function paletteOf(
    context: WebGL2RenderingContext,
    entry: BuildingTile,
    themes: readonly string[],
  ) {
    const color = options.color;
    if (!color) return undefined;
    const key = themes.join('\u0000');
    if (entry.palette?.key === key) return entry.palette;
    const features = entry.mesh.features;
    const rows = Math.max(1, Math.ceil(features.length / paletteWidth));
    const data = new Uint8Array(paletteWidth * rows * themes.length * 4);
    for (const [themeIndex, theme] of themes.entries()) {
      for (const [index, properties] of features.entries()) {
        let channels: readonly number[] = [0.85, 0.82, 0.76, 1];
        try {
          channels = tileflowColourChannels(color(properties, theme)) ?? channels;
        } catch {
          // A colour the application cannot give keeps the default.
        }
        const at =
          ((themeIndex * rows + Math.floor(index / paletteWidth)) * paletteWidth +
            (index % paletteWidth)) *
          4;
        data[at] = Math.round(channels[0]! * 255);
        data[at + 1] = Math.round(channels[1]! * 255);
        data[at + 2] = Math.round(channels[2]! * 255);
        data[at + 3] = 255;
      }
    }
    const texture = entry.palette?.texture ?? context.createTexture()!;
    context.bindTexture(context.TEXTURE_2D, texture);
    context.texImage2D(
      context.TEXTURE_2D,
      0,
      context.RGBA8,
      paletteWidth,
      rows * themes.length,
      0,
      context.RGBA,
      context.UNSIGNED_BYTE,
      data,
    );
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
    entry.palette = {texture, key, rows};
    return entry.palette;
  }

  /** The theme's 3D building colour, as the map shows it now, blends included. */
  function themeColour(): [number, number, number] {
    let text: unknown;
    for (const [layerId, property] of [
      ['tileflow-buildings-render-extrusion', 'fill-extrusion-color'],
      ['tileflow-buildings-fill', 'fill-color'],
    ] as const) {
      if (!map.getLayer(layerId)) continue;
      const value = map.getPaintProperty(layerId, property);
      if (typeof value === 'string') {
        text = value;
        break;
      }
    }
    const value = typeof text === 'string' ? text : '#d8d0c0';
    if (colourCache?.text === value) return colourCache.rgb;
    const channels = tileflowColourChannels(value) ?? [0.85, 0.82, 0.76, 1];
    colourCache = {text: value, rgb: [channels[0], channels[1], channels[2]]};
    return colourCache.rgb;
  }

  // --- Light ---

  function sunNow(): TileflowSun {
    return options.controller?.getSun?.() ?? resolveTileflowSun(tileflowDefaultSunPreset);
  }

  function lighting() {
    const sun = sunNow();
    const linear = (value: number) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    const sunLight = sun.rgb.map((channel) => linear(channel) * sun.intensity);
    const skyLight = sun.ambient.rgb.map((channel) => linear(channel) * sun.ambient.intensity);
    const up = sun.direction[2];
    const groundShadow = skyLight.map((sky, channel) => {
      const lit = sky + sunLight[channel]! * Math.max(0, up);
      return lit > 1e-5 ? (sky / lit) ** (1 / 2.2) : 1;
    });
    const floor = (Math.max(shadowFloor, sun.altitude) * Math.PI) / 180;
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
    const strength = shadowsOn
      ? Math.min(1, sun.shadowIntensity) *
        Math.min(1, sun.intensity * 4) *
        low *
        low *
        (3 - 2 * low)
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

  // --- Drawing ---

  /** The height scale times the fade below `minzoom`. */
  function visibleScale(): number {
    const fade = Math.min(1, Math.max(0, (map.getZoom() - (minzoom - 0.5)) / 0.5));
    return scale * fade;
  }

  function drawn(): TileEntry[] {
    return camera.ready().filter((entry) => entry.value.gl);
  }

  function box(entries: readonly TileEntry[]) {
    let [left, top, right, bottom, tallest] = [Infinity, Infinity, -Infinity, -Infinity, 0];
    for (const entry of entries) {
      left = Math.min(left, entry.x);
      top = Math.min(top, entry.y);
      right = Math.max(right, entry.x);
      bottom = Math.max(bottom, entry.y);
      tallest = Math.max(tallest, entry.value.mesh.top);
    }
    const unit = tileflowBuildingExtent * camera.metres;
    const origin = camera.origin;
    return {
      min: [(left - origin[0]) * unit, -(bottom + 1 - origin[1]) * unit, 0] as const,
      max: [
        (right + 1 - origin[0]) * unit,
        -(top - origin[1]) * unit,
        tallest * visibleScale(),
      ] as const,
      tiles: [left, top, right, bottom] as const,
      tallest,
    };
  }

  function renderShadows(context: WebGL2RenderingContext): void {
    if (!shadow || shadow.failed) return;
    const light = lighting();
    const entries = drawn();
    if (light.strength <= 0 || entries.length === 0) {
      shadow.light = undefined;
      return;
    }
    const scene = box(entries);
    const key = [
      ...light.shadowDirection.map((value) => value.toFixed(5)),
      visibleScale().toFixed(4),
      entries.length,
      camera.origin.join(),
    ].join();
    if (key === shadow.key && shadow.light) return;
    shadow.light = tileflowSunLightMatrix(light.shadowDirection, scene);
    shadow.key = key;
    const program = programs.depth!;
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
    context.useProgram(program.program);
    context.uniform1f(program.uniforms.u_scale!, visibleScale());
    context.uniform1f(program.uniforms.u_metres!, camera.metres);
    context.uniformMatrix4fv(program.uniforms.u_light_matrix!, false, shadow.light.matrix);
    for (const {x, y, value} of entries) {
      context.uniform2f(program.uniforms.u_offset!, ...camera.offsetOf({x, y}));
      context.bindVertexArray(value.gl!.vao);
      context.drawElements(context.TRIANGLES, value.mesh.indices.length, context.UNSIGNED_INT, 0);
    }
    context.bindVertexArray(null);
    context.disable(context.POLYGON_OFFSET_FILL);
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    context.viewport(0, 0, context.drawingBufferWidth, context.drawingBufferHeight);
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

  function setShadow(context: WebGL2RenderingContext, program: Program, strength: number) {
    const uniforms = program.uniforms;
    const on = strength > 0 && shadow?.light && !shadow.failed;
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, shadow?.texture ?? null);
    context.uniform1i(uniforms.u_shadow_map!, 0);
    context.uniform1f(uniforms.u_shadow!, on ? strength : 0);
    if (!on || !shadow?.light) return;
    context.uniformMatrix4fv(uniforms.u_light_matrix!, false, shadow.light.matrix);
    context.uniform2f(uniforms.u_shadow_texel!, 1 / shadow.size, 1 / shadow.size);
    context.uniform1f(uniforms.u_depth_unit!, 1 / shadow.light.depth);
    context.uniform1f(uniforms.u_normal_offset!, (shadow.light.extent / shadow.size) * 1.2);
  }

  function draw(context: WebGL2RenderingContext, args: ProjectionArgs): void {
    const entries = drawn();
    if (entries.length === 0) return;
    const light = lighting();
    const shown = visibleScale();
    const themes = options.color ? themesOnScreen() : undefined;

    const buildings = programs.buildings!;
    const u = buildings.uniforms;
    context.useProgram(buildings.program);
    context.uniform1f(u.u_scale!, shown);
    context.uniform1f(u.u_metres!, camera.metres);
    context.uniform3fv(u.u_colour!, themeColour());
    context.uniform3fv(u.u_sun_dir!, [...light.direction]);
    context.uniform3fv(u.u_shadow_dir!, light.shadowDirection);
    context.uniform3fv(u.u_sun_light!, light.sunLight);
    context.uniform3fv(u.u_sky_light!, light.skyLight);
    context.uniform1f(u.u_occlusion!, occlusionOn ? occlusion.wall : 0);
    context.uniform1f(u.u_corner!, occlusion.corner);
    context.uniform1f(u.u_night!, light.night);
    context.uniform1f(u.u_windows!, windowsOn ? 1 : 0);
    context.uniform1f(u.u_flood!, floodOn ? light.night : 0);
    context.uniform3fv(u.u_flood_colour!, flood.colour);
    setShadow(context, buildings, light.strength);
    for (const {x, y, value: entry} of entries) {
      project(context, buildings, args, x, y);
      context.uniform2f(u.u_offset!, ...camera.offsetOf({x, y}));
      const palette = themes ? paletteOf(context, entry, themes.themes) : undefined;
      context.uniform1f(u.u_palette_on!, palette ? 1 : 0);
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, palette?.texture ?? blank ?? null);
      context.uniform1i(u.u_palette!, 1);
      if (palette && themes) {
        context.uniform2f(u.u_palette_rows!, palette.rows, paletteWidth);
        context.uniform2f(u.u_palette_themes!, themes.lower, themes.upper);
        context.uniform1f(u.u_palette_mix!, themes.mix);
      }
      context.bindVertexArray(entry.gl!.vao);
      context.drawElements(context.TRIANGLES, entry.mesh.indices.length, context.UNSIGNED_INT, 0);
    }

    // The ground: shadows, the contact band and, at night, the flood lights.
    context.depthMask(false);
    context.enable(context.BLEND);
    context.blendFuncSeparate(context.DST_COLOR, context.ZERO, context.ZERO, context.ONE);
    if (light.strength > 0 && shadow?.light && !shadow.failed && ground) {
      const program = programs.ground!;
      context.useProgram(program.program);
      context.uniform1f(program.uniforms.u_metres!, camera.metres);
      context.uniform3fv(program.uniforms.u_ground_shadow!, light.groundShadow);
      setShadow(context, program, light.strength);
      context.bindVertexArray(ground.vao);
      const scene = box(entries);
      const longest = Math.min(
        4,
        Math.ceil(
          (scene.tallest * shown) /
            Math.tan((shadowFloor * Math.PI) / 180) /
            (tileflowBuildingExtent * camera.metres),
        ),
      );
      const margin = Math.max(1, longest);
      const [left, top, right, bottom] = scene.tiles;
      for (let x = left - margin; x <= right + margin; x += 1)
        for (let y = top - margin; y <= bottom + margin; y += 1) {
          project(context, program, args, x, y);
          context.uniform2f(program.uniforms.u_offset!, ...camera.offsetOf({x, y}));
          context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
        }
    }
    const walls = (program: Program) => {
      for (const {x, y, value} of entries) {
        const mesh = value.mesh;
        if (mesh.indices.length <= mesh.wallsFrom) continue;
        project(context, program, args, x, y);
        context.uniform2f(program.uniforms.u_offset!, ...camera.offsetOf({x, y}));
        context.bindVertexArray(value.gl!.vao);
        context.drawElements(
          context.TRIANGLES,
          mesh.indices.length - mesh.wallsFrom,
          context.UNSIGNED_INT,
          mesh.wallsFrom * 4,
        );
      }
    };
    if (occlusionOn) {
      const program = programs.band!;
      context.useProgram(program.program);
      context.uniform1f(program.uniforms.u_scale!, shown);
      context.uniform1f(program.uniforms.u_metres!, camera.metres);
      context.uniform1f(program.uniforms.u_band!, occlusion.ground);
      context.uniform1f(program.uniforms.u_band_strength!, occlusion.groundStrength);
      walls(program);
    }
    if (floodOn && light.night > 0.01) {
      const program = programs.flood!;
      context.useProgram(program.program);
      context.blendFuncSeparate(context.ONE, context.ONE, context.ZERO, context.ONE);
      context.uniform1f(program.uniforms.u_scale!, shown);
      context.uniform1f(program.uniforms.u_metres!, camera.metres);
      context.uniform1f(program.uniforms.u_band!, flood.reach);
      context.uniform1f(program.uniforms.u_flood!, light.night);
      context.uniform3fv(program.uniforms.u_flood_colour!, flood.colour);
      walls(program);
    }
    context.bindVertexArray(null);
    context.depthMask(true);
  }

  // --- Programs ---

  function link(context: WebGL2RenderingContext, shaderData: ProjectionArgs['shaderData']): void {
    for (const entry of linking ?? []) context.deleteProgram(entry.program);
    const projected = `${shaderData.vertexShaderPrelude}\n${shaderData.define}`;
    const sources: Record<string, [string, string]> = {
      buildings: [tileflowBuildingVertex(projected), tileflowBuildingFragment],
      ground: [tileflowBuildingGroundVertex(projected), tileflowBuildingGroundFragment],
      band: [tileflowBuildingBandVertex(projected), tileflowBuildingBandFragment],
      flood: [tileflowBuildingBandVertex(projected), tileflowBuildingFloodFragment],
    };
    if (!programs.depth)
      sources.depth = [tileflowBuildingDepthVertex, tileflowBuildingDepthFragment];
    linking = Object.entries(sources).map(([name, [vertexText, fragmentText]]) => {
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
      for (const [index, [attribute]] of tileflowBuildingAttributes.entries())
        context.bindAttribLocation(program, index, attribute);
      context.linkProgram(program);
      return {name, program, vertex, fragment, variant: shaderData.variantName};
    });
  }

  function linked(context: WebGL2RenderingContext): boolean {
    const parallel = context.getExtension('KHR_parallel_shader_compile') as {
      COMPLETION_STATUS_KHR: number;
    } | null;
    const entries = linking!;
    if (
      parallel &&
      entries.some(
        ({program}) => !context.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR),
      )
    )
      return false;
    linking = undefined;
    const failures: string[] = [];
    for (const {program, vertex, fragment} of entries) {
      if (!context.getProgramParameter(program, context.LINK_STATUS))
        failures.push(
          `${context.getShaderInfoLog(vertex) ?? ''} ${context.getShaderInfoLog(fragment) ?? ''} ${context.getProgramInfoLog(program) ?? ''}`,
        );
      context.deleteShader(vertex);
      context.deleteShader(fragment);
    }
    if (failures.length) {
      for (const {program} of entries) context.deleteProgram(program);
      throw new Error(`Tileflow 3D buildings shaders failed to link: ${failures.join('\n')}`);
    }
    for (const {name, program} of entries) {
      const previous = programs[name as keyof typeof programs];
      if (previous) context.deleteProgram(previous.program);
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      const count = context.getProgramParameter(program, context.ACTIVE_UNIFORMS) as number;
      for (let index = 0; index < count; index += 1) {
        const info = context.getActiveUniform(program, index);
        if (info)
          uniforms[info.name.replace(/\[0\]$/u, '')] = context.getUniformLocation(
            program,
            info.name,
          );
      }
      programs[name as keyof typeof programs] = {program, uniforms};
    }
    variant = entries[0]!.variant;
    return true;
  }

  function createShadowMap(context: WebGL2RenderingContext): void {
    if (shadow) return;
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
    shadow = {texture, framebuffer, size, failed: !complete};
  }

  function createGround(context: WebGL2RenderingContext): void {
    if (ground) return;
    const vao = context.createVertexArray()!;
    context.bindVertexArray(vao);
    const vbo = context.createBuffer()!;
    context.bindBuffer(context.ARRAY_BUFFER, vbo);
    const extent = tileflowBuildingExtent;
    context.bufferData(
      context.ARRAY_BUFFER,
      new Uint16Array([0, 0, extent, 0, 0, extent, extent, extent]),
      context.STATIC_DRAW,
    );
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, 2, context.UNSIGNED_SHORT, false, 0, 0);
    context.bindVertexArray(null);
    ground = {vao, vbo};
  }

  // --- The layer on the map ---

  function beforeId(): string | undefined {
    if (options.beforeId) return map.getLayer(options.beforeId) ? options.beforeId : undefined;
    if (map.getLayer(streetLightsLayerId)) return streetLightsLayerId;
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
    if (disposed || map.getLayer(tileflowBuildings3DLayerId) || !map.isStyleLoaded()) return;
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

  // --- Motion ---

  function grow(goal: number, change?: TileflowBuildings3DChange): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!Number.isFinite(goal))
      return Promise.reject(new RangeError('A height scale is a number from 0 to 1.'));
    const to = Math.min(1, Math.max(0, goal));
    motion?.done();
    const duration = change?.transition?.duration ?? defaultTransition;
    if (!(duration >= 0 && duration <= 10_000))
      return Promise.reject(new RangeError('A transition lasts from 0 to 10000 ms.'));
    attach();
    target = to;
    if (to > 0) camera.update();
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (duration === 0 || reduced) {
      scale = to;
      motion = undefined;
      map.triggerRepaint();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const current = {from: scale, to, start: performance.now(), duration, done: () => resolve()};
      motion = current;
      const step = () => {
        if (motion !== current || disposed) {
          resolve();
          return;
        }
        const t = Math.min(1, (performance.now() - current.start) / duration);
        const eased = t * t * (3 - 2 * t);
        scale = current.from + (current.to - current.from) * eased;
        map.triggerRepaint();
        if (t >= 1) {
          motion = undefined;
          resolve();
        } else cameraFrame(step);
      };
      cameraFrame(step);
    });
  }

  return {
    show: (change) => grow(1, change),
    hide: (change) => grow(0, change),
    grow,
    get scale() {
      return scale;
    },
    get stats() {
      let buildings = 0;
      let vertices = 0;
      let raised = 0;
      for (const {value} of drawn()) {
        raised += 1;
        buildings += value.mesh.features.length;
        vertices += value.mesh.vertices.length / tileflowBuildingVertexBytes;
      }
      return {tiles: raised, buildings, vertices};
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion?.done();
      map.off('styledata', onStyle);
      map.off('idle', onStyle);
      try {
        if (map.getLayer(tileflowBuildings3DLayerId)) map.removeLayer(tileflowBuildings3DLayerId);
      } catch {
        // A map already removed has no layers left to remove.
      }
      camera.dispose();
    },
  };
}

const emptyTile: BuildingTile = Object.freeze({
  mesh: Object.freeze({
    vertices: new Uint8Array(0),
    indices: new Uint32Array(0),
    wallsFrom: 0,
    top: 0,
    features: [],
  }),
});

function isWebGL2(context: unknown): context is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
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
