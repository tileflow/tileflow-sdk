import type {TileflowModelEmitter} from './models-3d-materials';
import {tileflowHazeFragment, tileflowHazeVertex} from './scene-3d-shaders';

/** A bounded doorway spill: floor wedge and two sides, authored in model metres. */
export function modelEmitterGeometry(emitter: TileflowModelEmitter) {
  const [a, b] = [emitter.start, emitter.end];
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tangent = [(b[0] - a[0]) / width, (b[1] - a[1]) / width];
  const normal = [tangent[1]!, -tangent[0]!];
  const reach = Math.min(10, Math.max(4, emitter.height * 1.3));
  const depth = emitter.depth ?? 0;
  const spread = depth > 0 ? Math.min(0.29, (width * 0.1) / depth) : 0.29;
  const half = Math.max(0.005, width / 2 - depth * (spread + 0.01));
  const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2]];
  const point = (along: number, out: number, up: number) => [
    centre[0]! + tangent[0]! * along + normal[0]! * out,
    centre[1]! + tangent[1]! * along + normal[1]! * out,
    centre[2]! + up,
  ];
  const left = point(-half, 0, 0.1),
    right = point(half, 0, 0.1);
  const farLeft = point(-half - spread * reach, reach, 0);
  const farRight = point(half + spread * reach, reach, 0);
  const positions = new Float32Array([
    ...left,
    ...right,
    ...farLeft,
    ...farRight,
    ...point(-half, 0, emitter.height),
    ...point(half, 0, emitter.height),
    ...left,
    ...right,
    ...farLeft,
    ...farRight,
  ]);
  const h = half / reach;
  const coordinates = new Float32Array([
    -h,
    0,
    h,
    1.3,
    h,
    0,
    h,
    1.3,
    -h - spread,
    1,
    h,
    0.8,
    h + spread,
    1,
    h,
    0.8,
    h + spread,
    0.8,
    h,
    0.7,
    h + spread,
    0.8,
    h,
    0.7,
    0,
    0,
    h,
    1.3,
    0,
    0,
    h,
    1.3,
    h + spread,
    1.2,
    h,
    0.8,
    h + spread,
    1.2,
    h,
    0.8,
  ]);
  return {positions, coordinates, reach};
}

export const modelEmitterVertex = (projected: string) => `#version 300 es
${projected}
uniform vec3 u_emitter_positions[10];
uniform vec4 u_emitter_coordinates[10];
uniform vec2 u_heading;
uniform vec2 u_anchor;
uniform float u_model_metres;
uniform float u_scale;
out vec4 v_light_coordinates;
${tileflowHazeVertex}
void main() {
  const int indices[12] = int[12](0, 1, 2, 2, 1, 3, 4, 6, 8, 5, 9, 7);
  int index = indices[gl_VertexID];
  vec3 position = u_emitter_positions[index];
  vec2 turned = vec2(position.x * u_heading.x + position.y * u_heading.y,
    -position.x * u_heading.y + position.y * u_heading.x);
  float growth = clamp(u_scale, 0.0, 1.0);
  gl_Position = projectTileFor3D(u_anchor + turned * vec2(1.0, -1.0) / u_model_metres,
    position.z * growth * growth * (3.0 - 2.0 * growth));
  v_haze_depth = gl_Position.w;
  v_light_coordinates = u_emitter_coordinates[index];
}`;

export const modelEmitterFragment = `#version 300 es
precision highp float;
in vec4 v_light_coordinates;
uniform vec3 u_emitter_colour;
uniform float u_emitter_strength;
uniform float u_opacity;
${tileflowHazeFragment}
out vec4 fragColor;
void main() {
  if (u_emitter_strength <= 0.0) discard;
  vec4 light = v_light_coordinates;
  float across = max(0.0, abs(light.x) - light.z) * 1.3;
  float distance = length(vec2(across, light.y)) +
    0.5 * (1.0 - clamp(u_emitter_strength - 1.0, 0.0, 1.0));
  float alpha = clamp((1.0 - distance * distance) * light.w, 0.0, 1.0);
  fragColor = vec4(hazed(u_emitter_colour), alpha * min(1.0, u_emitter_strength) * u_opacity);
}`;
