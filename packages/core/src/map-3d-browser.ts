import {createBuildingFlatLayers} from './building-flat-layers-browser';
import {
  createTileflowBuildings3D,
  type TileflowBuildings3D,
  type TileflowBuildings3DChange,
  type TileflowBuildings3DMap,
  type TileflowBuildings3DThemes,
} from './buildings-3d-browser';
import {readTileflowBuildings3D, tileflowBuildingsMetadataKey} from './buildings-3d-design';
import {readTileflowCamera, tileflowCameraMetadataKey, type TileflowCameraOptions} from './camera';
import {createTileflowAdaptiveCamera, type TileflowAdaptiveCameraMap} from './camera-browser';
import {tileflowMap3DDeclarations} from './map-3d-attach-browser';
import {tileflowStreetLightsMetadataKey} from './street-lights';
import {
  createTileflowStreetLights,
  type TileflowStreetLights,
  type TileflowStreetLightsMap,
} from './street-lights-browser';
import type {TileflowTileRequestTransform} from './tile-reader';
import {tileflowVegetationMetadataKey} from './trees-3d';
import {
  createTileflowVegetation,
  type TileflowVegetationController,
  type TileflowVegetationOptions,
} from './vegetation-browser';
import {tileflowVegetationDisplayMetadataKey, type TileflowViewMode} from './vegetation-display';

/** The MapLibre GL JS map capabilities the 3D scene uses. */
export type TileflowMap3DMap = TileflowBuildings3DMap &
  TileflowStreetLightsMap &
  TileflowAdaptiveCameraMap &
  TileflowVegetationOptions['map'];

export type TileflowMap3DOptions = Readonly<{
  map: TileflowMap3DMap;
  /** The theme controller, for the sun and the scene's design in every theme. */
  controller?: TileflowBuildings3DThemes;
  /** `3d` (the default) shows the scene; `2d` mounts no 3D layers and draws `auto` vegetation flat. */
  viewMode?: TileflowViewMode;
  /** Overrides the map's vegetation visibility; undefined uses the authored default. */
  vegetation?: boolean | undefined;
  /** Camera overrides. Omission uses the compiled map's policy, falling back to false. */
  camera?: TileflowCameraOptions;
  /** The map's request rules, for the tiles the renderers read. */
  transformRequest?: TileflowTileRequestTransform;
}>;

export type TileflowMap3D = {
  /** Shows the scene. A transition animates the buildings' rise; other parts change at once. */
  show(options?: TileflowBuildings3DChange): Promise<void>;
  /** Hides the scene, releasing its street lights. A transition animates the buildings' descent. */
  hide(options?: TileflowBuildings3DChange): Promise<void>;
  /** `3d` while shown, `2d` while hidden. */
  readonly viewMode: TileflowViewMode;
  /** Overrides the map's vegetation visibility; undefined restores the authored default. */
  setVegetation(visible: boolean | undefined): void;
  /** Overrides the camera policy; undefined restores the map's authored default. */
  setAdaptivePerspective(enabled: boolean | undefined): void;
  /** The mounted renderers, for diagnostics; each is present while the style declares it. */
  readonly buildings: TileflowBuildings3D | undefined;
  readonly vegetation: TileflowVegetationController | undefined;
  readonly streetLights: TileflowStreetLights | undefined;
  /** Takes every 3D layer off the map and restores its authored flat vegetation. */
  dispose(): void;
};

/**
 * Mounts every 3D renderer the map's compiled style declares — buildings with landmarks and Team
 * models (`tileflow:buildings`), vegetation (`tileflow:vegetation`, `tileflow:vegetation-display`)
 * and street lights (`tileflow:street-lights`) — on the map's shared 3D scene. It follows style and
 * theme changes, mounting and releasing renderers as the style declares them.
 */
export function createTileflowMap3D(options: TileflowMap3DOptions): TileflowMap3D {
  const {map, controller, transformRequest} = options;
  let viewMode: TileflowViewMode = options.viewMode ?? '3d';
  let vegetationVisible = options.vegetation;
  let adaptivePerspective = options.camera?.adaptivePerspective;
  const camera = createTileflowAdaptiveCamera(map);
  let authoredPerspective: boolean | undefined;
  let buildings: TileflowBuildings3D | undefined;
  let vegetation: TileflowVegetationController | undefined;
  let streetLights: TileflowStreetLights | undefined;
  const flatBuildings = createBuildingFlatLayers(map);
  let footprintLayers: readonly Readonly<{id: string; visible: boolean}>[] | undefined;
  let footprintZoom = 15.3;
  let disposed = false;
  let syncing = false;
  const shared = {
    map,
    ...(controller ? {controller} : {}),
    ...(transformRequest ? {transformRequest} : {}),
  };
  const instant = {transition: {duration: 0}};
  // What the style declares changes with the style, not each time the map settles; without a
  // controller, reading it serializes the whole style.
  let declarations: ReadonlySet<string> | undefined;

  function sync(): void {
    if (disposed || syncing || !map.isStyleLoaded()) return;
    syncing = true;
    try {
      const shown = viewMode === '3d';
      if (footprintLayers === undefined) {
        const themes = controller?.getThemeMetadata?.(tileflowBuildingsMetadataKey);
        const metadata = themes
          ? {[tileflowBuildingsMetadataKey]: themes.values[Math.round(themes.position)]}
          : (map.getStyle() as {metadata?: unknown} | undefined)?.metadata;
        const design = readTileflowBuildings3D(metadata);
        footprintLayers = design?.flatLayers ?? [];
        footprintZoom = design?.entrance?.buildings?.[1] ?? 15.3;
      }
      if (authoredPerspective === undefined) {
        const themes = controller?.getThemeMetadata?.(tileflowCameraMetadataKey);
        const metadata = themes
          ? {[tileflowCameraMetadataKey]: themes.values[Math.round(themes.position)]}
          : (map.getStyle() as {metadata?: unknown} | undefined)?.metadata;
        authoredPerspective = readTileflowCamera(metadata).adaptivePerspective ?? false;
      }
      camera.setEnabled(shown && (adaptivePerspective ?? authoredPerspective));
      const declared = (declarations ??= tileflowMap3DDeclarations({
        map,
        ...(controller ? {controller} : {}),
      }));
      const declares = (key: string) => declared.has(key);
      // Undeclared buildings would draw with default design, so a style without them has none.
      if (shown && declares(tileflowBuildingsMetadataKey))
        buildings ??= createTileflowBuildings3D(shared);
      else if (!declares(tileflowBuildingsMetadataKey) && buildings) {
        buildings.dispose();
        buildings = undefined;
      }
      if (
        !vegetation &&
        (declares(tileflowVegetationMetadataKey) || declares(tileflowVegetationDisplayMetadataKey))
      )
        vegetation = createTileflowVegetation({...shared, visible: vegetationVisible, viewMode});
      syncFlatBuildings();
      // Street lights are part of the 3D view only.
      if (shown && declares(tileflowStreetLightsMetadataKey))
        streetLights ??= createTileflowStreetLights(shared);
      else if (streetLights) {
        streetLights.dispose();
        streetLights = undefined;
      }
    } finally {
      syncing = false;
    }
  }

  function syncFlatBuildings(): void {
    if (disposed) return;
    if (!footprintLayers?.length) {
      flatBuildings.restore();
      return;
    }
    const canvas = map.getCanvas?.() as {getContext?(kind: string): unknown} | undefined;
    flatBuildings.update(
      footprintLayers,
      viewMode === '3d' &&
        Boolean(buildings) &&
        map.getZoom() >= footprintZoom &&
        Boolean(canvas?.getContext?.('webgl2')),
    );
  }

  function change(next: TileflowViewMode, transition?: TileflowBuildings3DChange): Promise<void> {
    if (disposed) return Promise.resolve();
    viewMode = next;
    camera.setEnabled(next === '3d' && (adaptivePerspective ?? authoredPerspective ?? false));
    vegetation?.setViewMode(next);
    if (next === '3d') {
      // A new renderer starts shown; one that was hidden rises again.
      const existing = buildings;
      sync();
      if (!existing && buildings && transition?.transition?.duration) {
        // A renderer mounted now rises from the ground like one that was hidden.
        void buildings.hide(instant);
      }
      return buildings ? buildings.show(transition) : Promise.resolve();
    }
    sync();
    return buildings?.hide(transition ?? instant) ?? Promise.resolve();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    flatBuildings.restore();
    camera.dispose();
    map.off('styledata', restyle);
    map.off('style.load', restyle);
    map.off('idle', sync);
    map.off('remove', onRemove);
    map.off('move', syncFlatBuildings);
    streetLights?.dispose();
    buildings?.dispose();
    vegetation?.dispose();
    streetLights = undefined;
    buildings = undefined;
    vegetation = undefined;
  }

  function restyle(): void {
    if (syncing) return;
    footprintLayers = undefined;
    declarations = undefined;
    authoredPerspective = undefined;
    sync();
  }

  function onRemove(): void {
    flatBuildings.forget();
    dispose();
  }

  map.on('styledata', restyle);
  map.on('style.load', restyle);
  map.on('idle', sync);
  map.on('remove', onRemove);
  map.on('move', syncFlatBuildings);
  sync();

  return {
    show: (transition) => change('3d', transition),
    hide: (transition) => change('2d', transition),
    get viewMode() {
      return viewMode;
    },
    setVegetation(visible) {
      vegetationVisible = visible;
      vegetation?.setVisible(visible);
    },
    setAdaptivePerspective(enabled) {
      adaptivePerspective = enabled;
      camera.setEnabled(viewMode === '3d' && (adaptivePerspective ?? authoredPerspective ?? false));
      sync();
    },
    get buildings() {
      return buildings;
    },
    get vegetation() {
      return vegetation;
    },
    get streetLights() {
      return streetLights;
    },
    dispose,
  };
}
