import {createBuildingNativeLayers} from './building-native-layers-browser';
import type {TileflowBuildings3DChange} from './buildings-3d-browser';
import {tileflowBuildingsMetadataKey} from './buildings-3d-design';
import {readTileflowCamera} from './camera';
import {createTileflowPitchLimit} from './camera-browser';
import type {TileflowMap3D, TileflowMap3DOptions} from './map-3d-browser';
import {tileflowStreetLightsMetadataKey} from './street-lights';
import {tileflowVegetationMetadataKey} from './trees-3d';
import {tileflowVegetationDisplayMetadataKey, type TileflowViewMode} from './vegetation-display';

/** The style metadata through which a compiled map declares its 3D scene. */
export const tileflowMap3DMetadataKeys = Object.freeze([
  tileflowBuildingsMetadataKey,
  tileflowVegetationMetadataKey,
  tileflowVegetationDisplayMetadataKey,
  tileflowStreetLightsMetadataKey,
] as const);

/** Where the 3D scene reads the style: the map, and the theme controller when there is one. */
export type TileflowMap3DSource = Readonly<{
  map: {getStyle(): unknown};
  controller?: {
    getThemeMetadata?(key: string): Readonly<{values: readonly unknown[]; position: number}>;
  };
}>;

/**
 * The parts of a 3D scene the style on screen declares, as their metadata keys; during a theme
 * blend, those any blended theme declares.
 */
export function tileflowMap3DDeclarations(source: TileflowMap3DSource): ReadonlySet<string> {
  const read = source.controller?.getThemeMetadata;
  let metadata: unknown;
  if (!read) metadata = (source.map.getStyle() as {metadata?: unknown} | undefined)?.metadata;
  const declared = (value: unknown) => value !== undefined && value !== null;
  return new Set(
    tileflowMap3DMetadataKeys.filter((key) =>
      read
        ? read.call(source.controller, key).values.some(declared)
        : typeof metadata === 'object' &&
          metadata !== null &&
          declared((metadata as Record<string, unknown>)[key]),
    ),
  );
}

/**
 * Whether the style on screen places building models or shows Tileflow's landmarks, which stand
 * in for the buildings under them; during a theme blend, whether any blended theme does.
 */
export function tileflowMapDeclaresStandIns(source: TileflowMap3DSource): boolean {
  const read = source.controller?.getThemeMetadata;
  const values = read
    ? read.call(source.controller, tileflowBuildingsMetadataKey).values
    : [
        ((source.map.getStyle() as {metadata?: Record<string, unknown>} | undefined)?.metadata ??
          {})[tileflowBuildingsMetadataKey],
      ];
  return values.some((value) => {
    if (typeof value !== 'object' || value === null) return false;
    const {models, landmarks} = value as {models?: unknown; landmarks?: unknown};
    return (Array.isArray(models) && models.length > 0) || Boolean(landmarks);
  });
}

/** Whether the style on screen declares any part of a 3D scene: buildings, trees or lights. */
export function tileflowMapDeclares3D(source: TileflowMap3DSource): boolean {
  return tileflowMap3DDeclarations(source).size > 0;
}

/** Loads the 3D renderers: a dynamic import of the `@tileflow/core/3d` entry. */
export type TileflowMap3DLoader = () => Promise<{
  createTileflowMap3D(options: TileflowMap3DOptions): TileflowMap3D;
}>;

export type AttachTileflowMap3DOptions = TileflowMap3DOptions & {
  map: TileflowMap3DOptions['map'] & {getStyle(): unknown};
  /** Loads the renderers the first time the map's style declares 3D. */
  load: TileflowMap3DLoader;
  /** Receives a failure to load or mount the renderers; the 2D map keeps working. */
  onError?: (error: unknown) => void;
};

export type TileflowMap3DAttachment = {
  /** The mounted scene, once a style that declares 3D has loaded the renderers. */
  readonly scene: TileflowMap3D | undefined;
  /**
   * `3d` shows the scene; `2d` hides it and draws `auto` vegetation flat. A transition animates the
   * buildings' rise or descent; without one the change is immediate.
   */
  setViewMode(mode: TileflowViewMode, change?: TileflowBuildings3DChange): void;
  /** Overrides the map's vegetation visibility; undefined restores the authored default. */
  setVegetation(visible: boolean | undefined): void;
  /** Overrides the camera policy; undefined restores the map's authored default. */
  setAdaptivePerspective(enabled: boolean | undefined): void;
  dispose(): void;
};

/**
 * Mounts the map's 3D scene when, and only when, its style declares one. Until then it loads
 * nothing, so a 2D map does not pay for the 3D renderers. Requested state applies on mount.
 */
export function attachTileflowMap3D(options: AttachTileflowMap3DOptions): TileflowMap3DAttachment {
  const {map, load, onError, ...sceneOptions} = options;
  let viewMode: TileflowViewMode = options.viewMode ?? '3d';
  let vegetation = options.vegetation;
  let adaptivePerspective = options.camera?.adaptivePerspective;
  let scene: TileflowMap3D | undefined;
  let loading = false;
  let failed = false;
  let disposed = false;
  // Flat maps still own their camera policy, without loading the 3D renderer.
  let pitchLimit: ReturnType<typeof createTileflowPitchLimit> | undefined;
  const pendingNativeBuildings = createBuildingNativeLayers(map);
  // While the renderers load, the native extrusion draws the buildings, unless models may stand in
  // for some: it must not draw those, and cannot tell which they are until the scene knows.
  let standsIn = false;
  const showPending = () =>
    pendingNativeBuildings.setVisible(viewMode === '3d' && (failed || !standsIn));

  // Whether the style declares 3D changes with the style, not each time a 2D map settles.
  let declares: boolean | undefined;
  const check = () => {
    if (disposed || loading || !map.isStyleLoaded()) return;
    if (declares === undefined) {
      const limit =
        options.camera?.pitchLimit ??
        readTileflowCamera((map.getStyle() as {metadata?: unknown} | undefined)?.metadata)
          .pitchLimit;
      if (limit) {
        pitchLimit ??= createTileflowPitchLimit(map);
        pitchLimit.setLimit(limit);
      } else {
        pitchLimit?.dispose();
        pitchLimit = undefined;
      }
    }
    declares ??= tileflowMapDeclares3D({
      map,
      ...(options.controller ? {controller: options.controller} : {}),
    });
    if (!declares) {
      pendingNativeBuildings.restore();
      return;
    }
    standsIn = tileflowMapDeclaresStandIns({
      map,
      ...(options.controller ? {controller: options.controller} : {}),
    });
    showPending();
    loading = true;
    stopWatching();
    load()
      .then(({createTileflowMap3D}) => {
        if (disposed) return;
        pendingNativeBuildings.restore();
        // The mounted scene takes over with the application's original maximum.
        pitchLimit?.dispose();
        scene = createTileflowMap3D({
          ...sceneOptions,
          map,
          viewMode,
          vegetation,
          camera: {...options.camera, adaptivePerspective},
          ...(onError ? {onError} : {}),
        });
      })
      .catch((error: unknown) => {
        if (disposed) return;
        // Without the scene, the native extrusion draws every building.
        failed = true;
        showPending();
        onError?.(error);
      });
  };
  const restyle = () => {
    declares = undefined;
    check();
  };
  function stopWatching() {
    map.off('styledata', restyle);
    map.off('style.load', restyle);
    map.off('idle', check);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopWatching();
    map.off('remove', onRemove);
    pendingNativeBuildings.restore();
    pitchLimit?.dispose();
    scene?.dispose();
    scene = undefined;
  }
  function onRemove() {
    // The mounted scene handles removal itself. Do not restore its lens on a destroyed map.
    pitchLimit?.dispose(false);
    pendingNativeBuildings.forget();
    scene = undefined;
    dispose();
  }

  map.on('styledata', restyle);
  map.on('style.load', restyle);
  map.on('idle', check);
  map.on('remove', onRemove);
  check();

  return {
    get scene() {
      return scene;
    },
    setViewMode(mode, change) {
      if (mode === viewMode) return;
      viewMode = mode;
      if (!scene) {
        if (declares) showPending();
        else pendingNativeBuildings.restore();
      }
      if (scene) void (mode === '3d' ? scene.show(change) : scene.hide(change));
    },
    setVegetation(visible) {
      vegetation = visible;
      scene?.setVegetation(visible);
    },
    setAdaptivePerspective(enabled) {
      adaptivePerspective = enabled;
      scene?.setAdaptivePerspective(enabled);
    },
    dispose,
  };
}
