/**
 * The WebGL context a browser map asks for. Multisampling is on, so the thin edges of 3D models,
 * buildings and trees resolve smoothly instead of breaking into stipple. Attributes the caller
 * passes win, so `{antialias: false}` opts out.
 */
export function tileflowCanvasContextAttributes<T extends object>(
  attributes?: T,
): T & {antialias: boolean} {
  return {antialias: true, ...attributes} as T & {antialias: boolean};
}
