import type {Browser} from 'playwright';
import {
  type MapLibreStyle,
  type NormalizedTileflowCaptureShot,
  serializeCanonicalJson,
  sha256Hex,
  tileflowCaptureShotFrames,
} from '@tileflow/core';
import {getTileflowStyleFontFaces, type TileflowStyleFontFace} from '@tileflow/core/runtime';
import type {
  TileflowLineBackgroundGlyphProviders,
  TileflowLocalTilesetFile,
} from '@tileflow/dev/artifacts';
import type {TileflowCaptureAsset} from './assets';
import {TileflowCaptureError} from './errors';
import type {TileflowCaptureRendererIdentity} from './metadata';
import {
  createTileflowShotReceipt,
  type TileflowCaptureDataInput,
  type TileflowShotReceiptV1,
} from './receipt';
import {
  openTileflowShotVideoEncoder,
  type TileflowShotVideoCodec,
  type TileflowShotVideoEncoder,
} from './shot-encoder';
import {assertValidCaptureStyle, withStandaloneTileflowPage} from './standalone';
import {writeTileflowWebm} from './webm';

export type TileflowShotFormat = 'frames' | 'webm';

/** One rendered frame, delivered in order while a shot renders. */
export type TileflowShotFrame = {
  shot: string;
  index: number;
  png: Uint8Array;
  sha256: string;
};

export type TileflowShotCapture = {
  shot: string;
  map: string;
  theme: string;
  format: TileflowShotFormat;
  /** WebM bytes for the `webm` format. Frames reach `onFrame` and are not retained. */
  video?: Uint8Array;
  codec?: TileflowShotVideoCodec;
  /** SHA-256 of the video, or of the frame set (`framesSha256`) for the `frames` format. */
  sha256: string;
  framesSha256: string;
  frameSha256s: string[];
  shotSha256: string;
  styleSha256: string;
  fps: NormalizedTileflowCaptureShot['fps'];
  frameCount: number;
  durationMs: number;
  width: number;
  height: number;
  dpr: 1 | 2;
  networkDependent: boolean;
  renderer: TileflowCaptureRendererIdentity;
  receipt: TileflowShotReceiptV1;
  warnings: string[];
};

export type RenderTileflowShotInput = Omit<StandaloneTileflowShotInput, 'onFrame'> & {
  data: TileflowCaptureDataInput;
  format: TileflowShotFormat;
  name: string;
  onFrame?: (frame: TileflowShotFrame) => Promise<void> | void;
  renderer: TileflowCaptureRendererIdentity;
};

export type StandaloneTileflowShotInput = {
  assets: TileflowCaptureAsset[];
  browser: Browser;
  /** Project root whose `.tileflow/cache` stores upstream glyph ranges. */
  glyphCacheDirectory?: string;
  /** Upstream glyph templates for maps whose text uses line-fitted backgrounds. */
  lineBackgroundGlyphs?: TileflowLineBackgroundGlyphProviders;
  localTilesets?: readonly TileflowLocalTilesetFile[];
  /** Receives each frame's PNG in order, before the next frame is rendered. */
  onFrame: (frame: {index: number; png: Uint8Array}) => Promise<void> | void;
  shot: NormalizedTileflowCaptureShot;
  signal?: AbortSignal;
  /** Compiled styles by concrete theme: the shot's theme and every blended theme. */
  styles: Readonly<Record<string, MapLibreStyle>>;
  /** Bounds page setup, the theme blend, and each frame separately. */
  timeoutMs?: number;
};

export type StandaloneTileflowShotOutput = {
  frameCount: number;
  height: number;
  networkDependent: boolean;
  warnings: string[];
  width: number;
};

/**
 * Renders a shot and returns its capture and receipt. A `webm` shot opens its encoder first, so a
 * browser without VP9 or VP8 encoding fails before the first frame.
 */
export async function renderTileflowShot(
  input: RenderTileflowShotInput,
): Promise<TileflowShotCapture> {
  const {shot} = input;
  const width = shot.viewport.width * shot.viewport.dpr;
  const height = shot.viewport.height * shot.viewport.dpr;
  let encoder: TileflowShotVideoEncoder | undefined;
  try {
    if (input.format === 'webm') {
      encoder = await openTileflowShotVideoEncoder({
        browser: input.browser,
        fps: shot.fps,
        height,
        ...(input.signal ? {signal: input.signal} : {}),
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
        width,
      });
    }
    const frameSha256s: string[] = [];
    const rendered = await captureStandaloneTileflowShot({
      ...input,
      onFrame: async ({index, png}) => {
        const sha256 = await sha256Hex(png);
        frameSha256s.push(sha256);
        await input.onFrame?.({index, png, sha256, shot: input.name});
        await encoder?.encode(index, png);
      },
    });
    const durationMs = shot.keyframes.at(-1)!.at;
    const framesSha256 = await tileflowShotFramesSha256(frameSha256s);
    const video = encoder
      ? writeTileflowWebm({
          chunks: await encoder.finish(),
          codec: encoder.codec,
          durationMs: (rendered.frameCount * 1_000) / shot.fps,
          fps: shot.fps,
          height,
          width,
        })
      : undefined;
    const blendThemes = shot.keyframes[0]?.blend?.themes;
    const styleHashes = new Map<string, string>();
    for (const theme of new Set([shot.theme, ...(blendThemes ?? [])])) {
      styleHashes.set(theme, await sha256Hex(serializeCanonicalJson(input.styles[theme])));
    }
    const [sha256, shotSha256] = await Promise.all([
      video ? sha256Hex(video) : Promise.resolve(framesSha256),
      sha256Hex(serializeCanonicalJson(shot)),
    ]);
    const styleSha256 = styleHashes.get(shot.theme)!;
    const receipt = createTileflowShotReceipt({
      ...(blendThemes
        ? {blend: blendThemes.map((name) => ({name, styleSha256: styleHashes.get(name)!}))}
        : {}),
      data: input.data,
      dpr: shot.viewport.dpr,
      durationMs,
      fps: shot.fps,
      frameCount: rendered.frameCount,
      framesSha256,
      height: rendered.height,
      map: shot.map,
      networkDependent: rendered.networkDependent,
      output: encoder ? {codec: encoder.codec, kind: 'webm', sha256} : {kind: 'frames', sha256},
      renderer: input.renderer,
      shot: input.name,
      shotSha256,
      styleSha256,
      theme: shot.theme,
      width: rendered.width,
    });

    return {
      shot: input.name,
      map: shot.map,
      theme: shot.theme,
      format: input.format,
      ...(video ? {video} : {}),
      ...(encoder ? {codec: encoder.codec} : {}),
      sha256,
      framesSha256,
      frameSha256s,
      shotSha256,
      styleSha256,
      fps: shot.fps,
      frameCount: rendered.frameCount,
      durationMs,
      width: rendered.width,
      height: rendered.height,
      dpr: shot.viewport.dpr,
      networkDependent: rendered.networkDependent,
      renderer: input.renderer,
      receipt,
      warnings: rendered.warnings,
    };
  } finally {
    await encoder?.close();
  }
}

/** SHA-256 of each frame's PNG SHA-256 in lowercase hex, one per line, in frame order. */
export function tileflowShotFramesSha256(frameSha256s: readonly string[]): Promise<string> {
  return sha256Hex(frameSha256s.map((sha256) => `${sha256}\n`).join(''));
}

/**
 * Renders every frame of a shot in one standalone page. Each frame moves the camera with `jumpTo`,
 * moves the blend position when the shot blends themes, and waits for MapLibre `idle` and two
 * animation frames before its screenshot, so a slow tile only delays the render.
 */
export async function captureStandaloneTileflowShot(
  input: StandaloneTileflowShotInput,
): Promise<StandaloneTileflowShotOutput> {
  const {shot} = input;
  const frames = tileflowCaptureShotFrames(shot);
  const blendThemes = shot.keyframes[0]?.blend?.themes;
  const themes = [...new Set([shot.theme, ...(blendThemes ?? [])])];
  const styles = themes.map((theme) => {
    const style = Object.hasOwn(input.styles, theme) ? input.styles[theme] : undefined;
    if (!style) {
      throw new TileflowCaptureError(
        'SHOT_NOT_FOUND',
        `Shot theme "${theme}" has no compiled style on map "${shot.map}".`,
      );
    }
    assertValidCaptureStyle(style, `${shot.map}/${theme}`);
    return [theme, pageStyle(style)] as const;
  });
  const pageStyles = Object.fromEntries(styles);

  return withStandaloneTileflowPage(
    {
      assets: input.assets,
      browser: input.browser,
      ...(input.glyphCacheDirectory ? {glyphCacheDirectory: input.glyphCacheDirectory} : {}),
      ...(input.lineBackgroundGlyphs ? {lineBackgroundGlyphs: input.lineBackgroundGlyphs} : {}),
      ...(input.localTilesets ? {localTilesets: input.localTilesets} : {}),
      ...(input.signal ? {signal: input.signal} : {}),
      style: pageStyles[shot.theme]!,
      ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      viewport: shot.viewport,
    },
    async (page) => {
      await page.load(uniqueFontFaces(styles.map(([, style]) => style)));
      if (blendThemes) {
        page.restartTimeout();
        await page.step('theme-blend', '__tileflowCapturePrepareBlend', {
          mapEventTimeoutMs: page.mapEventTimeoutMs,
          position: frames[0]?.blendPosition ?? 0,
          theme: shot.theme,
          themes: blendThemes.map((theme) => ({style: pageStyles[theme], theme})),
        });
      }

      for (const frame of frames) {
        page.restartTimeout();
        await page.step('map-idle', '__tileflowCaptureFrame', {
          blendPosition: frame.blendPosition,
          camera: frame.camera,
          mapEventTimeoutMs: page.mapEventTimeoutMs,
        });
        const png = await page.screenshot();
        await page.outside(async () => input.onFrame({index: frame.index, png}));
      }

      return {
        frameCount: frames.length,
        height: shot.viewport.height,
        width: shot.viewport.width,
        ...page.result(),
      };
    },
  );
}

/**
 * The style a shot page renders. Paint changes take effect at once instead of over MapLibre's
 * default 300 ms transition, so each frame shows its own blend position as soon as it is idle.
 */
function pageStyle(style: MapLibreStyle): MapLibreStyle {
  return {...style, transition: {delay: 0, duration: 0}} as MapLibreStyle;
}

function uniqueFontFaces(styles: readonly MapLibreStyle[]): TileflowStyleFontFace[] {
  const faces = new Map<string, TileflowStyleFontFace>();
  for (const style of styles) {
    for (const face of getTileflowStyleFontFaces(style) ?? []) {
      faces.set(JSON.stringify(face), face);
    }
  }
  return [...faces.values()];
}
