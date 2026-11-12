import type {Map as MapLibreMap, MapOptions} from 'maplibre-gl';
import {
  getTileflowSystemColorScheme,
  reportTileflowMapError,
  subscribeTileflowSystemColorScheme,
  type TileflowAppearanceInput,
  type TileflowMapError,
  type TileflowMapReadinessState,
  type TileflowNavigationControlInput,
  type TileflowThemeChangeOptions,
  type TileflowThemeController,
  type TileflowThemeTransition,
  type TileflowThemeTransitionResult,
  type TileflowViewMode,
} from './browser.js';
import {loadTileflowMapLibre} from './maplibre-loader';
import {mountTileflowMap, type TileflowMountedMap} from './maplibre-mount';
import {
  assertValidTileflowRuntimeSource,
  defaultTileflowManifestUrl,
  loadTileflowManifest,
  mergeTileflowAnalytics,
  normalizeTileflowRuntimeCenter,
  resolveTileflowManifestMap,
  resolveTileflowRuntimeStyle,
  resolveTileflowRuntimeView,
  type TileflowAnalytics,
  type TileflowRuntimeSource,
  type TileflowThemeSelection,
  type TileflowTimeOfDay,
} from './runtime.js';

export {
  configureTileflowMapLibre,
  loadTileflowMapLibre,
  type TileflowMapLibre,
  type TileflowMapLibreConfiguration,
} from './maplibre-loader';
export {
  mountTileflowMap,
  type TileflowMapMountOptions,
  type TileflowMapSettings,
  type TileflowMountedMap,
} from './maplibre-mount';

/** Options for a managed Tileflow map without a UI framework. */
export type CreateTileflowMapOptions = TileflowAppearanceInput & {
  container: HTMLElement;
  source: TileflowRuntimeSource;
  center?: [number, number];
  zoom?: number;
  theme?: TileflowThemeSelection;
  timeOfDay?: TileflowTimeOfDay;
  mapOptions?: Omit<MapOptions, 'container' | 'style'>;
  analytics?: TileflowAnalytics;
  vegetation?: boolean;
  viewMode?: TileflowViewMode;
  navigationControl?: TileflowNavigationControlInput;
  /** Aborting cancels preparation or disposes the mounted map. */
  signal?: AbortSignal;
  onError?: (event: TileflowMapError) => void;
  onLoad?: (map: MapLibreMap) => void;
  onState?: (state: TileflowMapReadinessState) => void;
  onThemeChange?: (transition: TileflowThemeTransition) => void;
};

/** Tileflow owns the style and lifetime; use the MapLibre instance for application extensions. */
export type TileflowMap = {
  getMap(): MapLibreMap | null;
  getThemeController(): TileflowThemeController | null;
  setTheme(
    theme: TileflowThemeSelection,
    options?: TileflowThemeChangeOptions,
  ): Promise<TileflowThemeTransitionResult>;
  setAppearance(appearance: TileflowAppearanceInput, options?: TileflowThemeChangeOptions): void;
  setViewMode(mode: TileflowViewMode): void;
  setVegetation(visible: boolean | undefined): void;
  /** Releases the map and all Tileflow resources. Repeated calls are safe. */
  dispose(): void;
};

/**
 * Resolves a prepared named map and uses the same browser mount as React, Vue and Svelte.
 * The promise resolves after setup; onLoad follows MapLibre's load event. For another source,
 * dispose this handle and create the next map. Use signal to cancel a creation still in flight.
 */
export async function createTileflowMap(options: CreateTileflowMapOptions): Promise<TileflowMap> {
  assertValidTileflowRuntimeSource(options.source);
  options.signal?.throwIfAborted();
  const report = (code: TileflowMapError['code'], error: unknown) =>
    reportTileflowMapError(options.onError, code, error);
  let mounted: TileflowMountedMap | undefined;
  let disposed = false;
  let unsubscribeSystemTheme: (() => void) | undefined;
  let selection = options.theme;
  let confirmedSelection = selection;
  let applySystemTheme: (() => void) | undefined;
  let selectionRevision = 0;
  let selectionPending = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeSystemTheme?.();
    options.signal?.removeEventListener('abort', dispose);
    mounted?.map.off('remove', dispose);
    mounted?.dispose();
  };

  let phase: TileflowMapError['code'] = 'manifest';
  try {
    const manifest = await loadTileflowManifest(
      options.source.manifestUrl ?? defaultTileflowManifestUrl,
      {signal: options.signal},
    );
    options.signal?.throwIfAborted();
    const manifestMap = manifest && resolveTileflowManifestMap(manifest, options.source.map);
    if (!manifestMap)
      throw new Error(`Tileflow map "${options.source.map}" is missing from its manifest.`);
    phase = 'theme';
    const resolveTheme = (theme: TileflowThemeSelection | undefined) =>
      resolveTileflowRuntimeStyle({
        source: options.source,
        manifestMap,
        theme,
        timeOfDay: options.timeOfDay,
        colorScheme: getTileflowSystemColorScheme(),
      })!;
    unsubscribeSystemTheme = subscribeTileflowSystemColorScheme(() => {
      if (selection === 'system' && !disposed) applySystemTheme?.();
    });
    const runtimeStyle = resolveTheme(selection);
    const view = resolveTileflowRuntimeView({
      manifestMap,
      center:
        options.center ??
        (options.mapOptions?.center === undefined
          ? undefined
          : normalizeTileflowRuntimeCenter(options.mapOptions.center)),
      zoom: options.zoom ?? options.mapOptions?.zoom,
      bearing: options.mapOptions?.bearing,
      pitch: options.mapOptions?.pitch,
    });
    phase = 'runtime';
    mounted = await mountTileflowMap({
      container: options.container,
      runtimeStyle,
      mapName: options.source.map,
      source: 'javascript',
      loadMapLibre: loadTileflowMapLibre,
      loadScene: () => import('./3d.js'),
      signal: options.signal,
      getAnalytics: () =>
        mergeTileflowAnalytics(
          options.analytics,
          mounted?.themeController?.getCurrent().analytics ?? runtimeStyle.analytics,
        ),
      settings: {
        mapOptions: {
          ...options.mapOptions,
          ...view,
          center:
            view.center === undefined ? undefined : normalizeTileflowRuntimeCenter(view.center),
        },
        appearance: {colors: options.colors, emphasis: options.emphasis},
        vegetation: options.vegetation,
        viewMode: options.viewMode,
        navigationControl: options.navigationControl,
      },
      onError: options.onError,
      onLoad: options.onLoad,
      onState: options.onState,
      onThemeChange: options.onThemeChange,
    });
    options.signal?.throwIfAborted();
    const runtime = mounted;
    runtime.map.on('remove', dispose);
    const setTheme: TileflowMap['setTheme'] = async (theme, changeOptions) => {
      if (disposed || !runtime.themeController) return {status: 'superseded'};
      const revision = ++selectionRevision;
      selectionPending = true;
      try {
        const next = resolveTheme(theme);
        selection = theme;
        const result = await runtime.themeController.setTheme(next, changeOptions);
        if (revision === selectionRevision) selectionPending = false;
        if (result.status === 'applied') {
          confirmedSelection = theme;
          if (!selectionPending) selection = theme;
        } else if (revision === selectionRevision) selection = confirmedSelection;
        if (result.status === 'failed') {
          report('theme', result.error ?? new Error('The map theme could not be changed.'));
        }
        return result;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (revision === selectionRevision) {
          selectionPending = false;
          selection = confirmedSelection;
        }
        report('theme', error);
        return {status: 'failed', error};
      }
    };
    applySystemTheme = () => {
      void setTheme('system');
    };
    options.signal?.addEventListener('abort', dispose, {once: true});
    if (
      selection === 'system' &&
      resolveTheme('system').theme !== runtime.themeController?.getCurrent().theme
    ) {
      void setTheme('system', {transition: {duration: 0}});
    }
    options.signal?.throwIfAborted();
    return {
      getMap: () => (disposed ? null : runtime.map),
      getThemeController: () => (disposed ? null : (runtime.themeController ?? null)),
      setTheme,
      setAppearance: (appearance, changeOptions) => {
        if (!disposed) runtime.appearance?.update(appearance, changeOptions);
      },
      setViewMode: (mode) => {
        if (!disposed) runtime.scene.setViewMode(mode);
      },
      setVegetation: (visible) => {
        if (!disposed) runtime.scene.setVegetation(visible);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    if (!options.signal?.aborted) report(phase, error);
    throw error;
  }
}
