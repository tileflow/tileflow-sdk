import {gzipWithCompressionStream} from './browser-platform';

self.onmessage = async ({data}: MessageEvent<{id: number; input: Uint8Array}>) => {
  try {
    const output = await gzipWithCompressionStream(data.input);
    (self as unknown as Worker).postMessage({id: data.id, output}, [output.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id: data.id,
      failure: `${(error as Error).name}: ${(error as Error).message} (${data.input.length} bytes)`,
    });
  }
};
