// Tileflow's 3D trees: a custom WebGL2 layer that stands the trees of a Tileflow map's own vector
// tiles round the camera, as the map's vegetation module describes them, lit by the theme
// controller's sun. Trees cast shadows on the ground and on the 3D buildings and take theirs, in the
// map's shared 3D scene; nearer buildings hide them. Showing, hiding and growing them lays out no
// source.
import {tileflowBuildingGroundFragment, tileflowBuildingGroundVertex} from './buildings-3d-shaders';
import {cameraFrame, type CameraTiles, createCameraTiles} from './camera-tiles-browser';
import {
  tileflowScene3D,
  type TileflowSceneCaster,
  tileflowSceneExtent,
  tileflowSceneLight,
  tileflowSceneShadowFloor,
} from './scene-3d-browser';
import {resolveTileflowSun, tileflowDefaultSunPreset, type TileflowSun} from './sun';
import {tileflowColourChannels} from './theme-blend';
import type {TileflowTileRequestTransform} from './tile-reader';
import {
  placeTileflowTrees,
  readTileflowVegetation3D,
  tileflowTreeBytes,
  type TileflowTreeForm,
  tileflowTreeForms,
  type TileflowTreePlacement,
  type TileflowVegetation3D,
  tileflowVegetationMetadataKey,
} from './trees-3d';
import {type TileflowTreeLevel, tileflowTreeMeshes, tileflowTreeVertexBytes} from './trees-3d-mesh';
import {
  tileflowTreeAttributes,
  tileflowTreeDepthFragment,
  tileflowTreeEdgeFragment,
  tileflowTreeEdgeVertex,
  tileflowTreeDepthVertex,
  tileflowTreeFragment,
  tileflowTreeVertex,
} from './trees-3d-shaders';

/** The MapLibre GL JS map capabilities the trees use. */
export type TileflowTrees3DMap = {
  addLayer(layer: object, beforeId?: string): unknown;
  getBearing(): number;
  getCenter(): {lat: number; lng: number};
  getLayer(id: string): unknown;
  getLayoutProperty?(layer: string, name: string): unknown;
  getPitch(): number;
  getSource(id: string): unknown;
  getStyle(): unknown;
  getZoom(): number;
  isStyleLoaded(): boolean | void;
  off(event: string, listener: () => void): unknown;
  on(event: string, listener: () => void): unknown;
  removeLayer(id: string): unknown;
  setLayoutProperty?(layer: string, name: string, value: unknown): unknown;
  triggerRepaint(): unknown;
};

/** Where the trees read the sun and the map's design: a Tileflow theme controller. */
export type TileflowTrees3DThemes = {
  getSun?(): TileflowSun;
  getThemeMetadata?(key: string): Readonly<{values: readonly unknown[]; position: number}>;
};

export type TileflowTrees3DOptions = Readonly<{
  map: TileflowTrees3DMap;
  /** The theme controller, for the sun and the trees' colours in every theme. */
  controller?: TileflowTrees3DThemes;
  /** The vector source with the canopy points, when not the map's World source. */
  canopySource?: string;
  /** The zoom from which trees stand; they fade in over the zoom above it. Defaults to 15. */
  minzoom?: number;
  /** The most tiles of trees round the camera, from 1 to 64; defaults to 25. */
  maxTiles?: number;
  /** The layer to draw before; defaults to the style's `above-buildings` placement. */
  beforeId?: string;
  /** The map's request rules, for the tiles the layer reads. */
  transformRequest?: TileflowTileRequestTransform;
}>;

export type TileflowTrees3DChange = Readonly<{transition?: Readonly<{duration?: number}>}>;

export type TileflowTrees3D = {
  /** Grows the trees out of the ground; resolves once they stand. */
  show(options?: TileflowTrees3DChange): Promise<void>;
  /** Sinks the trees back into the ground; resolves once they are gone. */
  hide(options?: TileflowTrees3DChange): Promise<void>;
  /** Eases the trees to `scale` of their size, from 0 (none) to 1. */
  grow(scale: number, options?: TileflowTrees3DChange): Promise<void>;
  /** The size scale shown now. */
  readonly scale: number;
  /**
   * Whether the map's style describes 3D trees (`vegetation({mode: '3d'})`), tiles of trees,
   * trees placed (mapped and from canopy points) and trees drawn in the last frame.
   */
  readonly stats: Readonly<{
    declared: boolean;
    tiles: number;
    trees: number;
    mapped: number;
    canopy: number;
    drawn: number;
  }>;
  /** Takes the layer off the map and lets go of its buffers. */
  dispose(): void;
};

export const tileflowTrees3DLayerId = 'tileflow-trees-3d';
// World's trees and canopy points are at z15.
const preferredZoom = 15;
const defaultTransition = 1000;
// Street lights draw over the 3D scene, so their lamps can hide behind trees and buildings.
const streetLightsLayerId = 'tileflow-street-lights';
const leafSlots = 4;
// How far each finish turns normals from the facets towards the round shape.
const finishes = {faceted: {round: 0.5}, smooth: {round: 1}, toon: {round: 0.3}} as const;

type Program = {program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null>};
type TreeTile = {
  placement: TileflowTreePlacement;
  gl?: {vbo: WebGLBuffer; vaos: Map<string, WebGLVertexArrayObject>};
};
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
 * Creates the trees and puts their layer on the map, sunk in the ground until `show()`. They read
 * the source's z15 tiles round the camera, where World carries its trees and canopy points.
 */
export function createTileflowTrees3D(options: TileflowTrees3DOptions): TileflowTrees3D {
  const {map} = options;
  const minzoom = options.minzoom ?? 15;
  const maxTiles = Math.round(options.maxTiles ?? 25);
  if (!Number.isFinite(minzoom) || minzoom < 0 || minzoom > 24)
    throw new RangeError('Tileflow 3D trees minzoom must be a zoom from 0 to 24.');
  if (!(maxTiles >= 1 && maxTiles <= 64))
    throw new RangeError('Tileflow 3D trees maxTiles must be from 1 to 64.');

  let scale = 0;
  let target = 0;
  let motion:
    {from: number; to: number; start: number; duration: number; done: () => void} | undefined;
  let gl: WebGL2RenderingContext | undefined;
  let programs: Partial<Record<'trees' | 'depth' | 'ground' | 'edges', Program>> = {};
  let variant: string | undefined;
  let meshes:
    | Record<TileflowTreeForm, Record<TileflowTreeLevel, {buffer: WebGLBuffer; count: number}>>
    | undefined;
  let ground: {vao: WebGLVertexArrayObject; vbo: WebGLBuffer} | undefined;
  let disposed = false;
  let drawnLast = 0;
  let generation = 0;
  let registered = false;
  let unregister = () => {};
  const scene = tileflowScene3D(map);

  // --- The map's design ---

  let design:
    {values: readonly unknown[]; parsed: (TileflowVegetation3D | undefined)[]} | undefined;

  /** The vegetation each theme on screen describes, and the blend's position between them. */
  function vegetationOnScreen(): {
    themes: (TileflowVegetation3D | undefined)[];
    position: number;
  } {
    const read = options.controller?.getThemeMetadata?.(tileflowVegetationMetadataKey) ?? {
      values: [
        (map.getStyle() as {metadata?: Record<string, unknown>} | undefined)?.metadata?.[
          tileflowVegetationMetadataKey
        ],
      ],
      position: 0,
    };
    if (
      !design ||
      design.values.length !== read.values.length ||
      design.values.some((value, index) => value !== read.values[index])
    )
      design = {
        values: read.values,
        parsed: read.values.map((value) =>
          readTileflowVegetation3D({[tileflowVegetationMetadataKey]: value}),
        ),
      };
    return {themes: design.parsed, position: read.position};
  }

  /** The vegetation the trees are placed by: the first theme on screen that describes it. */
  function vegetation(): TileflowVegetation3D | undefined {
    return vegetationOnScreen().themes.find((theme) => theme !== undefined);
  }

  // --- Tiles round the camera ---

  let tiles: CameraTiles<TreeTile>[] = [];
  let tilesKey: string | undefined;

  let describedLast: TileflowVegetation3D | undefined;

  function ensureTiles(): CameraTiles<TreeTile>[] {
    const described = vegetation();
    if (described === describedLast && (described === undefined || tiles.length > 0)) return tiles;
    describedLast = described;
    const key = described
      ? JSON.stringify([
          described.source,
          described.layers,
          described.fields,
          described.unknownForms,
          described.regions,
          options.canopySource,
        ])
      : undefined;
    if (key === tilesKey) return tiles;
    for (const set of tiles) {
      for (const entry of set.all()) if (entry.value && gl) release(gl, entry.value);
      set.dispose();
    }
    tiles = [];
    tilesKey = key;
    generation += 1;
    if (!described) return tiles;
    const make = (source: string, layers: {tree?: string; treeRow?: string; canopy?: string}) =>
      createCameraTiles<TreeTile>({
        map,
        source,
        layers: [layers.tree, layers.treeRow, layers.canopy].filter(
          (name): name is string => !!name,
        ),
        zoom: preferredZoom,
        minzoom,
        maxTiles,
        ...(options.transformRequest ? {transformRequest: options.transformRequest} : {}),
        active: () => target > 0 || scale > 0,
        build(tile, tileMetres) {
          const trees = layers.tree ? tile.layers[layers.tree] : undefined;
          const rows = layers.treeRow ? tile.layers[layers.treeRow] : undefined;
          const canopy = layers.canopy ? tile.layers[layers.canopy] : undefined;
          if (!trees && !rows && !canopy) return emptyTile;
          const placement = placeTileflowTrees(
            {...(trees ? {trees} : {}), ...(rows ? {rows} : {}), ...(canopy ? {canopy} : {})},
            {
              tile,
              tileMetres,
              fields: described.fields,
              unknownForms: described.unknownForms,
              regions: described.regions,
            },
          );
          return placement.trees.length > 0 ? {placement} : emptyTile;
        },
        empty: emptyTile,
        release(value) {
          if (gl) release(gl, value);
        },
        changed() {
          map.triggerRepaint();
        },
      });
    const canopyElsewhere =
      options.canopySource !== undefined && options.canopySource !== described.source;
    tiles.push(
      make(described.source, {
        tree: described.layers.tree,
        ...(described.layers.treeRow ? {treeRow: described.layers.treeRow} : {}),
        ...(canopyElsewhere || !described.layers.canopy ? {} : {canopy: described.layers.canopy}),
      }),
    );
    if (canopyElsewhere)
      tiles.push(make(options.canopySource!, {canopy: described.layers.canopy ?? 'canopy'}));
    if (target > 0) for (const set of tiles) set.update();
    return tiles;
  }

  function release(context: WebGL2RenderingContext, tile: TreeTile): void {
    if (!tile.gl) return;
    for (const vao of tile.gl.vaos.values()) context.deleteVertexArray(vao);
    context.deleteBuffer(tile.gl.vbo);
    tile.gl = undefined;
  }

  type Entry = {x: number; y: number; set: CameraTiles<TreeTile>; value: TreeTile};

  function drawn(): Entry[] {
    const entries: Entry[] = [];
    for (const set of tiles)
      for (const entry of set.ready())
        if (entry.value.gl) entries.push({x: entry.x, y: entry.y, set, value: entry.value});
    return entries;
  }

  /** Uploads up to two tiles of trees a frame. */
  function upload(context: WebGL2RenderingContext): void {
    if (!meshes) return;
    let budget = 2;
    for (const set of tiles)
      for (const {value: tile} of set.ready()) {
        if (tile.gl || tile.placement.trees.length === 0) continue;
        if (budget-- <= 0) {
          map.triggerRepaint();
          return;
        }
        const vbo = context.createBuffer()!;
        context.bindBuffer(context.ARRAY_BUFFER, vbo);
        context.bufferData(context.ARRAY_BUFFER, tile.placement.trees, context.STATIC_DRAW);
        const vaos = new Map<string, WebGLVertexArrayObject>();
        for (const form of tileflowTreeForms) {
          const range = tile.placement.forms[form];
          if (range.count === 0) continue;
          for (const level of ['near', 'far'] as const) {
            const vao = context.createVertexArray()!;
            context.bindVertexArray(vao);
            bindMesh(context, meshes[form][level].buffer);
            bindTrees(context, vbo, range.start * tileflowTreeBytes);
            vaos.set(`${form}:${level}`, vao);
          }
        }
        context.bindVertexArray(null);
        tile.gl = {vbo, vaos};
        generation += 1;
      }
  }

  function bindMesh(context: WebGL2RenderingContext, buffer: WebGLBuffer): void {
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    const stride = tileflowTreeVertexBytes;
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, 3, context.FLOAT, false, stride, 0);
    context.enableVertexAttribArray(1);
    context.vertexAttribPointer(1, 3, context.BYTE, true, stride, 12);
    context.enableVertexAttribArray(2);
    context.vertexAttribPointer(2, 1, context.UNSIGNED_BYTE, false, stride, 15);
    context.enableVertexAttribArray(3);
    context.vertexAttribPointer(3, 2, context.UNSIGNED_BYTE, true, stride, 16);
    context.enableVertexAttribArray(8);
    context.vertexAttribPointer(8, 3, context.BYTE, true, stride, 18);
  }

  function bindTrees(context: WebGL2RenderingContext, buffer: WebGLBuffer, offset: number): void {
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    const stride = tileflowTreeBytes;
    const instance = (
      index: number,
      size: number,
      type: number,
      normalised: boolean,
      at: number,
    ) => {
      context.enableVertexAttribArray(index);
      context.vertexAttribPointer(index, size, type, normalised, stride, offset + at);
      context.vertexAttribDivisor(index, 1);
    };
    instance(4, 2, context.UNSIGNED_SHORT, false, 0);
    instance(5, 2, context.UNSIGNED_SHORT, false, 4);
    instance(6, 2, context.UNSIGNED_BYTE, true, 8);
    instance(7, 2, context.UNSIGNED_BYTE, true, 12);
  }

  // --- Light and colour ---

  function sunNow(): TileflowSun {
    return options.controller?.getSun?.() ?? resolveTileflowSun(tileflowDefaultSunPreset);
  }

  const parsedColours = new Map<string, readonly number[]>();
  function rgb(colour: string): readonly number[] {
    let value = parsedColours.get(colour);
    if (!value) {
      const channels = tileflowColourChannels(colour) ?? [0.4, 0.55, 0.35, 1];
      value = [channels[0], channels[1], channels[2]];
      parsedColours.set(colour, value);
    }
    return value;
  }

  /** A palette resampled to the shader's slots, darkest to lightest. */
  function slots(palette: readonly string[]): number[][] {
    const colours = palette.map(rgb);
    return Array.from({length: leafSlots}, (_, slot) => {
      const at = colours.length === 1 ? 0 : (slot / (leafSlots - 1)) * (colours.length - 1);
      const low = Math.floor(at);
      const high = Math.min(colours.length - 1, low + 1);
      return [0, 1, 2].map(
        (channel) =>
          colours[low]![channel]! +
          (colours[high]![channel]! - colours[low]![channel]!) * (at - low),
      );
    });
  }

  let palette:
    {themes: unknown; position: number; value: ReturnType<typeof mixColours>} | undefined;

  /** The trees' colours on screen, mixed between the themes either side of a blend. */
  function colours() {
    const {themes, position} = vegetationOnScreen();
    if (palette?.themes === themes && palette.position === position) return palette.value;
    palette = {themes, position, value: mixColours(themes, position)};
    return palette.value;
  }

  function mixColours(themes: (TileflowVegetation3D | undefined)[], position: number) {
    const at = Math.min(themes.length - 1, Math.max(0, position));
    const lower = Math.floor(at);
    const upper = Math.min(themes.length - 1, lower + 1);
    const a = themes[lower] ?? vegetation();
    const b = themes[upper] ?? a;
    const t = at - lower;
    const mixList = (x: number[][], y: number[][]) =>
      x.map((colour, index) => colour.map((channel, c) => channel + (y[index]![c]! - channel) * t));
    const of = (theme: TileflowVegetation3D | undefined) => ({
      bark: [[...rgb(theme?.colors.bark ?? '#5b4a3a')]],
      broadleaf: slots(theme?.colors.broadleaf ?? ['#6f9a5b']),
      conifer: slots(theme?.colors.conifer ?? ['#557f52']),
      palm: slots(theme?.colors.palm ?? ['#7fa45f']),
      size: [[theme?.heightScale ?? 1, theme?.crownScale ?? 1, 0]],
      forms: tileflowTreeForms.map((form) => [
        theme?.forms[form]?.heightScale ?? 1,
        theme?.forms[form]?.crownScale ?? 1,
        0,
      ]),
      edges: [[theme?.edges ?? 0, 0, 0]],
      edgeColor: [[...(rgb(theme?.edgeColor ?? '#000000') ?? [0, 0, 0])]],
      owned: [[theme?.edgeColor === undefined ? 0 : 1, 0, 0]],
    });
    const [x, y] = [of(a), of(b)];
    const size = mixList(x.size, y.size)[0]!;
    const forms = mixList(x.forms, y.forms);
    return {
      bark: mixList(x.bark, y.bark)[0]!,
      broadleaf: mixList(x.broadleaf, y.broadleaf),
      conifer: mixList(x.conifer, y.conifer),
      palm: mixList(x.palm, y.palm),
      size,
      /** Each form's height and crown scale: the map's times the form's own. */
      sizes: Object.fromEntries(
        tileflowTreeForms.map((form, index) => [
          form,
          [size[0]! * forms[index]![0]!, size[1]! * forms[index]![1]!],
        ]),
      ) as Record<TileflowTreeForm, number[]>,
      finish: (t < 0.5 ? a : b)?.finish ?? 'faceted',
      edges: mixList(x.edges, y.edges)[0]![0]!,
      edgeColor: mixList(x.edgeColor, y.edgeColor)[0]!,
      ownEdge: mixList(x.owned, y.owned)[0]![0]!,
    };
  }

  // --- Drawing ---

  /** The size scale times the fade-in above `minzoom`. */
  function visibleScale(): number {
    return scale;
  }

  function fadeIn(): number {
    const t = Math.min(1, Math.max(0, (map.getZoom() - minzoom) / 0.8));
    return t * t * (3 - 2 * t);
  }

  /** How far trees reach from the map's centre before they fade out, in metres. */
  function reach(): [number, number] {
    const zoom = map.getZoom();
    const far = Math.min(3000, Math.max(500, 900 * 2 ** (16 - zoom) * (1 + map.getPitch() / 90)));
    return [far * 0.7, far];
  }

  /** The highest rank shown in a tile, by zoom and by its distance from the centre. */
  function rankOf(distance: number): number {
    const zoom = map.getZoom();
    const base = zoom >= 16.5 ? 15 : zoom >= 16 ? 12 : zoom >= 15.5 ? 9 : 7;
    const [start, end] = reach();
    const fall = distance > start ? Math.ceil(((distance - start) / (end - start)) * 6) : 0;
    return Math.max(2, Math.min(15, base - fall));
  }

  const caster: TileflowSceneCaster = {
    groundOrder: 1,
    bounds() {
      const shown = visibleScale();
      const entries = drawn();
      if (shown <= 0 || entries.length === 0 || map.getZoom() < minzoom) return undefined;
      let [left, top, right, bottom, tallest] = [Infinity, Infinity, -Infinity, -Infinity, 0];
      for (const {x, y, set, value} of entries) {
        if (set.zoom !== preferredZoom) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        tallest = Math.max(tallest, value.placement.tallest);
      }
      if (!Number.isFinite(left)) return undefined;
      const size = colours().size;
      return {
        zoom: preferredZoom,
        tiles: [left, top, right, bottom],
        tallest: tallest * shown * size[0]!,
      };
    },
    // The shadow map is drawn again only when the trees it holds or their size change.
    key: () =>
      `trees:${visibleScale().toFixed(4)}:${generation}:${programs.depth ? 1 : 0}:${Object.values(
        colours().sizes,
      )
        .flat()
        .map((value) => value.toFixed(3))
        .join()}:${drawn()
        .map(({x, y}) => `${x}/${y}`)
        .join(';')}`,
    drawDepth(context, frame) {
      const program = programs.depth;
      if (!program || !meshes) return;
      context.useProgram(program.program);
      const u = program.uniforms;
      context.uniform1f(u.u_scale!, visibleScale());
      context.uniform1f(u.u_metres!, frame.metres);
      context.uniformMatrix4fv(u.u_light_matrix!, false, frame.light.matrix);
      const sizes = colours().sizes;
      for (const {x, y, set, value} of drawn()) {
        context.uniform2f(u.u_offset!, ...frame.offsetOf({x, y}, set.zoom));
        for (const form of tileflowTreeForms) {
          const range = value.placement.forms[form];
          const vao = value.gl!.vaos.get(`${form}:far`);
          if (range.count === 0 || !vao) continue;
          context.uniform2fv(u.u_size_scale!, sizes[form]);
          context.bindVertexArray(vao);
          context.drawArraysInstanced(context.TRIANGLES, 0, meshes[form].far.count, range.count);
        }
      }
    },
  };

  function project(
    context: WebGL2RenderingContext,
    program: Program,
    args: ProjectionArgs,
    x: number,
    y: number,
  ) {
    const data = args.getProjectionData({tileID: {canonical: {x, y, z: preferredZoom}, wrap: 0}});
    const uniforms = program.uniforms;
    context.uniformMatrix4fv(uniforms.u_projection_matrix!, false, data.mainMatrix);
    context.uniform4fv(uniforms.u_projection_tile_mercator_coords!, data.tileMercatorCoords);
    context.uniform4fv(uniforms.u_projection_clipping_plane!, data.clippingPlane);
    context.uniform1f(uniforms.u_projection_transition!, data.projectionTransition);
    context.uniformMatrix4fv(uniforms.u_projection_fallback_matrix!, false, data.fallbackMatrix);
  }

  function draw(context: WebGL2RenderingContext, args: ProjectionArgs): void {
    const entries = drawn();
    drawnLast = 0;
    if (entries.length === 0 || !meshes || !programs.trees) return;
    const sun = sunNow();
    const light = tileflowSceneLight(sun);
    const palette = colours();
    const frame = scene.frame();
    const centre = map.getCenter();
    const zoom = preferredZoom;
    const n = 2 ** zoom;
    const cx = ((centre.lng + 180) / 360) * n;
    const phi = (centre.lat * Math.PI) / 180;
    const cy = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n;
    const metres = frame?.metres ?? (40_075_016.686 * Math.cos(phi)) / n / tileflowSceneExtent;
    const [near, far] = reach();

    const program = programs.trees;
    const u = program.uniforms;
    context.useProgram(program.program);
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.depthMask(true);
    context.disable(context.BLEND);
    context.disable(context.CULL_FACE);
    context.uniform1f(u.u_scale!, visibleScale());
    context.uniform1f(u.u_metres!, metres);
    context.uniform1f(u.u_round!, finishes[palette.finish].round);
    context.uniform1f(u.u_toon!, palette.finish === 'toon' ? 1 : 0);
    context.uniform3fv(u.u_sun_dir!, [...light.direction]);
    context.uniform3fv(u.u_shadow_dir!, light.shadowDirection);
    context.uniform3fv(u.u_sun_light!, light.sunLight);
    context.uniform3fv(u.u_sky_light!, light.skyLight);
    context.uniform1f(u.u_night!, light.night);
    context.uniform1f(u.u_fade!, fadeIn());
    context.uniform2fv(u.u_reach!, reach());
    context.uniform3fv(u.u_bark!, palette.bark);
    context.uniform1f(u.u_leaf_count!, leafSlots);
    scene.bindShadow(context, u, light.strength);
    let count = 0;
    // What each tile draws, for the outline pass that follows.
    const draws: {
      x: number;
      y: number;
      offset: number[];
      form: TileflowTreeForm;
      level: TileflowTreeLevel;
      instances: number;
      vao: WebGLVertexArrayObject;
    }[] = [];
    for (const {x, y, set, value} of entries) {
      project(context, program, args, x, y);
      const offset = frame ? frame.offsetOf({x, y}, set.zoom) : [0, 0];
      context.uniform2f(u.u_offset!, offset[0]!, offset[1]!);
      context.uniform2f(
        u.u_centre!,
        (cx - x) * tileflowSceneExtent,
        (cy - y) * tileflowSceneExtent,
      );
      const distance =
        Math.hypot(Math.max(x, Math.min(cx, x + 1)) - cx, Math.max(y, Math.min(cy, y + 1)) - cy) *
        tileflowSceneExtent *
        metres;
      // A tile wholly beyond the reach has faded out: none of its trees is drawn.
      if (distance > far) continue;
      const level: TileflowTreeLevel = distance < near * 0.45 ? 'near' : 'far';
      const rank = rankOf(distance);
      for (const form of tileflowTreeForms) {
        const range = value.placement.forms[form];
        const instances = range.upTo[rank] ?? 0;
        const vao = value.gl!.vaos.get(`${form}:${level}`);
        if (instances === 0 || !vao) continue;
        const leaves =
          form === 'palm'
            ? palette.palm
            : form === 'conifer' || form === 'columnar'
              ? palette.conifer
              : palette.broadleaf;
        context.uniform3fv(u.u_leaves!, leaves.flat());
        context.uniform2fv(u.u_size_scale!, palette.sizes[form]);
        context.bindVertexArray(vao);
        context.drawArraysInstanced(context.TRIANGLES, 0, meshes[form][level].count, instances);
        count += instances;
        draws.push({x, y, offset, form, level, instances, vao});
      }
    }
    drawnLast = count;

    // The outline: back faces pushed out a constant width on screen, behind each tree.
    const edges = palette.edges;
    if (edges > 0.01 && programs.edges && draws.length > 0) {
      const edgeProgram = programs.edges;
      const e = edgeProgram.uniforms;
      context.useProgram(edgeProgram.program);
      context.enable(context.CULL_FACE);
      context.cullFace(context.FRONT);
      context.uniform1f(e.u_scale!, visibleScale());
      context.uniform1f(e.u_metres!, metres);
      context.uniform1f(e.u_round!, finishes[palette.finish].round);
      context.uniform1f(e.u_fade!, fadeIn());
      context.uniform2fv(e.u_reach!, reach());
      context.uniform2f(e.u_viewport!, context.drawingBufferWidth, context.drawingBufferHeight);
      context.uniform1f(e.u_edge_width!, edges * 1.5 * pixelRatio(context));
      let tile = '';
      for (const draw of draws) {
        if (tile !== `${draw.x}/${draw.y}`) {
          tile = `${draw.x}/${draw.y}`;
          project(context, edgeProgram, args, draw.x, draw.y);
          context.uniform2f(e.u_offset!, draw.offset[0]!, draw.offset[1]!);
          context.uniform2f(
            e.u_centre!,
            (cx - draw.x) * tileflowSceneExtent,
            (cy - draw.y) * tileflowSceneExtent,
          );
        }
        // The map's edge colour, or the form's darkest leaf colour deepened.
        const leaves =
          draw.form === 'palm'
            ? palette.palm
            : draw.form === 'conifer' || draw.form === 'columnar'
              ? palette.conifer
              : palette.broadleaf;
        const own = palette.ownEdge;
        context.uniform3fv(
          e.u_edge_colour!,
          [0, 1, 2].map(
            (channel) => palette.edgeColor[channel]! * own + leaves[0]![channel]! * 0.4 * (1 - own),
          ),
        );
        context.uniform2fv(e.u_size_scale!, palette.sizes[draw.form]);
        context.bindVertexArray(draw.vao);
        context.drawArraysInstanced(
          context.TRIANGLES,
          0,
          meshes[draw.form][draw.level].count,
          draw.instances,
        );
      }
      context.disable(context.CULL_FACE);
    }

    // The flat map under the trees' shadows, when no 3D buildings darken it.
    if (light.strength > 0 && frame && ground && programs.ground && scene.drawsGround(caster)) {
      const shadowProgram = programs.ground;
      context.depthMask(false);
      context.enable(context.BLEND);
      context.blendFuncSeparate(context.DST_COLOR, context.ZERO, context.ZERO, context.ONE);
      context.useProgram(shadowProgram.program);
      context.uniform1f(shadowProgram.uniforms.u_metres!, frame.metres);
      context.uniform3fv(shadowProgram.uniforms.u_ground_shadow!, light.groundShadow);
      scene.bindShadow(context, shadowProgram.uniforms, light.strength);
      context.bindVertexArray(ground.vao);
      const longest = Math.min(
        2,
        Math.ceil(
          frame.tallest /
            Math.tan((tileflowSceneShadowFloor * Math.PI) / 180) /
            (tileflowSceneExtent * frame.metres),
        ),
      );
      const margin = Math.max(1, longest);
      const [left, top, right, bottom] = frame.tiles;
      for (let gx = left - margin; gx <= right + margin; gx += 1)
        for (let gy = top - margin; gy <= bottom + margin; gy += 1) {
          project(context, shadowProgram, args, gx, gy);
          context.uniform2f(shadowProgram.uniforms.u_offset!, ...frame.offsetOf({x: gx, y: gy}));
          context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
        }
      context.disable(context.BLEND);
      context.depthMask(true);
    }
    context.bindVertexArray(null);
  }

  // --- Programs and buffers ---

  function compile(
    context: WebGL2RenderingContext,
    vertexText: string,
    fragmentText: string,
    locations: readonly string[],
  ): Program {
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
    for (const [index, attribute] of locations.entries())
      context.bindAttribLocation(program, index, attribute);
    context.linkProgram(program);
    const failed = !context.getProgramParameter(program, context.LINK_STATUS);
    const log = failed
      ? `${context.getShaderInfoLog(vertex) ?? ''} ${context.getShaderInfoLog(fragment) ?? ''} ${context.getProgramInfoLog(program) ?? ''}`
      : '';
    context.deleteShader(vertex);
    context.deleteShader(fragment);
    if (failed) {
      context.deleteProgram(program);
      throw new Error(`Tileflow 3D trees shaders failed to link: ${log}`);
    }
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const count = context.getProgramParameter(program, context.ACTIVE_UNIFORMS) as number;
    for (let index = 0; index < count; index += 1) {
      const info = context.getActiveUniform(program, index);
      if (info)
        uniforms[info.name.replace(/\[0\]$/u, '')] = context.getUniformLocation(program, info.name);
    }
    return {program, uniforms};
  }

  function link(context: WebGL2RenderingContext, shaderData: ProjectionArgs['shaderData']): void {
    const projected = `${shaderData.vertexShaderPrelude}\n${shaderData.define}`;
    const next: typeof programs = {
      trees: compile(
        context,
        tileflowTreeVertex(projected),
        tileflowTreeFragment,
        tileflowTreeAttributes,
      ),
      ground: compile(
        context,
        tileflowBuildingGroundVertex(projected),
        tileflowBuildingGroundFragment,
        ['a_pos'],
      ),
      edges: compile(
        context,
        tileflowTreeEdgeVertex(projected),
        tileflowTreeEdgeFragment,
        tileflowTreeAttributes,
      ),
      depth:
        programs.depth ??
        compile(
          context,
          tileflowTreeDepthVertex,
          tileflowTreeDepthFragment,
          tileflowTreeAttributes,
        ),
    };
    for (const name of ['trees', 'ground', 'edges'] as const) {
      const previous = programs[name];
      if (previous) context.deleteProgram(previous.program);
    }
    programs = next;
    variant = shaderData.variantName;
  }

  function createMeshes(context: WebGL2RenderingContext): void {
    const built = tileflowTreeMeshes();
    meshes = Object.fromEntries(
      tileflowTreeForms.map((form) => [
        form,
        Object.fromEntries(
          (['near', 'far'] as const).map((level) => {
            const buffer = context.createBuffer()!;
            context.bindBuffer(context.ARRAY_BUFFER, buffer);
            context.bufferData(
              context.ARRAY_BUFFER,
              built[form][level].vertices,
              context.STATIC_DRAW,
            );
            return [level, {buffer, count: built[form][level].count}];
          }),
        ),
      ]),
    ) as typeof meshes;
    const vao = context.createVertexArray()!;
    context.bindVertexArray(vao);
    const vbo = context.createBuffer()!;
    context.bindBuffer(context.ARRAY_BUFFER, vbo);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Uint16Array([
        0,
        0,
        tileflowSceneExtent,
        0,
        0,
        tileflowSceneExtent,
        tileflowSceneExtent,
        tileflowSceneExtent,
      ]),
      context.STATIC_DRAW,
    );
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, 2, context.UNSIGNED_SHORT, false, 0, 0);
    context.bindVertexArray(null);
    ground = {vao, vbo};
  }

  const layer = {
    id: tileflowTrees3DLayerId,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      gl = context;
      createMeshes(context);
    },
    onRemove(_: unknown, context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      for (const set of tiles)
        for (const entry of set.all()) if (entry.value) release(context, entry.value);
      for (const program of Object.values(programs))
        if (program) context.deleteProgram(program.program);
      if (meshes)
        for (const levels of Object.values(meshes))
          for (const mesh of Object.values(levels)) context.deleteBuffer(mesh.buffer);
      if (ground) {
        context.deleteVertexArray(ground.vao);
        context.deleteBuffer(ground.vbo);
      }
      unregister();
      registered = false;
      scene.release(context);
      programs = {};
      meshes = undefined;
      ground = undefined;
      variant = undefined;
      gl = undefined;
    },
    prerender(context: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!isWebGL2(context)) return;
      ensureTiles();
      if (!programs.depth) return;
      if (!registered) unregister = scene.register(caster);
      registered = true;
      const metres = tiles[0]?.metres ?? 1;
      scene.prepare(context, tileflowSceneLight(sunNow()), metres);
    },
    render(context: WebGLRenderingContext | WebGL2RenderingContext, args: ProjectionArgs) {
      if (!isWebGL2(context)) return;
      try {
        if (variant !== args.shaderData.variantName) link(context, args.shaderData);
      } catch {
        return;
      }
      if (visibleScale() <= 0 || map.getZoom() < minzoom) {
        drawnLast = 0;
        return;
      }
      ensureTiles();
      upload(context);
      draw(context, args);
    },
  };

  // --- The flat trees ---

  // The style's flat trees (the vegetation module's circles and render passes) give way while the
  // 3D trees stand, and come back when they sink. Changing a layer's visibility lays its source out
  // again once, so it happens when the trees are shown or hidden, not as they grow.
  const flatVisibility = new Map<string, unknown>();
  function standIn(shown: boolean): void {
    if (!map.setLayoutProperty || !map.getLayoutProperty) return;
    if (!shown) {
      for (const [id, previous] of flatVisibility)
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', previous ?? 'visible');
      flatVisibility.clear();
      return;
    }
    const flat = new Set(vegetation()?.flatLayers ?? []);
    if (flat.size === 0) return;
    const layers = (map.getStyle() as {layers?: {id: string}[]} | undefined)?.layers ?? [];
    for (const {id} of layers) {
      if (!flat.has(id.split('::')[0]!)) continue;
      const visibility = map.getLayoutProperty(id, 'visibility');
      if (!flatVisibility.has(id)) flatVisibility.set(id, visibility);
      if (visibility !== 'none') map.setLayoutProperty(id, 'visibility', 'none');
    }
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
    if (disposed || map.getLayer(tileflowTrees3DLayerId) || !map.isStyleLoaded()) return;
    try {
      map.addLayer(layer, beforeId());
    } catch {
      // The style is mid-update; the next style event retries.
    }
  }

  const onStyle = () => {
    attach();
    if (target > 0) {
      standIn(true);
      for (const set of ensureTiles()) set.update();
    }
  };
  map.on('styledata', onStyle);
  map.on('idle', onStyle);
  attach();

  // --- Motion ---

  function grow(goal: number, change?: TileflowTrees3DChange): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!Number.isFinite(goal))
      return Promise.reject(new RangeError('A tree size scale is a number from 0 to 1.'));
    const to = Math.min(1, Math.max(0, goal));
    motion?.done();
    const duration = change?.transition?.duration ?? defaultTransition;
    if (!(duration >= 0 && duration <= 10_000))
      return Promise.reject(new RangeError('A transition lasts from 0 to 10000 ms.'));
    attach();
    target = to;
    if (to > 0) {
      standIn(true);
      for (const set of ensureTiles()) set.update();
    }
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (duration === 0 || reduced) {
      scale = to;
      motion = undefined;
      if (to === 0) standIn(false);
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
        scale = current.from + (current.to - current.from) * (t * t * (3 - 2 * t));
        map.triggerRepaint();
        if (t >= 1) {
          motion = undefined;
          if (current.to === 0) standIn(false);
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
      let count = 0;
      let trees = 0;
      let mapped = 0;
      let canopy = 0;
      for (const set of tiles)
        for (const {value} of set.ready()) {
          if (value.placement.trees.length === 0) continue;
          count += 1;
          trees += value.placement.trees.length / tileflowTreeBytes;
          mapped += value.placement.mapped;
          canopy += value.placement.canopy;
        }
      return {
        declared: vegetation() !== undefined,
        tiles: count,
        trees,
        mapped,
        canopy,
        drawn: drawnLast,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      motion?.done();
      standIn(false);
      map.off('styledata', onStyle);
      map.off('idle', onStyle);
      unregister();
      try {
        if (map.getLayer(tileflowTrees3DLayerId)) map.removeLayer(tileflowTrees3DLayerId);
      } catch {
        // A map already removed has no layers left to remove.
      }
      for (const set of tiles) set.dispose();
      tiles = [];
    },
  };
}

const emptyTile: TreeTile = Object.freeze({
  placement: Object.freeze({
    trees: new Uint8Array(0),
    forms: Object.fromEntries(
      tileflowTreeForms.map((form) => [form, {start: 0, count: 0, upTo: new Array(16).fill(0)}]),
    ) as unknown as TileflowTreePlacement['forms'],
    tallest: 0,
    mapped: 0,
    canopy: 0,
  }),
});

/** Drawing buffer pixels per CSS pixel. */
function pixelRatio(context: WebGL2RenderingContext): number {
  const canvas = context.canvas as {clientWidth?: number};
  const width = canvas.clientWidth;
  return width ? Math.min(4, Math.max(1, context.drawingBufferWidth / width)) : 1;
}

function isWebGL2(context: unknown): context is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
}
