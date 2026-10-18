/** Fade the nearest building/model surfaces once, without showing their rear walls. */
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
  const colourMask = gl.getParameter(gl.COLOR_WRITEMASK) as boolean[];
  const depthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean;
  const depthFunc = gl.getParameter(gl.DEPTH_FUNC) as number;
  const blending = gl.isEnabled(gl.BLEND);
  const blendColour = gl.getParameter(gl.BLEND_COLOR) as Float32Array;
  const blend = [gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA].map(
    (name) => gl.getParameter(name) as number,
  );
  const equations = [gl.BLEND_EQUATION_RGB, gl.BLEND_EQUATION_ALPHA].map(
    (name) => gl.getParameter(name) as number,
  );
  try {
    // Resolve all buildings and placed models together before blending any colour. Otherwise
    // a rear wall drawn first remains visible through the nearest one during the fade.
    gl.colorMask(false, false, false, false);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    draw();
    gl.colorMask(...(colourMask as [boolean, boolean, boolean, boolean]));
    gl.depthMask(false);
    gl.depthFunc(gl.EQUAL);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendColor(0, 0, 0, opacity);
    gl.blendFuncSeparate(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.ZERO, gl.ONE);
    draw();
  } finally {
    gl.colorMask(...(colourMask as [boolean, boolean, boolean, boolean]));
    gl.depthMask(depthMask);
    gl.depthFunc(depthFunc);
    gl.blendColor(...(Array.from(blendColour) as [number, number, number, number]));
    gl.blendFuncSeparate(blend[0]!, blend[1]!, blend[2]!, blend[3]!);
    gl.blendEquationSeparate(equations[0]!, equations[1]!);
    if (blending) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
  }
}
