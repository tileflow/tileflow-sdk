// Every receiver uses the same depth comparison: one hardware-filtered sample keeps
// buildings, trees, placed models and the ground equally sharp.
export const tileflowShadowLookup = `
uniform highp sampler2DShadow u_shadow_map;
uniform float u_shadow;
uniform float u_depth_unit;

float visibility(vec3 c, float bias) {
  if (u_shadow <= 0.0 || c.x <= 0.0 || c.y <= 0.0 || c.x >= 1.0 || c.y >= 1.0 || c.z >= 1.0)
    return 1.0;
  float z = c.z - bias * u_depth_unit;
  // The depth texture uses LINEAR comparison; an extra multi-tap kernel would
  // spread distant texels into metres of soft shadow.
  return texture(u_shadow_map, vec3(c.xy, z));
}`;

// Every 3D layer fades into the sky's horizon colour with distance, as the flat map under it does
// (sky-haze-browser.ts): the vertex passes its view depth, clip space's w, to the fragment.
export const tileflowHazeVertex = `
out float v_haze_depth;`;

export const tileflowHazeFragment = `
in float v_haze_depth;
uniform vec3 u_haze_colour;
uniform vec3 u_haze; // strength; the view depths where the haze starts and is complete

float hazeOf() {
  return u_haze.x > 0.0 ? u_haze.x * smoothstep(u_haze.y, u_haze.z, v_haze_depth) : 0.0;
}

vec3 hazed(vec3 colour) {
  return mix(colour, u_haze_colour, hazeOf());
}`;
