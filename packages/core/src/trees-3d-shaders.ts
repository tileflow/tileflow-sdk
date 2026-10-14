// Shaders of Tileflow's 3D trees (trees-3d-browser.ts). A unit tree mesh is stretched to each tree's
// height and crown, turned, and stood on its point in the tile, projected with MapLibre's
// custom-layer projection. Light follows the 3D buildings' model: a crown facing a sunlit sky takes
// its theme colour, shade takes the sky's, and the shared shadow map darkens what lies in shadow.

/** Attribute names, in location order: the mesh's per vertex, then the trees' per instance. */
export const tileflowTreeAttributes = [
  'a_vertex',
  'a_normal',
  'a_part',
  'a_look',
  'a_tree_pos',
  'a_tree_size',
  'a_tree_turn',
  'a_tree_seed',
] as const;

const attributes = `
in vec3 a_vertex; // the unit tree: x east, y north, z up, from 0 to 1
in vec3 a_normal;
in float a_part; // 0 bark, 1 leaves, 2 fronds, 3 a palm's stem
in vec2 a_look; // the lobe's shade, from 0 to 1 for -1 to 1; occlusion baked into the mesh
in vec2 a_tree_pos; // the tree's point in the tile, in tile units
in vec2 a_tree_size; // height and crown, in decimetres
in vec2 a_tree_turn; // turn, shade among the theme's colours
in vec2 a_tree_seed; // seed; whether it stands for a canopy point
`;

// Where a vertex of a tree stands, in metres from the tree's foot, as its height scale grows it.
const placement = `
uniform float u_scale;
uniform float u_metres; // metres per tile unit
uniform vec2 u_offset; // this tile's corner from the scene's origin, in tile units
uniform vec2 u_size_scale; // the map's height and crown scales

float growthOf() {
  float p = clamp(u_scale * 1.25 - a_tree_seed.x * 0.25, 0.0, 1.0);
  return p * p * (3.0 - 2.0 * p);
}

vec2 turned(vec2 v) {
  float angle = a_tree_turn.x * 6.2831853;
  float c = cos(angle);
  float s = sin(angle);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

vec3 standing(float growth) {
  float height = a_tree_size.x * 0.1 * u_size_scale.x;
  float crown = a_tree_size.y * 0.1 * u_size_scale.y;
  return vec3(turned(a_vertex.xy * crown), a_vertex.z * height) * growth;
}

vec3 normalOf() {
  float height = max(a_tree_size.x * 0.1 * u_size_scale.x, 0.1);
  float crown = max(a_tree_size.y * 0.1 * u_size_scale.y, 0.1);
  vec3 n = normalize(vec3(a_normal.xy / crown, a_normal.z / height));
  return vec3(turned(n.xy), n.z);
}

vec3 sceneOf(vec3 local) {
  return vec3((a_tree_pos + u_offset) * u_metres * vec2(1.0, -1.0), 0.0) + local;
}
`;

export const tileflowTreeDepthVertex = `#version 300 es
${attributes}
uniform mat4 u_light_matrix;
${placement}
void main() {
  float growth = growthOf();
  if (growth <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = u_light_matrix * vec4(sceneOf(standing(growth)), 1.0);
}`;

export const tileflowTreeDepthFragment = `#version 300 es
precision highp float;
void main() {}`;

export const tileflowTreeVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
uniform mat4 u_light_matrix;
uniform vec3 u_shadow_dir;
uniform float u_normal_offset;
uniform vec2 u_centre; // the map's centre from this tile's corner, in tile units
uniform vec2 u_reach; // where trees start to fade out and are gone, in metres from the centre
${placement}
out vec3 v_normal;
out vec3 v_shadow;
out vec3 v_look; // part, lobe shade, occlusion
out float v_shade; // the tree's shade among the theme's colours
out float v_fade;
void main() {
  float growth = growthOf();
  if (growth <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 local = standing(growth);
  gl_Position = projectTileFor3D(a_tree_pos + local.xy / u_metres * vec2(1.0, -1.0), local.z);
  vec3 normal = normalOf();
  float facing = clamp(dot(normal, u_shadow_dir), 0.0, 1.0);
  vec4 shadow = u_light_matrix *
    vec4(sceneOf(local) + normal * u_normal_offset * mix(1.0, 0.5, facing), 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
  v_normal = normal;
  v_look = vec3(a_part, a_look.x * 2.0 - 1.0, a_look.y);
  v_shade = a_tree_turn.y;
  float distance = length((a_tree_pos - u_centre) * u_metres);
  v_fade = 1.0 - smoothstep(u_reach.x, u_reach.y, distance);
}`;

export const tileflowTreeFragment = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_shadow;
in vec3 v_look;
in float v_shade;
in float v_fade;
uniform vec3 u_sun_dir;
uniform vec3 u_sun_light;
uniform vec3 u_sky_light;
uniform float u_night;
uniform float u_fade; // how far the layer has faded in, from 0 to 1
uniform vec3 u_bark;
uniform vec3 u_leaves[4]; // the form's colours, sunlit
uniform float u_leaf_count;
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

// An ordered dither, so a fading tree thins out instead of turning see-through.
float dither(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int index = i.x + i.y * 4;
  float table[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (table[index] + 0.5) / 16.0;
}

vec3 leafColour() {
  float count = max(u_leaf_count, 1.0);
  float at = v_shade * (count - 1.0);
  int low = int(floor(at));
  int high = min(low + 1, int(count) - 1);
  vec3 a = u_leaves[0];
  vec3 b = u_leaves[0];
  for (int index = 0; index < 4; index += 1) {
    if (index == low) a = u_leaves[index];
    if (index == high) b = u_leaves[index];
  }
  return mix(a, b, fract(at));
}

void main() {
  if (v_fade * u_fade < dither(gl_FragCoord.xy)) discard;
  vec3 normal = normalize(v_normal);
  float part = v_look.x;
  bool stem = part > 2.5;
  bool bark = part < 0.5 || stem;
  bool fronds = part > 1.5 && !stem;
  // A palm's stem is paler than bark, ringed light and dark by its leaf scars.
  vec3 base = stem
    ? min(u_bark * 1.45 + 0.06, vec3(1.0)) * (1.0 + v_look.y * 0.12)
    : bark ? u_bark : leafColour() * (1.0 + v_look.y * 0.09);
  float facing = dot(normal, u_sun_dir);
  // Leaves let light round and through them: wrapped light on the lit side, a glow against a low sun.
  float direct = bark ? max(facing, 0.0) : fronds ? abs(facing) * 0.85 : max((facing + 0.35) / 1.35, 0.0);
  float through = bark ? 0.0 : max(-facing, 0.0) * 0.22 * (1.0 - clamp(u_sun_dir.z * 2.0, 0.0, 1.0));
  float lit = visibility(v_shadow, 0.4);
  vec3 sky = u_sky_light * mix(mix(0.75, 0.5, u_night), 1.0, max(normal.z, 0.0) * 0.6 + 0.4);
  vec3 light = (sky + u_sun_light * (direct + through) * (1.0 - u_shadow * (1.0 - lit))) *
    mix(1.0, v_look.z, 0.75);
  vec3 roof = u_sky_light + u_sun_light * max(u_sun_dir.z, 0.0);
  vec3 colour = base * min(pow(light / max(roof, vec3(1e-4)), vec3(1.0 / 2.2)), vec3(1.5));
  // At night the tops of crowns keep near their theme's colour, as a night theme draws them, so
  // trees stay apart from the dark ground.
  float crownTop = bark ? 0.0 : smoothstep(0.1, 0.9, normal.z);
  colour = mix(colour, base * 0.95 + vec3(0.02, 0.03, 0.04), u_night * 0.45 * crownTop);
  fragColor = vec4(colour, 1.0);
}`;
