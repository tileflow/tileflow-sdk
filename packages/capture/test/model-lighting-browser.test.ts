import assert from 'node:assert/strict';
import test from 'node:test';
import {tileflowModelFragment} from '../../core/src/models-3d-shaders';
import {launchTileflowCaptureBrowser} from '../src/browser';

test(
  'model occlusion attenuates ambient light without attenuating direct sunlight',
  {skip: process.env.TILEFLOW_RUN_BROWSER_TESTS !== '1'},
  async () => {
    const browser = await launchTileflowCaptureBrowser({allowInstall: false});
    try {
      const page = await browser.newPage();
      await page.setContent('<canvas width="8" height="8"></canvas>');
      await page.addScriptTag({content: 'window.__name = (fn) => fn;'});
      const result = await page.evaluate((fragment) => {
        const gl = document.querySelector('canvas')!.getContext('webgl2')!;
        if (!gl) throw new Error('WebGL2 unavailable');
        const program = gl.createProgram()!;
        const vertex = `#version 300 es
precision highp float;
uniform float u_test_visibility;
uniform float u_test_height;
uniform int u_test_role;
out vec3 v_colour;
out vec3 v_normal;
out vec3 v_shadow;
out float v_light;
flat out int v_lighting_role;
out float v_height;
void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  v_colour = vec3(0.4, 0.5, 0.6);
  v_normal = vec3(0.0, 0.0, 1.0);
  v_shadow = vec3(0.5);
  v_light = u_test_visibility;
  v_lighting_role = u_test_role;
  v_height = u_test_height;
}`;
        for (const [type, source] of [
          [gl.VERTEX_SHADER, vertex],
          [gl.FRAGMENT_SHADER, fragment],
        ] as const) {
          const shader = gl.createShader(type)!;
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(shader)!);
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
          throw new Error(gl.getProgramInfoLog(program)!);
        gl.useProgram(program);
        const scalar = (name: string, value: number) =>
          gl.uniform1f(gl.getUniformLocation(program, name), value);
        scalar('u_ambient_occlusion', 1);
        gl.uniform3f(gl.getUniformLocation(program, 'u_sun_dir'), 0, 0, 1);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
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
        const read = (sky: number, sun: number, visibility: number, shadow = 0) => {
          gl.uniform3f(gl.getUniformLocation(program, 'u_sky_light'), sky, sky, sky);
          gl.uniform3f(gl.getUniformLocation(program, 'u_sun_light'), sun, sun, sun);
          scalar('u_test_visibility', visibility);
          scalar('u_shadow', shadow);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          const pixel = new Uint8Array(4);
          gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          return [...pixel].slice(0, 3);
        };
        const lighting = {
          ambient: [read(1, 0, 1), read(1, 0, 0.2)],
          direct: [read(0, 1, 1), read(0, 1, 0.2)],
          shadow: [read(0, 1, 1, 1), read(1, 0, 1, 1)],
        };
        gl.uniform1i(gl.getUniformLocation(program, 'u_test_role'), 1);
        scalar('u_role_emission[1]', 0.1);
        gl.uniform4f(
          gl.getUniformLocation(program, 'u_role_emission_colour[1]'),
          0.98,
          0.76,
          0.56,
          1,
        );
        gl.uniform4f(gl.getUniformLocation(program, 'u_role_emission_gradient[1]'), 0.5, 0, 0, 1);
        scalar('u_role_emission_power[1]', 0.8);
        const emission = [0, 0.05, 0.1, 0.2, 0.5, 1].map((height) => {
          scalar('u_test_height', height);
          return read(0, 0, 1);
        });
        scalar('u_test_height', 0);
        const occludedEmission = read(0, 0, 0.2);
        gl.uniform1i(gl.getUniformLocation(program, 'u_test_role'), 3);
        const roofEmission = read(0, 0, 1);
        return {...lighting, emission, occludedEmission, roofEmission, error: gl.getError()};
      }, tileflowModelFragment);
      assert.equal(result.error, 0);
      assert.deepEqual(
        result.direct[0],
        result.direct[1],
        'ambient occlusion must not darken direct light',
      );
      assert.ok(result.ambient[1]!.every((value, i) => value < result.ambient[0]![i]! * 0.8));
      assert.ok(
        result.shadow[0]!.every((value) => value === 0),
        'directional shadows remain active',
      );
      assert.deepEqual(
        result.shadow[1],
        result.ambient[0],
        'sun shadows must not remove ambient light',
      );
      assert.ok(result.emission[0]![0]! > result.emission[0]![2]!, 'the emitted light is warm');
      assert.ok(result.emission.every((rgb, i) => !i || rgb[0]! <= result.emission[i - 1]![0]!));
      assert.deepEqual(result.emission[4], [0, 0, 0], 'wall emission vanishes above its gradient');
      assert.deepEqual(
        result.emission[0],
        result.occludedEmission,
        'AO must not absorb emitted light',
      );
      assert.deepEqual(
        result.roofEmission,
        [0, 0, 0],
        'wall lighting must not illuminate a roof role',
      );
    } finally {
      await browser.close();
    }
  },
);
