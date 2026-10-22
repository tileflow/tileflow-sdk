import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowVegetationMetadataKey} from '../src/trees-3d';
import {createTileflowTrees3D} from '../src/trees-3d-browser';
import {encodeTile} from './vector-tile-fixture';

// Exercise the public renderer with decoded vector tiles. Record each instanced draw at the
// WebGL boundary so a uniform leaking from hedges into the next tile (or pass) is observable.
test('tree height floors never resize hedges in color, outline or shadow passes', async (t) => {
  type Buffer = {bytes?: Uint8Array};
  type Vao = {size?: {buffer: Buffer; offset: number}};
  type Program = {sources: {source: string}[]; uniforms: string[]};
  const draws: {pass: string; height: number; width: number; minimum: number; size: number[]}[] =
    [];
  class GL {
    LINK_STATUS = 1;
    ACTIVE_UNIFORMS = 2;
    FRAMEBUFFER_COMPLETE = 3;
    drawingBufferWidth = 1000;
    drawingBufferHeight = 1000;
    buffer?: Buffer;
    vao?: Vao;
    program?: Program;
    minimum = NaN;
    size = [NaN, NaN];
    createBuffer() {
      return {};
    }
    createVertexArray() {
      return {};
    }
    createShader() {
      return {source: ''};
    }
    createProgram(): Program {
      return {sources: [], uniforms: []};
    }
    shaderSource(shader: {source: string}, source: string) {
      shader.source = source;
    }
    attachShader(program: Program, shader: {source: string}) {
      program.sources.push(shader);
    }
    linkProgram(program: Program) {
      program.uniforms = [
        ...new Set(
          program.sources.flatMap(({source}) =>
            [...source.matchAll(/uniform\s+\w+\s+(\w+)/gu)].map((match) => match[1]!),
          ),
        ),
      ];
    }
    getProgramParameter(program: Program, key: number) {
      return key === this.LINK_STATUS ? true : program.uniforms.length;
    }
    getActiveUniform(program: Program, index: number) {
      return {name: program.uniforms[index]};
    }
    getUniformLocation(_program: Program, name: string) {
      return name;
    }
    useProgram(program: Program) {
      this.program = program;
    }
    bindBuffer(_target: unknown, buffer: Buffer) {
      this.buffer = buffer;
    }
    bufferData(_target: unknown, bytes: Uint8Array) {
      this.buffer!.bytes = bytes;
    }
    bindVertexArray(vao: Vao) {
      this.vao = vao;
    }
    vertexAttribPointer(
      index: number,
      _size: number,
      _type: number,
      _normalized: boolean,
      _stride: number,
      offset: number,
    ) {
      if (index === 5) this.vao!.size = {buffer: this.buffer!, offset};
    }
    uniform1f(name: string, value: number) {
      if (name === 'u_minimum_height') this.minimum = value;
    }
    uniform2f(name: string, x: number, y: number) {
      if (name === 'u_size_scale') this.size = [x, y];
    }
    getParameter() {
      return 4096;
    }
    checkFramebufferStatus() {
      return this.FRAMEBUFFER_COMPLETE;
    }
    drawArraysInstanced(_mode: unknown, _first: number, _count: number, instances: number) {
      if (!instances) return;
      const {buffer, offset} = this.vao!.size!;
      const bytes = buffer.bytes!;
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
      const source = this.program!.sources[0]!.source;
      draws.push({
        pass: source.includes('u_edge_width')
          ? 'outline'
          : source.includes('gl_Position = u_light_matrix')
            ? 'shadow'
            : 'color',
        height: view.getUint16(0, true) / 10,
        width: view.getUint16(2, true) / 10,
        minimum: this.minimum,
        size: this.size,
      });
    }
  }
  const old = Object.getOwnPropertyDescriptor(globalThis, 'WebGL2RenderingContext');
  Object.defineProperty(globalThis, 'WebGL2RenderingContext', {configurable: true, value: GL});
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'WebGL2RenderingContext', old);
    else Reflect.deleteProperty(globalThis, 'WebGL2RenderingContext');
  });
  const gl = new Proxy(new GL(), {
    get(target, key, receiver) {
      if (key in target) return Reflect.get(target, key, receiver);
      return typeof key === 'string' && key === key.toUpperCase() ? 3 : () => ({});
    },
  });
  const bytes = encodeTile({
    tree: {
      extent: 4096,
      features: Array.from({length: 16}, (_, index) => ({
        type: 1 as const,
        properties: {height: 2, genus: 'Tilia'},
        parts: [[[500 + (index % 4) * 1000, 500 + Math.floor(index / 4) * 1000]]],
      })),
    },
    hedge: {
      extent: 4096,
      features: [
        {
          type: 2,
          properties: {subclass: 'hedge'},
          parts: [
            [
              [2000, 2000],
              [2100, 2000],
            ],
          ],
        },
      ],
    },
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  let layer: any;
  const map = {
    addLayer(value: any) {
      layer = value;
      value.onAdd(map, gl);
    },
    getBearing: () => 0,
    getCenter: () => ({lat: -0.005493164, lng: 0.005493164}),
    getPitch: () => 0,
    getLayer: () => layer,
    getSource: () => ({tiles: ['https://tree-sizing.invalid/{z}/{x}/{y}.pbf'], maxzoom: 15}),
    getStyle: () => ({
      layers: [],
      metadata: {
        [tileflowVegetationMetadataKey]: {
          version: 1,
          source: 'tileflow',
          layers: {tree: 'tree', hedge: 'hedge'},
          fields: {},
          colors: {bark: '#554433', broadleaf: ['#335533'], conifer: ['#224422']},
          minimumHeight: 8,
          edges: 1,
        },
      },
    }),
    getZoom: () => 16,
    isStyleLoaded: () => true,
    on() {},
    off() {},
    triggerRepaint() {},
    removeLayer() {
      layer.onRemove(map, gl);
      layer = undefined;
    },
  };
  const trees = createTileflowTrees3D({map, maxTiles: 2});
  t.after(() => trees.dispose());
  await trees.show({transition: {duration: 0}});
  for (let i = 0; trees.stats.tiles < 2 && i < 100; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(trees.stats.tiles, 2);
  const args = {
    shaderData: {variantName: 'mercator', vertexShaderPrelude: '', define: ''},
    getProjectionData: () => ({
      mainMatrix: [],
      tileMercatorCoords: [],
      clippingPlane: [],
      projectionTransition: 0,
      fallbackMatrix: [],
    }),
  };
  layer.render(gl, args);
  layer.prerender(gl);
  for (const pass of ['color', 'outline', 'shadow']) {
    const samples = draws.filter((draw) => draw.pass === pass);
    assert.ok(
      samples.filter((draw) => draw.height === 1.3).length >= 2,
      `${pass} draws both tiles' hedges`,
    );
    assert.ok(
      samples.filter((draw) => draw.height !== 1.3).length >= 2,
      `${pass} draws both tiles' trees`,
    );
    for (const draw of samples) {
      if (draw.height === 1.3) {
        assert.equal(draw.minimum, 0, `${pass}: hedge keeps its measured height`);
        assert.equal(draw.width, 1.5, `${pass}: hedge keeps its segment length`);
        assert.deepEqual(draw.size, [1, 1]);
      } else assert.equal(draw.minimum, 8, `${pass}: next tile's trees regain their height floor`);
    }
  }
});
