// Shaders of the building models a map places in its 3D city, drawn by Tileflow's 3D buildings
// renderer (buildings-3d-browser.ts) in the same light as its buildings. A model's vertices are in
// metres round its origin, quantised over its bounds; the renderer turns them by the placement's
// heading into the tile units of the tile the model stands in, and MapLibre's custom-layer
// projection draws them. The shadow pass works in metres from the scene's origin (x east, y north,
// z up), as the buildings' does.

/** Attribute names, in location order, with their layout in the 12-byte vertex. */
export const tileflowModelAttributes = [
  ['a_position', 3, 'SHORT', true, 0],
  ['a_normal', 3, 'BYTE', true, 6],
  ['a_paint', 3, 'UNSIGNED_BYTE', false, 9],
] as const;

const attributes = `
in vec3 a_position; // over the model's bounds, from -1 to 1
in vec3 a_normal;
in vec3 a_paint; // part; shade (0 to 255); light (0 to 255)
`;

// Where a vertex stands: metres round the model's origin, turned by its heading, in the tile units
// of the tile it stands in, and how high as the city grows out of the ground.
const placement = `
uniform vec3 u_bounds_min;
uniform vec3 u_bounds_max;
uniform vec2 u_heading; // cos and sin of the heading, clockwise from north
uniform vec2 u_anchor; // the model's origin in its tile, in tile units
uniform float u_model_metres; // metres per tile unit where the model stands
uniform float u_scale; // how far the city has grown, 0 to 1
uniform vec2 u_offset; // the model's tile's corner from the scene's origin, in tile units
uniform float u_metres; // metres per tile unit in the scene

vec3 metresOf() {
  return u_bounds_min + (a_position * 0.5 + 0.5) * (u_bounds_max - u_bounds_min);
}

vec3 turned(vec3 v) {
  return vec3(v.x * u_heading.x + v.y * u_heading.y, -v.x * u_heading.y + v.y * u_heading.x, v.z);
}

float grown(float z) {
  float p = clamp(u_scale, 0.0, 1.0);
  return z * p * p * (3.0 - 2.0 * p);
}

vec2 tileOf(vec3 m) {
  return u_anchor + vec2(m.x, -m.y) / u_model_metres;
}

vec3 sceneOf(vec2 tile, float z) {
  return vec3((tile + u_offset) * u_metres * vec2(1.0, -1.0), z);
}
`;

export const tileflowModelDepthVertex = `#version 300 es
${attributes}
uniform mat4 u_light_matrix;
${placement}
void main() {
  vec3 m = turned(metresOf());
  gl_Position = u_light_matrix * vec4(sceneOf(tileOf(m), grown(m.z)), 1.0);
}`;

export const tileflowModelDepthFragment = `#version 300 es
precision highp float;
void main() {}`;

export const tileflowModelVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
uniform mat4 u_light_matrix;
uniform vec3 u_shadow_dir;
uniform float u_normal_offset;
uniform vec3 u_part_colours[5];
${placement}
out vec3 v_colour;
out vec3 v_normal;
out vec3 v_shadow;
out float v_light;

void main() {
  vec3 m = turned(metresOf());
  vec2 tile = tileOf(m);
  float z = grown(m.z);
  gl_Position = projectTileFor3D(tile, z);
  vec3 normal = normalize(turned(a_normal) + vec3(0.0, 0.0, 1e-5));
  float facing = clamp(dot(normal, u_shadow_dir), 0.0, 1.0);
  vec4 shadow = u_light_matrix * vec4(sceneOf(tile, z) + normal * u_normal_offset * mix(1.0, 0.5, facing), 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
  v_normal = normal;
  int part = int(a_paint.x + 0.5);
  vec3 colour = u_part_colours[clamp(part, 0, 4)];
  // A material lighter or darker than mid-grey makes its part lighter or darker.
  v_colour = colour * (0.55 + 0.45 * (a_paint.y / 255.0) * 2.0);
  v_light = a_paint.z / 255.0;
}`;

export const tileflowModelFragment = `#version 300 es
precision highp float;
in vec3 v_colour;
in vec3 v_normal;
in vec3 v_shadow;
in float v_light;
uniform vec3 u_sun_dir;
uniform vec3 u_sun_light;
uniform vec3 u_sky_light;
uniform float u_night;
uniform highp sampler2DShadow u_shadow_map;
uniform vec2 u_shadow_texel;
uniform float u_shadow;
uniform float u_depth_unit;
out vec4 fragColor;

float visibility(vec3 c, float bias) {
  if (u_shadow <= 0.0 || c.x <= 0.0 || c.y <= 0.0 || c.x >= 1.0 || c.y >= 1.0 || c.z >= 1.0)
    return 1.0;
  float z = c.z - bias * u_depth_unit;
  vec2 o = u_shadow_texel * 0.75;
  return 0.25 * (
    texture(u_shadow_map, vec3(c.xy + vec2(-o.x, -o.y), z)) +
    texture(u_shadow_map, vec3(c.xy + vec2(o.x, -o.y), z)) +
    texture(u_shadow_map, vec3(c.xy + vec2(-o.x, o.y), z)) +
    texture(u_shadow_map, vec3(c.xy + vec2(o.x, o.y), z)));
}

// The buildings' light: a sunlit roof keeps its colour, a face turned to a low sun glows, and shade
// takes the sky's colour; a face that looks down sees little sky.
vec3 shade(vec3 normal, float lit) {
  float facing = dot(normal, u_sun_dir);
  vec3 sky = u_sky_light * mix(mix(0.8, 0.5, u_night), 1.0, max(normal.z, -0.4));
  vec3 light = sky + u_sun_light * max(facing, 0.0) * (1.0 - u_shadow * (1.0 - lit));
  vec3 roof = u_sky_light + u_sun_light * max(u_sun_dir.z, 0.0);
  return min(pow(light / max(roof, vec3(1e-4)), vec3(1.0 / 2.2)), vec3(1.7));
}

void main() {
  vec3 normal = normalize(gl_FrontFacing ? v_normal : -v_normal);
  float lit = dot(normal, u_sun_dir) > 0.0 ? visibility(v_shadow, 0.3) : 0.0;
  fragColor = vec4(v_colour * shade(normal, lit) * mix(0.55, 1.0, v_light), 1.0);
}`;
