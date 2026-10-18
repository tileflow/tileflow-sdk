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
