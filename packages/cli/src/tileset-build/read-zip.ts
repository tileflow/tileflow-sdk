import {createWriteStream} from 'node:fs';
import {basename, extname, join, posix} from 'node:path';
import type {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import yauzl, {type Entry, type ZipFile} from 'yauzl';
import {listChoices, TilesetBuildError} from './errors';

const projectionExtension = '.prj';
const dataExtensions = ['.shp', '.dbf', '.cpg'];
/** Entries are listed in memory, so their number is bounded before the first one is opened. */
const maximumEntries = 65_536;
const maximumKmlBytes = 4 * 1024 ** 3;

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

/**
 * The KML document inside a KMZ. It is streamed straight into the parser, so nothing from the
 * archive reaches the disk, and yauzl stops any entry that inflates past its declared size.
 */
export class ZippedKml {
  private constructor(
    private readonly zip: ZipFile,
    private readonly entry: Entry,
  ) {}

  static async open(path: string, requested: string | undefined): Promise<ZippedKml> {
    const zip = await openZip(path);
    try {
      const entry = chooseKml((await listEntries(zip)).filter(isKml), requested);
      if (entry.uncompressedSize > maximumKmlBytes) {
        throw new TilesetBuildError(
          'TF_TILESET_BUILD_INPUT_LIMIT',
          'input',
          `${entry.fileName} expands to more than ${maximumKmlBytes / 1024 ** 3} GiB. Convert it to a format that can be streamed from disk first.`,
        );
      }
      return new ZippedKml(zip, entry);
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  get uncompressedBytes(): number {
    return this.entry.uncompressedSize;
  }

  async *chunks(): AsyncGenerator<Buffer> {
    try {
      for await (const chunk of await openEntry(this.zip, this.entry)) yield chunk as Buffer;
    } catch (error) {
      throw unreadable(error);
    }
  }

  close(): void {
    this.zip.close();
  }
}

function isDataEntry(entry: Entry, extension: string): boolean {
  const name = entry.fileName;
  return (
    !name.endsWith('/') &&
    extname(name).toLowerCase() === extension &&
    !basename(name).startsWith('.') &&
    !name.split('/').includes('__MACOSX')
  );
}

function isShapefile(entry: Entry): boolean {
  return isDataEntry(entry, '.shp');
}

function isKml(entry: Entry): boolean {
  return isDataEntry(entry, '.kml');
}

/** `doc.kml` is the name the KMZ convention gives the main document; anything else must be unique. */
function chooseKml(documents: readonly Entry[], requested: string | undefined): Entry {
  const names = documents.map((entry) => entry.fileName).sort();
  if (names.length === 0) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'input',
      'The KMZ has no .kml file.',
    );
  }
  if (requested !== undefined) {
    const match = documents.find((entry) => entry.fileName === requested);
    if (match) return match;
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'zipEntry',
      `The KMZ has no KML document named "${requested}". It has: ${listChoices(names)}.`,
    );
  }
  const main = documents.find((entry) => entry.fileName.toLowerCase() === 'doc.kml');
  if (main) return main;
  if (documents.length > 1) {
    throw new TilesetBuildError(
      'TF_TILESET_BUILD_ZIP_ENTRY_INVALID',
      'zipEntry',
      `The KMZ has ${names.length} KML documents and no doc.kml. Choose one with --zip-entry: ${listChoices(names)}.`,
    );
  }
  return documents[0];
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
  const listed = listChoices(names);
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
      if (entries.length > maximumEntries) {
        reject(
          new TilesetBuildError(
            'TF_TILESET_BUILD_INPUT_LIMIT',
            'input',
            `The archive has more than ${maximumEntries} entries.`,
          ),
        );
        return;
      }
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
  if (error instanceof TilesetBuildError) return error;
  const detail = error instanceof Error ? error.message : 'unknown error';
  return new TilesetBuildError(
    'TF_TILESET_BUILD_INPUT_INVALID',
    'input',
    `The zip could not be read: ${detail}.`,
  );
}
