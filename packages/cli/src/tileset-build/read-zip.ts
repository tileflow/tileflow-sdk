import {createWriteStream} from 'node:fs';
import {basename, extname, join, posix} from 'node:path';
import type {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import yauzl, {type Entry, type ZipFile} from 'yauzl';
import {TilesetBuildError} from './errors';

const projectionExtension = '.prj';
const dataExtensions = ['.shp', '.dbf', '.cpg'];

/** One Shapefile chosen from a zip. Files are written under fixed names, never archive paths. */
export class ZippedShapefile {
  private constructor(
    private readonly zip: ZipFile,
    private readonly members: ReadonlyMap<string, Entry>,
    private readonly stem: string,
    readonly uncompressedBytes: number,
  ) {}

  static async open(path: string, requested: string | undefined): Promise<ZippedShapefile> {
    const zip = await openZip(path);
    try {
      const entries = await listEntries(zip);
      const shapefiles = entries.filter(isShapefile);
      const chosen = chooseShapefile(shapefiles, requested);
      const stem = withoutExtension(chosen.fileName).toLowerCase();
      const members = new Map<string, Entry>();
      for (const entry of entries) {
        if (withoutExtension(entry.fileName).toLowerCase() !== stem) continue;
        const extension = extname(entry.fileName).toLowerCase();
        if (extension === projectionExtension || dataExtensions.includes(extension)) {
          members.set(extension, entry);
        }
      }
      const uncompressedBytes = [...members.values()].reduce(
        (total, entry) => total + entry.uncompressedSize,
        0,
      );
      return new ZippedShapefile(
        zip,
        members,
        basename(withoutExtension(chosen.fileName)),
        uncompressedBytes,
      );
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  /** The `.prj` comes first, so that a refused CRS does not pay for extracting the data. */
  async extractProjection(directory: string): Promise<string> {
    await this.#extract(directory, [projectionExtension]);
    return this.#shapefilePath(directory);
  }

  async extractData(directory: string): Promise<string> {
    await this.#extract(directory, dataExtensions);
    return this.#shapefilePath(directory);
  }

  close(): void {
    this.zip.close();
  }

  #shapefilePath(directory: string): string {
    return join(directory, `${this.stem}.shp`);
  }

  async #extract(directory: string, extensions: readonly string[]): Promise<void> {
    for (const extension of extensions) {
      const entry = this.members.get(extension);
      if (!entry) continue;
      try {
        const stream = await openEntry(this.zip, entry);
        await pipeline(stream, createWriteStream(join(directory, `${this.stem}${extension}`)));
      } catch (error) {
        if ((error as {code?: unknown}).code === 'ENOSPC') throw error;
        throw unreadable(error);
      }
    }
  }
}

function isShapefile(entry: Entry): boolean {
  const name = entry.fileName;
  return (
    !name.endsWith('/') &&
    extname(name).toLowerCase() === '.shp' &&
    !basename(name).startsWith('.') &&
    !name.split('/').includes('__MACOSX')
  );
}

function chooseShapefile(shapefiles: readonly Entry[], requested: string | undefined): Entry {
  const names = shapefiles.map((entry) => entry.fileName).sort();
  if (names.length === 0) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'input',
      'The zip has no .shp file. Only Shapefiles can be read from a zip; extract other formats first.',
    );
  }
  const listed = `${names.slice(0, 20).join(', ')}${names.length > 20 ? `, and ${names.length - 20} more` : ''}`;
  if (requested !== undefined) {
    const match = shapefiles.find((entry) => entry.fileName === requested);
    if (match) return match;
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'zipEntry',
      `The zip has no Shapefile named "${requested}". It has: ${listed}.`,
    );
  }
  if (shapefiles.length > 1) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'zipEntry',
      `The zip has ${names.length} Shapefiles. Choose one with --zip-entry: ${listed}.`,
    );
  }
  return shapefiles[0];
}

function withoutExtension(name: string): string {
  return name.slice(0, name.length - posix.extname(name).length);
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, {autoClose: false, lazyEntries: true}, (error, zip) => {
      if (error) reject(unreadable(error));
      else resolve(zip);
    });
  });
}

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on('entry', (entry: Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', (error: unknown) => reject(unreadable(error)));
    zip.readEntry();
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

function unreadable(error: unknown): TilesetBuildError {
  const detail = error instanceof Error ? error.message : 'unknown error';
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_INVALID',
    'input',
    `The zip could not be read: ${detail}.`,
  );
}
