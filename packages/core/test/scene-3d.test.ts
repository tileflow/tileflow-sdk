import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tileflowScene3D,
  type TileflowSceneCaster,
  tileflowSceneLight,
  tileflowSunLightMatrix,
} from '../src/scene-3d-browser';
import {resolveTileflowSun, tileflowDefaultSunPreset, tileflowSunDirection} from '../src/sun';

const apply = (matrix: Float32Array, point: readonly number[]) =>
  [0, 1, 2].map(
    (row) =>
      matrix[row]! * point[0]! +
      matrix[4 + row]! * point[1]! +
      matrix[8 + row]! * point[2]! +
      matrix[12 + row]!,
  );
const near = (a: number, b: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

test('default daylight keeps cast shadows subtle and retains independent strength control', () => {
  const sun = resolveTileflowSun(tileflowDefaultSunPreset);
  const light = tileflowSceneLight(sun);
  for (const channel of light.groundShadow)
    assert.ok(channel > 0.9 && channel < 0.93, `daylight shadow multiplier ${channel}`);
  assert.equal(light.strength, 1);
  assert.equal(tileflowSceneLight(sun, false).strength, 0);
  const custom = tileflowSceneLight(
    resolveTileflowSun({...tileflowDefaultSunPreset, shadowIntensity: 0.35}),
  );
  assert.equal(custom.strength, 0.35);
});

test('a shadow endpoint beyond the caster tiles remains inside the light depth range', () => {
  const light = tileflowSunLightMatrix(tileflowSunDirection(90, 15), {
    min: [0, -1000, 0],
    max: [1000, 0, 100],
  });
  const roof = apply(light.matrix, [0, -500, 100]);
  const ground = apply(light.matrix, [-100 / Math.tan(Math.PI / 12), -500, 0]);
  near(roof[0]!, ground[0]!);
  near(roof[1]!, ground[1]!);
  assert.ok(ground[2]! > roof[2]!);
  assert.ok(
    ground.every((value) => Math.abs(value) < 1),
    'the full shadow reaches its ground',
  );
});

test('a focused receiver keeps an offscreen caster on the same light ray', () => {
  const light = tileflowSunLightMatrix(
    tileflowSunDirection(90, 45),
    {min: [-1000, -1000, 0], max: [1000, 1000, 100]},
    {
      receivers: [
        [-10, -10, 0],
        [10, -10, 0],
        [10, 10, 0],
        [-10, 10, 0],
      ],
      resolution: 4096,
    },
  );
  const receiver = apply(light.matrix, [0, 0, 0]);
  const caster = apply(light.matrix, [100, 0, 100]);
  near(receiver[0]!, caster[0]!);
  near(receiver[1]!, caster[1]!);
  assert.ok(caster[2]! < receiver[2]!);
  assert.ok(caster.every((value) => Math.abs(value) < 1));
  assert.ok(light.extent < 30, 'offscreen caster coverage does not dilute receiver resolution');
});

test('focused shadow projections stay still within a texel and advance by whole texels', () => {
  const direction = tileflowSunDirection(0, 60);
  const box = {min: [-1000, -1000, 0], max: [1000, 1000, 100]};
  const view = (offset: number) => ({
    receivers: [
      [-20 + offset, -20, 0],
      [20 + offset, -20, 0],
      [20 + offset, 20, 0],
      [-20 + offset, 20, 0],
    ],
    resolution: 4096,
  });
  const a = tileflowSunLightMatrix(direction, box, view(0));
  const b = tileflowSunLightMatrix(direction, box, view(0.001));
  assert.deepEqual(a.matrix, b.matrix);
  const c = tileflowSunLightMatrix(direction, box, view(0.1));
  const shift = ((c.matrix[12]! - a.matrix[12]!) * 4096) / 2;
  assert.ok(Math.abs(shift) > 1);
  near(shift, Math.round(shift), 1e-4);
});

test('latitude scale changes do not move fixed-world shadows by fractional texels', () => {
  const latitude = 40.4;
  const circumference = 40_075_016.686;
  const metresAt = (lat: number) => circumference * Math.cos((lat * Math.PI) / 180);
  const baseline = metresAt(latitude);
  const direction = tileflowSunDirection(210, 40);
  const sample = (lat: number) => {
    const gridScale = metresAt(lat);
    const ratio = gridScale / baseline;
    const pan = ((lat - latitude) * Math.PI * circumference) / 360;
    const view = {
      receivers: [-200, 200].flatMap((x) =>
        [-200, 200].flatMap((y) => [0, 100].map((z) => [x * ratio, y * ratio + pan, z])),
      ),
      resolution: 4096,
      origin: [0.4897 * gridScale, -0.377 * gridScale, 0],
      gridScale,
    };
    const light = tileflowSunLightMatrix(
      direction,
      {min: [-1000 * ratio, -1000 * ratio, 0], max: [1000 * ratio, 1000 * ratio, 100]},
      view,
    );
    return [0, 35].map((height) => apply(light.matrix, [10 * ratio, 20 * ratio, height]));
  };
  const before = sample(latitude);
  const after = sample(latitude + 1e-7); // About 1.1 cm north, with the real new metre scale.
  for (const [index, point] of before.entries()) {
    for (const axis of [0, 1]) {
      const shift = ((after[index]![axis]! - point[axis]!) * 4096) / 2;
      near(shift, Math.round(shift), 0.001);
    }
  }
});

test('shadow direction has a 15 degree floor without changing the actual light or strength', () => {
  const sun = resolveTileflowSun({
    azimuth: 245,
    altitude: 10,
    color: '#D6A077',
    intensity: 0.15,
    shadowIntensity: 0.85,
    ambient: {color: '#93A4BC', intensity: 0.4},
  });
  const light = tileflowSceneLight(sun);
  near(light.direction[2]!, Math.sin(Math.PI / 18));
  near(light.shadowDirection[2]!, Math.sin(Math.PI / 12));
  assert.equal(
    light.strength,
    0.85,
    'a weak sun does not silently reduce authored shadow intensity',
  );
  for (const channel of [0, 1, 2]) {
    const ambient = sun.ambient.rgb[channel]! ** 2.2 * 0.4;
    const direct = sun.rgb[channel]! ** 2.2 * 0.15 * Math.sin(Math.PI / 18);
    near(light.groundShadow[channel]!, (ambient / (ambient + direct)) ** (1 / 2.2));
  }
  assert.equal(tileflowSceneLight(sun, false).strength, 0);
});

function fakeContext() {
  let allocations = 0;
  const uniforms = new Map<unknown, number>();
  const context = new Proxy(
    {
      getParameter: () => 4096,
      createTexture: () => {
        allocations++;
        return {};
      },
      createFramebuffer: () => ({}),
      checkFramebufferStatus: () => 1,
      uniform1f: (name: unknown, value: number) => uniforms.set(name, value),
      drawingBufferWidth: 1000,
      drawingBufferHeight: 800,
    },
    {
      get(target, key) {
        if (key in target) return Reflect.get(target, key);
        return typeof key === 'string' && key === key.toUpperCase() ? 1 : () => {};
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return {context, uniforms, allocations: () => allocations};
}

test('the scene focuses through public camera methods and retains every caster', () => {
  const world = 512 * 2 ** 19;
  const map = {
    getCanvas: () => ({clientWidth: 1000, clientHeight: 800}),
    getCenter: () => ({lng: 0, lat: 0}),
    getBearing: () => 0,
    getPitch: () => 0,
    getZoom: () => 19,
    getVerticalFieldOfView: () => 36.87,
    getProjection: (): {type: string} | undefined => undefined,
    getTerrain: (): object | undefined => undefined,
    project: () => ({x: 500, y: 400}),
    unproject: ([x, y]: [number, number]) => ({
      lng: ((x - 500) / world) * 360,
      lat: (Math.atan(Math.sinh(-((y - 400) / world) * 2 * Math.PI)) * 180) / Math.PI,
    }),
  };
  const scene = tileflowScene3D(map);
  let drawn = 0;
  const caster: TileflowSceneCaster = {
    bounds: () => ({zoom: 15, tiles: [16383, 16383, 16385, 16385], tallest: 100}),
    key: () => 'same buildings',
    drawDepth: () => {
      drawn++;
    },
    groundOrder: 0,
  };
  scene.register(caster);
  const gpu = fakeContext();
  const light = tileflowSceneLight(
    resolveTileflowSun({
      azimuth: 210,
      altitude: 60,
      color: '#FFF',
      intensity: 0.2,
      shadowIntensity: 1,
      ambient: {color: '#FFF', intensity: 0.5},
    }),
  );
  const metres = 40_075_016.686 / 2 ** 15 / 8192;
  scene.prepare(gpu.context, light, metres);
  assert.equal(drawn, 1);
  assert.ok(scene.frame()!.light.extent < 250, 'visible receivers get the atlas resolution');
  scene.prepare(gpu.context, light, metres);
  assert.equal(drawn, 1, 'an unchanged view reuses its depth pass');
  map.getProjection = () => ({type: 'globe'});
  scene.prepare(gpu.context, light, metres);
  assert.equal(drawn, 1, 'a declared globe with planar corner rays retains the focused fit');
  scene.bindShadow(gpu.context, {u_normal_offset: 'normal' as unknown as WebGLUniformLocation}, 1);
  assert.ok(gpu.uniforms.get('normal')! >= 0.02 && gpu.uniforms.get('normal')! <= 0.15);
  assert.ok(!gpu.uniforms.has(undefined), 'optimized-out uniforms are passed as null');
  map.getTerrain = () => ({});
  scene.prepare(gpu.context, light, metres);
  assert.ok(scene.frame()!.light.extent > 3000, 'terrain is unsafe even at zero centre elevation');
  map.getTerrain = () => undefined;
  // Missing/horizon camera capabilities keep the conservative full-scene projection.
  map.getPitch = () => 80;
  scene.prepare(gpu.context, light, metres);
  assert.ok(scene.frame()!.light.extent > 3000);
  assert.equal(drawn, 2);
  // Reconstruct independent downward rays for a tilted, asymmetrically padded camera.
  const pitch = Math.PI / 3;
  const distance = 400 / Math.tan((36.87 * Math.PI) / 360);
  map.getPitch = () => 60;
  map.project = () => ({x: 590, y: 350});
  map.unproject = ([x, y]) => {
    const rayY = Math.sin(pitch) + ((350 - y) / distance) * Math.cos(pitch);
    const rayZ = -Math.cos(pitch) + ((350 - y) / distance) * Math.sin(pitch);
    const along = (-distance * Math.cos(pitch)) / rayZ;
    const groundX = ((x - 590) / distance) * along;
    const groundY = -distance * Math.sin(pitch) + rayY * along;
    return {
      lng: (groundX / world) * 360,
      lat: (Math.atan(Math.sinh((groundY / world) * 2 * Math.PI)) * 180) / Math.PI,
    };
  };
  scene.prepare(gpu.context, light, metres);
  assert.ok(
    scene.frame()!.light.extent < 700,
    'raised receivers and map padding keep a focused fit',
  );
  assert.equal(drawn, 3);
});

test('a scene with no direct sunlight allocates no shadow texture', () => {
  const gpu = fakeContext();
  const light = tileflowSceneLight(
    resolveTileflowSun({
      azimuth: 0,
      altitude: -12,
      color: '#FFF',
      intensity: 0.2,
      shadowIntensity: 1,
      ambient: {color: '#FFF', intensity: 0.12},
    }),
  );
  tileflowScene3D({}).prepare(gpu.context, light, 1);
  assert.equal(light.strength, 0);
  assert.equal(gpu.allocations(), 0);
});
