import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowModelDepthFragment, tileflowModelFragment} from '../../core/src/models-3d-shaders';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'physical model materials retain textures, alpha, emission and ambient-only occlusion',
  {
    skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1',
  },
  async () => {
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="8" height="8"></canvas>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const result = await page.evaluate(
        async ({fragment, depth}) => {
          const gl = document.querySelector('canvas')!.getContext('webgl2')!;
          if (!gl) throw new Error('WebGL2 unavailable');
          const vertex = `#version 300 es
precision highp float;
uniform float u_test_visibility;
out vec3 v_colour;
out vec3 v_normal;
out vec3 v_shadow;
out float v_light;
flat out int v_lighting_role;
flat out int v_part;
out float v_height;
out vec4 v_uv;
out vec4 v_rgba;
out vec3 v_position;
void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  v_colour = vec3(0.4, 0.5, 0.6);
  v_normal = vec3(0.0, 0.0, 1.0);
  v_shadow = vec3(0.5);
  v_light = u_test_visibility;
  v_lighting_role = 1;
  v_part = 0;
  v_height = 0.0;
  v_uv = vec4(uv, uv);
  v_rgba = vec4(0.5, 1.0, 1.0, 0.5);
  v_position = vec3(uv, 0.0);
}`;
          function program(source: string) {
            const p = gl.createProgram()!;
            for (const [type, text] of [
              [gl.VERTEX_SHADER, vertex],
              [gl.FRAGMENT_SHADER, source],
            ] as const) {
              const shader = gl.createShader(type)!;
              gl.shaderSource(shader, text);
              gl.compileShader(shader);
              if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                throw new Error(gl.getShaderInfoLog(shader)!);
              gl.attachShader(p, shader);
              gl.deleteShader(shader);
            }
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS))
              throw new Error(gl.getProgramInfoLog(p)!);
            return p;
          }
          const p = program(fragment);
          gl.useProgram(p);
          const loc = (name: string) => gl.getUniformLocation(p, name);
          if (loc('u_physical') === null)
            throw new Error('Physical material shading is unavailable.');
          const scalar = (name: string, value: number) => gl.uniform1f(loc(name), value);
          const integer = (name: string, value: number) => gl.uniform1i(loc(name), value);
          const vector = (name: string, ...value: number[]) => gl.uniform3fv(loc(name), value);
          function texture(unit: number, values: number[], width = 1) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            const t = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA8,
              width,
              1,
              0,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              new Uint8Array(values),
            );
            return t;
          }
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.DEPTH_COMPONENT32F,
            1,
            1,
            0,
            gl.DEPTH_COMPONENT,
            gl.FLOAT,
            new Float32Array([0]),
          );
          for (let channel = 0; channel < 5; channel++) {
            texture(2 + channel, [255, 255, 255, 255]);
            integer(`u_material_texture${channel}`, 2 + channel);
            gl.uniform4f(loc(`u_texture_transform[${channel}]`), 0, 0, 1, 1);
          }
          integer('u_physical', 1);
          integer('u_unlit', 1);
          scalar('u_test_visibility', 1);
          scalar('u_ambient_occlusion', 1);
          scalar('u_occlusion_strength', 1);
          scalar('u_normal_strength', 1);
          scalar('u_roughness', 1);
          scalar('u_opacity', 1);
          scalar('u_metallic', 0);
          gl.uniform4f(loc('u_base_colour'), 1, 1, 1, 1);
          vector('u_sun_dir', 0, 0, 1);
          vector('u_view_position', 0.5, 0.5, 5);
          let reading = 0;
          const read = () => {
            const before = gl.getError();
            if (before) throw new Error(`Material setup ${reading}: WebGL ${before}`);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            const pixel = new Uint8Array(4);
            gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
            const error = gl.getError();
            if (error) throw new Error(`Material draw ${reading}: WebGL ${error}`);
            reading++;
            return [...pixel];
          };
          const unlit = read();
          gl.uniform4f(loc('u_base_colour'), 0.002, 0.002, 0.002, 1);
          const darkTransfer = read();
          gl.uniform4f(loc('u_base_colour'), 1, 1, 1, 1);
          scalar('u_texture_enabled[0]', 1);
          texture(2, [128, 255, 0, 255]);
          const textured = read();
          integer('u_alpha_mode', 1);
          scalar('u_alpha_cutoff', 0.6);
          const masked = read();
          integer('u_alpha_mode', 2);
          const blended = read();
          integer('u_alpha_mode', 0);
          scalar('u_texture_enabled[0]', 0);
          gl.uniform4f(loc('u_role_colour[1]'), 1, 0, 0, 1);
          const tinted = read();
          vector('u_part_colours[0]', 0, 0, 1);
          scalar('u_part_mix[0]', 1);
          const recoloured = read();
          scalar('u_part_mix[0]', 0);
          gl.uniform4f(loc('u_role_colour[1]'), 0, 0, 0, 0);
          integer('u_unlit', 0);
          scalar('u_texture_enabled[0]', 0);
          vector('u_sky_light', 0.4, 0.4, 0.4);
          const ambient = read();
          scalar('u_test_visibility', 0.2);
          const ambientOccluded = read();
          vector('u_sky_light', 0, 0, 0);
          vector('u_sun_light', 0.5, 0.5, 0.5);
          const directOccluded = read();
          scalar('u_test_visibility', 1);
          const direct = read();
          scalar('u_texture_enabled[3]', 1);
          texture(5, [51, 255, 255, 255]);
          const directTextureOccluded = read();
          vector('u_sun_light', 0, 0, 0);
          vector('u_sky_light', 0.4, 0.4, 0.4);
          const textureOccluded = read();
          scalar('u_ambient_occlusion', 0);
          const textureOcclusionDisabled = read();
          scalar('u_ambient_occlusion', 1);
          scalar('u_texture_enabled[3]', 0);
          vector('u_sky_light', 0, 0, 0);
          vector('u_sun_light', 0.25, 0.25, 0.25);
          const dimmerSun = read();
          scalar('u_shadow', 1);
          const shadowed = read();
          scalar('u_shadow', 0);
          scalar('u_texture_enabled[2]', 1);
          texture(4, [255, 128, 128, 255]);
          const normalMapped = read();
          scalar('u_texture_enabled[2]', 0);
          scalar('u_roughness', 0.15);
          scalar('u_metallic', 1);
          const metal = read();
          vector('u_sun_light', 0, 0, 0);
          vector('u_emissive', 0.25, 0, 0);
          const emitted = read();
          scalar('u_test_visibility', 0);
          scalar('u_shadow', 1);
          const emittedOccluded = read();
          scalar('u_role_emission[1]', 1);
          gl.uniform4f(loc('u_role_emission_colour[1]'), 0, 0, 1, 1);
          const roleEmission = read();
          // The depth shader must accept the same physical alpha interface.
          const depthProgram = program(depth);
          if (gl.getError()) throw new Error('Depth program setup failed.');
          gl.useProgram(depthProgram);
          gl.drawBuffers([gl.NONE]);
          const dloc = (name: string) => gl.getUniformLocation(depthProgram, name);
          gl.uniform1i(dloc('u_physical'), 1);
          gl.uniform1i(dloc('u_alpha_mode'), 1);
          gl.uniform1f(dloc('u_alpha_cutoff'), 0.6);
          gl.uniform4f(dloc('u_base_colour'), 1, 1, 1, 1);
          for (let channel = 0; channel < 5; channel++)
            gl.uniform1i(dloc(`u_material_texture${channel}`), 2 + channel);
          const check = (stage: string) => {
            const error = gl.getError();
            if (error) throw new Error(`${stage}: WebGL ${error}`);
          };
          check('Depth uniforms');
          // Colour output is deliberately absent; an occlusion query measures retained fragments.
          const query = async (cutoff: number) => {
            gl.uniform1f(dloc('u_alpha_cutoff'), cutoff);
            const q = gl.createQuery()!;
            gl.beginQuery(gl.ANY_SAMPLES_PASSED, q);
            check('Depth query');
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            check('Depth draw');
            gl.endQuery(gl.ANY_SAMPLES_PASSED);
            gl.flush();
            for (let frame = 0; frame < 120; frame++) {
              await new Promise((resolve) => requestAnimationFrame(resolve));
              if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
                const passed = Boolean(gl.getQueryParameter(q, gl.QUERY_RESULT));
                gl.deleteQuery(q);
                return passed;
              }
            }
            throw new Error('The material depth query did not complete.');
          };
          const depthMasked = await query(0.6);
          const depthOpaque = await query(0.4);
          return {
            unlit,
            darkTransfer,
            textured,
            masked,
            blended,
            tinted,
            recoloured,
            ambient,
            ambientOccluded,
            direct,
            directOccluded,
            directTextureOccluded,
            textureOccluded,
            textureOcclusionDisabled,
            dimmerSun,
            shadowed,
            normalMapped,
            metal,
            emitted,
            emittedOccluded,
            roleEmission,
            depthMasked,
            depthOpaque,
            error: gl.getError(),
          };
        },
        {fragment: tileflowModelFragment, depth: tileflowModelDepthFragment},
      );
      assert.equal(result.error, 0);
      assert.deepEqual(
        result.darkTransfer,
        [11, 15, 15, 255],
        'dark material radiance follows the cartographic gamma-2.2 transfer',
      );
      assert.ok(
        result.unlit[0]! > 180 && result.unlit[1] === 255,
        'linear vertex colour is preserved',
      );
      assert.ok(
        result.textured[0]! > 85 && result.textured[0]! < 100 && result.textured[2] === 0,
        'colour textures decode sRGB once',
      );
      assert.deepEqual(result.masked, [0, 0, 0, 0]);
      assert.ok(result.blended[3]! >= 126 && result.blended[3]! <= 129);
      assert.ok(result.tinted[0]! > 180 && result.tinted[2] === 0);
      assert.deepEqual(
        result.recoloured,
        [0, 0, 255, 255],
        'palette overrides retain recolouring of physical materials',
      );
      assert.ok(result.ambientOccluded[0]! < result.ambient[0]! * 0.7);
      assert.deepEqual(
        result.direct,
        result.directOccluded,
        'geometric AO leaves direct sunlight intact',
      );
      assert.deepEqual(
        result.direct,
        result.directTextureOccluded,
        'texture AO leaves direct sunlight intact',
      );
      assert.ok(result.textureOccluded[0]! < result.ambient[0]! * 0.7);
      assert.deepEqual(result.textureOcclusionDisabled, result.ambient);
      assert.ok(result.dimmerSun[0]! < result.direct[0]!, 'physical light uses absolute radiance');
      assert.equal(result.shadowed[0], 0);
      assert.ok(result.normalMapped[0]! < result.dimmerSun[0]! * 0.2);
      assert.notDeepEqual(
        result.metal,
        result.dimmerSun,
        'metallic roughness changes the reflection',
      );
      assert.ok(result.emitted[0]! > 130 && result.emitted[1] === 0);
      assert.deepEqual(result.emitted, result.emittedOccluded);
      assert.deepEqual(
        result.roleEmission,
        [0, 0, 255, 255],
        'full role emission selects its target without adding authored emission twice',
      );
      assert.equal(result.depthMasked, false, 'masked pixels do not cast a solid solar shadow');
      assert.equal(result.depthOpaque, true);
    } finally {
      await browser.close();
    }
  },
);
