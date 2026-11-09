import type {FeatureIngest, IngestSummary} from './ingest';

const maximumAutoZoom = 14;
const pointMinimumZoom = 10;
const shapeMinimumZoom = 4;
const detailBits = 12;
const retainedFraction = 0.9;
const maximumVerticesPerTile = 50_000;

/** Choose the lowest zoom that resolves most vertices and keeps the densest tile manageable. */
export function chooseMaxzoom(ingest: FeatureIngest, summary: IngestSummary): number {
  const count = ingest.sampleCount;
  const sample = ingest.sample;
  const floor = summary.geometryTypes.every((type) => type === 'Point')
    ? pointMinimumZoom
    : shapeMinimumZoom;

  const fullResolution = distinctCells(sample, count, maximumAutoZoom + detailBits);
  let resolved = maximumAutoZoom;
  for (let zoom = 0; zoom < maximumAutoZoom; zoom += 1) {
    if (distinctCells(sample, count, zoom + detailBits) >= fullResolution * retainedFraction) {
      resolved = zoom;
      break;
    }
  }

  let density = maximumAutoZoom;
  for (let zoom = 0; zoom <= maximumAutoZoom; zoom += 1) {
    if (densestCell(sample, count, zoom) * ingest.sampleStride <= maximumVerticesPerTile) {
      density = zoom;
      break;
    }
  }
  return Math.max(floor, resolved, density);
}

function cellKeys(sample: Int32Array, count: number, level: number): Float64Array {
  const shift = 2 ** (31 - level);
  const keys = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const x = Math.floor(sample[index * 2] / shift);
    const y = Math.floor(sample[index * 2 + 1] / shift);
    keys[index] = x * 2 ** level + y;
  }
  return keys.sort();
}

function distinctCells(sample: Int32Array, count: number, level: number): number {
  const keys = cellKeys(sample, count, Math.min(level, 26));
  let distinct = 0;
  for (let index = 0; index < count; index += 1) {
    if (index === 0 || keys[index] !== keys[index - 1]) distinct += 1;
  }
  return distinct;
}

function densestCell(sample: Int32Array, count: number, level: number): number {
  const keys = cellKeys(sample, count, level);
  let densest = 0;
  let run = 0;
  for (let index = 0; index < count; index += 1) {
    run = index > 0 && keys[index] === keys[index - 1] ? run + 1 : 1;
    if (run > densest) densest = run;
  }
  return densest;
}
