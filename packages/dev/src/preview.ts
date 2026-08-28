import {
  defaultTileflowRuntimeView,
  type NormalizedTileflowCaptureScene,
  normalizeTileflowCaptureScene,
  parseResolvedTileflowMap,
  resolveThemeSelection,
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
  theme?: string;
};

export type ResolvedTileflowPreview = {
  camera: NormalizedTileflowCaptureScene['camera'];
  label: string;
  mapName: string;
  themeName: string;
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
    if (selection.theme !== undefined) {
      throw new TileflowPreviewSelectionError(
        'A committed Tileflow scene owns its concrete theme; do not combine scene and theme selection.',
      );
    }
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

    const map = parseResolvedTileflowMap(project.maps[normalized.map]!);
    const selectedTheme = resolvePreviewTheme(map, normalized.theme);
    return {
      camera: normalized.camera,
      label: `${normalized.map} / ${selectedTheme.name} / ${selection.scene} · ${normalized.viewport.width}×${normalized.viewport.height}`,
      mapName: normalized.map,
      themeName: selectedTheme.name,
      viewport: normalized.viewport,
    };
  }

  const mapName = selection.map ?? getFirstTileflowMapName(project);
  const map = Object.hasOwn(project.maps, mapName) ? project.maps[mapName] : undefined;

  if (!map) {
    throw new TileflowPreviewSelectionError(`Unknown Tileflow map: ${mapName}`);
  }

  const resolvedMap = parseResolvedTileflowMap(map);
  const selectedTheme = resolvePreviewTheme(resolvedMap, selection.theme);
  return {
    camera: {
      type: 'center',
      center: resolvedMap.view?.center
        ? [resolvedMap.view.center[0], resolvedMap.view.center[1]]
        : [defaultTileflowRuntimeView.center[0], defaultTileflowRuntimeView.center[1]],
      zoom: resolvedMap.view?.zoom ?? defaultTileflowRuntimeView.zoom,
      bearing: resolvedMap.view?.bearing ?? defaultTileflowRuntimeView.bearing,
      pitch: resolvedMap.view?.pitch ?? defaultTileflowRuntimeView.pitch,
    },
    label: `${mapName} / ${selectedTheme.name}`,
    mapName,
    themeName: selectedTheme.name,
  };
}

function resolvePreviewTheme(
  map: ReturnType<typeof parseResolvedTileflowMap>,
  requested: string | undefined,
): ReturnType<typeof resolveThemeSelection> {
  try {
    return resolveThemeSelection(map, requested);
  } catch {
    const available = Object.keys(map.themes).sort().join(', ');
    throw new TileflowPreviewSelectionError(
      `Tileflow theme selection is invalid or unknown. Choose one of: ${available}.`,
    );
  }
}
