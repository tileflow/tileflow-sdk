/**
 * The map's 3D scene alone, for applications that load it with a dynamic import only when a
 * style declares one; `attachTileflowMap3D` in the browser entry does exactly that.
 */
export {
  createTileflowMap3D,
  type TileflowMap3D,
  type TileflowMap3DMap,
  type TileflowMap3DOptions,
} from './map-3d-browser';
