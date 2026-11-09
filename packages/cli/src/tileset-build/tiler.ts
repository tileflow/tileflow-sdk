import {type Box, clipRecordInto} from './clip';
import {TilesetBuildError} from './errors';
import {compressedSizeForBudget} from './gzip';
import {tileBufferUnits, TileEncoder} from './mvt';
import type {TileArchiveWriter} from './pmtiles-writer';
import {FeatureSpool, field, geometryType, headerWords, type SpoolDirectory} from './spool';

/** The inspector rejects decoded tiles above this size. */
const maximumTileBytes = 6_000_000;
const targetCompressedBytes = 500 * 1024;
/** A tile this far over budget is abandoned early, so one pass cannot exhaust memory. */
const maximumBufferedBytes = 64 * 1024 * 1024;
const maximumAttempts = 7;
const tileCellsPerAxis = 512;
/** The tile buffer is whole cells wide, so a feature near an edge wins or loses as in its own tile. */
const bufferCells = (tileBufferUnits * tileCellsPerAxis) / 4096;
const selectionCellsPerAxis = tileCellsPerAxis + bufferCells * 2;
/** Below the last zoom, points sharing a cell draw on top of each other; one is enough. */
const pointsPerCell = 1;
const minimumFeaturesToThinPoints = 2048;
const simplifyTolerance = 4;
const lastZoomTolerance = 1;
/** Features narrower than this many tile units render as a dot, and thin like one. */
const dotSpan = 8;
const minimumExteriorArea = 8;
const yieldEveryTiles = 256;

export type ZoomStatistics = {
  features: number;
  largestTileBytes: number;
  thinnedFeatures: number;
  tiles: number;
  zoom: number;
};

export type PyramidOptions = Readonly<{
  archive: TileArchiveWriter;
  directory: SpoolDirectory;
  keys: readonly string[];
  layer: string;
  maxzoom: number;
  minzoom: number;
  onTile?: (tilesWritten: number) => void;
}>;

/** Top-down, depth-first: each tile reads its parent's clipped features and spools its children. */
export async function buildPyramid(
  root: FeatureSpool,
  options: PyramidOptions,
): Promise<readonly ZoomStatistics[]> {
  const statistics: ZoomStatistics[] = [];
  for (let zoom = 0; zoom <= options.maxzoom; zoom += 1) {
    statistics.push({features: 0, largestTileBytes: 0, thinnedFeatures: 0, tiles: 0, zoom});
  }
  const pyramid = new Pyramid(options, statistics);
  await pyramid.visit(0, 0, 0, root);
  return statistics;
}

class Pyramid {
  readonly #encoder: TileEncoder;
  readonly #cellCounts = new Uint32Array(selectionCellsPerAxis ** 2);
  readonly #cellSeen = new Uint32Array(selectionCellsPerAxis ** 2);
  /** Which records of the tile just encoded were drawn; read while clipping its children. */
  #drawn = new Uint8Array(0);
  #visited = 0;

  constructor(
    private readonly options: PyramidOptions,
    private readonly statistics: ZoomStatistics[],
  ) {
    this.#encoder = new TileEncoder(options.layer, options.keys);
  }

  async visit(z: number, x: number, y: number, spool: FeatureSpool): Promise<void> {
    const {archive, maxzoom, minzoom} = this.options;
    let content = -1;
    if (z >= minzoom) {
      const tile = this.#encodeTile(z, x, y, spool);
      if (tile !== null) content = await archive.addTile(z, x, y, tile);
    }
    this.#visited += 1;
    if (this.#visited % yieldEveryTiles === 0) {
      this.options.onTile?.(archive.tileCount);
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (z === maxzoom) {
      spool.dispose();
      return;
    }

    // A tile fully inside one polygon repeats unchanged all the way down: keep it in the directory
    // only. This is what makes a country polygon at a high maximum zoom affordable.
    if (content >= 0 && isSolidTile(spool, tileBox(z, x, y))) {
      for (let depth = 1; depth <= maxzoom - z; depth += 1) {
        archive.addSubtreeLevel(z, x, y, depth, content);
      }
      spool.dispose();
      return;
    }

    const children: FeatureSpool[] = [];
    const boxes: Box[] = [];
    for (let index = 0; index < 4; index += 1) {
      children.push(new FeatureSpool(this.options.directory));
      boxes.push(tileBox(z + 1, x * 2 + (index & 1), y * 2 + (index >> 1)));
    }
    const encoded = z >= minzoom;
    let record = 0;
    spool.forEach((words, offset) => {
      // Children must draw what this tile drew, which is what makes thinning nest across zooms.
      words[offset + field.kept] = encoded ? this.#drawn[record] : 0;
      record += 1;
      for (let index = 0; index < 4; index += 1) {
        clipRecordInto(words, offset, boxes[index], children[index]);
      }
    });
    spool.dispose();
    for (let index = 0; index < 4; index += 1) {
      const child = children[index];
      if (child.count > 0) {
        await this.visit(z + 1, x * 2 + (index & 1), y * 2 + (index >> 1), child);
      } else {
        child.dispose();
      }
    }
  }

  #encodeTile(z: number, x: number, y: number, spool: FeatureSpool): Uint8Array | null {
    const {maxzoom} = this.options;
    const encoder = this.#encoder;
    const lastZoom = z === maxzoom;
    const stats = this.statistics[z];
    const encodeOptions = lastZoom
      ? {keepCollapsedLines: true, minimumArea: 0, tolerance: lastZoomTolerance}
      : {
          keepCollapsedLines: false,
          minimumArea: minimumExteriorArea,
          tolerance: simplifyTolerance,
        };

    const pointCap =
      !lastZoom && spool.count > minimumFeaturesToThinPoints ? pointsPerCell : Infinity;
    const unit = 2 ** (31 - z) / tileCellsPerAxis;
    const originX = x * 2 ** (31 - z) - bufferCells * unit;
    const originY = y * 2 ** (31 - z) - bufferCells * unit;
    const dotWorldSpan = dotSpan * 2 ** (19 - z);
    let featureLimit = Infinity;
    let honorParent = true;
    if (this.#drawn.length < spool.count) this.#drawn = new Uint8Array(spool.count * 2);
    const drawn = this.#drawn;
    for (let attempt = 0; ; attempt += 1) {
      drawn.fill(0, 0, spool.count);
      const quota = featureLimit === Infinity ? Infinity : this.#quotaFor(featureLimit);
      const cellShare = quota === Infinity ? 1 : this.#cellShareFor(quota, featureLimit);
      const trackCells = quota !== Infinity || pointCap !== Infinity;
      if (trackCells) this.#cellSeen.fill(0);
      encoder.begin(z, x, y, encodeOptions);
      let thinned = 0;
      let abandoned = false;
      let record = -1;
      let optional = 0;
      spool.forEach((words, offset) => {
        record += 1;
        if (abandoned) return;
        const required = honorParent && words[offset + field.kept] === 1;
        if (trackCells) {
          const cell = selectionCell(words, offset, originX, originY, unit);
          const cap = isDot(words, offset, dotWorldSpan) ? Math.min(pointCap, quota) : quota;
          if (!required && (this.#cellSeen[cell] >= cap || cellRank(cell) >= cellShare)) {
            thinned += 1;
            return;
          }
          this.#cellSeen[cell] += 1;
        }
        if (encoder.add(words, offset)) {
          drawn[record] = 1;
          if (!required) optional += 1;
          if (encoder.approximateBytes <= maximumBufferedBytes) {
            if (!lastZoom || encoder.approximateBytes <= maximumTileBytes) return;
          }
          if (lastZoom) throw tooLarge(z, x, y);
          abandoned = true;
        } else {
          thinned += 1;
        }
      });
      if (encoder.featureCount === 0) return null;
      const tile = encoder.finish();
      const size = lastZoom ? tile.length : measuredSize(tile);
      const decodable = !abandoned && tile.length <= maximumTileBytes;
      // The byte target is a preference: past it, keeping what the parent drew still wins.
      const settled = optional === 0 || attempt === maximumAttempts;
      if (lastZoom || (decodable && (size <= targetCompressedBytes || settled))) {
        stats.tiles += 1;
        stats.features += encoder.featureCount;
        stats.thinnedFeatures += thinned;
        if (tile.length > stats.largestTileBytes) stats.largestTileBytes = tile.length;
        return tile;
      }
      if (attempt === maximumAttempts) throw tooLarge(z, x, y);
      if (optional === 0) honorParent = false;
      if (featureLimit === Infinity) {
        this.#countCells(spool, originX, originY, unit, pointCap, dotWorldSpan);
      }
      const ratio = Math.min(targetCompressedBytes / size, maximumTileBytes / tile.length);
      featureLimit = Math.max(1, Math.floor(encoder.featureCount * ratio * 0.9));
    }
  }

  #countCells(
    spool: FeatureSpool,
    originX: number,
    originY: number,
    unit: number,
    pointCap: number,
    dotWorldSpan: number,
  ): void {
    this.#cellCounts.fill(0);
    spool.forEach((words, offset) => {
      const cell = selectionCell(words, offset, originX, originY, unit);
      if (!isDot(words, offset, dotWorldSpan) || this.#cellCounts[cell] < pointCap) {
        this.#cellCounts[cell] += 1;
      }
    });
  }

  /** When one feature per cell is still too many, the share of cells that may keep theirs. */
  #cellShareFor(quota: number, limit: number): number {
    if (quota > 1) return 1;
    let occupied = 0;
    for (const count of this.#cellCounts) if (count > 0) occupied += 1;
    return Math.min(1, limit / occupied);
  }

  /** The largest per-cell allowance that fits the limit, which thins dense areas first. */
  #quotaFor(limit: number): number {
    let low = 1;
    let high = 1;
    for (const count of this.#cellCounts) if (count > high) high = count;
    while (low < high) {
      const candidate = Math.ceil((low + high) / 2);
      let total = 0;
      for (const count of this.#cellCounts) total += Math.min(count, candidate);
      if (total <= limit) low = candidate;
      else high = candidate - 1;
    }
    return low;
  }
}

function tileBox(z: number, x: number, y: number): Box {
  const size = 2 ** (31 - z);
  const buffer = tileBufferUnits * 2 ** (19 - z);
  return {
    maxX: (x + 1) * size + buffer,
    maxY: (y + 1) * size + buffer,
    minX: x * size - buffer,
    minY: y * size - buffer,
  };
}

function selectionCell(
  words: Int32Array,
  offset: number,
  originX: number,
  originY: number,
  unit: number,
): number {
  const centerX = (words[offset + field.minX] + words[offset + field.maxX]) / 2;
  const centerY = (words[offset + field.minY] + words[offset + field.maxY]) / 2;
  const limit = selectionCellsPerAxis - 1;
  const cellX = Math.max(0, Math.min(limit, Math.floor((centerX - originX) / unit)));
  const cellY = Math.max(0, Math.min(limit, Math.floor((centerY - originY) / unit)));
  return cellY * selectionCellsPerAxis + cellX;
}

function isDot(words: Int32Array, offset: number, span: number): boolean {
  const type = words[offset + field.type];
  if (type === geometryType.point) return true;
  return (
    type === geometryType.polygon &&
    words[offset + field.maxX] - words[offset + field.minX] < span &&
    words[offset + field.maxY] - words[offset + field.minY] < span
  );
}

/** A stable pseudo-random rank in 0..1, so cell sampling is deterministic and evenly spread. */
function cellRank(cell: number): number {
  return (Math.imul(cell + 1, 2654435761) >>> 0) / 2 ** 32;
}

function isSolidTile(spool: FeatureSpool, box: Box): boolean {
  if (spool.count !== 1) return false;
  let solid = false;
  spool.forEach((words, offset) => {
    if (
      words[offset + field.type] !== geometryType.polygon ||
      words[offset + field.parts] !== 1 ||
      words[offset + field.minX] !== box.minX ||
      words[offset + field.minY] !== box.minY ||
      words[offset + field.maxX] !== box.maxX ||
      words[offset + field.maxY] !== box.maxY
    ) {
      return;
    }
    // Spanning the box is not enough: a diamond does too. Every vertex must sit on a corner.
    const start = offset + headerWords + 1;
    solid = true;
    for (let index = 0; index < words[offset + field.points]; index += 1) {
      const px = words[start + index * 2];
      const py = words[start + index * 2 + 1];
      if ((px !== box.minX && px !== box.maxX) || (py !== box.minY && py !== box.maxY)) {
        solid = false;
      }
    }
  });
  return solid;
}

function measuredSize(tile: Uint8Array): number {
  return tile.length <= targetCompressedBytes ? tile.length : compressedSizeForBudget(tile);
}

function tooLarge(z: number, x: number, y: number): TilesetBuildError {
  return new TilesetBuildError(
    'TF_TILESET_BUILD_TILE_TOO_LARGE',
    'zoom',
    `Tile ${z}/${x}/${y} cannot fit in ${maximumTileBytes} bytes without losing features. Raise --maxzoom, or remove attributes with --include or --exclude.`,
  );
}
