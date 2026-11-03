import {tileflowHazeFragment, tileflowHazeVertex, tileflowShadowLookup} from './scene-3d-shaders';

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
  ['a_edge', 2, 'UNSIGNED_BYTE', false, 26],
] as const;

const attributes = `
in vec2 a_pos;
in vec2 a_height; // base and top, in decimetres
in vec2 a_normal; // the wall's outward normal in the tile (x east, y south); on a roof, its tilt
in vec2 a_flags; // raised to the top; part of a wall
in float a_along; // decimetres along the wall
in vec2 a_wave; // the building's jitter; seed
in vec2 a_centre; // the building's centre in the tile
in vec2 a_paint; // tone plus four times the class group (none, housing, work, no windows); night use (none, dining, entertainment, nightlife)
in vec2 a_corners; // the wall's tight corners (bit 0 at its start, bit 1 at its end) and courtyard (bit 2); its length in metres
in float a_feature; // the building's feature in the tile
in vec2 a_edge; // a roof triangle's corner and its sides on the outline; a wall's end and its ends on the tile's edge
`;

// How high a building stands for the renderer's height scale: buildings slide out of the ground in a
// short stagger, each settling at its height.
const growth = `
uniform float u_scale;
uniform vec2 u_offset; // this tile's corner from the scene's origin, in tile units
uniform float u_metres; // metres per tile unit
// In this tile's units: origin and start/end of the fade along the view, or centre and radii of the
// fallback covered disc. The direction is along the ground in this tile's axes.
uniform vec4 u_ring;
uniform vec2 u_ring_ahead;
uniform bool u_ring_directional;

float progressOf() {
  return clamp(u_scale * 1.25 - a_wave.x * 0.25, 0.0, 1.0);
}

float elevationOf(float own, float top, float p) {
  float eased = p * p * (3.0 - 2.0 * p);
  return max(0.0, own - (1.0 - eased) * top);
}

// Buildings sink into the ground over the last stretch of the city's reach, so it ends without an
// edge of cut-off blocks. The view-aligned fade leaves the entire near width standing; the legacy
// disc fallback also exempts its near side.
float reachOf(vec2 position) {
  if (u_ring_directional)
    return 1.0 - smoothstep(u_ring.z, u_ring.w, dot(position - u_ring.xy, u_ring_ahead));
  if (u_ring.w <= 0.0) return 1.0;
  vec2 from = position - u_ring.xy;
  float far = smoothstep(0.0, u_ring.w - u_ring.z, dot(from, u_ring_ahead));
  return 1.0 - smoothstep(u_ring.z, u_ring.w, length(from)) * far;
}

vec3 localOf(vec2 position, float elevation) {
  return vec3((position + u_offset) * u_metres * vec2(1.0, -1.0), elevation);
}
`;

// The light a building gives the street at night, kept quiet: landmarks and towers of 40 m or more,
// one in two, are flood-lit at their foot in the layer's flood colour, and the places busy at night
// light their ground floor's windows: bars and clubs in a neon of their own or a warm light,
// theatres and cinemas in a marquee white, places to eat in amber.
const nightLight = `
uniform vec3 u_flood_colour;

// The tone packed with the class group four values apart; the group alone.
float toneOf(float paint) {
  return mod(paint + 0.5, 4.0) - 0.5;
}

float groupOf(float paint) {
  return floor((paint + 0.5) / 4.0);
}

vec3 floodOf(float paint, float top, float seed) {
  return u_flood_colour * step(0.5, seed) * max(step(2.5, toneOf(paint)), step(40.0, top));
}

vec3 shopOf(float use, float seed) {
  if (use > 2.5) {
    float pick = fract(seed * 7.31);
    vec3 neon = pick < 0.34 ? vec3(1.0, 0.3, 0.64) : pick < 0.67 ? vec3(0.64, 0.4, 1.0) : vec3(0.3, 0.85, 1.0);
    return fract(seed * 3.7) < 0.5 ? neon * 0.9 : vec3(1.0, 0.72, 0.44) * 0.85;
  }
  if (use > 1.5) return vec3(1.0, 0.88, 0.66);
  if (use > 0.5) return vec3(1.0, 0.68, 0.38) * 0.75;
  return vec3(0.0);
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
  float elevation = elevationOf(a_flags.x > 0.5 ? top : base, top, p) * reachOf(a_pos);
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
uniform float u_variation; // how far buildings' brightness strays from their colour, either way
uniform vec3 u_surface_tile; // repeating projected-metre phase and metres per tile unit
${growth}
out vec2 v_surface;
out vec3 v_colour;
out float v_base;
out vec3 v_facade; // metres along the wall, metres up as built, the building's top
out vec4 v_building; // seed, tone and class group, wall, night use
out vec3 v_normal;
out vec3 v_shadow;
flat out vec3 v_wall; // where the wall starts along its ring, its tight corners, its length
out vec3 v_edge; // a roof triangle's corner weights; on a wall, from 0 at its start to 1 at its end
flat out float v_outline; // a roof triangle's sides on the outline; a wall's ends on the tile's edge
${tileflowHazeVertex}

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
  float elevation = elevationOf(own, top, p) * reachOf(a_pos);
  gl_Position = projectTileFor3D(a_pos, elevation);
  v_haze_depth = gl_Position.w;
  float wall = a_flags.y;
  // A wall faces out level; a roof faces up, tilted by its slope.
  vec3 normal = wall > 0.5 ? vec3(a_normal.x, -a_normal.y, 0.0)
    : vec3(a_normal.x, -a_normal.y, sqrt(max(0.0, 1.0 - dot(a_normal, a_normal))));
  float facing = clamp(dot(normal, u_shadow_dir), 0.0, 1.0);
  vec4 shadow = u_light_matrix *
    vec4(localOf(a_pos, elevation) + normal * u_normal_offset * mix(1.0, 0.5, facing), 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
  v_normal = normal;
  v_colour = u_palette_on > 0.5
    ? mix(paletteColour(u_palette_themes.x), paletteColour(u_palette_themes.y), u_palette_mix)
    : u_colour;
  // Neighbours of one colour stay apart: each building a little lighter or darker than its colour.
  v_colour *= 1.0 + (a_wave.x - 0.5) * 2.0 * u_variation;
  v_base = base;
  v_surface = a_pos * u_surface_tile.z + u_surface_tile.xy;
  v_edge = wall > 0.5 ? vec3(a_edge.x, 0.0, 0.0) : vec3(equal(vec3(a_edge.x), vec3(0.0, 1.0, 2.0)));
  v_outline = a_edge.y;
  v_facade = vec3(a_along * 0.1, own, top);
  v_building = vec4(a_wave.y, a_paint.x, wall, a_paint.y);
  v_wall = vec3(a_along * 0.1, a_corners);
}`;

export const tileflowBuildingFragment = `#version 300 es
precision highp float;
in vec3 v_colour;
in float v_base;
in vec2 v_surface;
uniform vec4 u_surface_walls; // width, course height, joint width, contrast
uniform vec3 u_surface_roof; // square size, joint width, contrast
uniform vec2 u_surface_cornice; // band height, contrast
uniform vec3 u_style_light_position;
uniform vec3 u_style_light_colour;
uniform float u_style_light_intensity;
uniform float u_style_gradient;
uniform float u_edge_radius;
uniform float u_sun_lighting;
in vec3 v_facade;
in vec4 v_building;
in vec3 v_normal;
in vec3 v_shadow;
flat in vec3 v_wall;
in vec3 v_edge;
flat in float v_outline;
uniform vec3 u_sun_dir;
uniform vec3 u_sun_light;
uniform vec3 u_sky_light;
uniform float u_occlusion;
uniform float u_occlusion_radius;
uniform float u_corner;
uniform float u_night; // 0 by day, 1 at night
uniform float u_windows; // whether to draw night windows
uniform float u_flood; // flood light strength at night
uniform float u_architectural_intensity;
uniform vec3 u_architectural_colour;
uniform vec2 u_architectural_wall; // minimum height, wall radius / building height
uniform float u_edge; // how strongly roof outlines and outer corners catch the light, 0 for none
uniform float u_edge_width; // their width, in the drawing buffer's pixels
uniform vec3 u_edge_colour; // the application's colour for them
uniform float u_edge_own; // how much of them takes the application's colour, from 0 to 1
${nightLight}
${tileflowShadowLookup}
${tileflowHazeFragment}
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// The contact shade rises gradually up the facade, in world metres. Use one bounded shade
// for the authored gradient, ground contact and inner corners, rather than multiplying them.
float facadeShade() {
  if (v_building.z < 0.5) return 1.0;
  float reach = min(3.0, max((v_facade.z - v_base) * 0.5, 0.1));
  float gradient = 0.1 * u_style_gradient * (1.0 - smoothstep(0.0, reach, v_facade.y - v_base));
  // Exponential attenuation leaves a soft tail above the first floor, without a band ending
  // at its radius. Height above ground also keeps raised parts from acquiring a dark lower rim.
  float up = max(v_facade.y, 0.0);
  float contact = u_occlusion * exp(-up / max(u_occlusion_radius, 0.001));
  float along = v_facade.x - v_wall.x;
  float corner = 0.0;
  if (mod(v_wall.y, 2.0) >= 1.0) corner = 1.0 - smoothstep(0.0, u_corner, along);
  if (mod(floor(v_wall.y / 2.0), 2.0) >= 1.0)
    corner = max(corner, 1.0 - smoothstep(0.0, u_corner, v_wall.z - along));
  float inner = u_occlusion * 0.7 * corner * mix(1.0, 0.5, clamp(up / 30.0, 0.0, 1.0));
  return 1.0 - max(gradient, max(contact, inner));
}

// MapLibre GL JS 6.13 fill-extrusion light, evaluated per fragment for curved corner normals.
// Copyright MapLibre contributors and Mapbox; BSD-3-Clause, see THIRD_PARTY_NOTICES.md.
vec3 styleColour(vec3 colour, vec3 normal) {
  float luminance = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  float facing = clamp(dot(normal * vec3(1.0, -1.0, 1.0), u_style_light_position), 0.0, 1.0);
  float brightness = mix(1.0 - u_style_light_intensity,
    max(1.0 - luminance + u_style_light_intensity, 1.0), facing);
  if (v_building.z > 0.5) {
    float wallLight = clamp((1.0 + v_base) * sqrt(v_facade.z / 150.0),
      mix(0.7, 0.98, 1.0 - u_style_light_intensity), 1.0);
    brightness *= mix(1.0, mix(wallLight, 1.0, normal.z), u_style_gradient);
  }
  return clamp((colour + 0.03) * brightness * u_style_light_colour,
    0.3 * (1.0 - u_style_light_colour), vec3(1.0));
}

// A surface's light over the light a sunlit roof takes, in the map's colours: a sunlit roof keeps
// its colour, a wall turned to a low sun glows, and shade takes the sky's colour. A wall sees half
// the sky; by day the ground's light makes up some of the rest, at night little does.
vec3 shade(vec3 normal, float lit) {
  float facing = dot(normal, u_sun_dir);
  vec3 sky = u_sky_light * mix(mix(0.8, 0.5, u_night), 1.0, normal.z);
  vec3 light = sky + u_sun_light * max(facing, 0.0) * (1.0 - u_shadow * (1.0 - lit));
  vec3 roof = u_sky_light + u_sun_light * max(u_sun_dir.z, 0.0);
  return min(pow(light / max(roof, vec3(1e-4)), vec3(1.0 / 2.2)), vec3(1.7));
}

// How near the fragment lies to its roof's outline, or to an outer corner of its wall, from 1 on the
// line to 0 a line's width away: a constant width on screen at any distance. Inner corners, the
// tile's edge and the diagonals inside a roof draw none.
float edgeOf() {
  int sides = int(v_outline + 0.5);
  float near = 1e4;
  if (v_building.z > 0.5) {
    int corners = int(v_wall.y + 0.5);
    float pixel = max(fwidth(v_edge.x), 1e-6);
    if ((corners & 1) == 0 && (sides & 1) == 0) near = min(near, v_edge.x / pixel);
    if ((corners & 2) == 0 && (sides & 2) == 0) near = min(near, (1.0 - v_edge.x) / pixel);
  } else {
    vec3 across = v_edge / max(fwidth(v_edge), vec3(1e-6));
    if ((sides & 1) != 0) near = min(near, across.x);
    if ((sides & 2) != 0) near = min(near, across.y);
    if ((sides & 4) != 0) near = min(near, across.z);
  }
  return 1.0 - smoothstep(u_edge_width - 0.75, u_edge_width + 0.25, near);
}

// A filtered joint between large, softly shaded blocks. Derivatives are taken before the
// stagger/periodic wrap, so row boundaries do not create false level-of-detail transitions.
float surfaceBlocks(vec2 position, vec2 size, float joint, float contrast, float stagger) {
  vec2 footprint = max(fwidth(position), vec2(0.0001));
  float visible = smoothstep(2.0, 7.0, min(size.x / footprint.x, size.y / footprint.y));
  vec2 uv = position / size;
  uv.x += mod(floor(uv.y), 2.0) * stagger;
  vec2 cell = fract(uv) * size;
  vec2 distance = min(cell, size - cell);
  vec2 aa = footprint * 0.65;
  vec2 seam = 1.0 - smoothstep(vec2(joint * 0.5) - aa, vec2(joint * 0.5) + aa, distance);
  float groove = max(seam.x, seam.y);
  // A quiet bevel on the upper and left edges makes the painted blocks catch light.
  vec2 bevel = (1.0 - smoothstep(vec2(joint), vec2(joint + 0.35) + aa, cell)) * (1.0 - seam);
  return 1.0 + contrast * visible * (max(bevel.x, bevel.y) * 0.3 - groove * 0.65);
}

// Distance to the actual roof outline in the roof's projected-metre plane. The triangle's
// barycentric gradient ignores internal triangulation and tile cuts, including around patios.
float roofOutlineDistance() {
  vec2 dx = dFdx(v_surface), dy = dFdy(v_surface);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  if (abs(determinant) < 1e-10) return 1e6;
  vec3 bx = dFdx(v_edge), by = dFdy(v_edge);
  vec3 gx = (bx * dy.y - by * dx.y) / determinant;
  vec3 gy = (by * dx.x - bx * dy.x) / determinant;
  vec3 distance = v_edge / max(sqrt(gx * gx + gy * gy), vec3(1e-7));
  int sides = int(v_outline + 0.5);
  float nearest = 1e6;
  if ((sides & 1) != 0) nearest = min(nearest, distance.x);
  if ((sides & 2) != 0) nearest = min(nearest, distance.y);
  if ((sides & 4) != 0) nearest = min(nearest, distance.z);
  return nearest;
}

vec3 surfaceColour() {
  vec3 colour = v_colour;
  bool wall = v_building.z > 0.5;
  float pattern = 1.0;
  if (wall && u_surface_walls.w > 0.0)
    pattern = surfaceBlocks(v_facade.xy, u_surface_walls.xy, u_surface_walls.z, u_surface_walls.w, 0.5);
  if (!wall && u_surface_roof.z > 0.0)
    pattern = surfaceBlocks(v_surface, vec2(u_surface_roof.x), u_surface_roof.y, u_surface_roof.z, 0.0);
  float band = 0.0, seam = 0.0;
  if (u_surface_cornice.y > 0.0) {
    float distance = wall ? v_facade.z - v_facade.y : roofOutlineDistance();
    float width = wall ? min(u_surface_cornice.x, (v_facade.z - v_base) * 0.2) : u_surface_cornice.x;
    float pixel = max(fwidth(distance), 0.001);
    float visible = smoothstep(0.4, 1.5, width / pixel);
    band = (1.0 - smoothstep(width - pixel * 0.5, width + pixel * 0.5, distance)) * visible;
    seam = (1.0 - smoothstep(0.0, pixel + width * 0.15, abs(distance - width))) * visible;
  }
  colour *= mix(pattern, 1.0, band) * (1.0 - seam * u_surface_cornice.y * 0.25);
  return mix(colour, mix(colour, vec3(1.0), u_surface_cornice.y * 0.45), band);
}

void main() {
  vec3 normal = normalize(v_normal);
  // A narrow lighting transition softens the roof/wall junction without moving the roof
  // or adding a bright outline. Exterior vertical corners are rounded in the mesh itself.
  if (v_building.z > 0.5 && u_edge_radius > 0.0) {
    float radius = min(u_edge_radius, max((v_facade.z - v_base) * 0.25, 0.01));
    float rim = 1.0 - smoothstep(0.0, radius, v_facade.z - v_facade.y);
    normal = normalize(mix(normal, vec3(0.0, 0.0, 1.0), rim));
  }
  float lit = dot(normal, u_sun_dir) > 0.0 ? visibility(v_shadow, 0.3) : 0.0;
  vec3 surface = surfaceColour();
  vec3 colour = mix(styleColour(surface, normal) * (1.0 - u_shadow * (1.0 - lit)),
    surface * shade(normal, lit), u_sun_lighting);
  colour *= facadeShade();
  // Roof outlines and outer corners catch the light, so where one building ends and the next starts
  // stays legible, at night most of all.
  float edge = u_edge > 0.0 ? edgeOf() * u_edge : 0.0;
  vec3 caught = max(colour, v_colour) * 1.2 + vec3(0.9, 0.95, 1.0) * mix(0.05, 0.13, u_night);
  colour = mix(colour, mix(caught, u_edge_colour, u_edge_own), edge);
  if (v_building.z > 0.5) {
    float up = v_facade.y;
    float top = v_facade.z;
    float seed = v_building.x;
    // Sheds, barns, factories and churches have no rows of windows; homes light more of theirs at
    // night than offices, in a warm light, and offices more of theirs in a cool one.
    float group = groupOf(v_building.y);
    if (u_windows > 0.5 && group < 2.5 && top > 5.5 && up > 3.2 && up < top - 1.0) {
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
      float share = u_night * mix(0.42, 0.5, tower) * clamp(seed * 1.7 - 0.25, 0.0, 1.0) *
        (group > 1.5 ? 0.55 : group > 0.5 ? 1.3 : 1.0);
      float floorShare = clamp(share * (0.15 + 1.7 * hash(vec2(cell.y, seed * 13.1))), 0.0, 1.0);
      // A room flares as it comes on, then settles.
      float since = floorShare - (1.0 - h);
      float on = step(0.0, since);
      float flare = 1.0 + 1.4 * (1.0 - smoothstep(0.0, 0.07, since));
      vec3 warm = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.87, 0.6), hash(room.yx + seed));
      float kind = hash(room + seed * 3.7);
      float cool = group > 1.5 ? 0.45 : group > 0.5 ? 1.0 : 0.9;
      vec3 glow = (kind > cool ? vec3(0.8, 0.9, 1.0) : warm) * mix(0.72, 1.0, hash(room.yx + seed * 7.3));
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
    // Flood lights wash the foot of lit buildings at night.
    colour += floodOf(v_building.y, top, seed) * u_flood * 0.3 * (1.0 - smoothstep(0.0, 6.0, up));
    if (top > u_architectural_wall.x && u_architectural_intensity > 0.0) {
      float radius = top * u_architectural_wall.y;
      float share = u_architectural_intensity * max(0.0, 1.0 - up / max(radius, 0.001));
      colour = mix(colour, u_architectural_colour, share);
    }
    // The places busy at night light their ground floor's windows: panes of about 3.6 m, which far
    // away give way to their average so nothing shimmers.
    if (v_building.w > 0.5 && v_wall.z > 3.0 && v_wall.y < 4.0 && u_flood > 0.0) {
      float pane = v_facade.x / 3.6;
      float wide = max(fwidth(pane), 1e-3);
      float across = clamp(min(fract(pane) - 0.1, 0.9 - fract(pane)) / wide + 0.5, 0.0, 1.0);
      across = mix(across, 0.8, smoothstep(0.3, 0.6, wide));
      float tall = max(fwidth(up), 1e-3);
      float rows = clamp(min(up - 0.6, 3.2 - up) / tall + 0.5, 0.0, 1.0);
      colour = mix(colour, shopOf(v_building.w, seed) * u_flood + colour * 0.15, across * rows * 0.6 * min(u_flood, 1.0));
    }
  }
  fragColor = vec4(hazed(colour), 1.0);
}`;

export const tileflowBuildingGroundVertex = (projected: string): string => `#version 300 es
${projected}
in vec2 a_pos;
uniform mat4 u_light_matrix;
uniform vec2 u_offset;
uniform float u_metres;
out vec3 v_shadow;
${tileflowHazeVertex}
void main() {
  gl_Position = projectTileFor3D(a_pos, 0.0);
  v_haze_depth = gl_Position.w;
  vec4 shadow = u_light_matrix * vec4((a_pos + u_offset) * u_metres * vec2(1.0, -1.0), 0.0, 1.0);
  v_shadow = shadow.xyz * 0.5 + 0.5;
}`;

export const tileflowBuildingGroundFragment = `#version 300 es
precision highp float;
in vec3 v_shadow;
uniform vec3 u_ground_shadow;
${tileflowShadowLookup}
${tileflowHazeFragment}
out vec4 fragColor;
void main() {
  // Far shadows fade into the haze the flat map has already taken.
  float shaded = u_shadow * (1.0 - visibility(v_shadow, 0.15)) * (1.0 - hazeOf());
  fragColor = vec4(mix(vec3(1.0), u_ground_shadow, shaded), 1.0);
}`;

// Flood lights spill from each wall onto the ground, with the top edge moved out by their reach.
// Contact occlusion uses a separate distance mask so wall bands cannot accumulate at corners.
export const tileflowBuildingBandVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
uniform float u_band;
${growth}
${nightLight}
out float v_out;
out float v_strength;
out vec3 v_flood;
out vec3 v_shop;
${tileflowHazeVertex}
void main() {
  float base = a_height.x * 0.1;
  float top = a_height.y * 0.1;
  float p = progressOf();
  v_flood = floodOf(a_paint.x, top, a_wave.y);
  // Shop windows spill a warm light, tinted by their own, a few metres onto the pavement.
  v_shop = mix(vec3(1.0, 0.76, 0.5), shopOf(a_paint.y, a_wave.y), 0.35) * step(0.5, a_paint.y) *
    step(a_corners.x, 3.5);
  if (p <= 0.0 || base > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = projectTileFor3D(a_pos + a_normal * (u_band / u_metres) * a_flags.x, 0.0);
  v_haze_depth = gl_Position.w;
  v_out = a_flags.x;
  v_strength = p;
}`;

export const tileflowBuildingFloodFragment = `#version 300 es
precision highp float;
in float v_out;
in float v_strength;
in vec3 v_flood;
in vec3 v_shop;
uniform float u_flood;
${tileflowHazeFragment}
out vec4 fragColor;
void main() {
  float near = 1.0 - v_out;
  float close = near * near * near * near * near * near;
  fragColor = vec4((v_flood * 0.35 * near * near + v_shop * 0.12 * close) * u_flood * v_strength *
    (1.0 - hazeOf()), 0.0);
}`;

export const buildingArchitecturalFloodVertex = (projected: string): string => `#version 300 es
${projected}
${attributes}
${growth}
uniform vec2 u_radius;
uniform float u_min_height;
out float v_out;
void main() {
  if (a_height.y * 0.1 < u_min_height || a_height.x > 5.0 || progressOf() <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float radius = mix(u_radius.x, u_radius.y, a_wave.x);
  gl_Position = projectTileFor3D(a_pos + a_normal * (radius / u_metres) * a_flags.x, 0.0);
  v_out = a_flags.x;
}`;

// Store remaining light transmission in the shared MIN mask; overlapping walls never accumulate.
export const buildingArchitecturalFloodFragment = `#version 300 es
precision highp float;
in float v_out;
uniform float u_intensity;
out vec4 fragColor;
void main() {
  float near = 1.0 - v_out;
  fragColor = vec4(vec3(1.0 - u_intensity * pow(near, 2.101)), 1.0);
}`;

export const buildingArchitecturalFloodComposite = `#version 300 es
precision highp float;
uniform sampler2D u_mask;
uniform vec3 u_colour;
${tileflowHazeFragment}
out vec4 fragColor;
void main() {
  float light = 1.0 - texelFetch(u_mask, ivec2(gl_FragCoord.xy), 0).r;
  fragColor = vec4(u_colour, light * (1.0 - hazeOf()));
}`;
