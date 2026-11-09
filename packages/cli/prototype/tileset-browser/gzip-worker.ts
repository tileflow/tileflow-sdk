import {gzipWithCompressionStream} from './browser-platform';

self.onmessage = async ({data}: MessageEvent<{id: number; input: Uint8Array}>) => {
  const output = await gzipWithCompressionStream(data.input);
  (self as unknown as Worker).postMessage({id: data.id, output}, [output.buffer]);
};
