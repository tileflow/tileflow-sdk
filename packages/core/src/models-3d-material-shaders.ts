import {tileflowModelPartCount} from './models-3d-model';

/** Shared glTF texture and alpha evaluation for colour and solar-depth passes. */
export const modelMaterialSampling = `
in vec4 v_uv;
in vec4 v_rgba;
uniform bool u_physical;
uniform vec4 u_base_colour;
uniform int u_alpha_mode; // opaque, mask, blend
uniform float u_alpha_cutoff;
uniform float u_texture_enabled[5];
uniform vec4 u_texture_transform[5]; // offset.xy, scale.xy
uniform float u_texture_rotation[5];
uniform float u_texture_coord[5];
uniform sampler2D u_material_texture0;
uniform sampler2D u_material_texture1;
uniform sampler2D u_material_texture2;
uniform sampler2D u_material_texture3;
uniform sampler2D u_material_texture4;

vec2 materialUV(int channel) {
  vec2 uv = u_texture_coord[channel] > 0.5 ? v_uv.zw : v_uv.xy;
  vec4 transform = u_texture_transform[channel];
  uv *= transform.zw;
  float angle = u_texture_rotation[channel];
  return transform.xy + mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * uv;
}

vec4 materialTexture(int channel) {
  if (u_texture_enabled[channel] < 0.5) return vec4(1.0);
  vec2 uv = materialUV(channel);
  if (channel == 0) return texture(u_material_texture0, uv);
  if (channel == 1) return texture(u_material_texture1, uv);
  if (channel == 2) return texture(u_material_texture2, uv);
  if (channel == 3) return texture(u_material_texture3, uv);
  return texture(u_material_texture4, uv);
}

float materialAlpha() {
  if (!u_physical || u_alpha_mode == 0) return 1.0;
  float alpha = u_base_colour.a * v_rgba.a * materialTexture(0).a;
  if (u_alpha_mode == 1 && alpha < u_alpha_cutoff) discard;
  return u_alpha_mode == 1 ? 1.0 : alpha;
}
`;

/** Metallic/roughness shading in linear light; geometric and texture AO affect only the sky. */
export const modelPhysicalLighting = `
in vec3 v_position;
flat in int v_part;
uniform vec3 u_view_position;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3 u_emissive;
uniform float u_normal_strength;
uniform float u_occlusion_strength;
uniform bool u_unlit;
uniform vec3 u_part_colours[${tileflowModelPartCount}];
uniform float u_part_mix[${tileflowModelPartCount}];
uniform vec4 u_role_colour[7];
uniform vec4 u_role_material[7]; // metallic, roughness, their respective override weights

vec3 fromSRGB(vec3 colour) {
  return pow(max(colour, vec3(0.0)), vec3(2.2));
}

vec3 toSRGB(vec3 colour) {
  // Use the scene's gamma-2.2 approximation, including at low night radiance.
  return pow(max(colour, vec3(0.0)), vec3(1.0 / 2.2));
}

vec3 materialNormal(vec3 normal) {
  if (u_texture_enabled[2] < 0.5) return normal;
  vec2 uv = materialUV(2);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float determinant = dx.x * dy.y - dx.y * dy.x;
  if (abs(determinant) < 1e-8) return normal;
  vec3 px = dFdx(v_position), py = dFdy(v_position);
  vec3 tangent = (px * dy.y - py * dx.y) / determinant;
  vec3 bitangent = (py * dx.x - px * dy.x) / determinant;
  tangent = normalize(tangent - normal * dot(normal, tangent));
  bitangent = normalize(bitangent - normal * dot(normal, bitangent));
  vec3 sampleNormal = materialTexture(2).xyz * 2.0 - 1.0;
  sampleNormal.xy *= u_normal_strength;
  return normalize(mat3(tangent, bitangent, normal) * sampleNormal);
}

vec3 materialBase(int role) {
  vec4 own = u_role_colour[role];
  vec3 factor = mix(u_base_colour.rgb, fromSRGB(own.rgb), own.a);
  factor = mix(factor, fromSRGB(u_part_colours[v_part]), u_part_mix[v_part]);
  return factor * v_rgba.rgb * fromSRGB(materialTexture(0).rgb);
}

vec3 physicalLight(vec3 base, vec3 normal, float lit, int role) {
  if (u_unlit) return base;
  vec4 packed = materialTexture(1);
  vec4 overrideMaterial = u_role_material[role];
  float metallic = clamp(mix(u_metallic, overrideMaterial.x, overrideMaterial.z) * packed.b, 0.0, 1.0);
  float roughness = clamp(mix(u_roughness, overrideMaterial.y, overrideMaterial.w) * packed.g, 0.04, 1.0);
  vec3 view = normalize(u_view_position - v_position);
  vec3 halfway = normalize(view + u_sun_dir);
  float nv = max(dot(normal, view), 0.001);
  float nl = max(dot(normal, u_sun_dir), 0.0);
  float nh = max(dot(normal, halfway), 0.0);
  float vh = max(dot(view, halfway), 0.0);
  float a2 = pow(roughness, 4.0);
  float denominator = nh * nh * (a2 - 1.0) + 1.0;
  float distribution = a2 / max(3.14159265 * denominator * denominator, 1e-7);
  float masking = 0.5 / max(nv * sqrt(a2 + (1.0 - a2) * nl * nl)
    + nl * sqrt(a2 + (1.0 - a2) * nv * nv), 1e-5);
  vec3 f0 = mix(vec3(0.04), base, metallic);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
  vec3 diffuse = base * (1.0 - metallic) * 0.96;
  // Scene light is cartographic radiance: a Lambert surface uses unit diffuse response.
  vec3 direct = (diffuse * (1.0 - fresnel) + distribution * masking * fresnel)
    * u_sun_light * nl * (1.0 - u_shadow * (1.0 - lit));
  // Analytic fit of the integrated GGX BRDF: reflection scales and biases its normal reflectance.
  float smoothness = 1.0 - roughness;
  float fit = smoothness * min(smoothness * smoothness, exp2(-9.28 * nv)) + 0.0425 - 0.0275 * roughness;
  float reflectionScale = 1.04 - 0.572 * roughness - 1.04 * fit;
  float reflectionBias = 0.022 * roughness - 0.04 + 1.04 * fit;
  vec3 reflectedSky = max(vec3(0.0), f0 * reflectionScale + reflectionBias);
  float directional = dot(u_sun_light, vec3(0.2126, 0.7152, 0.0722));
  float exposure = (0.96 + 0.04 * clamp(normal.z, -1.0, 1.0)) *
    (1.0 - 0.3 * min(directional, 1.0) * max(-dot(normal, u_sun_dir), 0.0));
  float ao = mix(1.0, v_light * mix(1.0, materialTexture(3).r, u_occlusion_strength),
    u_ambient_occlusion);
  vec3 ambient = (diffuse + reflectedSky) * u_sky_light * exposure * ao;
  return ambient + min(direct, vec3(1.0));
}
`;
