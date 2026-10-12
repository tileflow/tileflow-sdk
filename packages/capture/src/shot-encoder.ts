import type {Browser, BrowserContext, Page} from 'playwright';
import {tileflowSyntheticAssetOrigin} from './assets';
import {TileflowCaptureError} from './errors';

export type TileflowShotVideoCodec = 'vp8' | 'vp9';

export type TileflowShotEncodedChunk = {
  /** Microseconds from the start of the video. */
  timestamp: number;
  key: boolean;
  data: Uint8Array;
};

export type TileflowShotVideoEncoder = {
  readonly codec: TileflowShotVideoCodec;
  /** Encodes frame `index` from its PNG; frames must arrive in order. */
  encode(index: number, png: Uint8Array): Promise<void>;
  /** Flushes the encoder and returns every chunk in decoding order. */
  finish(): Promise<TileflowShotEncodedChunk[]>;
  close(): Promise<void>;
};

export type OpenTileflowShotVideoEncoderInput = {
  browser: Browser;
  fps: number;
  /** Physical frame height in pixels. */
  height: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Physical frame width in pixels. */
  width: number;
};

const encoderDocumentUrl = `${tileflowSyntheticAssetOrigin}/__tileflow/shot-encoder.html`;
const encoderFrameUrl = `${tileflowSyntheticAssetOrigin}/__tileflow/shot-frame.png`;

type EncoderPageResult =
  | {chunks: Array<{data: string; key: boolean; timestamp: number}>; status: 'ok'}
  | {message?: string; status: 'failed'};

/**
 * Opens a WebCodecs video encoder in its own browser context. Frames are decoded from the PNGs the
 * capture produced, so the video holds exactly the captured pixels. VP9 is preferred and VP8 is the
 * fallback; a browser that supports neither fails before any frame is rendered.
 */
export async function openTileflowShotVideoEncoder(
  input: OpenTileflowShotVideoEncoderInput,
): Promise<TileflowShotVideoEncoder> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  let context: BrowserContext | undefined;
  const state: {termination?: 'aborted' | 'timeout'} = {};
  let pendingPng: Uint8Array | undefined;
  const chunks: TileflowShotEncodedChunk[] = [];
  const onAbort = () => {
    state.termination = 'aborted';
    void context?.close().catch(() => undefined);
  };
  const close = async () => {
    input.signal?.removeEventListener('abort', onAbort);
    await context?.close().catch(() => undefined);
  };

  /** Runs one encoder step; a timeout or abort closes the context and fails the step. */
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    if (input.signal?.aborted || state.termination === 'aborted') {
      throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.');
    }
    const timeout = setTimeout(() => {
      state.termination = 'timeout';
      void context?.close().catch(() => undefined);
    }, timeoutMs);
    timeout.unref?.();
    try {
      return await work();
    } catch (error) {
      // The timer and abort listener set the reason while `work` is pending.
      const reason = state.termination as 'aborted' | 'timeout' | undefined;
      if (reason === 'aborted') {
        throw new TileflowCaptureError('ABORTED', 'Tileflow capture was aborted.', {cause: error});
      }
      if (reason === 'timeout') {
        throw new TileflowCaptureError(
          'CAPTURE_TIMEOUT',
          'Video encoding exceeded the capture timeout.',
          {cause: error, details: {phase: 'video-encode'}},
        );
      }
      if (error instanceof TileflowCaptureError) throw error;
      throw encodeFailed(undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  };

  let page: Page;
  let codec: TileflowShotVideoCodec;
  try {
    input.signal?.addEventListener('abort', onAbort, {once: true});
    const opened = await run(async () => {
      context = await input.browser.newContext({
        acceptDownloads: false,
        javaScriptEnabled: true,
        serviceWorkers: 'block',
        viewport: {height: 64, width: 64},
      });
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (url === encoderDocumentUrl) {
          await route.fulfill({
            body: '<!doctype html><html lang="en"><head><meta charset="utf-8" /></head><body></body></html>',
            contentType: 'text/html; charset=utf-8',
            status: 200,
          });
          return;
        }
        if (url === encoderFrameUrl && pendingPng) {
          await route.fulfill({
            body: Buffer.from(pendingPng),
            contentType: 'image/png',
            status: 200,
          });
          return;
        }
        await route.abort('blockedbyclient');
      });
      await context.routeWebSocket(/.*/, (socket) =>
        socket.close({code: 1008, reason: 'WebSockets are disabled during capture'}),
      );
      const encoderPage = await context.newPage();
      await encoderPage.goto(encoderDocumentUrl, {waitUntil: 'domcontentloaded'});
      await encoderPage.addScriptTag({content: encoderPageScript});
      const result = await encoderPage.evaluate(
        (config) =>
          (
            window as unknown as {
              __tileflowOpenShotEncoder: (
                value: typeof config,
              ) => Promise<{codec?: TileflowShotVideoCodec; message?: string; status: string}>;
            }
          ).__tileflowOpenShotEncoder(config),
        {
          bitrate: shotBitrate(input.width, input.height, input.fps),
          fps: input.fps,
          frameUrl: encoderFrameUrl,
          height: input.height,
          width: input.width,
        },
      );
      return {page: encoderPage, result};
    });
    page = opened.page;
    if (opened.result.status === 'unsupported' || !opened.result.codec) {
      throw new TileflowCaptureError(
        'VIDEO_ENCODER_UNAVAILABLE',
        `The capture browser cannot encode ${input.width}x${input.height} VP9 or VP8 video. Capture the shot with format "frames" instead.`,
        {details: {phase: 'video-encode'}},
      );
    }
    if (opened.result.status !== 'ok') throw encodeFailed(opened.result.message);
    codec = opened.result.codec;
  } catch (error) {
    await close();
    throw error;
  }

  const collect = (result: EncoderPageResult) => {
    if (result.status !== 'ok') throw encodeFailed(result.message);
    for (const chunk of result.chunks) {
      chunks.push({
        data: new Uint8Array(Buffer.from(chunk.data, 'base64')),
        key: chunk.key,
        timestamp: chunk.timestamp,
      });
    }
  };

  return {
    codec,
    async encode(index, png) {
      await run(async () => {
        pendingPng = png;
        try {
          collect(
            await page.evaluate(
              (frame) =>
                (
                  window as unknown as {
                    __tileflowEncodeShotFrame: (value: number) => Promise<EncoderPageResult>;
                  }
                ).__tileflowEncodeShotFrame(frame),
              index,
            ),
          );
        } finally {
          pendingPng = undefined;
        }
      });
    },
    async finish() {
      await run(async () =>
        collect(
          await page.evaluate(() =>
            (
              window as unknown as {
                __tileflowFinishShotEncoder: () => Promise<EncoderPageResult>;
              }
            ).__tileflowFinishShotEncoder(),
          ),
        ),
      );
      return [...chunks];
    },
    close,
  };
}

/** About 0.2 bits per pixel, which keeps map lines and labels sharp, bounded to 24 Mbit/s. */
function shotBitrate(width: number, height: number, fps: number): number {
  return Math.min(24_000_000, Math.max(250_000, Math.round(width * height * fps * 0.2)));
}

function encodeFailed(message?: string, cause?: unknown): TileflowCaptureError {
  const detail = message
    ? ` ${message
        .replace(/[^A-Za-z0-9 _.,:'"()[\]/=-]/g, '')
        .trim()
        .slice(0, 200)}`
    : '';
  return new TileflowCaptureError('VIDEO_ENCODE_FAILED', `Video encoding failed.${detail}`, {
    ...(cause === undefined ? {} : {cause}),
    details: {phase: 'video-encode'},
  });
}

const encoderPageScript = String.raw`
let encoder;
let encoderError;
let frameDuration = 0;
let keyInterval = 1;
let frameUrl = "";
const pending = [];

window.__tileflowOpenShotEncoder = async function(input) {
  if (typeof VideoEncoder !== "function" || typeof VideoFrame !== "function") {
    return {status: "unsupported"};
  }
  frameDuration = 1e6 / input.fps;
  keyInterval = input.fps;
  frameUrl = input.frameUrl;
  // VP9 profile 0, 8-bit; VP8 where VP9 is unavailable.
  for (const [codec, codecString] of [["vp9", "vp09.00.10.08"], ["vp8", "vp8"]]) {
    const config = {
      bitrate: input.bitrate,
      codec: codecString,
      framerate: input.fps,
      height: input.height,
      latencyMode: "quality",
      width: input.width
    };
    let support;
    try {
      support = await VideoEncoder.isConfigSupported(config);
    } catch {
      continue;
    }
    if (!support.supported) continue;
    try {
      encoder = new VideoEncoder({
        error: (error) => {
          encoderError = String(error?.message || error || "encoder error");
        },
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          pending.push({data: toBase64(data), key: chunk.type === "key", timestamp: chunk.timestamp});
        }
      });
      encoder.configure(config);
      return {codec, status: "ok"};
    } catch (error) {
      return {message: String(error?.message || error || ""), status: "failed"};
    }
  }
  return {status: "unsupported"};
};

window.__tileflowEncodeShotFrame = async function(index) {
  try {
    if (encoderError) return {message: encoderError, status: "failed"};
    const response = await fetch(frameUrl, {cache: "no-store"});
    if (!response.ok) return {message: "frame unavailable", status: "failed"};
    const bitmap = await createImageBitmap(await response.blob(), {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none"
    });
    const frame = new VideoFrame(bitmap, {
      duration: Math.round(frameDuration),
      timestamp: Math.round(index * frameDuration)
    });
    bitmap.close();
    try {
      encoder.encode(frame, {keyFrame: index % keyInterval === 0});
    } finally {
      frame.close();
    }
    while (encoder.encodeQueueSize > 2 && !encoderError) {
      await new Promise((resolve) => encoder.addEventListener("dequeue", resolve, {once: true}));
    }
    if (encoderError) return {message: encoderError, status: "failed"};
    return {chunks: pending.splice(0), status: "ok"};
  } catch (error) {
    return {message: String(error?.message || error || ""), status: "failed"};
  }
};

window.__tileflowFinishShotEncoder = async function() {
  try {
    await encoder.flush();
    encoder.close();
    if (encoderError) return {message: encoderError, status: "failed"};
    return {chunks: pending.splice(0), status: "ok"};
  } catch (error) {
    return {message: String(encoderError || error?.message || error || ""), status: "failed"};
  }
};

function toBase64(bytes) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(text);
}
`;
