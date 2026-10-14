import {resolve} from 'node:path';
import {
  compareCodeUnits,
  type MapLibreStyle,
  type NormalizedTileflowCaptureScene,
  type NormalizedTileflowCaptureShot,
  normalizeTileflowCaptureScene,
  normalizeTileflowCaptureShot,
  parseResolvedTileflowMap,
  resolveThemeSelection,
  serializeCanonicalJson,
  sha256Hex,
  type TileflowCaptureScene,
  tileflowCaptureSceneNameSchema,
  tileflowCaptureShotNameSchema,
} from '@tileflow/core';
import {
  createTileflowBuildArtifacts,
  defaultTileflowConfigPath,
  type TileflowBuildArtifacts,
  type TileflowIconResolutionOptions,
} from '@tileflow/dev/artifacts';
import {assertValidTileflowStyle, TileflowStyleValidationError} from '@tileflow/dev/validation';
import {captureApplicationTileflowScene, resolveTileflowApplicationUrl} from './application';
import {type TileflowBrowserInstallProgress, TileflowCaptureBrowserManager} from './browser';
import {TileflowCaptureError} from './errors';
import {
  createTileflowCaptureRendererIdentity,
  type TileflowCaptureRendererIdentity,
} from './metadata';
import {createTileflowCaptureReceipt, type TileflowCaptureReceipt} from './receipt';
import {
  renderTileflowShot,
  type TileflowShotCapture,
  type TileflowShotFormat,
  type TileflowShotFrame,
} from './shot';
import {captureStandaloneTileflowScene, tileflowSyntheticAssetOrigin} from './standalone';
import {type PreparedTileflowCaptureStyle, TileflowCaptureWorldSession} from './world';

export const tileflowCaptureResultSchemaVersion = 1 as const;

export type TileflowCaptureOptions = {
  allowBrowserInstall?: boolean;
  appOrigin?: string;
  appUrl?: string;
  config?: string;
  cwd?: string;
  /**
   * Explicit shared Icon Set resolution settings.
   *
   * These choose the verified cache root, offline behavior, trusted delivery origins and the
   * transport used to hydrate exact locked pins. No build resolves a catalog head.
   */
  icons?: TileflowIconResolutionOptions;

  onBrowserInstallProgress?: (progress: TileflowBrowserInstallProgress) => void;
  frame?: 'map' | 'viewport';
  scenes: string[];
  signal?: AbortSignal;
  selector?: string;
  timeoutMs?: number;
};

export type CreateTileflowCaptureSessionOptions = Omit<TileflowCaptureOptions, 'scenes'>;

export type TileflowCapture = {
  /** Concrete normalized frame retained for later review without rendering again. */
  definition?: NormalizedTileflowCaptureScene & {theme: string};
  scene: string;
  map: string;
  theme: string;
  target: 'map' | 'application';
  png: Uint8Array;
  sha256: string;
  sceneSha256: string;
  styleSha256: string;
  width: number;
  height: number;
  dpr: 1 | 2;
  networkDependent: boolean;
  renderer: TileflowCaptureRendererIdentity;
  /** Newly captured evidence is always the concrete-theme receipt contract. */
  receipt: TileflowCaptureReceipt;
  warnings: string[];
};

export type TileflowCaptureResult = {
  schemaVersion: 1;
  captures: TileflowCapture[];
};

export type TileflowShotCaptureOptions = {
  /** `webm` (the default) encodes a VP9 or VP8 video; `frames` delivers only PNG frames. */
  format?: TileflowShotFormat;
  /** Receives each frame's PNG in order while the shot renders. */
  onFrame?: (frame: TileflowShotFrame) => Promise<void> | void;
  signal?: AbortSignal;
};

export type TileflowShotCaptureResult = {
  schemaVersion: 1;
  shots: TileflowShotCapture[];
};

export type CaptureTileflowShotOptions = CreateTileflowCaptureSessionOptions &
  Omit<TileflowShotCaptureOptions, 'signal'> & {shot: string};

export type TileflowCaptureSession = {
  capture(scenes: string[], signal?: AbortSignal): Promise<TileflowCaptureResult>;
  captureAll(signal?: AbortSignal): Promise<TileflowCaptureResult>;
  captureDefinitions(
    scenes: Record<string, TileflowCaptureScene>,
    signal?: AbortSignal,
  ): Promise<TileflowCaptureResult>;
  captureArtifacts(
    artifacts: TileflowBuildArtifacts,
    requestedScenes: string[],
    signal?: AbortSignal,
  ): Promise<TileflowCaptureResult>;
  /** Renders one committed shot. */
  captureShot(shot: string, options?: TileflowShotCaptureOptions): Promise<TileflowShotCapture>;
  /** Renders committed shots in name order from one compiled artifact snapshot. */
  captureShots(
    shots: string[],
    options?: TileflowShotCaptureOptions,
  ): Promise<TileflowShotCaptureResult>;
  captureAllShots(options?: TileflowShotCaptureOptions): Promise<TileflowShotCaptureResult>;
  close(): Promise<void>;
};

export async function captureTileflowScenes(
  options: TileflowCaptureOptions,
): Promise<TileflowCaptureResult> {
  const session = createTileflowCaptureSession(options);

  try {
    return await session.capture(options.scenes, options.signal);
  } finally {
    await session.close();
  }
}

/** Renders one committed shot with a temporary session. */
export async function captureTileflowShot(
  options: CaptureTileflowShotOptions,
): Promise<TileflowShotCapture> {
  const {format, onFrame, shot, ...sessionOptions} = options;
  const session = createTileflowCaptureSession(sessionOptions);

  try {
    return await session.captureShot(shot, {
      ...(format ? {format} : {}),
      ...(onFrame ? {onFrame} : {}),
    });
  } finally {
    await session.close();
  }
}

export function createTileflowCaptureSession(
  options: CreateTileflowCaptureSessionOptions = {},
): TileflowCaptureSession {
  return new TileflowCaptureSessionImpl(options);
}

export class TileflowCaptureSessionImpl implements TileflowCaptureSession {
  readonly #options: CreateTileflowCaptureSessionOptions;
  readonly #browserManager: TileflowCaptureBrowserManager;
  readonly #worldSession: TileflowCaptureWorldSession;
  #closed = false;

  constructor(options: CreateTileflowCaptureSessionOptions = {}) {
    this.#options = options;
    this.#browserManager = new TileflowCaptureBrowserManager({
      allowInstall: options.allowBrowserInstall,
      onInstallProgress: options.onBrowserInstallProgress,
      signal: options.signal,
    });
    this.#worldSession = new TileflowCaptureWorldSession();
  }

  async capture(scenes: string[], signal?: AbortSignal): Promise<TileflowCaptureResult> {
    this.#assertOpen();

    const artifacts = await this.#createArtifacts();
    try {
      return await this.captureArtifacts(artifacts, scenes, signal ?? this.#options.signal);
    } finally {
      await disposeCaptureArtifacts(artifacts);
    }
  }

  async captureAll(signal?: AbortSignal): Promise<TileflowCaptureResult> {
    this.#assertOpen();
    const artifacts = await this.#createArtifacts();
    try {
      return await this.captureArtifacts(
        artifacts,
        Object.keys(artifacts.project.scenes ?? {}),
        signal ?? this.#options.signal,
      );
    } finally {
      await disposeCaptureArtifacts(artifacts);
    }
  }

  async captureDefinitions(
    scenes: Record<string, TileflowCaptureScene>,
    signal?: AbortSignal,
  ): Promise<TileflowCaptureResult> {
    this.#assertOpen();
    const artifacts = await this.#createArtifacts();
    const withDefinitions: TileflowBuildArtifacts = {
      ...artifacts,
      project: {...artifacts.project, scenes},
    };
    try {
      return await this.captureArtifacts(
        withDefinitions,
        Object.keys(scenes),
        signal ?? this.#options.signal,
      );
    } finally {
      await disposeCaptureArtifacts(artifacts);
    }
  }

  async captureArtifacts(
    artifacts: TileflowBuildArtifacts,
    requestedScenes: string[],
    signal?: AbortSignal,
  ): Promise<TileflowCaptureResult> {
    this.#assertOpen();
    const sceneNames = selectTileflowCaptureSceneNames(artifacts, requestedScenes);
    const validatedStyles = new Set<string>();
    const preparedStyles = new Map<string, PreparedTileflowCaptureStyle>();

    for (const sceneName of sceneNames) {
      const scene = this.#resolveScene(artifacts, sceneName);
      if (
        scene.target.kind === 'application' &&
        !this.#options.appOrigin &&
        !this.#options.appUrl
      ) {
        throw new TileflowCaptureError(
          'APPLICATION_ORIGIN_REQUIRED',
          `Scene "${sceneName}" requires --app-origin or TILEFLOW_APP_ORIGIN.`,
        );
      }
      const style = artifacts.styles[scene.map]?.[scene.theme];
      if (!style) {
        throw new TileflowCaptureError(
          'SCENE_NOT_FOUND',
          `Scene "${sceneName}" references unavailable theme "${scene.theme}" on map "${scene.map}".`,
        );
      }
      const styleKey = `${scene.map}/${scene.theme}`;
      if (!validatedStyles.has(styleKey)) {
        const prepared = await this.#worldSession.prepare(style, signal);
        try {
          assertValidTileflowStyle(prepared.style, styleKey);
        } catch (error) {
          throwCaptureStyleValidationError(error);
        }
        preparedStyles.set(styleKey, prepared);
        validatedStyles.add(styleKey);
      }
    }

    throwIfAborted(signal);
    const browser = await this.#browserManager.getBrowser(signal);
    const renderer = createTileflowCaptureRendererIdentity(browser);
    const captures: TileflowCapture[] = [];

    for (const sceneName of sceneNames) {
      throwIfAborted(signal);
      const scene = this.#resolveScene(artifacts, sceneName);
      const prepared = preparedStyles.get(`${scene.map}/${scene.theme}`);
      const style = prepared?.style;

      if (!style || !prepared) {
        throw new TileflowCaptureError(
          'SCENE_NOT_FOUND',
          `Scene "${sceneName}" references unavailable map "${scene.map}".`,
        );
      }

      const colorScheme = resolveThemeSelection(
        parseResolvedTileflowMap(artifacts.project.maps[scene.map]!),
        scene.theme,
      ).theme.colorScheme;

      const rendered =
        scene.target.kind === 'application'
          ? await captureApplicationTileflowScene({
              appOrigin: this.#options.appOrigin,
              appUrl: this.#options.appUrl,
              browser,
              colorScheme,
              scene: {...scene, target: scene.target},
              signal,
              timeoutMs: this.#options.timeoutMs,
            })
          : await captureStandaloneTileflowScene({
              assets: [...artifacts.assets, ...(prepared.assets ?? [])],
              browser,
              ...(artifacts.localTilesets ? {localTilesets: artifacts.localTilesets} : {}),
              ...(artifacts.lineBackgroundGlyphs
                ? {
                    glyphCacheDirectory: resolve(this.#options.cwd ?? process.cwd()),
                    lineBackgroundGlyphs: artifacts.lineBackgroundGlyphs,
                  }
                : {}),
              scene,
              signal,
              style,
              timeoutMs: this.#options.timeoutMs,
            });
      const [sha256, sceneSha256, styleSha256] = await Promise.all([
        sha256Hex(rendered.png),
        sha256Hex(serializeCanonicalJson(scene)),
        sha256Hex(serializeCanonicalJson(style)),
      ]);
      const target = scene.target.kind;
      const receipt = createTileflowCaptureReceipt({
        data: prepared.data,
        dpr: scene.viewport.dpr,
        height: rendered.height,
        map: scene.map,
        theme: scene.theme,
        networkDependent: rendered.networkDependent,
        pngSha256: sha256,
        renderer,
        scene: sceneName,
        sceneSha256,
        styleSha256,
        target,
        width: rendered.width,
      });

      captures.push({
        definition: scene,
        scene: sceneName,
        map: scene.map,
        theme: scene.theme,
        target,
        png: rendered.png,
        sha256,
        sceneSha256,
        styleSha256,
        width: rendered.width,
        height: rendered.height,
        dpr: scene.viewport.dpr,
        networkDependent: rendered.networkDependent,
        renderer,
        receipt,
        warnings: rendered.warnings.sort(compareCodeUnits),
      });
    }

    return {schemaVersion: tileflowCaptureResultSchemaVersion, captures};
  }

  async captureShot(
    shot: string,
    options: TileflowShotCaptureOptions = {},
  ): Promise<TileflowShotCapture> {
    const result = await this.captureShots([shot], options);
    return result.shots[0]!;
  }

  async captureAllShots(
    options: TileflowShotCaptureOptions = {},
  ): Promise<TileflowShotCaptureResult> {
    this.#assertOpen();
    const artifacts = await this.#createArtifacts();
    try {
      return await this.#captureShotArtifacts(
        artifacts,
        Object.keys(artifacts.project.shots ?? {}),
        options,
      );
    } finally {
      await disposeCaptureArtifacts(artifacts);
    }
  }

  async captureShots(
    shots: string[],
    options: TileflowShotCaptureOptions = {},
  ): Promise<TileflowShotCaptureResult> {
    this.#assertOpen();
    const artifacts = await this.#createArtifacts();
    try {
      return await this.#captureShotArtifacts(artifacts, shots, options);
    } finally {
      await disposeCaptureArtifacts(artifacts);
    }
  }

  async #captureShotArtifacts(
    artifacts: TileflowBuildArtifacts,
    requestedShots: string[],
    options: TileflowShotCaptureOptions,
  ): Promise<TileflowShotCaptureResult> {
    const signal = options.signal ?? this.#options.signal;
    const format = options.format ?? 'webm';
    if (format !== 'webm' && format !== 'frames') {
      throw new TypeError('Expected shot format "webm" or "frames".');
    }
    const shotNames = selectTileflowCaptureShotNames(artifacts, requestedShots);
    const resolved: Array<{
      name: string;
      prepared: PreparedTileflowCaptureStyle[];
      shot: NormalizedTileflowCaptureShot;
      styles: Record<string, MapLibreStyle>;
    }> = [];
    const preparedStyles = new Map<string, PreparedTileflowCaptureStyle>();

    for (const name of shotNames) {
      const shot = normalizeShot(artifacts, name);
      const themes = [...new Set([shot.theme, ...(shot.keyframes[0]?.blend?.themes ?? [])])];
      const styles: Record<string, MapLibreStyle> = {};
      const prepared: PreparedTileflowCaptureStyle[] = [];
      for (const theme of themes) {
        const styleKey = `${shot.map}/${theme}`;
        let preparedStyle = preparedStyles.get(styleKey);
        if (!preparedStyle) {
          const style = artifacts.styles[shot.map]?.[theme];
          if (!style) {
            throw new TileflowCaptureError(
              'SHOT_NOT_FOUND',
              `Shot "${name}" references unavailable theme "${theme}" on map "${shot.map}".`,
            );
          }
          preparedStyle = await this.#worldSession.prepare(style, signal);
          try {
            assertValidTileflowStyle(preparedStyle.style, styleKey);
          } catch (error) {
            throwCaptureStyleValidationError(error);
          }
          preparedStyles.set(styleKey, preparedStyle);
        }
        styles[theme] = preparedStyle.style;
        prepared.push(preparedStyle);
      }
      resolved.push({name, prepared, shot, styles});
    }

    throwIfAborted(signal);
    const browser = await this.#browserManager.getBrowser(signal);
    const renderer = createTileflowCaptureRendererIdentity(browser);
    const shots: TileflowShotCapture[] = [];

    for (const {name, prepared, shot, styles} of resolved) {
      throwIfAborted(signal);
      const capture = await renderTileflowShot({
        assets: [...artifacts.assets, ...prepared.flatMap((style) => style.assets ?? [])],
        browser,
        data: prepared[0]!.data,
        format,
        ...(artifacts.localTilesets ? {localTilesets: artifacts.localTilesets} : {}),
        ...(artifacts.lineBackgroundGlyphs
          ? {
              glyphCacheDirectory: resolve(this.#options.cwd ?? process.cwd()),
              lineBackgroundGlyphs: artifacts.lineBackgroundGlyphs,
            }
          : {}),
        name,
        ...(options.onFrame ? {onFrame: options.onFrame} : {}),
        renderer,
        shot,
        ...(signal ? {signal} : {}),
        styles,
        ...(this.#options.timeoutMs === undefined ? {} : {timeoutMs: this.#options.timeoutMs}),
      });
      shots.push({...capture, warnings: [...capture.warnings].sort(compareCodeUnits)});
    }

    return {schemaVersion: tileflowCaptureResultSchemaVersion, shots};
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    await this.#browserManager.close();
  }

  async #createArtifacts(): Promise<TileflowBuildArtifacts> {
    const cwd = resolve(this.#options.cwd ?? process.cwd());
    try {
      const artifacts = await createTileflowBuildArtifacts({
        assetBaseUrl: tileflowSyntheticAssetOrigin,
        config: this.#options.config ?? defaultTileflowConfigPath,
        cwd,
        ...(this.#options.icons ? {icons: this.#options.icons} : {}),
      });
      return artifacts;
    } catch (error) {
      return throwCaptureStyleValidationError(error);
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new TileflowCaptureError('BROWSER_START_FAILED', 'Tileflow capture session is closed.');
    }
  }

  #resolveScene(
    artifacts: TileflowBuildArtifacts,
    sceneName: string,
  ): NormalizedTileflowCaptureScene & {theme: string} {
    const scene = normalizeScene(artifacts, sceneName);
    const hasApplicationOverrides =
      this.#options.appUrl !== undefined ||
      this.#options.selector !== undefined ||
      this.#options.frame !== undefined;

    if (!hasApplicationOverrides) return scene;
    if (scene.target.kind !== 'application' && !this.#options.appUrl) {
      throw new TileflowCaptureError(
        'APPLICATION_ORIGIN_REQUIRED',
        'Application selector/frame overrides require an application scene or --url.',
      );
    }

    const existing = scene.target.kind === 'application' ? scene.target : undefined;
    let path = existing?.path ?? '/';
    if (this.#options.appUrl) {
      const resolved = resolveTileflowApplicationUrl({appUrl: this.#options.appUrl, path});
      const url = new URL(resolved.url);
      path = `${url.pathname}${url.search}`;
    }
    const selector = this.#options.selector ?? existing?.selector;
    const captureId = this.#options.selector ? undefined : existing?.captureId;

    return {
      ...scene,
      target: {
        kind: 'application',
        path,
        ...(captureId ? {captureId} : {}),
        ...(selector ? {selector} : {}),
        frame: this.#options.frame ?? existing?.frame ?? 'map',
      },
    };
  }
}

async function disposeCaptureArtifacts(
  artifacts: Pick<TileflowBuildArtifacts, 'dispose'>,
): Promise<void> {
  const dispose = artifacts.dispose;
  artifacts.dispose = undefined;
  await dispose?.();
}

export function selectTileflowCaptureSceneNames(
  artifacts: Pick<TileflowBuildArtifacts, 'project'>,
  requestedScenes: readonly string[],
): string[] {
  const availableScenes = Object.keys(artifacts.project.scenes ?? {})
    .filter((sceneName) => tileflowCaptureSceneNameSchema.safeParse(sceneName).success)
    .sort(compareCodeUnits);
  const sceneNames = [...new Set(requestedScenes)].sort(compareCodeUnits);

  if (sceneNames.length === 0) {
    throw new TileflowCaptureError(
      'SCENE_NOT_FOUND',
      'Select at least one capture scene or request every configured scene explicitly.',
    );
  }

  for (const sceneName of sceneNames) {
    if (!tileflowCaptureSceneNameSchema.safeParse(sceneName).success) {
      throw new TileflowCaptureError(
        'SCENE_NOT_FOUND',
        'Expected a portable Tileflow capture scene name.',
      );
    }
    if (!Object.hasOwn(artifacts.project.scenes ?? {}, sceneName)) {
      const suffix =
        availableScenes.length > 0
          ? ` Available scenes: ${availableScenes.join(', ')}.`
          : ' The config defines no capture scenes.';
      throw new TileflowCaptureError(
        'SCENE_NOT_FOUND',
        `Unknown Tileflow capture scene "${sceneName}".${suffix}`,
      );
    }
  }

  return sceneNames;
}

export function selectTileflowCaptureShotNames(
  artifacts: Pick<TileflowBuildArtifacts, 'project'>,
  requestedShots: readonly string[],
): string[] {
  const availableShots = Object.keys(artifacts.project.shots ?? {})
    .filter((shotName) => tileflowCaptureShotNameSchema.safeParse(shotName).success)
    .sort(compareCodeUnits);
  const shotNames = [...new Set(requestedShots)].sort(compareCodeUnits);

  if (shotNames.length === 0) {
    throw new TileflowCaptureError(
      'SHOT_NOT_FOUND',
      'Select at least one capture shot or request every configured shot explicitly.',
    );
  }

  for (const shotName of shotNames) {
    if (!tileflowCaptureShotNameSchema.safeParse(shotName).success) {
      throw new TileflowCaptureError('SHOT_NOT_FOUND', 'Expected a portable Tileflow shot name.');
    }
    if (!Object.hasOwn(artifacts.project.shots ?? {}, shotName)) {
      const suffix =
        availableShots.length > 0
          ? ` Available shots: ${availableShots.join(', ')}.`
          : ' The config defines no capture shots.';
      throw new TileflowCaptureError(
        'SHOT_NOT_FOUND',
        `Unknown Tileflow capture shot "${shotName}".${suffix}`,
      );
    }
  }

  return shotNames;
}

function normalizeShot(
  artifacts: Pick<TileflowBuildArtifacts, 'project'>,
  shotName: string,
): NormalizedTileflowCaptureShot {
  const shot = artifacts.project.shots![shotName]!;
  const normalized = normalizeTileflowCaptureShot(shot);
  const resolvedMap = artifacts.project.maps[normalized.map];
  if (!resolvedMap) {
    throw new TileflowCaptureError(
      'SHOT_NOT_FOUND',
      `Shot "${shotName}" references unavailable map "${normalized.map}".`,
    );
  }
  const map = parseResolvedTileflowMap(resolvedMap);
  for (const theme of [normalized.theme, ...(normalized.keyframes[0]?.blend?.themes ?? [])]) {
    try {
      resolveThemeSelection(map, theme);
    } catch (error) {
      throw new TileflowCaptureError(
        'SHOT_NOT_FOUND',
        `Shot "${shotName}" has an invalid theme: ${error instanceof Error ? error.message : 'unknown theme'}`,
        {cause: error},
      );
    }
  }
  return normalized;
}

function normalizeScene(
  artifacts: Pick<TileflowBuildArtifacts, 'project'>,
  sceneName: string,
): NormalizedTileflowCaptureScene & {theme: string} {
  const scene = Object.hasOwn(artifacts.project.scenes ?? {}, sceneName)
    ? artifacts.project.scenes?.[sceneName]
    : undefined;

  if (!scene) {
    throw new TileflowCaptureError('SCENE_NOT_FOUND', `Unknown Tileflow scene "${sceneName}".`);
  }

  const normalized = normalizeTileflowCaptureScene(scene);
  const resolvedMap = artifacts.project.maps[normalized.map];
  if (!resolvedMap) {
    throw new TileflowCaptureError(
      'SCENE_NOT_FOUND',
      `Scene "${sceneName}" references unavailable map "${normalized.map}".`,
    );
  }
  const map = parseResolvedTileflowMap(resolvedMap);
  let theme: string;
  try {
    theme = resolveThemeSelection(map, normalized.theme).name;
  } catch (error) {
    throw new TileflowCaptureError(
      'SCENE_NOT_FOUND',
      `Scene "${sceneName}" has an invalid theme: ${error instanceof Error ? error.message : 'unknown theme'}`,
      {cause: error},
    );
  }
  return {...normalized, theme};
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
  }
}

function throwCaptureStyleValidationError(error: unknown): never {
  if (error instanceof TileflowStyleValidationError) {
    throw new TileflowCaptureError('STYLE_INVALID', error.message, {
      cause: error,
      details: {
        diagnostics: error.issues,
        phase: 'style-validation',
      },
    });
  }
  throw error;
}
