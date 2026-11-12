import {deflateSync} from 'fflate';
import {gzip as gzipCallback, gzipSync} from 'node:zlib';

/** Byte 9 of a gzip header names the operating system that wrote it. */
const operatingSystemByte = 9;
const unknownOperatingSystem = 255;

/** Without this, the same tile compressed on macOS and Linux differs in that one header byte. */
function withStableHeader(compressed: Buffer): Buffer {
  compressed[operatingSystemByte] = unknownOperatingSystem;
  return compressed;
}

export function stableGzipSync(bytes: Uint8Array): Buffer {
  return withStableHeader(gzipSync(bytes));
}

/** Compresses on the thread pool, so callers can run several at once. */
export function stableGzip(bytes: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzipCallback(bytes, (error, result) => {
      if (error) reject(error);
      else resolve(withStableHeader(result));
    });
  });
}

/**
 * Compressed size for decisions that change which features survive. zlib's output varies with its
 * version and processor, and the decoded tiles must not; this JavaScript deflate is the same
 * everywhere. It is slower, so it is only for the rare tile near the size target.
 */
export function compressedSizeForBudget(bytes: Uint8Array): number {
  return deflateSync(bytes, {level: 6}).length;
}
