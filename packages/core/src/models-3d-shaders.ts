import {modelMaterialSampling, modelPhysicalLighting} from './models-3d-material-shaders';
import {tileflowModelPartCount} from './models-3d-model';
import {tileflowHazeFragment, tileflowHazeVertex, tileflowShadowLookup} from './scene-3d-shaders';

// Shaders of the building models a map places in its 3D city, drawn by Tileflow's 3D buildings
// renderer (buildings-3d-browser.ts) in the same light as its buildings. A model's vertices are whole
// steps from its level's centre in glTF's axes (x east, y up, z south), as its file holds them
// (models-3d-file.ts); the renderer turns them by the placement's heading into the tile units of the
// tile the model stands in, and MapLibre's custom-layer projection draws them. The shadow pass works in metres from the scene's origin (x east, y north,
// z up), as the buildings' does.

/** Attribute names, in location order, with their layout in the 16-byte vertex. */
export const tileflowModelAttributes = [
  ['a_position', 3, 'SHORT', false, 0],
  ['a_normal', 3, 'BYTE', true, 8],
  ['a_paint', 3, 'UNSIGNED_BYTE', false, 12],
  ['a_lighting_role', 1, 'UNSIGNED_BYTE', false, 15],
] as const;

/** Optional 32-byte surface stream, following the legacy vertex attributes. */
export const tileflowModelSurfaceAttributes = [
  ['a_uv', 4, 'FLOAT', false, 0],
  ['a_rgba', 4, 'FLOAT', false, 16],
] as const;

const attributes = `
in vec3 a_position; // whole steps from the level's centre, in glTF's axes
in vec3 a_normal; // in glTF's axes
in vec3 a_paint; // part; shade (0 to 255); light (0 to 255)
in float a_lighting_role;
in vec4 a_uv;
in vec4 a_rgba;
`;

// Where a vertex stands: metres round the model's origin, turned by its heading, in the tile units
// of the tile it stands in, and how high as the city grows out of the ground.
const placement = `
uniform vec3 u_level_centre; // in glTF's axes, in metres
uniform float u_level_step; // metres in one step
uniform vec2 u_heading; // cos and sin of the heading, clockwise from north
uniform vec2 u_anchor; // the model's origin in its tile, in tile units
uniform float u_model_metres; // metres per tile unit where the model stands
uniform float u_scale; // how far the city has grown, 0 to 1
uniform vec2 u_offset; // the model's tile's corner from the scene's origin, in tile units
uniform float u_metres; // metres per tile unit in the scene

// glTF's x east, y up and z south become x east, y north and z up.
vec3 upright(vec3 g) {
  return vec3(g.x, -g.z, g.y);
}

vec3 metresOf() {
  return upright(u_level_centre + a_position * u_level_step);
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
out vec4 v_uv;
out vec4 v_rgba;
void main() {
  vec3 m = turned(metresOf());
  gl_Position = u_light_matrix * vec4(sceneOf(tileOf(m), grown(m.z)), 1.0);
  v_uv = a_uv;
  v_rgba = a_rgba;
}`;

export const tileflowModelDepthFragment = `#version 300 es
precision highp float;
${modelMaterialSampling}
void main() {
  float alpha = materialAlpha();
  // Blended surfaces cast an alpha-tested solar shadow, avoiding solid panes.
  if (u_alpha_mode == 2 && alpha < 0.5) discard;
}`;

export const tileflowModelVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
uniform mat4 u_light_matrix;
uniform vec3 u_shadow_dir;
uniform float u_normal_offset;
uniform vec3 u_part_colours[${tileflowModelPartCount}];
uniform vec2 u_model_height;
${placement}
out vec3 v_colour;
out vec3 v_normal;
out vec3 v_shadow;
out float v_light;
flat out int v_lighting_role;
out float v_height;
out vec4 v_uv;
out vec4 v_rgba;
out vec3 v_position;
flat out int v_part;
${tileflowHazeVertex}

void main() {
  vec3 m = turned(metresOf());
  vec2 tile = tileOf(m);
  float z = grown(m.z);
  gl_Position = projectTileFor3D(tile, z);
  v_haze_depth = gl_Position.w;
  vec3 normal = normalize(turned(upright(a_normal)) + vec3(0.0, 0.0, 1e-5));
  float facing = clamp(dot(normal, u_shadow_dir), 0.0, 1.0);
  vec4 shadow = u_light_matrix * vec4(sceneOf(tile, z) + normal * u_normal_offset * mix(1.0, 0.5, facing), 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
  v_normal = normal;
  int part = int(a_paint.x + 0.5);
  v_part = clamp(part, 0, ${tileflowModelPartCount - 1});
  v_uv = a_uv;
  v_rgba = a_rgba;
  v_position = vec3(m.xy, z);
  vec3 colour = u_part_colours[clamp(part, 0, ${tileflowModelPartCount - 1})];
  // A material lighter or darker than mid-grey makes its part lighter or darker.
  v_colour = colour * (0.55 + 0.45 * (a_paint.y / 255.0) * 2.0);
  v_light = a_paint.z / 255.0;
  v_lighting_role = clamp(int(a_lighting_role + 0.5), 0, 6);
  v_height = (m.z - u_model_height.x) / max(u_model_height.y, 0.001);
}`;

export const tileflowModelFragment = `#version 300 es
precision highp float;
in vec3 v_colour;
in vec3 v_normal;
in vec3 v_shadow;
in float v_light;
flat in int v_lighting_role;
in float v_height;
uniform vec3 u_sun_dir;
uniform vec3 u_sun_light;
uniform vec3 u_sky_light;
uniform float u_night;
uniform float u_ambient_occlusion;
uniform float u_role_emission[7];
uniform vec4 u_role_emission_colour[7];
uniform vec4 u_role_emission_gradient[7];
uniform float u_role_emission_power[7];
uniform float u_opacity;
out vec4 fragColor;
${tileflowShadowLookup}
${tileflowHazeFragment}
${modelMaterialSampling}
${modelPhysicalLighting}

// The buildings' light: a sunlit roof keeps its colour, a face turned to a low sun glows, and shade
// takes the sky's colour; a face that looks down sees little sky.
vec3 shade(vec3 normal, float lit) {
  float facing = dot(normal, u_sun_dir);
  vec3 sky = u_sky_light * mix(mix(0.8, 0.5, u_night), 1.0, max(normal.z, -0.4));
  sky *= mix(1.0, v_light, u_ambient_occlusion);
  vec3 light = sky + u_sun_light * max(facing, 0.0) * (1.0 - u_shadow * (1.0 - lit));
  vec3 roof = u_sky_light + u_sun_light * max(u_sun_dir.z, 0.0);
  return min(pow(light / max(roof, vec3(1e-4)), vec3(1.0 / 2.2)), vec3(1.7));
}

void main() {
  vec3 normal = normalize(gl_FrontFacing ? v_normal : -v_normal);
  if (u_physical) normal = materialNormal(normal);
  float lit = dot(normal, u_sun_dir) > 0.0 ? visibility(v_shadow, 0.3) : 0.0;
  int role = clamp(v_lighting_role, 0, 6);
  vec4 gradient = u_role_emission_gradient[role];
  float multiplier = 1.0;
  if (gradient.x != gradient.y) {
    float height = clamp((v_height - gradient.x) / (gradient.y - gradient.x), 0.0, 1.0);
    multiplier = mix(gradient.z, gradient.w, pow(height, pow(10.0, u_role_emission_power[role])));
  }
  float emission = clamp(u_role_emission[role] * multiplier, 0.0, 1.0);
  if (u_physical) {
    float alpha = materialAlpha();
    vec3 base = materialBase(role);
    vec3 radiance = physicalLight(base, normal, lit, role);
    radiance += u_emissive * fromSRGB(materialTexture(4).rgb);
    vec4 own = u_role_emission_colour[role];
    radiance = mix(radiance, mix(base, fromSRGB(own.rgb), own.a), emission);
    fragColor = vec4(hazed(toSRGB(radiance)), alpha * u_opacity);
    return;
  }
  vec3 colour = v_colour * shade(normal, lit);
  if (emission > 0.0) {
    vec4 own = u_role_emission_colour[role];
    vec3 target = mix(v_colour, own.rgb, own.a);
    colour = pow(mix(pow(max(colour, vec3(0.0)), vec3(2.2)),
      pow(max(target, vec3(0.0)), vec3(2.2)), emission), vec3(1.0 / 2.2));
  }
  fragColor = vec4(hazed(colour), 1.0);
}`;
