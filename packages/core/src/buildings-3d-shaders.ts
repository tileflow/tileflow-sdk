// Shaders of Tileflow's 3D buildings renderer (buildings-3d-browser.ts). Positions are in tile
// units and projected with MapLibre's custom-layer projection; the shadow pass works in metres from
// the scene's origin (x east, y north, z up).

/** Attribute names, in location order, with their layout in the 28-byte vertex. */
export const tileflowBuildingAttributes = [
  ['a_pos', 2, 'UNSIGNED_SHORT', false, 0],
  ['a_height', 2, 'UNSIGNED_SHORT', false, 4],
  ['a_normal', 2, 'BYTE', true, 8],
  ['a_flags', 2, 'UNSIGNED_BYTE', false, 10],
  ['a_along', 1, 'UNSIGNED_SHORT', false, 12],
  ['a_wave', 2, 'UNSIGNED_BYTE', true, 14],
  ['a_centre', 2, 'UNSIGNED_SHORT', false, 16],
  ['a_paint', 2, 'UNSIGNED_BYTE', false, 20],
  ['a_corners', 2, 'UNSIGNED_BYTE', false, 22],
  ['a_feature', 1, 'UNSIGNED_SHORT', false, 24],
] as const;

const attributes = `
in vec2 a_pos;
in vec2 a_height; // base and top, in decimetres
in vec2 a_normal; // the wall's outward normal in the tile (x east, y south); none on roofs
in vec2 a_flags; // raised to the top; part of a wall
in float a_along; // decimetres along the wall
in vec2 a_wave; // the building's jitter; seed
in vec2 a_centre; // the building's centre in the tile
in vec2 a_paint; // tone; reserved
in vec2 a_corners; // the wall's tight corners (bit 0 at its start, bit 1 at its end); its length in metres
in float a_feature; // the building's feature in the tile
`;

// How high a building stands for the renderer's height scale: buildings slide out of the ground in a
// short stagger, each settling at its height.
const growth = `
uniform float u_scale;
uniform vec2 u_offset; // this tile's corner from the scene's origin, in tile units
uniform float u_metres; // metres per tile unit

float progressOf() {
  return clamp(u_scale * 1.25 - a_wave.x * 0.25, 0.0, 1.0);
}

float elevationOf(float own, float top, float p) {
  float eased = p * p * (3.0 - 2.0 * p);
  return max(0.0, own - (1.0 - eased) * top);
}

vec3 localOf(vec2 position, float elevation) {
  return vec3((position + u_offset) * u_metres * vec2(1.0, -1.0), elevation);
}
`;

const shadowLookup = `
uniform highp sampler2DShadow u_shadow_map;
uniform vec2 u_shadow_texel;
uniform float u_shadow; // how dark shadows fall, 0 for none
uniform float u_depth_unit; // the depth of a metre

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
`;

export const tileflowBuildingDepthVertex = `#version 300 es
${attributes}
uniform mat4 u_light_matrix;
${growth}
void main() {
  float base = a_height.x * 0.1;
  float top = a_height.y * 0.1;
  float p = progressOf();
  if (p <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float elevation = elevationOf(a_flags.x > 0.5 ? top : base, top, p);
  gl_Position = u_light_matrix * vec4(localOf(a_pos, elevation), 1.0);
}`;

export const tileflowBuildingDepthFragment = `#version 300 es
precision highp float;
void main() {}`;

export const tileflowBuildingVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
uniform mat4 u_light_matrix;
uniform vec3 u_shadow_dir;
uniform float u_normal_offset;
uniform vec3 u_colour; // the theme's colour, without a palette
uniform float u_palette_on;
uniform highp sampler2D u_palette;
uniform vec2 u_palette_rows; // rows per theme; texels per row
uniform vec2 u_palette_themes; // the themes either side of the blend position
uniform float u_palette_mix;
${growth}
out vec3 v_colour;
out vec3 v_facade; // metres along the wall, metres up as built, the building's top
out vec3 v_building; // seed, tone, wall
out vec3 v_normal;
out vec3 v_shadow;
flat out vec3 v_wall; // where the wall starts along its ring, its tight corners, its length

vec3 paletteColour(float theme) {
  float row = theme * u_palette_rows.x + floor(a_feature / u_palette_rows.y);
  float column = mod(a_feature, u_palette_rows.y);
  return texelFetch(u_palette, ivec2(int(column), int(row)), 0).rgb;
}

void main() {
  float base = a_height.x * 0.1;
  float top = a_height.y * 0.1;
  float own = a_flags.x > 0.5 ? top : base;
  float p = progressOf();
  if (p <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float elevation = elevationOf(own, top, p);
  gl_Position = projectTileFor3D(a_pos, elevation);
  float wall = a_flags.y;
  vec3 normal = wall > 0.5 ? vec3(a_normal.x, -a_normal.y, 0.0) : vec3(0.0, 0.0, 1.0);
  float facing = clamp(dot(normal, u_shadow_dir), 0.0, 1.0);
  vec4 shadow = u_light_matrix *
    vec4(localOf(a_pos, elevation) + normal * u_normal_offset * mix(1.0, 0.5, facing), 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
  v_normal = normal;
  v_colour = u_palette_on > 0.5
    ? mix(paletteColour(u_palette_themes.x), paletteColour(u_palette_themes.y), u_palette_mix)
    : u_colour;
  v_facade = vec3(a_along * 0.1, own, top);
  v_building = vec3(a_wave.y, a_paint.x, wall);
  v_wall = vec3(a_along * 0.1, a_corners);
}`;

export const tileflowBuildingFragment = `#version 300 es
precision highp float;
in vec3 v_colour;
in vec3 v_facade;
in vec3 v_building;
in vec3 v_normal;
in vec3 v_shadow;
flat in vec3 v_wall;
uniform vec3 u_sun_dir;
uniform vec3 u_sun_light;
uniform vec3 u_sky_light;
uniform float u_occlusion;
uniform float u_corner;
uniform float u_night; // 0 by day, 1 at night
uniform float u_windows; // whether to draw night windows
uniform float u_flood; // flood light strength at night
uniform vec3 u_flood_colour;
${shadowLookup}
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// A surface's light over the light a sunlit roof takes, in the map's colours: a sunlit roof keeps
// its colour, a wall turned to a low sun glows, and shade takes the sky's colour.
vec3 shade(vec3 normal, float lit) {
  float facing = dot(normal, u_sun_dir);
  vec3 sky = u_sky_light * mix(0.8, 1.0, normal.z);
  vec3 light = sky + u_sun_light * max(facing, 0.0) * (1.0 - u_shadow * (1.0 - lit));
  vec3 roof = u_sky_light + u_sun_light * max(u_sun_dir.z, 0.0);
  return min(pow(light / max(roof, vec3(1e-4)), vec3(1.0 / 2.2)), vec3(1.7));
}

void main() {
  vec3 normal = normalize(v_normal);
  float lit = dot(normal, u_sun_dir) > 0.0 ? visibility(v_shadow, 0.3) : 0.0;
  vec3 colour = v_colour * shade(normal, lit);
  if (v_building.z > 0.5) {
    float up = v_facade.y;
    float top = v_facade.z;
    float seed = v_building.x;
    float foot = 1.0 - u_occlusion * pow(1.0 - clamp(up / 9.0, 0.0, 1.0), 2.0);
    float along = v_facade.x - v_wall.x;
    float corner = 0.0;
    if (mod(v_wall.y, 2.0) >= 1.0) corner = 1.0 - smoothstep(0.0, u_corner, along);
    if (v_wall.y >= 2.0) corner = max(corner, 1.0 - smoothstep(0.0, u_corner, v_wall.z - along));
    colour *= foot * (1.0 - u_occlusion * 0.7 * corner * mix(1.0, 0.5, clamp(up / 30.0, 0.0, 1.0)));
    if (top - up < 0.5) colour *= 1.12;
    if (u_windows > 0.5 && top > 5.5 && up > 3.2 && up < top - 1.0) {
      float tower = step(40.0, top);
      float column = mix(mix(4.6, 3.8, step(12.0, top)), 3.0, tower) + (seed - 0.5) * 0.8;
      vec2 grid = vec2(v_facade.x / column, up / 3.2);
      vec2 cell = floor(grid);
      vec2 f = fract(grid);
      vec2 size = mix(vec2(0.46, 0.5), vec2(0.62, 0.56), tower);
      vec2 edge = max(fwidth(grid) * 0.75, vec2(0.001));
      vec2 low = 0.5 - size * 0.5;
      vec2 high = 0.5 + size * 0.5;
      vec2 inside = smoothstep(low - edge, low + edge, f) * (1.0 - smoothstep(high - edge, high + edge, f));
      float pane = inside.x * inside.y;
      float run = 2.0 + floor(seed * 2.99);
      vec2 room = vec2(floor(cell.x / run), cell.y);
      float h = hash(room + seed * 61.7);
      float share = u_night * mix(0.42, 0.5, tower) * clamp(seed * 1.7 - 0.25, 0.0, 1.0);
      float floorShare = clamp(share * (0.15 + 1.7 * hash(vec2(cell.y, seed * 13.1))), 0.0, 1.0);
      // A room flares as it comes on, then settles.
      float since = floorShare - (1.0 - h);
      float on = step(0.0, since);
      float flare = 1.0 + 1.4 * (1.0 - smoothstep(0.0, 0.07, since));
      vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.87, 0.6), hash(room.yx + seed));
      float kind = hash(room + seed * 3.7);
      vec3 glow = (kind > 0.9 ? vec3(0.8, 0.9, 1.0) : warm) * mix(0.72, 1.0, hash(room.yx + seed * 7.3));
      // Unlit panes stay close to the wall at night; by day the glass catches the sky.
      vec3 unlit = mix(colour * 0.84, vec3(0.6, 0.72, 0.84), (1.0 - u_night) * 0.45);
      float area = size.x * size.y;
      vec3 detailed = mix(colour, mix(unlit, glow * flare, on), pane);
      // Farther away, single windows give way to a lit strip per room, still larger than a pixel,
      // then to the wall's average glow, so nothing shimmers.
      vec2 strip = vec2(grid.x / run, grid.y);
      vec2 stripCell = floor(strip);
      vec2 stripEdge = max(fwidth(strip) * 0.75, vec2(0.001));
      vec2 stripLow = vec2(0.08, 0.26);
      vec2 stripHigh = vec2(0.92, 0.82);
      vec2 stripInside = smoothstep(stripLow - stripEdge, stripLow + stripEdge, fract(strip)) *
        (1.0 - smoothstep(stripHigh - stripEdge, stripHigh + stripEdge, fract(strip)));
      float stripOn = step(0.0, floorShare - (1.0 - hash(stripCell + seed * 61.7)));
      vec3 strips = mix(colour, mix(unlit, glow * 0.95, stripOn), stripInside.x * stripInside.y * 0.85);
      vec3 wallGlow = mix(colour, unlit, area) * mix(1.0, 0.8, share) + vec3(1.0, 0.58, 0.22) * area * 1.3 * share;
      vec2 cells = 1.0 / max(fwidth(grid), vec2(0.0001));
      float useStrips = smoothstep(1.1, 1.8, cells.y);
      float useWindows = smoothstep(2.5, 6.0, cells.x) * smoothstep(3.4, 5.0, cells.y);
      colour = mix(mix(wallGlow, strips, useStrips), detailed, useWindows);
    }
    // Flood lights wash the foot of lit buildings at night: shops, busy places, landmarks, towers.
    float floodlit = step(0.3, seed) * max(step(0.5, v_building.y), step(25.0, top));
    colour += u_flood_colour * u_flood * floodlit * 0.42 * (1.0 - smoothstep(0.0, 6.0, up));
  }
  fragColor = vec4(colour, 1.0);
}`;

export const tileflowBuildingGroundVertex = (projected: string): string => `#version 300 es
${projected}
in vec2 a_pos;
uniform mat4 u_light_matrix;
uniform vec2 u_offset;
uniform float u_metres;
out vec3 v_shadow;
void main() {
  gl_Position = projectTileFor3D(a_pos, 0.0);
  vec4 shadow = u_light_matrix * vec4((a_pos + u_offset) * u_metres * vec2(1.0, -1.0), 0.0, 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
}`;

export const tileflowBuildingGroundFragment = `#version 300 es
precision highp float;
in vec3 v_shadow;
uniform vec3 u_ground_shadow;
${shadowLookup}
out vec4 fragColor;
void main() {
  float shaded = u_shadow * (1.0 - visibility(v_shadow, 0.15));
  fragColor = vec4(mix(vec3(1.0), u_ground_shadow, shaded), 1.0);
}`;

// The band at the foot of every wall: the wall's own quad laid on the ground, its top edge moved
// out by the band's reach. The same geometry carries the flood lights' light on the ground.
export const tileflowBuildingBandVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
uniform float u_band;
${growth}
out float v_out;
out float v_strength;
out float v_floodlit;
void main() {
  float base = a_height.x * 0.1;
  float top = a_height.y * 0.1;
  float p = progressOf();
  v_floodlit = step(0.3, a_wave.y) * max(step(0.5, a_paint.x), step(25.0, top));
  if (p <= 0.0 || base > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectTileFor3D(a_pos + a_normal * (u_band / u_metres) * a_flags.x, 0.0);
  v_out = a_flags.x;
  v_strength = p;
}`;

export const tileflowBuildingBandFragment = `#version 300 es
precision highp float;
in float v_out;
in float v_strength;
in float v_floodlit;
uniform float u_band_strength;
out vec4 fragColor;
void main() {
  float near = 1.0 - v_out;
  fragColor = vec4(vec3(1.0 - u_band_strength * near * near * v_strength), 1.0);
}`;

export const tileflowBuildingFloodFragment = `#version 300 es
precision highp float;
in float v_out;
in float v_strength;
in float v_floodlit;
uniform float u_flood;
uniform vec3 u_flood_colour;
out vec4 fragColor;
void main() {
  float near = 1.0 - v_out;
  fragColor = vec4(u_flood_colour * 0.55 * u_flood * near * near * v_strength * v_floodlit, 0.0);
}`;
