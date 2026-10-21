// Tileflow's 3D buildings renderer: a custom WebGL2 layer that raises the buildings of the map's
// own vector tiles round the camera. Scene sun lighting, soft contact, cast shadows and rounded
// corners are the defaults; decorative effects and timed height transitions are opt-in.
import {
  buildingFloodLightShare,
  defaultBuildingFloodLight,
  defaultModelEmissionGradient,
} from './building-illumination';
import {
  readTileflowBuildings3D,
  type TileflowBuildings3DDesign,
  tileflowBuildingsMetadataKey,
  tileflowDefaultBuildings3DDesign,
} from './buildings-3d-design';
import {tileflowBuildingStyleLight} from './buildings-3d-light';
import {
  tileflowBuildingExtent,
  type TileflowBuildingMesh,
  tileflowBuildingVertexBytes,
} from './buildings-3d-mesh';
import {createBuildingMesher} from './buildings-3d-mesher';
import {
  buildingContactCompositeFragment,
  buildingContactFragment,
  buildingContactVertex,
  createBuildingContactMask,
  createBuildingContactVao,
  tileflowBuildingOcclusion as occlusion,
} from './buildings-3d-occlusion';
import {drawBuildingOpacity} from './buildings-3d-opacity';
import {
  buildingArchitecturalFloodComposite,
  buildingArchitecturalFloodFragment,
  buildingArchitecturalFloodVertex,
  tileflowBuildingAttributes,
  tileflowBuildingBandVertex,
  tileflowBuildingDepthFragment,
  tileflowBuildingDepthVertex,
  tileflowBuildingFloodFragment,
  tileflowBuildingFragment,
  tileflowBuildingGroundFragment,
  tileflowBuildingGroundVertex,
  tileflowBuildingVertex,
} from './buildings-3d-shaders';
import {buildingBoxVisible, buildingCornerDetail, buildingDrawRanges} from './buildings-3d-view';
import {cameraFrame, cameraTileAt, createCameraTiles} from './camera-tiles-browser';
import {tileflowFeatureColour} from './feature-colour-browser';
import {inspectModelTriangles, type TileflowModelInspection} from './model-inspection';
import {createTileflowPlacedModels, type TileflowPlacedModel} from './models-3d-browser';
import {modelEmitterFragment, modelEmitterVertex} from './models-3d-emitters';
import {bindModelMaterial} from './models-3d-materials-browser';
import {
  type TileflowModelLightingRole,
  tileflowModelLightingRoles,
  type TileflowModelPart,
  tileflowModelParts,
} from './models-3d-model';
import {sampleModelRole} from './models-3d-role-lighting';
import {
  tileflowModelAttributes,
  tileflowModelDepthFragment,
  tileflowModelDepthVertex,
  tileflowModelFragment,
  tileflowModelSurfaceAttributes,
  tileflowModelVertex,
} from './models-3d-shaders';
import {
  tileflowScene3D,
  type TileflowSceneCaster,
  tileflowSceneLight,
  tileflowSceneShadowFloor,
} from './scene-3d-browser';
import {tileflowSceneMinzoom, tileflowSceneOpacity} from './scene-3d-visibility';
import {resolveTileflowSun, tileflowStyleSunPreset, type TileflowSun} from './sun';
import {tileflowColourChannels} from './theme-blend';
import type {TileflowTileRequestTransform} from './tile-reader';

/** The MapLibre GL JS map capabilities the renderer uses. */
export type TileflowBuildings3DMap = {
  addLayer(layer: object, beforeId?: string): unknown;
  getCenter(): {lat: number; lng: number};
  getBearing(): number;
  getCanvas?(): {clientHeight: number};
  getVerticalFieldOfView?(): number;
  getLight?(): unknown;
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
  /** The zoom where buildings start fading in, reaching full opacity 0.25 zoom later. Defaults to 15. */
  minzoom?: number;
  /** The most tiles raised round the camera, from 1 to 64; defaults to 25. */
  maxTiles?: number;
  /** The layer to draw before; defaults to the style's `above-buildings` placement. */
  beforeId?: string;
  /** The map's request rules, for the tiles the renderer reads. */
  transformRequest?: TileflowTileRequestTransform;
}>;

export type TileflowBuildings3DChange = Readonly<{
  transition?: Readonly<{duration?: number; mode?: 'grow' | 'fade'}>;
}>;

export type TileflowBuildings3D = {
  /** Read-only, bounded snapshots of resident prepared model meshes. */
  inspectModels(): TileflowModelInspection[];
  /** Shows buildings immediately; pass a transition duration to animate their rise. */
  show(options?: TileflowBuildings3DChange): Promise<void>;
  /** Hides buildings immediately; pass a transition duration to animate their descent. */
  hide(options?: TileflowBuildings3DChange): Promise<void>;
  /** Sets the height scale, from 0 (flat) to 1; animation requires a transition duration. */
  grow(scale: number, options?: TileflowBuildings3DChange): Promise<void>;
  /** The height scale shown now. */
  readonly scale: number;
  /**
   * Whether the map's style describes its 3D buildings (the buildings module's
   * `threeDimensional`), tiles raised, buildings and vertices, and the placed models standing, for
   * diagnostics.
   */
  readonly stats: Readonly<{
    declared: boolean;
    tiles: number;
    buildings: number;
    vertices: number;
    models: number;
  }>;
  /** Takes the layer off the map and lets go of its buffers. */
  dispose(): void;
};

export const tileflowBuildings3DLayerId = 'tileflow-buildings-3d';
// World's buildings carry their heights at z15; a source that stops earlier is read at its maxzoom.
const preferredZoom = 15;
const defaultTransition = 0;
const flood = {reach: 10, colour: [1, 0.7, 0.4] as const};
// Roof outlines and outer corners are a CSS pixel wide, and half as strong by day as at night.
const edgeLine = {width: 1, day: 0.5};
const paletteWidth = 256;
// A model that comes to stand over the flat ground left for it fades in over this long, in ms.
const modelFade = 500;
// Street lights draw over the buildings, so their lamps can hide behind them.
const streetLightsLayerId = 'tileflow-street-lights';
// The colours a model's parts take from the buildings' colour when the design gives them none.
const derivedParts: Record<TileflowModelPart, (rgb: readonly number[]) => number[]> = {
  surface: (rgb) => [...rgb],
  secondary: (rgb) => rgb.map((channel) => channel * 0.82),
  glass: (rgb) => rgb.map((channel, index) => channel * 0.42 + [0.56, 0.64, 0.72][index]! * 0.42),
  accent: (rgb) => rgb.map((channel) => channel * 0.62),
  roof: (rgb) => rgb.map((channel) => channel * 0.9),
};

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
  gl?: {
    vao: WebGLVertexArrayObject;
    vbo: WebGLBuffer;
    ibo: WebGLBuffer;
    contact?: ReturnType<typeof createBuildingContactVao>;
  };
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
 * Creates the renderer, showing buildings automatically above zoom 15 unless hidden. It reads the source's
 * z15 tiles round the camera, the zoom at which World's buildings carry their heights.
 */
export function createTileflowBuildings3D(
  options: TileflowBuildings3DOptions,
): TileflowBuildings3D {
  const {map} = options;
  const minzoom = options.minzoom ?? tileflowSceneMinzoom;
  const maxTiles = Math.round(options.maxTiles ?? 25);
  if (!Number.isFinite(minzoom) || minzoom < 0 || minzoom > 24)
    throw new RangeError('Tileflow 3D buildings minzoom must be a zoom from 0 to 24.');
  if (!(maxTiles >= 1 && maxTiles <= 64))
    throw new RangeError('Tileflow 3D buildings maxTiles must be from 1 to 64.');

  const mesher = createBuildingMesher();
  let detail = buildingCornerDetail(map.getZoom());
  let scale = 1;
  let opacity = 1;
  let target = 1;
  let blank: WebGLTexture | undefined;
  let motion:
    {from: number; to: number; start: number; duration: number; done: () => void} | undefined;
  let gl: WebGL2RenderingContext | undefined;
  let programs: Partial<
    Record<
      | 'buildings'
      | 'depth'
      | 'ground'
      | 'contact'
      | 'contactComposite'
      | 'flood'
      | 'architecturalFlood'
      | 'architecturalFloodComposite'
      | 'model'
      | 'modelEmitter'
      | 'modelDepth',
      Program
    >
  > = {};
  let variant: string | undefined;
  let linking: Linking[] | undefined;
  let ground: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer} | undefined;
  const contactMask = createBuildingContactMask();
  const floodMask = createBuildingContactMask();
  // The ground masks drawn by this frame's prerender, read back by its render.
  let masks: {contact?: WebGLTexture; flood?: WebGLTexture} = {};
  let disposed = false;
  // Shadows are drawn in the map's shared 3D scene, with any other 3D layer on the map.
  const scene = tileflowScene3D(map);
  let generation = 0;
  let registered = false;
  let unregister = () => {};
  // The models the map places, and Tileflow's landmarks, stand in for the buildings under their
  // footprints: once one stands, the tiles it reaches are built again without those buildings.
  const models = createTileflowPlacedModels({
    ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
    changed(tiles, zoom) {
      if (tiles.length > 0 && zoom === camera.zoom) {
        const keys = new Set(tiles.map((tile) => `${tile.x}/${tile.y}`));
        camera.refresh((tile) => keys.has(`${tile.x}/${tile.y}`));
      }
      generation += 1;
      map.triggerRepaint();
    },
  });

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
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.NEAREST);
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.NEAREST);
    },
    onRemove(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      for (const entry of camera.all()) if (entry.value) release(context, entry.value);
      models.release(context);
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
      contactMask.release(context);
      floodMask.release(context);
      if (blank) context.deleteTexture(blank);
      blank = undefined;
      programs = {};
      linking = undefined;
      variant = undefined;
      ground = undefined;
      gl = undefined;
    },
    prerender(context: WebGLRenderingContext | WebGL2RenderingContext, args: ProjectionArgs) {
      if (!isWebGL2(context)) return;
      ensureCamera();
      // Models and landmarks are read for every tile the camera wants, from a zoom before the
      // buildings show, so they stand when the buildings fade in.
      if (target > 0 || scale > 0)
        models.update(
          design().models ?? [],
          design().landmarks?.url,
          camera.coverage(),
          camera.zoom,
          visibleScale() > 0,
        );
      drawMasks(context, args);
      if (!programs.depth) return;
      // A disabled building shadow pass must not claim the ground pass from the trees.
      if (!design().shadows || visibleScale() <= 0) {
        if (registered) unregister();
        registered = false;
        return;
      }
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
      // Prepare resident tiles before the zoom entrance, so the fade starts with ready geometry.
      // Uploads are bounded and request frames only while work remains.
      if (target > 0 || scale > 0) upload(context);
      if (visibleScale() <= 0) return;
      draw(context, args);
    },
  };

  // --- Tiles round the camera ---

  // The tiles are read from the source and layers the map's design names; a style that names
  // others reads them anew.
  const makeCamera = (
    layers: TileflowBuildings3DDesign['layers'],
    source: string,
    edgeRadius = 0,
  ) =>
    createCameraTiles<BuildingTile>({
      map,
      source,
      layers: [layers.building, ...(layers.places ? [layers.places] : [])],
      zoom: preferredZoom,
      minzoom,
      maxTiles,
      ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
      active: () => target > 0 || scale > 0,
      async build(tile, tileMetres, signal) {
        const decoded = tile.layers[layers.building];
        // A tile without buildings stays flat.
        if (!decoded) return emptyTile;
        const places = layers.places ? tile.layers[layers.places] : undefined;
        // Nothing a model will stand on is raised: wait for the landmarks' indexes and the map's
        // models round the tile, briefly.
        await models.settle(tile, signal);
        signal.throwIfAborted();
        const masks = models.masksIn(tile, tileflowBuildingExtent);
        const mesh = await mesher.build(
          decoded,
          {
            tileMetres,
            edgeRadius: detail === 0 ? 0 : edgeRadius,
            cornerAngle: detail === 1 ? Math.PI / 3 : Math.PI / 6,
            ...(places ? {places} : {}),
            ...(masks ? {masks} : {}),
          },
          signal,
        );
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
    0,
  ]);
  let camera = makeCamera(
    tileflowDefaultBuildings3DDesign.layers,
    tileflowDefaultBuildings3DDesign.source,
  );

  /** Reads the tiles the map's design names. */
  function ensureCamera(): void {
    const {source, layers, edgeRadius = 0} = design();
    const key = JSON.stringify([source, layers, edgeRadius]);
    const nextDetail = buildingCornerDetail(
      map.getZoom(),
      map.getCenter().lat,
      edgeRadius,
      map.getPitch(),
      detail,
    );
    if (key === cameraKey) {
      if (nextDetail !== detail && (target > 0 || scale > 0)) {
        detail = nextDetail;
        if (edgeRadius > 0) camera.refresh(() => true);
      }
      return;
    }
    detail = nextDetail;
    for (const entry of camera.all()) if (entry.value && gl) release(gl, entry.value);
    camera.dispose();
    cameraKey = key;
    camera = makeCamera(layers, source, edgeRadius);
    generation += 1;
    if (target > 0) camera.update();
  }

  function release(context: WebGL2RenderingContext, tile: BuildingTile): void {
    if (tile.gl) {
      context.deleteVertexArray(tile.gl.vao);
      if (tile.gl.contact) {
        context.deleteVertexArray(tile.gl.contact.vao);
        context.deleteBuffer(tile.gl.contact.vbo);
      }
      context.deleteBuffer(tile.gl.vbo);
      context.deleteBuffer(tile.gl.ibo);
      tile.gl = undefined;
    }
    if (tile.palette) {
      context.deleteTexture(tile.palette.texture);
      tile.palette = undefined;
    }
  }

  /** Uploads loaded models, and up to two meshed tiles a frame. */
  function upload(context: WebGL2RenderingContext): void {
    const modelKey = models.key();
    models.upload(context);
    if (modelKey !== models.key()) map.triggerRepaint();
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
      // prerender ran before this upload; refresh its shadow once, then allow the map to idle.
      map.triggerRepaint();
    }
  }

  // --- Colours ---

  // --- The map's design ---

  let fallbackStyle: {light?: unknown; metadata?: Record<string, unknown>} | undefined;
  let fallbackSun: TileflowSun | undefined;
  function standaloneStyle() {
    return (fallbackStyle ??= (map.getStyle() as typeof fallbackStyle) ?? {});
  }
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
      values: [standaloneStyle().metadata?.[tileflowBuildingsMetadataKey]],
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
    return (
      options.controller?.getSun?.() ??
      (fallbackSun ??= resolveTileflowSun(tileflowStyleSunPreset(standaloneStyle())))
    );
  }

  function lighting() {
    const light = tileflowSceneLight(sunNow(), design().shadows);
    return {...light, strength: light.strength * visibleOpacity()};
  }

  // --- Drawing ---

  /** Zoom controls opacity; explicit grow() calls alone change building height. */
  function visibleScale(): number {
    return visibleOpacity() > 0 ? scale : 0;
  }

  function visibleOpacity(): number {
    return opacity * tileflowSceneOpacity(map.getZoom(), minzoom);
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
      const standing = modelsDrawn();
      if (!design().shadows || shown <= 0 || (entries.length === 0 && standing.length === 0))
        return undefined;
      let [left, top, right, bottom, tallest] = [Infinity, Infinity, -Infinity, -Infinity, 0];
      for (const entry of entries) {
        left = Math.min(left, entry.x);
        top = Math.min(top, entry.y);
        right = Math.max(right, entry.x);
        bottom = Math.max(bottom, entry.y);
        tallest = Math.max(tallest, entry.value.mesh.top);
      }
      for (const model of standing) {
        const {x, y, reach} = standOf(model);
        left = Math.min(left, Math.floor(x - reach));
        top = Math.min(top, Math.floor(y - reach));
        right = Math.max(right, Math.floor(x + reach));
        bottom = Math.max(bottom, Math.floor(y + reach));
        tallest = Math.max(tallest, model.model.bounds[5]);
      }
      return {zoom: camera.zoom, tiles: [left, top, right, bottom], tallest: tallest * shown};
    },
    key: () =>
      `buildings:${visibleScale().toFixed(4)}:${generation}:${models.key()}:${programs.depth ? 1 : 0}`,
    drawDepth(context, frame) {
      const program = programs.depth;
      if (!program) return;
      context.useProgram(program.program);
      context.uniform1f(program.uniforms.u_scale!, visibleScale());
      context.uniform1f(program.uniforms.u_metres!, frame.metres);
      context.uniformMatrix4fv(program.uniforms.u_light_matrix!, false, frame.light.matrix);
      for (const {x, y, value} of drawn()) {
        const offset = frame.offsetOf({x, y}, camera.zoom);
        if (
          !buildingBoxVisible(frame.light.matrix, [
            (offset[0] - 1) * frame.metres,
            -(offset[1] + tileflowBuildingExtent + 1) * frame.metres,
            0,
            (offset[0] + tileflowBuildingExtent + 1) * frame.metres,
            -(offset[1] - 1) * frame.metres,
            value.mesh.top + 0.1,
          ])
        )
          continue;
        const ranges = buildingDrawRanges(
          value.mesh,
          ({bounds: [left, top, right, bottom, height]}) =>
            buildingBoxVisible(frame.light.matrix, [
              (left + offset[0]) * frame.metres,
              -(bottom + offset[1]) * frame.metres,
              0,
              (right + offset[0]) * frame.metres,
              -(top + offset[1]) * frame.metres,
              height,
            ]),
        );
        if (!ranges.length) continue;
        context.uniform2f(program.uniforms.u_offset!, ...offset);
        context.bindVertexArray(value.gl!.vao);
        for (const range of ranges)
          context.drawElements(
            context.TRIANGLES,
            range.count,
            context.UNSIGNED_INT,
            range.from * 4,
          );
      }
      const modelDepth = programs.modelDepth;
      if (!modelDepth) return;
      context.useProgram(modelDepth.program);
      context.uniformMatrix4fv(modelDepth.uniforms.u_light_matrix!, false, frame.light.matrix);
      context.uniform1f(modelDepth.uniforms.u_scale!, visibleScale());
      context.uniform1f(modelDepth.uniforms.u_metres!, frame.metres);
      const centre = map.getCenter();
      for (const model of modelsDrawn()) {
        const stand = standOf(model);
        setPlacement(context, modelDepth, model, stand);
        context.uniform2f(
          modelDepth.uniforms.u_offset!,
          ...frame.offsetOf({x: stand.tileX, y: stand.tileY}, camera.zoom),
        );
        drawModel(context, modelDepth, model, models.levelOf(model, centre), 'depth');
      }
    },
  };

  // --- Placed models ---

  function modelsDrawn(): TileflowPlacedModel[] {
    return models.shown().filter((model) => model.gl);
  }

  /** How far a model that has just come to stand has faded in, from 0 to 1. */
  function appearanceOf(model: TileflowPlacedModel, now: number): number {
    if (model.standingSince === undefined) return 1;
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduced ? 1 : Math.min(1, Math.max(0, (now - model.standingSince) / modelFade));
  }

  /** Where a model stands at the camera's zoom: its tile, its origin in it and its reach in tiles. */
  function standOf(model: TileflowPlacedModel) {
    const [longitude, latitude] = model.placement.at;
    const [x, y] = cameraTileAt(longitude, latitude, camera.zoom);
    const tileX = Math.floor(x);
    const tileY = Math.floor(y);
    const tileMetres = (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / 2 ** camera.zoom;
    const [minX, minY, , maxX, maxY] = model.model.bounds;
    return {
      x,
      y,
      tileX,
      tileY,
      anchor: [(x - tileX) * tileflowBuildingExtent, (y - tileY) * tileflowBuildingExtent] as const,
      metres: tileMetres / tileflowBuildingExtent,
      reach: Math.hypot(Math.max(-minX, maxX), Math.max(-minY, maxY)) / tileMetres,
    };
  }

  function setPlacement(
    context: WebGL2RenderingContext,
    program: Program,
    model: TileflowPlacedModel,
    stand: ReturnType<typeof standOf>,
  ): void {
    const u = program.uniforms;
    const turn = (model.placement.heading * Math.PI) / 180;
    context.uniform2f(u.u_heading!, Math.cos(turn), Math.sin(turn));
    context.uniform2f(u.u_anchor!, stand.anchor[0], stand.anchor[1]);
    context.uniform1f(u.u_model_metres!, stand.metres);
  }

  function drawModel(
    context: WebGL2RenderingContext,
    program: Program,
    model: TileflowPlacedModel,
    level: number,
    pass: 'solid' | 'blend' | 'depth' = 'solid',
  ) {
    const buffers = model.gl![level]!;
    const mesh = model.model.levels[level]!;
    context.uniform3f(program.uniforms.u_level_centre!, ...mesh.centre);
    context.uniform1f(program.uniforms.u_level_step!, mesh.step);
    context.uniform2f(
      program.uniforms.u_model_height ?? null,
      model.model.bounds[2],
      model.model.bounds[5] - model.model.bounds[2],
    );
    context.bindVertexArray(buffers.vao);
    if (!mesh.surface) {
      if (pass === 'blend') return;
      bindModelMaterial(context, program.uniforms, undefined, undefined, blank!);
      context.drawElements(context.TRIANGLES, mesh.indices.length, buffers.type, 0);
      return;
    }
    const ranges = mesh.surface.ranges
      .map((range, index) => ({range, index}))
      .filter(({range}) => {
        const transparent = mesh.surface!.materials[range.material]!.alphaMode === 'BLEND';
        return pass === 'depth' || transparent === (pass === 'blend');
      });
    if (pass === 'blend' && ranges.length > 1) {
      const camera = modelCamera(model),
        turn = (model.placement.heading * Math.PI) / 180;
      const distance = (index: number) => {
        const c = buffers.surface!.centres.subarray(index * 3, index * 3 + 3);
        const x = c[0]! * Math.cos(turn) + c[1]! * Math.sin(turn);
        const y = -c[0]! * Math.sin(turn) + c[1]! * Math.cos(turn);
        return (x - camera[0]) ** 2 + (y - camera[1]) ** 2 + (c[2]! - camera[2]) ** 2;
      };
      ranges.sort((a, b) => distance(b.index) - distance(a.index));
    }
    for (const {range} of ranges) {
      const [low, high] = range.emissiveBounds ?? [model.model.bounds[2], model.model.bounds[5]];
      context.uniform2f(program.uniforms.u_model_height ?? null, low, high - low);
      bindModelMaterial(
        context,
        program.uniforms,
        mesh.surface.materials[range.material]!,
        buffers.surface,
        blank!,
      );
      context.drawElements(
        context.TRIANGLES,
        range.count,
        buffers.type,
        range.from * mesh.indices.BYTES_PER_ELEMENT,
      );
    }
    context.disable(context.CULL_FACE);
  }

  /** The colours of the models' parts, mixed between the themes either side of a blend. */
  function partColoursNow(): Float32Array {
    const {themes, lower, upper, mix} = designsOnScreen();
    const base = themeColour();
    const out = new Float32Array(15);
    for (const [part, index] of Object.entries(tileflowModelParts) as [
      TileflowModelPart,
      number,
    ][]) {
      const derived = derivedParts[part](base);
      const below = rgbOf(themes[lower]!.modelColors?.[part]) ?? derived;
      const above = rgbOf(themes[upper]!.modelColors?.[part]) ?? derived;
      for (let channel = 0; channel < 3; channel += 1)
        out[index * 3 + channel] = below[channel]! + (above[channel]! - below[channel]!) * mix;
    }
    return out;
  }

  function partMixNow(): Float32Array {
    const {themes, lower, upper, mix} = designsOnScreen();
    return Float32Array.from(
      Object.keys(tileflowModelParts).map(
        (part) =>
          (themes[lower]!.modelColors?.[part as TileflowModelPart] ? 1 - mix : 0) +
          (themes[upper]!.modelColors?.[part as TileflowModelPart] ? mix : 0),
      ),
    );
  }

  /** Camera in metres from the model, using MapLibre's public camera and field of view. */
  function modelCamera(model: TileflowPlacedModel): [number, number, number] {
    const zoom = map.getZoom();
    const [cx, cy] = cameraTileAt(map.getCenter().lng, map.getCenter().lat, zoom);
    const [mx, my] = cameraTileAt(...model.placement.at, zoom);
    const metres = (40_075_016.686 * Math.cos((model.placement.at[1] * Math.PI) / 180)) / 2 ** zoom;
    const distance =
      ((map.getCanvas?.().clientHeight ?? 720) * metres) /
      512 /
      (2 * Math.tan(((map.getVerticalFieldOfView?.() ?? 36.87) * Math.PI) / 360));
    const pitch = (map.getPitch() * Math.PI) / 180,
      bearing = (map.getBearing() * Math.PI) / 180;
    return [
      (cx - mx) * metres - distance * Math.sin(pitch) * Math.sin(bearing),
      (my - cy) * metres - distance * Math.sin(pitch) * Math.cos(bearing),
      distance * Math.cos(pitch),
    ];
  }

  type ModelLightingUniforms = Record<
    'strengths' | 'colours' | 'gradients' | 'powers' | 'materialColours' | 'materials',
    Float32Array
  >;
  const modelLightingCache = new Map<string, ModelLightingUniforms>();
  let modelLightingThemes: readonly TileflowBuildings3DDesign[] | undefined;
  let modelLightingPosition = '';

  function modelLightingNow(identity: string): ModelLightingUniforms {
    const {themes, lower, upper, mix} = designsOnScreen();
    const position = `${lower}:${upper}:${mix}`;
    if (themes !== modelLightingThemes || position !== modelLightingPosition) {
      modelLightingCache.clear();
      modelLightingThemes = themes;
      modelLightingPosition = position;
    }
    const cached = modelLightingCache.get(identity);
    if (cached) return cached;
    const strengths = new Float32Array(7);
    const colours = new Float32Array(28);
    const gradients = new Float32Array(28);
    const powers = new Float32Array(7);
    const materialColours = new Float32Array(28);
    const materials = new Float32Array(28);
    for (const [role, id] of Object.entries(tileflowModelLightingRoles) as [
      TileflowModelLightingRole,
      number,
    ][]) {
      const from = themes[lower]!.modelLighting?.[role],
        to = themes[upper]!.modelLighting?.[role];
      const sampledFrom = sampleModelRole(from, `${identity}:${role}`);
      const sampledTo = sampleModelRole(to, `${identity}:${role}`);
      strengths[id] = sampledFrom.strength * (1 - mix) + sampledTo.strength * mix;
      const ca = sampledFrom.color,
        cb = sampledTo.color;
      for (let channel = 0; channel < 3; channel++)
        materialColours[id * 4 + channel] =
          (ca?.[channel] ?? cb?.[channel] ?? 0) * (1 - mix) +
          (cb?.[channel] ?? ca?.[channel] ?? 0) * mix;
      materialColours[id * 4 + 3] =
        (ca ? (from?.colorMix ?? 1) * (1 - mix) : 0) + (cb ? (to?.colorMix ?? 1) * mix : 0);
      for (const [channel, key] of (['metallic', 'roughness'] as const).entries()) {
        materials[id * 4 + channel] =
          (from?.[key] ?? to?.[key] ?? 0) * (1 - mix) + (to?.[key] ?? from?.[key] ?? 0) * mix;
        materials[id * 4 + 2 + channel] =
          (from?.[key] === undefined ? 0 : 1 - mix) + (to?.[key] === undefined ? 0 : mix);
      }
      const a = rgbOf(from?.emissiveColor),
        b = rgbOf(to?.emissiveColor);
      for (let channel = 0; channel < 3; channel += 1)
        colours[id * 4 + channel] =
          (a?.[channel] ?? b?.[channel] ?? 0) * (1 - mix) +
          (b?.[channel] ?? a?.[channel] ?? 0) * mix;
      colours[id * 4 + 3] = (a ? 1 - mix : 0) + (b ? mix : 0);
      const first = from?.emissiveHeight ?? defaultModelEmissionGradient;
      const second = to?.emissiveHeight ?? defaultModelEmissionGradient;
      for (let component = 0; component < 4; component += 1)
        gradients[id * 4 + component] = first[component]! * (1 - mix) + second[component]! * mix;
      powers[id] = first[4] * (1 - mix) + second[4] * mix;
    }
    const result = {strengths, colours, gradients, powers, materialColours, materials};
    if (modelLightingCache.size >= 1024)
      modelLightingCache.delete(modelLightingCache.keys().next().value!);
    modelLightingCache.set(identity, result);
    return result;
  }

  function floodLightNow() {
    const {themes, lower, upper, mix} = designsOnScreen();
    const first = themes[lower]!.floodLight ?? defaultBuildingFloodLight;
    const second = themes[upper]!.floodLight ?? defaultBuildingFloodLight;
    const number = (a: number, b: number) => a * (1 - mix) + b * mix;
    const a = rgbOf(first.color) ?? rgbOf(defaultBuildingFloodLight.color)!;
    const b = rgbOf(second.color) ?? rgbOf(defaultBuildingFloodLight.color)!;
    return {
      intensity:
        number(first.intensity, second.intensity) *
        buildingFloodLightShare(sunNow(), number(first.brightnessScale, second.brightnessScale)),
      colour: a.map((value, i) => number(value, b[i]!)),
      radius: [
        number(first.groundRadius[0], second.groundRadius[0]),
        number(first.groundRadius[1], second.groundRadius[1]),
      ],
      minGroundHeight: number(first.minGroundHeight, second.minGroundHeight),
      minWallHeight: number(first.minWallHeight, second.minWallHeight),
      wallHeightRatio: number(first.wallHeightRatio, second.wallHeightRatio),
    };
  }

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

  function viewRanges(args: ProjectionArgs, tile: TileEntry, margin = 0, wallsOnly = false) {
    const data = args.getProjectionData({
      tileID: {canonical: {x: tile.x, y: tile.y, z: camera.zoom}, wrap: 0},
    });
    // Globe projection is nonlinear; retain all geometry through its transition.
    const mercator = args.shaderData.variantName === 'mercator';
    const reach = margin / camera.metres + 1;
    if (
      mercator &&
      !buildingBoxVisible(data.mainMatrix, [
        -reach,
        -reach,
        0,
        tileflowBuildingExtent + reach,
        tileflowBuildingExtent + reach,
        tile.value.mesh.top + 0.1,
      ])
    )
      return [];
    return buildingDrawRanges(
      tile.value.mesh,
      ({bounds: [left, top, right, bottom, height]}) =>
        !mercator ||
        buildingBoxVisible(data.mainMatrix, [
          left - reach,
          top - reach,
          0,
          right + reach,
          bottom + reach,
          height,
        ]),
      wallsOnly,
    );
  }

  function groundVisible(args: ProjectionArgs, x: number, y: number): boolean {
    if (args.shaderData.variantName !== 'mercator') return true;
    const data = args.getProjectionData({tileID: {canonical: {x, y, z: camera.zoom}, wrap: 0}});
    return buildingBoxVisible(data.mainMatrix, [
      0,
      0,
      0,
      tileflowBuildingExtent,
      tileflowBuildingExtent,
      0,
    ]);
  }

  /** Drawing buffer pixels per CSS pixel. */
  function pixelRatio(context: WebGL2RenderingContext): number {
    const canvas = context.canvas as {clientWidth?: number};
    const width = canvas.clientWidth;
    return width ? Math.min(4, Math.max(1, context.drawingBufferWidth / width)) : 1;
  }

  /** Draws the walls of the given tiles in a band reaching `reach` metres from their feet. */
  function drawWalls(
    context: WebGL2RenderingContext,
    program: Program,
    args: ProjectionArgs,
    entries: readonly TileEntry[],
    reach: number,
  ): void {
    for (const tile of entries) {
      const {x, y, value} = tile;
      const mesh = value.mesh;
      if (mesh.indices.length <= mesh.wallsFrom) continue;
      project(context, program, args, x, y);
      context.uniform2f(program.uniforms.u_offset!, ...camera.offsetOf({x, y}));
      context.bindVertexArray(value.gl!.vao);
      for (const range of viewRanges(args, tile, reach, true))
        context.drawElements(context.TRIANGLES, range.count, context.UNSIGNED_INT, range.from * 4);
    }
  }

  /**
   * Draws the frame's ground masks from the prerender, before the map's main pass: the contact
   * band at the foot of the walls and the architectural flood light. Drawing them between the
   * map's layers would switch framebuffers within its pass, which tiled GPUs pay for in full.
   */
  function drawMasks(context: WebGL2RenderingContext, args: ProjectionArgs): void {
    masks = {};
    const shown = visibleScale();
    const entries = variant === args.shaderData.variantName && shown > 0 && ground ? drawn() : [];
    if (design().occlusion && entries.length > 0) {
      const program = programs.contact!;
      masks.contact = contactMask.render(context, () => {
        context.useProgram(program.program);
        context.uniform1f(program.uniforms.u_scale!, shown);
        context.uniform1f(program.uniforms.u_metres!, camera.metres);
        context.uniform1f(program.uniforms.u_band!, occlusion.ground);
        context.uniform1f(
          program.uniforms.u_band_strength!,
          occlusion.groundStrength * visibleOpacity(),
        );
        for (const tile of entries) {
          const {x, y, value} = tile;
          const ranges = viewRanges(args, tile, occlusion.ground, true);
          if (!ranges.length) continue;
          const buffers = value.gl!;
          buffers.contact ??= createBuildingContactVao(context, value.mesh);
          project(context, program, args, x, y);
          context.bindVertexArray(buffers.contact.vao);
          for (const range of ranges) {
            buffers.contact.offset((range.from - value.mesh.wallsFrom) / 6);
            context.drawArraysInstanced(context.TRIANGLE_STRIP, 0, 4, range.count / 6);
          }
        }
      });
    } else contactMask.release(context);
    const architectural = floodLightNow();
    if (architectural.intensity > 0 && entries.length > 0) {
      const program = programs.architecturalFlood!;
      masks.flood = floodMask.render(context, () => {
        context.useProgram(program.program);
        context.uniform1f(program.uniforms.u_scale!, shown);
        context.uniform1f(program.uniforms.u_metres!, camera.metres);
        context.uniform2f(
          program.uniforms.u_radius!,
          architectural.radius[0]!,
          architectural.radius[1]!,
        );
        context.uniform1f(program.uniforms.u_min_height!, architectural.minGroundHeight);
        context.uniform1f(
          program.uniforms.u_intensity!,
          architectural.intensity * visibleOpacity(),
        );
        drawWalls(context, program, args, entries, architectural.radius[1]!);
      });
    } else floodMask.release(context);
  }

  function draw(context: WebGL2RenderingContext, args: ProjectionArgs): void {
    const entries = drawn();
    const standing = modelsDrawn();
    if (entries.length === 0 && standing.length === 0) return;
    const light = lighting();
    const shown = visibleScale();
    const themes = colouredByData() ? designsOnScreen() : undefined;
    const nightLight = mixed((entry) => entry.nightLight);
    const architectural = floodLightNow();
    const edges = mixed((entry) => entry.edges);
    const {occlusion: occlusionOn, windows: windowsOn} = design();
    const now = performance.now();
    const appearing = standing.filter((entry) => appearanceOf(entry, now) < 1);
    const steady = standing.filter((entry) => !appearing.includes(entry));

    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.depthMask(true);
    context.disable(context.BLEND);
    drawBuildingOpacity(context, visibleOpacity(), () => {
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
      context.uniform1f(u.u_occlusion_radius!, occlusion.wallRadius);
      context.uniform1f(u.u_corner!, occlusion.corner);
      context.uniform1f(u.u_night!, light.night);
      context.uniform1f(u.u_windows!, windowsOn ? 1 : 0);
      context.uniform1f(u.u_flood!, light.night * nightLight);
      context.uniform3fv(u.u_flood_colour!, flood.colour);
      context.uniform1f(u.u_architectural_intensity!, architectural.intensity);
      context.uniform3fv(u.u_architectural_colour!, architectural.colour);
      context.uniform2f(
        u.u_architectural_wall!,
        architectural.minWallHeight,
        architectural.wallHeightRatio,
      );
      context.uniform1f(
        u.u_variation!,
        mixed((entry) => entry.colorVariation),
      );
      const styleLight = tileflowBuildingStyleLight(
        map.getLight?.() ?? fallbackStyleLight,
        map.getBearing(),
      );
      context.uniform3fv(u.u_style_light_position!, styleLight.position);
      context.uniform3fv(u.u_style_light_colour!, styleLight.colour);
      context.uniform1f(u.u_style_light_intensity!, styleLight.intensity);
      context.uniform1f(u.u_edge_radius!, design().edgeRadius ?? 0);
      context.uniform1f(
        u.u_style_gradient!,
        mixed((entry) => (entry.verticalGradient ? 1 : 0)),
      );
      context.uniform1f(
        u.u_sun_lighting!,
        mixed((entry) => (entry.lighting === 'sun' ? 1 : 0)),
      );
      const edgeColour = edgeColourNow();
      const lightEdge = edges * (edgeLine.day + (1 - edgeLine.day) * light.night);
      context.uniform1f(u.u_edge!, lightEdge + (edges - lightEdge) * edgeColour.share);
      context.uniform3fv(u.u_edge_colour!, edgeColour.rgb);
      context.uniform1f(u.u_edge_own!, edgeColour.share);
      context.uniform1f(u.u_edge_width!, edgeLine.width * pixelRatio(context));
      scene.bindShadow(context, u, light.strength);
      for (const tile of entries) {
        const {x, y, value: entry} = tile;
        const ranges = viewRanges(args, tile);
        if (!ranges.length) continue;
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
        for (const range of ranges)
          context.drawElements(
            context.TRIANGLES,
            range.count,
            context.UNSIGNED_INT,
            range.from * 4,
          );
      }

      drawModels(steady);
    });
    // A model that has just come to stand fades in over the flat ground left for it.
    for (const entry of appearing)
      drawBuildingOpacity(context, visibleOpacity() * appearanceOf(entry, now), () =>
        drawModels([entry]),
      );
    if (appearing.length > 0) map.triggerRepaint();
    // Transparent materials blend after the city's opaque surfaces and use the same model fade.
    context.enable(context.BLEND);
    context.blendFuncSeparate(
      context.SRC_ALPHA,
      context.ONE_MINUS_SRC_ALPHA,
      context.ZERO,
      context.ONE,
    );
    context.depthMask(false);
    context.depthFunc(context.LEQUAL);
    drawModels(
      [...standing].sort((a, b) => {
        const distance = (entry: TileflowPlacedModel) => Math.hypot(...modelCamera(entry));
        return distance(b) - distance(a);
      }),
      'blend',
    );

    /** The placed models, in the buildings' light. */
    function drawModels(
      list: readonly TileflowPlacedModel[],
      pass: 'solid' | 'blend' = 'solid',
    ): void {
      const model = programs.model;
      if (model && list.length > 0) {
        const m = model.uniforms;
        context.useProgram(model.program);
        context.disable(context.CULL_FACE);
        context.uniform1f(m.u_scale!, shown);
        context.uniform3fv(m.u_sun_dir!, [...light.direction]);
        context.uniform3fv(m.u_shadow_dir!, light.shadowDirection);
        context.uniform3fv(m.u_sun_light!, light.sunLight);
        context.uniform3fv(m.u_sky_light!, light.skyLight);
        context.uniform1f(m.u_night!, light.night);
        context.uniform1f(
          m.u_ambient_occlusion!,
          occlusionOn ? mixed((entry) => entry.modelOcclusion ?? 0.75) : 0,
        );
        context.uniform3fv(m.u_part_colours!, partColoursNow());
        context.uniform1fv(m.u_part_mix!, partMixNow());
        scene.bindShadow(context, m, light.strength);
        const centre = map.getCenter();
        for (const entry of list) {
          const emission = modelLightingNow(entry.model.id);
          context.uniform1fv(m.u_role_emission!, emission.strengths);
          context.uniform4fv(m.u_role_emission_colour!, emission.colours);
          context.uniform4fv(m.u_role_emission_gradient!, emission.gradients);
          context.uniform1fv(m.u_role_emission_power!, emission.powers);
          context.uniform4fv(m.u_role_colour!, emission.materialColours);
          context.uniform4fv(m.u_role_material!, emission.materials);
          const stand = standOf(entry);
          project(context, model, args, stand.tileX, stand.tileY);
          const at = placed(stand.tileX, stand.tileY);
          context.uniform2f(m.u_offset!, ...at.offset);
          context.uniform1f(m.u_metres!, at.metres);
          setPlacement(context, model, entry, stand);
          context.uniform3fv(m.u_view_position!, modelCamera(entry));
          context.uniform1f(
            m.u_opacity!,
            pass === 'blend' ? visibleOpacity() * appearanceOf(entry, now) : 1,
          );
          drawModel(context, model, entry, models.levelOf(entry, centre), pass);
        }
      }
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
          if (!groundVisible(args, x, y)) continue;
          project(context, program, args, x, y);
          context.uniform2f(program.uniforms.u_offset!, ...frame.offsetOf({x, y}));
          context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
        }
    }
    // The prerender draws no mask before the programs for this projection have linked, nor for
    // tiles uploaded since; the next frame has them.
    if (
      ((occlusionOn && !masks.contact) || (architectural.intensity > 0 && !masks.flood)) &&
      entries.length > 0 &&
      ground
    )
      map.triggerRepaint();
    if (masks.contact && entries.length > 0 && ground) {
      // Composite once per ground pixel, depth-tested against the buildings just drawn. This
      // preserves roofs and facades and avoids dark seams where bands or neighbouring tiles meet.
      const composite = programs.contactComposite!;
      context.useProgram(composite.program);
      context.activeTexture(context.TEXTURE2);
      context.bindTexture(context.TEXTURE_2D, masks.contact);
      context.uniform1i(composite.uniforms.u_contact!, 2);
      context.bindVertexArray(ground.vao);
      const xs = entries.map(({x}) => x);
      const ys = entries.map(({y}) => y);
      for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x += 1)
        for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y += 1) {
          if (!groundVisible(args, x, y)) continue;
          project(context, composite, args, x, y);
          context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
        }
      context.bindTexture(context.TEXTURE_2D, null);
    }
    if (nightLight > 0 && light.night > 0.01) {
      const program = programs.flood!;
      context.useProgram(program.program);
      context.blendFuncSeparate(context.ONE, context.ONE, context.ZERO, context.ONE);
      context.uniform1f(program.uniforms.u_scale!, shown);
      context.uniform1f(program.uniforms.u_metres!, camera.metres);
      context.uniform1f(program.uniforms.u_band!, flood.reach);
      context.uniform1f(program.uniforms.u_flood!, light.night * nightLight * visibleOpacity());
      context.uniform3fv(program.uniforms.u_flood_colour!, flood.colour);
      drawWalls(context, program, args, entries, flood.reach);
    }
    if (masks.flood && entries.length > 0 && ground) {
      const composite = programs.architecturalFloodComposite!;
      context.useProgram(composite.program);
      context.activeTexture(context.TEXTURE2);
      context.bindTexture(context.TEXTURE_2D, masks.flood);
      context.uniform1i(composite.uniforms.u_mask!, 2);
      context.uniform3fv(composite.uniforms.u_colour!, architectural.colour);
      context.blendFuncSeparate(
        context.SRC_ALPHA,
        context.ONE_MINUS_SRC_ALPHA,
        context.ZERO,
        context.ONE,
      );
      context.bindVertexArray(ground.vao);
      const xs = entries.map(({x}) => x),
        ys = entries.map(({y}) => y);
      for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x += 1)
        for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y += 1) {
          if (!groundVisible(args, x, y)) continue;
          project(context, composite, args, x, y);
          context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
        }
      context.bindTexture(context.TEXTURE_2D, null);
    }
    const emitterProgram = programs.modelEmitter;
    if (emitterProgram) {
      const u = emitterProgram.uniforms;
      context.useProgram(emitterProgram.program);
      context.disable(context.CULL_FACE);
      context.blendFuncSeparate(
        context.SRC_ALPHA,
        context.ONE_MINUS_SRC_ALPHA,
        context.ZERO,
        context.ONE,
      );
      context.bindVertexArray(null);
      context.uniform1f(u.u_scale!, shown);
      const palette = partColoursNow();
      const paletteMix = partMixNow();
      for (const entry of standing) {
        const level = models.levelOf(entry, map.getCenter());
        const surface = entry.model.levels[level]!.surface;
        if (!surface?.emitters?.length) continue;
        const stand = standOf(entry),
          lighting = modelLightingNow(entry.model.id);
        project(context, emitterProgram, args, stand.tileX, stand.tileY);
        setPlacement(context, emitterProgram, entry, stand);
        context.uniform1f(u.u_opacity!, visibleOpacity() * appearanceOf(entry, now));
        for (const [index, emitter] of surface.emitters.entries()) {
          const role = tileflowModelLightingRoles[emitter.role],
            part = tileflowModelParts[emitter.part];
          const geometry = entry.gl![level]!.surface!.emitters[index]!;
          const gradient = lighting.gradients.subarray(role * 4, role * 4 + 4);
          const bounds = entry.model.bounds;
          const height = (emitter.start[2] - bounds[2]) / Math.max(0.001, bounds[5] - bounds[2]);
          const at =
            gradient[0] === gradient[1]
              ? 1
              : Math.min(1, Math.max(0, (height - gradient[0]!) / (gradient[1]! - gradient[0]!)));
          const multiplier =
            gradient[0] === gradient[1]
              ? 1
              : gradient[2]! + (gradient[3]! - gradient[2]!) * at ** (10 ** lighting.powers[role]!);
          const strength = lighting.strengths[role]! * multiplier;
          if (strength <= 0) continue;
          const own = lighting.colours.subarray(role * 4, role * 4 + 4);
          const tint = lighting.materialColours.subarray(role * 4, role * 4 + 4);
          const tintWeight = tint[3]! * (1 - paletteMix[part]!);
          const colour = [0, 1, 2].map((channel) =>
            own[3]! > 0
              ? own[channel]!
              : palette[part * 3 + channel]! * (1 - tintWeight) + tint[channel]! * tintWeight,
          );
          context.uniform3fv(u.u_emitter_positions!, geometry.positions);
          context.uniform4fv(u.u_emitter_coordinates!, geometry.coordinates);
          context.uniform3fv(u.u_emitter_colour!, colour);
          context.uniform1f(u.u_emitter_strength!, strength);
          context.drawArrays(context.TRIANGLES, 0, 12);
        }
      }
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
      contact: [buildingContactVertex(projected), buildingContactFragment],
      contactComposite: [tileflowBuildingGroundVertex(projected), buildingContactCompositeFragment],
      flood: [tileflowBuildingBandVertex(projected), tileflowBuildingFloodFragment],
      architecturalFlood: [
        buildingArchitecturalFloodVertex(projected),
        buildingArchitecturalFloodFragment,
      ],
      architecturalFloodComposite: [
        tileflowBuildingGroundVertex(projected),
        buildingArchitecturalFloodComposite,
      ],
    };
    sources.model = [tileflowModelVertex(projected), tileflowModelFragment];
    sources.modelEmitter = [modelEmitterVertex(projected), modelEmitterFragment];
    if (!programs.depth)
      sources.depth = [tileflowBuildingDepthVertex, tileflowBuildingDepthFragment];
    if (!programs.modelDepth)
      sources.modelDepth = [tileflowModelDepthVertex, tileflowModelDepthFragment];
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
      const bound =
        name === 'model' || name === 'modelDepth'
          ? [...tileflowModelAttributes, ...tileflowModelSurfaceAttributes]
          : tileflowBuildingAttributes;
      for (const [index, [attribute]] of bound.entries())
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
  let fallbackStyleLight: unknown;
  const onStyle = () => {
    fallbackStyle = undefined;
    fallbackSun = undefined;
    if (!map.getLight) fallbackStyleLight = standaloneStyle().light;
    attach();
  };
  map.on('styledata', onStyle);
  // A settled map has the same style: it only retries attaching the layer.
  map.on('idle', attach);
  onStyle();
  camera.update();

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
    const fading = change?.transition?.mode === 'fade' && to > 0;
    if (fading) {
      scale = to;
      opacity = 0;
    } else opacity = 1;
    target = to;
    if (to > 0) camera.update();
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (duration === 0 || reduced) {
      scale = to;
      opacity = 1;
      motion = undefined;
      map.triggerRepaint();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const current = {
        from: fading ? opacity : scale,
        to: fading ? 1 : to,
        start: performance.now(),
        duration,
        done: () => resolve(),
      };
      motion = current;
      const step = () => {
        if (motion !== current || disposed) {
          resolve();
          return;
        }
        const t = Math.min(1, (performance.now() - current.start) / duration);
        const eased = t * t * (3 - 2 * t);
        if (fading) opacity = current.from + (current.to - current.from) * eased;
        else scale = current.from + (current.to - current.from) * eased;
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
    inspectModels() {
      const grouped = new Map<string, TileflowPlacedModel[]>();
      for (const placed of models.shown())
        grouped.set(placed.model.id, [...(grouped.get(placed.model.id) ?? []), placed]);
      return [...grouped].slice(0, 64).map(([id, placements]) => {
        const model = placements[0]!.model,
          level = model.levels[model.levels.length - 1]!;
        const view = new DataView(
          level.vertices.buffer,
          level.vertices.byteOffset,
          level.vertices.byteLength,
        );
        const mesh = inspectModelTriangles(level.indices, (index) => {
          const at = index * 16,
            x = level.centre[0] + view.getInt16(at, true) * level.step,
            up = level.centre[1] + view.getInt16(at + 2, true) * level.step,
            south = level.centre[2] + view.getInt16(at + 4, true) * level.step;
          return [x, -south, up];
        });
        return {
          id,
          module: 'Buildings',
          format: 'Tileflow prepared model',
          vertices: model.levels[0]!.vertices.byteLength / 16,
          triangles: model.levels[0]!.indices.length / 3,
          bytes: model.levels.reduce(
            (sum, item) => sum + item.vertices.byteLength + item.indices.byteLength,
            0,
          ),
          lods: model.levels.length,
          instances: placements.length,
          ...mesh,
        };
      });
    },
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
      return {
        declared: designs?.declared ?? false,
        tiles: raised,
        buildings,
        vertices,
        models: modelsDrawn().length,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion?.done();
      map.off('styledata', onStyle);
      map.off('idle', attach);
      unregister();
      models.dispose();
      try {
        if (map.getLayer(tileflowBuildings3DLayerId)) map.removeLayer(tileflowBuildings3DLayerId);
      } catch {
        // A map already removed has no layers left to remove.
      }
      camera.dispose();
      mesher.dispose();
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
