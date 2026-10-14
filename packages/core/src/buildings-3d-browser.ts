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
import {
  readTileflowBuildings3D,
  type TileflowBuildings3DDesign,
  tileflowBuildingsMetadataKey,
  tileflowDefaultBuildings3DDesign,
} from './buildings-3d-design';
import {cameraFrame, createCameraTiles} from './camera-tiles-browser';
import {tileflowFeatureColour} from './feature-colour-browser';
import {
  tileflowScene3D,
  type TileflowSceneCaster,
  tileflowSceneLight,
  tileflowSceneShadowFloor,
} from './scene-3d-browser';
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

/** Where the renderer reads the sun and the map's design: a Tileflow theme controller. */
export type TileflowBuildings3DThemes = {
  getSun?(): TileflowSun;
  getThemeMetadata?(key: string): Readonly<{values: readonly unknown[]; position: number}>;
};

export type TileflowBuildings3DOptions = Readonly<{
  map: TileflowBuildings3DMap;
  /** The theme controller, for the sun and the buildings' design in every theme. */
  controller?: TileflowBuildings3DThemes;
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
  /**
   * Whether the map's style describes its 3D buildings (the buildings module's
   * `threeDimensional`), tiles raised, buildings and vertices, for diagnostics.
   */
  readonly stats: Readonly<{declared: boolean; tiles: number; buildings: number; vertices: number}>;
  /** Takes the layer off the map and lets go of its buffers. */
  dispose(): void;
};

export const tileflowBuildings3DLayerId = 'tileflow-buildings-3d';
// World's buildings carry their heights at z15; a source that stops earlier is read at its maxzoom.
const preferredZoom = 15;
const defaultTransition = 800;
const occlusion = {ground: 8, groundStrength: 0.42, wall: 0.36, corner: 3};
const flood = {reach: 10, colour: [1, 0.7, 0.4] as const};
// Each building strays up to 6% lighter or darker than its colour.
const variation = 0.06;
// Roof outlines and outer corners are a CSS pixel wide, and half as strong by day as at night.
const edgeLine = {width: 1, day: 0.5};
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
  const minzoom = options.minzoom ?? 14.5;
  const maxTiles = Math.round(options.maxTiles ?? 25);
  if (!Number.isFinite(minzoom) || minzoom < 0 || minzoom > 24)
    throw new RangeError('Tileflow 3D buildings minzoom must be a zoom from 0 to 24.');
  if (!(maxTiles >= 1 && maxTiles <= 64))
    throw new RangeError('Tileflow 3D buildings maxTiles must be from 1 to 64.');

  let scale = 0;
  let target = 0;
  let blank: WebGLTexture | undefined;
  let motion:
    {from: number; to: number; start: number; duration: number; done: () => void} | undefined;
  let gl: WebGL2RenderingContext | undefined;
  let programs: Partial<Record<'buildings' | 'depth' | 'ground' | 'band' | 'flood', Program>> = {};
  let variant: string | undefined;
  let linking: Linking[] | undefined;
  let ground: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer} | undefined;
  let disposed = false;
  // Shadows are drawn in the map's shared 3D scene, with any other 3D layer on the map.
  const scene = tileflowScene3D(map);
  let generation = 0;
  let registered = false;
  let unregister = () => {};

  const layer = {
    id: tileflowBuildings3DLayerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      gl = context;
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
      unregister();
      registered = false;
      scene.release(context);
      if (ground) {
        context.deleteVertexArray(ground.vao);
        context.deleteBuffer(ground.vbo);
      }
      if (blank) context.deleteTexture(blank);
      blank = undefined;
      programs = {};
      linking = undefined;
      variant = undefined;
      ground = undefined;
      gl = undefined;
    },
    prerender(context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      ensureCamera();
      if (!programs.depth) return;
      if (!registered) unregister = scene.register(caster);
      registered = true;
      scene.prepare(context, lighting(), camera.metres);
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

  // The tiles are read from the source and layers the map's design names; a style that names
  // others reads them anew.
  const makeCamera = (layers: TileflowBuildings3DDesign['layers'], source: string) =>
    createCameraTiles<BuildingTile>({
      map,
      source,
      layers: [layers.building, ...(layers.places ? [layers.places] : [])],
      zoom: preferredZoom,
      minzoom,
      maxTiles,
      ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
      active: () => target > 0 || scale > 0,
      build(tile, tileMetres) {
        const decoded = tile.layers[layers.building];
        // A tile without buildings stays flat.
        if (!decoded) return emptyTile;
        const places = layers.places ? tile.layers[layers.places] : undefined;
        const mesh = meshTileflowBuildings(decoded, {tileMetres, ...(places ? {places} : {})});
        return mesh ? {mesh} : emptyTile;
      },
      empty: emptyTile,
      release(value) {
        if (gl) release(gl, value);
      },
      changed() {
        generation += 1;
      },
    });
  let cameraKey = JSON.stringify([
    tileflowDefaultBuildings3DDesign.source,
    tileflowDefaultBuildings3DDesign.layers,
  ]);
  let camera = makeCamera(
    tileflowDefaultBuildings3DDesign.layers,
    tileflowDefaultBuildings3DDesign.source,
  );

  /** Reads the tiles the map's design names. */
  function ensureCamera(): void {
    const {source, layers} = design();
    const key = JSON.stringify([source, layers]);
    if (key === cameraKey) return;
    for (const entry of camera.all()) if (entry.value && gl) release(gl, entry.value);
    camera.dispose();
    cameraKey = key;
    camera = makeCamera(layers, source);
    generation += 1;
    if (target > 0) camera.update();
  }

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
      generation += 1;
    }
  }

  // --- Colours ---

  // --- The map's design ---

  let designs:
    | {values: readonly unknown[]; parsed: TileflowBuildings3DDesign[]; declared: boolean}
    | undefined;

  /**
   * The design of every theme on screen and where the blend stands between them. A style compiled
   * without a design takes the defaults, coloured as the map paints its buildings now.
   */
  function designsOnScreen(): {
    themes: readonly TileflowBuildings3DDesign[];
    lower: number;
    upper: number;
    mix: number;
  } {
    const read = options.controller?.getThemeMetadata?.(tileflowBuildingsMetadataKey) ?? {
      values: [
        (map.getStyle() as {metadata?: Record<string, unknown>} | undefined)?.metadata?.[
          tileflowBuildingsMetadataKey
        ],
      ],
      position: 0,
    };
    if (
      !designs ||
      designs.values.length !== read.values.length ||
      designs.values.some((value, index) => value !== read.values[index])
    ) {
      const parsed = read.values.map((value) =>
        readTileflowBuildings3D({[tileflowBuildingsMetadataKey]: value}),
      );
      designs = {
        values: read.values,
        parsed: parsed.map((entry) => entry ?? tileflowDefaultBuildings3DDesign),
        declared: parsed.some((entry) => entry !== undefined),
      };
    }
    const count = designs.parsed.length;
    const position = Math.min(count - 1, Math.max(0, read.position));
    const lower = Math.floor(position);
    return {
      themes: designs.parsed,
      lower,
      upper: Math.min(count - 1, lower + 1),
      mix: position - lower,
    };
  }

  /** The design of the theme nearest the blend's position, for what cannot be mixed. */
  function design(): TileflowBuildings3DDesign {
    const {themes, lower, upper, mix} = designsOnScreen();
    return themes[mix < 0.5 ? lower : upper] ?? tileflowDefaultBuildings3DDesign;
  }

  /** A number of the design mixed between the themes either side of the blend's position. */
  function mixed(read: (design: TileflowBuildings3DDesign) => number): number {
    const {themes, lower, upper, mix} = designsOnScreen();
    return read(themes[lower]!) * (1 - mix) + read(themes[upper]!) * mix;
  }

  const parsedColours = new Map<string, readonly [number, number, number] | undefined>();
  function rgbOf(text: string | undefined): readonly [number, number, number] | undefined {
    if (text === undefined) return undefined;
    if (!parsedColours.has(text)) {
      const channels = tileflowColourChannels(text);
      parsedColours.set(text, channels ? [channels[0], channels[1], channels[2]] : undefined);
    }
    return parsedColours.get(text);
  }

  /**
   * The design's edge colour on screen, mixed between the themes either side of a blend, and how
   * much of the edges it colours: 1 where every theme on screen has one, 0 where none has.
   */
  function edgeColourNow(): {rgb: number[]; share: number} {
    const {themes, lower, upper, mix} = designsOnScreen();
    const below = rgbOf(themes[lower]!.edgeColor);
    const above = lower === upper ? undefined : rgbOf(themes[upper]!.edgeColor);
    const weights = [below ? 1 - (lower === upper ? 0 : mix) : 0, above ? mix : 0];
    const share = weights[0]! + weights[1]!;
    if (share <= 0) return {rgb: [1, 1, 1], share: 0};
    return {
      rgb: [0, 1, 2].map(
        (channel) =>
          ((below?.[channel] ?? 0) * weights[0]! + (above?.[channel] ?? 0) * weights[1]!) / share,
      ),
      share,
    };
  }

  /** Whether any theme on screen colours its buildings by their data. */
  function colouredByData(): boolean {
    return designsOnScreen().themes.some((entry) => typeof entry.color !== 'string');
  }

  /** A tile's colours per theme on screen, one texel per building, when they depend on data. */
  function paletteOf(
    context: WebGL2RenderingContext,
    entry: BuildingTile,
    themes: readonly TileflowBuildings3DDesign[],
  ) {
    const key = JSON.stringify(themes.map((theme) => theme.color));
    if (entry.palette?.key === key) return entry.palette;
    const features = entry.mesh.features;
    const rows = Math.max(1, Math.ceil(features.length / paletteWidth));
    const data = new Uint8Array(paletteWidth * rows * themes.length * 4);
    for (const [themeIndex, theme] of themes.entries()) {
      for (const [index, properties] of features.entries()) {
        const channels: readonly number[] = tileflowFeatureColour(
          theme.color,
          properties,
          tileflowColourChannels,
        ) ?? [0.85, 0.82, 0.76];
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

  /**
   * The buildings' colour when it does not depend on their data: the design's colour, mixed between
   * the themes either side of a blend, or, for a style compiled without a design, the colour the map
   * paints its buildings now.
   */
  function themeColour(): [number, number, number] {
    designsOnScreen();
    if (designs?.declared) {
      const {themes, lower, upper, mix} = designsOnScreen();
      const below = rgbOf(
        typeof themes[lower]!.color === 'string' ? (themes[lower]!.color as string) : undefined,
      );
      const above = rgbOf(
        typeof themes[upper]!.color === 'string' ? (themes[upper]!.color as string) : undefined,
      );
      const a = below ?? above ?? [0.85, 0.82, 0.76];
      const b = above ?? a;
      return [0, 1, 2].map((channel) => a[channel]! + (b[channel]! - a[channel]!) * mix) as [
        number,
        number,
        number,
      ];
    }
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
    return [...(rgbOf(typeof text === 'string' ? text : '#d8d0c0') ?? [0.85, 0.82, 0.76])] as [
      number,
      number,
      number,
    ];
  }

  // --- Light ---

  function sunNow(): TileflowSun {
    return options.controller?.getSun?.() ?? resolveTileflowSun(tileflowDefaultSunPreset);
  }

  function lighting() {
    return tileflowSceneLight(sunNow(), design().shadows);
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

  // --- Shadows, in the map's shared 3D scene ---

  const caster: TileflowSceneCaster = {
    groundOrder: 0,
    bounds() {
      const shown = visibleScale();
      const entries = drawn();
      if (shown <= 0 || entries.length === 0) return undefined;
      let [left, top, right, bottom, tallest] = [Infinity, Infinity, -Infinity, -Infinity, 0];
      for (const entry of entries) {
        left = Math.min(left, entry.x);
        top = Math.min(top, entry.y);
        right = Math.max(right, entry.x);
        bottom = Math.max(bottom, entry.y);
        tallest = Math.max(tallest, entry.value.mesh.top);
      }
      return {zoom: camera.zoom, tiles: [left, top, right, bottom], tallest: tallest * shown};
    },
    key: () => `buildings:${visibleScale().toFixed(4)}:${generation}:${programs.depth ? 1 : 0}`,
    drawDepth(context, frame) {
      const program = programs.depth;
      if (!program) return;
      context.useProgram(program.program);
      context.uniform1f(program.uniforms.u_scale!, visibleScale());
      context.uniform1f(program.uniforms.u_metres!, frame.metres);
      context.uniformMatrix4fv(program.uniforms.u_light_matrix!, false, frame.light.matrix);
      for (const {x, y, value} of drawn()) {
        context.uniform2f(program.uniforms.u_offset!, ...frame.offsetOf({x, y}, camera.zoom));
        context.bindVertexArray(value.gl!.vao);
        context.drawElements(context.TRIANGLES, value.mesh.indices.length, context.UNSIGNED_INT, 0);
      }
    },
  };

  /** A tile's corner and the metres per tile unit in the frame shadows are drawn in. */
  function placed(x: number, y: number): {offset: [number, number]; metres: number} {
    const frame = scene.frame();
    return frame && frame.zoom === camera.zoom
      ? {offset: frame.offsetOf({x, y}, camera.zoom), metres: frame.metres}
      : {offset: camera.offsetOf({x, y}), metres: camera.metres};
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

  /** Drawing buffer pixels per CSS pixel. */
  function pixelRatio(context: WebGL2RenderingContext): number {
    const canvas = context.canvas as {clientWidth?: number};
    const width = canvas.clientWidth;
    return width ? Math.min(4, Math.max(1, context.drawingBufferWidth / width)) : 1;
  }

  function draw(context: WebGL2RenderingContext, args: ProjectionArgs): void {
    const entries = drawn();
    if (entries.length === 0) return;
    const light = lighting();
    const shown = visibleScale();
    const themes = colouredByData() ? designsOnScreen() : undefined;
    const nightLight = mixed((entry) => entry.nightLight);
    const edges = mixed((entry) => entry.edges);
    const {occlusion: occlusionOn, windows: windowsOn} = design();

    const buildings = programs.buildings!;
    const u = buildings.uniforms;
    context.useProgram(buildings.program);
    context.uniform1f(u.u_scale!, shown);
    context.uniform1f(u.u_metres!, placed(0, 0).metres);
    context.uniform3fv(u.u_colour!, themeColour());
    context.uniform3fv(u.u_sun_dir!, [...light.direction]);
    context.uniform3fv(u.u_shadow_dir!, light.shadowDirection);
    context.uniform3fv(u.u_sun_light!, light.sunLight);
    context.uniform3fv(u.u_sky_light!, light.skyLight);
    context.uniform1f(u.u_occlusion!, occlusionOn ? occlusion.wall : 0);
    context.uniform1f(u.u_corner!, occlusion.corner);
    context.uniform1f(u.u_night!, light.night);
    context.uniform1f(u.u_windows!, windowsOn ? 1 : 0);
    context.uniform1f(u.u_flood!, light.night * nightLight);
    context.uniform3fv(u.u_flood_colour!, flood.colour);
    context.uniform1f(u.u_variation!, variation);
    const edgeColour = edgeColourNow();
    const lightEdge = edges * (edgeLine.day + (1 - edgeLine.day) * light.night);
    context.uniform1f(u.u_edge!, lightEdge + (edges - lightEdge) * edgeColour.share);
    context.uniform3fv(u.u_edge_colour!, edgeColour.rgb);
    context.uniform1f(u.u_edge_own!, edgeColour.share);
    context.uniform1f(u.u_edge_width!, edgeLine.width * pixelRatio(context));
    scene.bindShadow(context, u, light.strength);
    for (const {x, y, value: entry} of entries) {
      project(context, buildings, args, x, y);
      context.uniform2f(u.u_offset!, ...placed(x, y).offset);
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
    const frame = scene.frame();
    if (
      light.strength > 0 &&
      frame &&
      frame.zoom === camera.zoom &&
      ground &&
      scene.drawsGround(caster)
    ) {
      const program = programs.ground!;
      context.useProgram(program.program);
      context.uniform1f(program.uniforms.u_metres!, frame.metres);
      context.uniform3fv(program.uniforms.u_ground_shadow!, light.groundShadow);
      scene.bindShadow(context, program.uniforms, light.strength);
      context.bindVertexArray(ground.vao);
      const longest = Math.min(
        4,
        Math.ceil(
          frame.tallest /
            Math.tan((tileflowSceneShadowFloor * Math.PI) / 180) /
            (tileflowBuildingExtent * frame.metres),
        ),
      );
      const margin = Math.max(1, longest);
      const [left, top, right, bottom] = frame.tiles;
      for (let x = left - margin; x <= right + margin; x += 1)
        for (let y = top - margin; y <= bottom + margin; y += 1) {
          project(context, program, args, x, y);
          context.uniform2f(program.uniforms.u_offset!, ...frame.offsetOf({x, y}));
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
    if (nightLight > 0 && light.night > 0.01) {
      const program = programs.flood!;
      context.useProgram(program.program);
      context.blendFuncSeparate(context.ONE, context.ONE, context.ZERO, context.ONE);
      context.uniform1f(program.uniforms.u_scale!, shown);
      context.uniform1f(program.uniforms.u_metres!, camera.metres);
      context.uniform1f(program.uniforms.u_band!, flood.reach);
      context.uniform1f(program.uniforms.u_flood!, light.night * nightLight);
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
      designsOnScreen();
      return {declared: designs?.declared ?? false, tiles: raised, buildings, vertices};
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion?.done();
      map.off('styledata', onStyle);
      map.off('idle', onStyle);
      unregister();
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

export {tileflowSunLightMatrix} from './scene-3d-browser';
