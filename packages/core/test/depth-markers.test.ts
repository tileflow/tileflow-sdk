import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTileflowDepthMarkers,
  tileflowDepthMarkerPlacement,
} from '../src/depth-markers-browser';

test('a marker is placed in its zoom 16 tile, with metres in tile units', () => {
  const {tile, position, unitsPerMetre} = tileflowDepthMarkerPlacement([-80.1301, 25.7933]);
  assert.equal(tile.z, 16);
  assert.ok(position.every((value) => value >= 0 && value < 8192));
  // A zoom 16 tile is about 551 m across at Miami Beach's latitude.
  assert.ok(Math.abs(8192 / unitsPerMetre - 551) < 2);
  // The tile and position give back the longitude.
  const lng = ((tile.x + position[0] / 8192) / 2 ** 16) * 360 - 180;
  assert.ok(Math.abs(lng + 80.1301) < 1e-9);
});

type Listener = () => void;

/** A MapLibre-shaped map that runs a custom layer's hooks with a recording WebGL context. */
class MarkerMap {
  readonly layers = new Map<string, {layer: Record<string, unknown>; before?: string}>();
  readonly order: string[] = ['buildings', 'labels'];
  repaints = 0;
  private readonly listeners = new Set<Listener>();
  constructor(readonly gl: FakeGl) {}
  addLayer(layer: Record<string, unknown>, before?: string) {
    this.layers.set(layer.id as string, {layer, before});
    (layer.onAdd as (map: unknown, gl: unknown) => void)?.(this, this.gl);
  }
  getLayer(id: string) {
    return this.layers.get(id) ?? (this.order.includes(id) ? {} : undefined);
  }
  removeLayer(id: string) {
    const entry = this.layers.get(id);
    this.layers.delete(id);
    (entry?.layer.onRemove as (map: unknown, gl: unknown) => void)?.(this, this.gl);
  }
  getCanvas() {
    return {width: 1600, height: 1000} as HTMLCanvasElement;
  }
  getPixelRatio() {
    return 2;
  }
  triggerRepaint() {
    this.repaints += 1;
  }
  on(_event: 'styledata', listener: Listener) {
    this.listeners.add(listener);
  }
  off(_event: 'styledata', listener: Listener) {
    this.listeners.delete(listener);
  }
  restyle() {
    // A new style drops the runtime layers, as MapLibre's setStyle does.
    for (const id of [...this.layers.keys()]) this.removeLayer(id);
    for (const listener of [...this.listeners]) listener();
  }
  render(id = 'tileflow-depth-markers') {
    const layer = this.layers.get(id)?.layer;
    (layer?.render as (gl: unknown, input: unknown) => void)?.(this.gl, {
      shaderData: {variantName: 'mercator', vertexShaderPrelude: '', define: ''},
      getProjectionData: ({tileID}: {tileID: {canonical: {x: number; y: number}}}) => {
        this.gl.projected.push(tileID.canonical);
        return {
          mainMatrix: new Float32Array(16),
          tileMercatorCoords: [0, 0, 1, 1],
          clippingPlane: [0, 0, 0, 0],
          projectionTransition: 0,
          fallbackMatrix: new Float32Array(16),
        };
      },
    });
  }
  get listening() {
    return this.listeners.size;
  }
}

class WebGl2Base {}
(globalThis as {WebGL2RenderingContext?: unknown}).WebGL2RenderingContext ??= WebGl2Base;

/** Records the draws and the uniforms set before each one. */
class FakeGl
  extends (globalThis as unknown as {WebGL2RenderingContext: new () => object})
    .WebGL2RenderingContext
{
  readonly draws: {uniforms: Record<string, unknown>; depthTest: boolean; texture: unknown}[] = [];
  readonly projected: unknown[] = [];
  readonly uploads: unknown[] = [];
  readonly deleted: string[] = [];
  private uniforms: Record<string, unknown> = {};
  private depthTest = true;
  private texture: unknown;
  private textures = 0;
  linkOk = true;
  readonly VERTEX_SHADER = 1;
  readonly FRAGMENT_SHADER = 2;
  readonly ARRAY_BUFFER = 3;
  readonly STATIC_DRAW = 4;
  readonly FLOAT = 5;
  readonly LINK_STATUS = 6;
  readonly TEXTURE0 = 7;
  readonly TEXTURE_2D = 8;
  readonly RGBA = 9;
  readonly UNSIGNED_BYTE = 10;
  readonly DEPTH_TEST = 11;
  readonly TRIANGLE_STRIP = 12;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 13;
  readonly UNPACK_FLIP_Y_WEBGL = 14;
  readonly TEXTURE_MIN_FILTER = 15;
  readonly TEXTURE_MAG_FILTER = 16;
  readonly LINEAR = 17;
  readonly TEXTURE_WRAP_S = 18;
  readonly TEXTURE_WRAP_T = 19;
  readonly CLAMP_TO_EDGE = 20;
  createBuffer() {
    return {};
  }
  bindBuffer() {}
  bufferData() {}
  createVertexArray() {
    return {};
  }
  bindVertexArray() {}
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  createShader() {
    return {};
  }
  shaderSource() {}
  compileShader() {}
  createProgram() {
    return {};
  }
  attachShader() {}
  bindAttribLocation() {}
  linkProgram() {}
  deleteShader() {}
  getProgramParameter() {
    return this.linkOk;
  }
  getUniformLocation(_program: unknown, name: string) {
    return name;
  }
  useProgram() {}
  activeTexture() {}
  uniform1i(name: string, value: number) {
    this.uniforms[name] = value;
  }
  uniform1f(name: string, value: number) {
    this.uniforms[name] = value;
  }
  uniform2f(name: string, x: number, y: number) {
    this.uniforms[name] = [x, y];
  }
  uniform4fv(name: string, value: unknown) {
    this.uniforms[name] = value;
  }
  uniformMatrix4fv(name: string, _transpose: boolean, value: unknown) {
    this.uniforms[name] = value;
  }
  depthMask() {}
  enable(cap: number) {
    if (cap === this.DEPTH_TEST) this.depthTest = true;
  }
  disable(cap: number) {
    if (cap === this.DEPTH_TEST) this.depthTest = false;
  }
  createTexture() {
    return {texture: ++this.textures};
  }
  bindTexture(_target: number, texture: unknown) {
    this.texture = texture;
  }
  pixelStorei() {}
  texImage2D(...args: unknown[]) {
    this.uploads.push(args.at(-1));
  }
  texParameteri() {}
  drawArrays() {
    this.draws.push({
      uniforms: {...this.uniforms},
      depthTest: this.depthTest,
      texture: this.texture,
    });
  }
  deleteTexture() {
    this.deleted.push('texture');
  }
  deleteProgram() {
    this.deleted.push('program');
  }
  deleteVertexArray() {
    this.deleted.push('vao');
  }
  deleteBuffer() {
    this.deleted.push('buffer');
  }
}

const pin = {name: 'pin'} as unknown as TexImageSource;
const ring = {name: 'ring'} as unknown as TexImageSource;

test('markers add one custom 3D layer, draw each marker and upload each image once', () => {
  const gl = new FakeGl();
  const map = new MarkerMap(gl);
  const markers = createTileflowDepthMarkers(map, {beforeId: 'labels'});
  assert.equal(map.layers.size, 0, 'no layer until there is a marker');

  markers.add({lngLat: [-80.1301, 25.7933], image: pin, size: [28, 40], anchor: 'bottom'});
  const ground = markers.add({
    lngLat: [-80.1301, 25.7933],
    image: ring,
    size: [60, 60],
    alignment: 'ground',
    rotation: 90,
    occlude: false,
  });
  const entry = map.layers.get('tileflow-depth-markers');
  assert.equal(entry?.before, 'labels');
  assert.equal(entry?.layer.type, 'custom');
  assert.equal(entry?.layer.renderingMode, '3d');

  map.render();
  assert.equal(gl.draws.length, 2);
  const [screen, flat] = gl.draws;
  assert.deepEqual(screen!.uniforms.u_size, [28, 40]);
  assert.deepEqual(screen!.uniforms.u_origin, [0.5, 1]);
  assert.equal(screen!.uniforms.u_ground, 0);
  // CSS pixels to clip units over an 800 × 500 CSS pixel canvas.
  assert.deepEqual(screen!.uniforms.u_pixel, [2 / 800, 2 / 500]);
  assert.equal(screen!.depthTest, true);
  assert.equal(flat!.uniforms.u_ground, 1);
  // A ground marker's size is in metres, drawn in tile units.
  const {unitsPerMetre} = tileflowDepthMarkerPlacement([-80.1301, 25.7933]);
  assert.ok(Math.abs((flat!.uniforms.u_size as number[])[0]! - 60 * unitsPerMetre) < 1e-6);
  assert.equal(flat!.uniforms.u_rotation, Math.PI / 2);
  assert.equal(flat!.depthTest, false);
  assert.deepEqual(gl.uploads, [pin, ring]);

  // Drawing again uploads nothing; passing the image again uploads it again.
  map.render();
  assert.equal(gl.uploads.length, 2);
  ground.update({image: ring, opacity: 0.5});
  map.render();
  assert.deepEqual(gl.uploads, [pin, ring, ring]);
  assert.equal(gl.draws.at(-1)!.uniforms.u_opacity, 0.5);

  // Markers sharing an image upload it once, even after it was passed again to one of them.
  markers.add({lngLat: [-80.13, 25.79], image: ring, size: [10, 10]});
  map.render();
  map.render();
  assert.deepEqual(gl.uploads, [pin, ring, ring]);

  // A transparent marker is not drawn.
  ground.update({opacity: 0});
  const before = gl.draws.length;
  map.render();
  assert.equal(gl.draws.length - before, 2);
});

test('the layer comes back after a style change, and dispose releases it', () => {
  const gl = new FakeGl();
  const map = new MarkerMap(gl);
  const markers = createTileflowDepthMarkers(map, {beforeId: () => 'buildings'});
  const handle = markers.add({lngLat: [2.17, 41.38], image: pin, size: [20, 20]});
  map.render();
  map.restyle();
  assert.ok(gl.deleted.includes('program'));
  assert.equal(map.layers.get('tileflow-depth-markers')?.before, 'buildings');
  map.render();
  assert.equal(gl.draws.length, 2);

  handle.remove();
  map.render();
  assert.equal(gl.draws.length, 2);
  markers.dispose();
  assert.equal(map.layers.size, 0);
  assert.equal(map.listening, 0);
  assert.throws(() => markers.add({lngLat: [0, 0], image: pin, size: [1, 1]}), /disposed/u);
});

test('invalid markers are refused', () => {
  const markers = createTileflowDepthMarkers(new MarkerMap(new FakeGl()));
  const base = {lngLat: [0, 0] as const, image: pin, size: [10, 10] as const};
  assert.throws(() => markers.add({...base, lngLat: [0, Number.NaN]}), /lngLat/u);
  assert.throws(() => markers.add({...base, size: [0, 10]}), /positive size/u);
  assert.throws(() => markers.add({...base, opacity: 2}), /opacity/u);
  assert.throws(
    () => markers.add({...base, alignment: 'sky' as unknown as 'ground'}),
    /screen or ground/u,
  );
  assert.throws(
    () => markers.add({...base, offset: [1] as unknown as [number, number]}),
    /offset/u,
  );
  const handle = markers.add(base);
  assert.throws(() => handle.update({rotation: Number.POSITIVE_INFINITY}), /rotation/u);
});
