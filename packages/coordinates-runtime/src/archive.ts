import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir, open, unlink} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {createGunzip} from 'node:zlib';

const blockSize = 512;
const maximumChunkBytes = 64 * 1024;
const safePath = /^[A-Za-z0-9_./=+-]+$/u;
const sha256 = /^[a-f0-9]{64}$/u;

export type CoordinatesArchiveFile = Readonly<{
  bytes: number;
  executable: boolean;
  path: string;
  sha256: string;
}>;

export class CoordinatesArchiveError extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Coordinates archive extraction failed.');
    this.code = code;
    this.name = 'CoordinatesArchiveError';
  }
}

/** Extracts one manifest-bound, development-only POSIX ustar gzip archive. */
export async function extractCoordinatesArchive(input: {
  archivePath: string;
  destination: string;
  files: readonly CoordinatesArchiveFile[];
  signal?: AbortSignal;
}): Promise<void> {
  const manifest = validateManifest(input.files);
  throwIfAborted(input.signal);

  try {
    await mkdir(input.destination, {mode: 0o700});
  } catch {
    throw new CoordinatesArchiveError('DESTINATION_UNAVAILABLE');
  }

  const source = createReadStream(input.archivePath);
  const gunzip = createGunzip();
  source.on('error', (error) => gunzip.destroy(error));
  const abort = () => {
    const error = new CoordinatesArchiveError('ARCHIVE_ABORTED');
    source.destroy(error);
    gunzip.destroy(error);
  };
  input.signal?.addEventListener('abort', abort, {once: true});
  source.pipe(gunzip);

  try {
    await extractTar(new ArchiveReader(gunzip), input.destination, manifest, input.signal);
  } catch (error) {
    if (error instanceof CoordinatesArchiveError) throw error;
    if (input.signal?.aborted) throw new CoordinatesArchiveError('ARCHIVE_ABORTED');
    throw new CoordinatesArchiveError('ARCHIVE_UNREADABLE');
  } finally {
    input.signal?.removeEventListener('abort', abort);
    source.destroy();
    gunzip.destroy();
  }
}

async function extractTar(
  reader: ArchiveReader,
  destination: string,
  manifest: Manifest,
  signal: AbortSignal | undefined,
) {
  const seenFiles = new Set<string>();
  const seenDirectories = new Set<string>();

  while (true) {
    throwIfAborted(signal);
    const header = await reader.readOptional(blockSize);
    if (!header) throw new CoordinatesArchiveError('ARCHIVE_TRUNCATED');
    if (isZeroBlock(header)) {
      const end = await reader.readOptional(blockSize);
      if (!end || !isZeroBlock(end)) throw new CoordinatesArchiveError('ARCHIVE_TRUNCATED');
      if ((await reader.readOptional(1)) !== null)
        throw new CoordinatesArchiveError('ARCHIVE_GARBAGE');
      break;
    }

    const entry = parseHeader(header);
    if (entry.type === 'directory') {
      await extractDirectory(entry, destination, manifest, seenDirectories, signal);
      continue;
    }
    await extractFile(entry, reader, destination, manifest, seenFiles, signal);
  }

  if (seenFiles.size !== manifest.files.size)
    throw new CoordinatesArchiveError('ARCHIVE_MISSING_FILE');
}

async function extractDirectory(
  entry: TarEntry,
  destination: string,
  manifest: Manifest,
  seenDirectories: Set<string>,
  signal: AbortSignal | undefined,
) {
  if (entry.size !== 0 || entry.mode !== 0o755)
    throw new CoordinatesArchiveError('ARCHIVE_MODE_MISMATCH');
  const path = normalizeDirectoryPath(entry.path);
  if (!manifest.directories.has(path) || seenDirectories.has(path)) {
    throw new CoordinatesArchiveError('ARCHIVE_ENTRY_UNDECLARED');
  }
  throwIfAborted(signal);
  try {
    await mkdir(join(destination, path), {mode: 0o700});
  } catch {
    throw new CoordinatesArchiveError('ARCHIVE_WRITE_FAILED');
  }
  seenDirectories.add(path);
}

async function extractFile(
  entry: TarEntry,
  reader: ArchiveReader,
  destination: string,
  manifest: Manifest,
  seenFiles: Set<string>,
  signal: AbortSignal | undefined,
) {
  const expected = manifest.files.get(entry.path);
  if (!expected) throw new CoordinatesArchiveError('ARCHIVE_ENTRY_UNDECLARED');
  if (seenFiles.has(entry.path)) throw new CoordinatesArchiveError('ARCHIVE_ENTRY_DUPLICATE');
  if (entry.size !== expected.bytes) throw new CoordinatesArchiveError('ARCHIVE_SIZE_MISMATCH');
  if (entry.mode !== (expected.executable ? 0o755 : 0o644)) {
    throw new CoordinatesArchiveError('ARCHIVE_MODE_MISMATCH');
  }
  const parent = dirname(entry.path);
  if (parent !== '.' && !manifest.directories.has(parent)) {
    throw new CoordinatesArchiveError('ARCHIVE_ENTRY_UNDECLARED');
  }

  const target = join(destination, entry.path);
  let file;
  try {
    file = await open(target, 'wx', expected.executable ? 0o755 : 0o644);
  } catch {
    throw new CoordinatesArchiveError('ARCHIVE_WRITE_FAILED');
  }

  try {
    const hash = createHash('sha256');
    let remaining = entry.size;
    while (remaining > 0) {
      throwIfAborted(signal);
      const chunk = await reader.read(Math.min(remaining, maximumChunkBytes));
      hash.update(chunk);
      await writeAll(file, chunk);
      remaining -= chunk.byteLength;
    }
    const padding = (blockSize - (entry.size % blockSize)) % blockSize;
    if (padding > 0 && !(await reader.read(padding)).every((byte) => byte === 0)) {
      throw new CoordinatesArchiveError('ARCHIVE_ENTRY_INVALID');
    }
    if (hash.digest('hex') !== expected.sha256)
      throw new CoordinatesArchiveError('ARCHIVE_HASH_MISMATCH');
    seenFiles.add(entry.path);
  } catch (error) {
    await file.close().catch(() => undefined);
    await unlink(target).catch(() => undefined);
    throw error;
  }
  await file.close().catch(() => {
    throw new CoordinatesArchiveError('ARCHIVE_WRITE_FAILED');
  });
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, buffer: Buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const result = await file.write(buffer, offset, buffer.byteLength - offset, null);
    if (result.bytesWritten <= 0) throw new CoordinatesArchiveError('ARCHIVE_WRITE_FAILED');
    offset += result.bytesWritten;
  }
}

function parseHeader(header: Buffer): TarEntry {
  const checksum = readOctal(header, 148, 8);
  const calculated = header.reduce(
    (sum, byte, index) => sum + (index >= 148 && index < 156 ? 0x20 : byte),
    0,
  );
  if (checksum !== calculated) throw new CoordinatesArchiveError('ARCHIVE_CHECKSUM_INVALID');
  if (
    !header.subarray(257, 263).equals(Buffer.from('ustar\0')) ||
    !header.subarray(263, 265).equals(Buffer.from('00'))
  ) {
    throw new CoordinatesArchiveError('ARCHIVE_HEADER_INVALID');
  }

  const name = readText(header, 0, 100);
  const prefix = readText(header, 345, 155, true);
  const path = prefix ? `${prefix}/${name}` : name;
  const type =
    header[156] === 0 || header[156] === '0'.charCodeAt(0)
      ? 'file'
      : header[156] === '5'.charCodeAt(0)
        ? 'directory'
        : null;
  if (!type) throw new CoordinatesArchiveError('ARCHIVE_ENTRY_INVALID');
  const normalizedPath = type === 'directory' ? normalizeDirectoryPath(path) : path;
  validatePath(normalizedPath);
  return {
    mode: readOctal(header, 100, 8),
    path: normalizedPath,
    size: readOctal(header, 124, 12),
    type,
  };
}

function validateManifest(files: readonly CoordinatesArchiveFile[]): Manifest {
  const records = new Map<string, CoordinatesArchiveFile>();
  const directories = new Set<string>();
  for (const file of files) {
    if (
      !file ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.executable !== 'boolean' ||
      typeof file.sha256 !== 'string' ||
      !sha256.test(file.sha256)
    ) {
      throw new CoordinatesArchiveError('MANIFEST_INVALID');
    }
    validatePath(file.path);
    if (records.has(file.path)) throw new CoordinatesArchiveError('MANIFEST_INVALID');
    records.set(file.path, file);
    for (let directory = dirname(file.path); directory !== '.'; directory = dirname(directory)) {
      directories.add(directory);
    }
  }
  return {directories, files: records};
}

function validatePath(path: string) {
  if (
    typeof path !== 'string' ||
    !path ||
    !safePath.test(path) ||
    path.startsWith('/') ||
    path.includes('\\')
  ) {
    throw new CoordinatesArchiveError('ARCHIVE_ENTRY_INVALID');
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new CoordinatesArchiveError('ARCHIVE_ENTRY_INVALID');
}

function normalizeDirectoryPath(path: string) {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
  validatePath(normalized);
  return normalized;
}

function readText(header: Buffer, offset: number, length: number, allowEmpty = false) {
  const field = header.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  const value = terminator === -1 ? field : field.subarray(0, terminator);
  if ((!allowEmpty && !value.length) || value.some((byte) => byte < 0x21 || byte > 0x7e)) {
    throw new CoordinatesArchiveError('ARCHIVE_HEADER_INVALID');
  }
  if (terminator !== -1 && field.subarray(terminator + 1).some((byte) => byte !== 0)) {
    throw new CoordinatesArchiveError('ARCHIVE_HEADER_INVALID');
  }
  return value.toString('ascii');
}

function readOctal(header: Buffer, offset: number, length: number) {
  const field = header.subarray(offset, offset + length);
  if (field.some((byte) => byte !== 0 && byte !== 0x20 && (byte < 0x30 || byte > 0x37))) {
    throw new CoordinatesArchiveError('ARCHIVE_HEADER_INVALID');
  }
  const value = field.toString('ascii').replace(/[\0 ]/gu, '');
  if (!value) return 0;
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new CoordinatesArchiveError('ARCHIVE_HEADER_INVALID');
  return parsed;
}

function isZeroBlock(block: Buffer) {
  return block.every((byte) => byte === 0);
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new CoordinatesArchiveError('ARCHIVE_ABORTED');
}

type Manifest = Readonly<{
  directories: ReadonlySet<string>;
  files: ReadonlyMap<string, CoordinatesArchiveFile>;
}>;
type TarEntry = Readonly<{mode: number; path: string; size: number; type: 'directory' | 'file'}>;

class ArchiveReader {
  #buffer = Buffer.alloc(0);
  #done = false;
  #iterator: AsyncIterator<Buffer>;

  constructor(stream: AsyncIterable<Buffer>) {
    this.#iterator = stream[Symbol.asyncIterator]();
  }

  async readOptional(size: number): Promise<Buffer | null> {
    if (!this.#buffer.byteLength) {
      await this.fill();
      if (!this.#buffer.byteLength && this.#done) return null;
    }
    return this.read(size);
  }

  async read(size: number): Promise<Buffer> {
    while (this.#buffer.byteLength < size) {
      await this.fill();
      if (this.#done && this.#buffer.byteLength < size)
        throw new CoordinatesArchiveError('ARCHIVE_TRUNCATED');
    }
    const result = this.#buffer.subarray(0, size);
    this.#buffer = this.#buffer.subarray(size);
    return result;
  }

  async fill() {
    if (this.#done) return;
    const next = await this.#iterator.next();
    if (next.done) {
      this.#done = true;
      return;
    }
    if (next.value.byteLength) this.#buffer = Buffer.concat([this.#buffer, next.value]);
  }
}
