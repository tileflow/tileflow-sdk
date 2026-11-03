import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createTileflowBuildings3D} from '../src/buildings-3d-browser';
import {
  tileflowBuildingsMetadata,
  tileflowDefaultBuildings3DDesign,
} from '../src/buildings-3d-design';
import {encodeTile} from './vector-tile-fixture';

type Texture = {format?: number};
type Shader = {source?: string};
type Program = {shaders: Shader[]};
type Layer = {
  id: string;
  onAdd(map: unknown, context: WebGL2RenderingContext): void;
  onRemove(map: unknown, context: WebGL2RenderingContext): void;
  prerender(context: WebGL2RenderingContext, args: unknown): void;
  render(context: WebGL2RenderingContext, args: unknown): void;
};

/** Track texture units at the production renderer's draw boundary, including cold uploads. */
function recordingContext(base: new () => object) {
  const constants = new Map<string, number>();
  const textures = new Map<number, Texture | null>();
  const draws: {shadow: Texture | null | undefined; palette: Texture | null | undefined}[] = [];
  let active = 0;
  let program: Program | undefined;
  let uploads = 0;
  const methods: Record<string, unknown> = {
    drawingBufferWidth: 100,
    drawingBufferHeight: 100,
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createVertexArray: () => ({}),
    createBuffer: () => ({}),
    createProgram: (): Program => ({shaders: []}),
    createShader: (): Shader => ({}),
    shaderSource: (shader: Shader, source: string) => (shader.source = source),
    attachShader: (target: Program, shader: Shader) => target.shaders.push(shader),
    useProgram: (value: Program) => (program = value),
    getExtension: () => null,
    getParameter: () => 128,
    getProgramParameter: (_target: Program, parameter: number) =>
      parameter === gl.ACTIVE_UNIFORMS ? 0 : true,
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    activeTexture: (unit: number) => (active = unit),
    bindTexture: (_target: number, texture: Texture | null) => textures.set(active, texture),
    texImage2D: (_target: number, _level: number, format: number) => {
      textures.get(active)!.format = format;
      uploads++;
    },
    texStorage2D: (_target: number, _levels: number, format: number) => {
      textures.get(active)!.format = format;
    },
    drawElements: () => {
      if (program?.shaders.some((shader) => shader.source?.includes('u_palette_on'))) {
        draws.push({shadow: textures.get(gl.TEXTURE0), palette: textures.get(gl.TEXTURE1)});
      }
    },
  };
  const gl = new Proxy(new base(), {
    get(_target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in methods) return methods[key];
      if (key === key.toUpperCase()) {
        if (!constants.has(key)) constants.set(key, constants.size + 1);
        return constants.get(key);
      }
      return () => {};
    },
  }) as WebGL2RenderingContext;
  active = gl.TEXTURE0;
  return {gl, draws, uploads: () => uploads};
}

test('cold and refreshed building palettes preserve the shadow sampler on every draw', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebGL2RenderingContext');
  class Context {}
  Object.defineProperty(globalThis, 'WebGL2RenderingContext', {value: Context, configurable: true});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'WebGL2RenderingContext', descriptor);
    else delete (globalThis as {WebGL2RenderingContext?: unknown}).WebGL2RenderingContext;
  });
  const gpu = recordingContext(Context);
  const bytes = encodeTile({
    building: {
      extent: 8192,
      features: [
        {
          type: 3,
          properties: {render_height: 30, use: 'shop'},
          parts: [
            [
              [3500, 3500],
              [4500, 3500],
              [4500, 4500],
              [3500, 4500],
            ],
          ],
        },
      ],
    },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes.slice()));
  const design = (color: string) =>
    tileflowBuildingsMetadata({
      ...tileflowDefaultBuildings3DDesign,
      color: ['case', ['==', ['get', 'use'], 'shop'], color, '#808080'],
      occlusion: false,
    });
  let values = [design('#ff0000')];
  let position = 0;
  let layer: Layer | undefined;
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    addLayer(value: object) {
      layer = value as Layer;
      layer.onAdd(map, gpu.gl);
    },
    removeLayer() {
      layer?.onRemove(map, gpu.gl);
      layer = undefined;
    },
    getLayer: (id: string) => (layer?.id === id ? layer : undefined),
    getStyle: () => ({layers: []}),
    getLight: () => ({}),
    getPaintProperty: () => undefined,
    getBearing: () => 0,
    getCenter: () => ({lng: 0.005, lat: -0.005}),
    getZoom: () => 16,
    getPitch: () => 0,
    getSource: () => ({
      type: 'vector',
      tiles: ['https://palette.test/{z}/{x}/{y}.pbf'],
      maxzoom: 15,
    }),
    isStyleLoaded: () => true,
    on(event: string, listener: () => void) {
      const entries = listeners.get(event) ?? new Set();
      entries.add(listener);
      listeners.set(event, entries);
    },
    off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
    triggerRepaint() {},
  };
  const buildings = createTileflowBuildings3D({
    map,
    maxTiles: 1,
    controller: {getThemeMetadata: () => ({values, position})},
  });
  t.after(() => buildings.dispose());
  const matrix = [1 / 8192, 0, 0, 0, 0, 1 / 8192, 0, 0, 0, 0, 1 / 1000, 0, 0, 0, 0, 1];
  const args = {
    shaderData: {variantName: 'mercator', vertexShaderPrelude: '', define: ''},
    getProjectionData: () => ({
      mainMatrix: matrix,
      fallbackMatrix: matrix,
      tileMercatorCoords: [0, 0, 1, 1],
      clippingPlane: [0, 0, 0, 0],
      projectionTransition: 0,
    }),
  };
  const render = () => {
    layer!.prerender(gpu.gl, args);
    layer!.render(gpu.gl, args);
  };
  const deadline = performance.now() + 3000;
  while (!buildings.stats.buildings && performance.now() < deadline) {
    render();
    await delay(5);
  }
  assert.equal(buildings.stats.buildings, 1, 'the real tile must be meshed and uploaded');
  render();
  assert.ok(gpu.draws.length > 0, 'the fixture building must be inside the visible ring');
  for (const draw of gpu.draws) {
    assert.notEqual(draw.shadow, draw.palette, 'a cold palette must not occupy the shadow unit');
    assert.equal(draw.palette?.format, gpu.gl.RGBA8);
  }
  gpu.draws.length = 0;
  values = [values[0]!, design('#00ff00')];
  const before = gpu.uploads();
  for (position of [0, 0.25, 0.5, 0.75, 1]) render();
  assert.equal(gpu.uploads(), before + 1, 'one palette upload serves the complete transition');
  assert.ok(gpu.draws.length >= 5, 'every transition frame draws the buildings');
  const shadow = gpu.draws.at(-1)!.shadow;
  for (const draw of gpu.draws) {
    assert.equal(draw.shadow, shadow, 'a palette upload must not replace the shadow binding');
    assert.equal(draw.shadow?.format, gpu.gl.DEPTH_COMPONENT16);
    assert.equal(draw.palette?.format, gpu.gl.RGBA8);
    assert.notEqual(draw.shadow, draw.palette, 'shadow and colour samplers need separate textures');
  }
});
