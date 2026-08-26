import {
  defaultTileflowRuntimeView,
  type NormalizedTileflowCaptureScene,
  normalizeTileflowCaptureScene,
} from '@tileflow/core';
import type {TileflowBuildCatalog} from '@tileflow/core/build';
import {getFirstTileflowMapName} from './config';

export {renderTileflowPreviewHtml} from './preview-html';
export {
  normalizeTileflowLandmarkManifest,
  readBoundedTileflowJsonResponse,
  readBoundedTileflowResponse,
} from './landmarks';
export type {
  TileflowLandmark,
  TileflowLandmarkArchive,
  TileflowLandmarkAxisConvention,
  TileflowLandmarkManifestV2,
  TileflowLandmarkModel,
} from './landmarks';

export type TileflowPreviewSelection = {
  map?: string;
  scene?: string;
};

export type ResolvedTileflowPreview = {
  camera: NormalizedTileflowCaptureScene['camera'];
  label: string;
  mapName: string;
  viewport?: NormalizedTileflowCaptureScene['viewport'];
};

export class TileflowPreviewSelectionError extends Error {
  readonly code = 'PREVIEW_SELECTION_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'TileflowPreviewSelectionError';
  }
}

export function resolveTileflowPreview(
  project: TileflowBuildCatalog,
  selection: TileflowPreviewSelection = {},
): ResolvedTileflowPreview {
  if (selection.map !== undefined && selection.scene !== undefined) {
    throw new TileflowPreviewSelectionError(
      'Choose either a Tileflow preview map or scene, not both.',
    );
  }

  if (selection.scene !== undefined) {
    const scene = Object.hasOwn(project.scenes ?? {}, selection.scene)
      ? project.scenes?.[selection.scene]
      : undefined;

    if (!scene) {
      throw new TileflowPreviewSelectionError(`Unknown Tileflow scene: ${selection.scene}`);
    }

    const normalized = normalizeTileflowCaptureScene(scene);

    if (normalized.target.kind === 'application') {
      throw new TileflowPreviewSelectionError(
        `Tileflow scene "${selection.scene}" targets an application. Preview it through the application's development server.`,
      );
    }

    if (!Object.hasOwn(project.maps, normalized.map)) {
      throw new TileflowPreviewSelectionError(
        `Tileflow scene "${selection.scene}" references an unknown map: ${normalized.map}`,
      );
    }

    return {
      camera: normalized.camera,
      label: `${normalized.map} / ${selection.scene} · ${normalized.viewport.width}×${normalized.viewport.height}`,
      mapName: normalized.map,
      viewport: normalized.viewport,
    };
  }

  const mapName = selection.map ?? getFirstTileflowMapName(project);
  const map = Object.hasOwn(project.maps, mapName) ? project.maps[mapName] : undefined;

  if (!map) {
    throw new TileflowPreviewSelectionError(`Unknown Tileflow map: ${mapName}`);
  }

  return {
    camera: {
      type: 'center',
      center: map.view?.center
        ? [map.view.center[0], map.view.center[1]]
        : [defaultTileflowRuntimeView.center[0], defaultTileflowRuntimeView.center[1]],
      zoom: map.view?.zoom ?? defaultTileflowRuntimeView.zoom,
      bearing: map.view?.bearing ?? defaultTileflowRuntimeView.bearing,
      pitch: map.view?.pitch ?? defaultTileflowRuntimeView.pitch,
    },
    label: mapName,
    mapName,
  };
}
