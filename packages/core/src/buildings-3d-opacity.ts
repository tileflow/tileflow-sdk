/**
 * Fade the nearest building/model surfaces once, without showing their rear walls. Expects the
 * buildings' opaque state (every colour channel and depth written, LEQUAL, no blending) and leaves
 * it, so a frame reads no GL state back.
 */
export function drawBuildingOpacity(
  gl: WebGL2RenderingContext,
  opacity: number,
  draw: () => void,
): void {
  if (opacity <= 0) return;
  if (opacity >= 1) {
    draw();
    return;
  }
  try {
    // Resolve all buildings and placed models together before blending any colour. Otherwise
    // a rear wall drawn first remains visible through the nearest one during the fade.
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    draw();
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.depthFunc(gl.EQUAL);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendColor(0, 0, 0, opacity);
    gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.ZERO, gl.ONE);
    draw();
  } finally {
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
  }
}
