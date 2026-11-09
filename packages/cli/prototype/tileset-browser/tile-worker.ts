import {GeojsonFeatureReader} from '../../src/tileset-build/geojson-stream';
import {FeatureIngest} from '../../src/tileset-build/ingest';
import {FeatureSpool, SpoolDirectory} from '../../src/tileset-build/spool';
import {tileFeatures} from '../../src/tileset-build/tileset-core';
import {browserPlatform, GzipPool, OpfsStorage} from './browser-platform';

const chunkBytes = 4 * 1024 * 1024;

export type TileJob = Readonly<{
  directory: string;
  generatorVersion: string;
  gzipWorkers: number;
  input: File;
  layer: string;
}>;

const scope = self as unknown as Worker;

self.onmessage = async ({data: job}: MessageEvent<TileJob>) => {
  const started = performance.now();
  let storage: OpfsStorage | null = null;
  let pool: GzipPool | null = null;
  try {
    storage = await OpfsStorage.open(job.directory);
    pool = job.gzipWorkers > 0 ? new GzipPool(job.gzipWorkers, '/gzip-worker.js') : null;
    const platform = browserPlatform(storage, pool);
    const directory = new SpoolDirectory(platform.storage);
    const spool = new FeatureSpool(directory);
    const ingest = new FeatureIngest(spool, {exclude: null, include: null}, null, null);

    const reader = new GeojsonFeatureReader(ingest, () => undefined);
    for (let position = 0; position < job.input.size; position += chunkBytes) {
      const end = position + chunkBytes;
      const chunk = new Uint8Array(await job.input.slice(position, end).arrayBuffer());
      reader.write(chunk);
      await platform.yield();
      scope.postMessage({phase: 'reading', position: end});
    }
    reader.end();
    const ingested = performance.now();

    const result = await tileFeatures({
      archiveName: 'archive.pmtiles',
      directory,
      generatorVersion: job.generatorVersion,
      ingest,
      layer: job.layer,
      minzoom: 0,
      onProgress: (message) => scope.postMessage({phase: 'progress', message}),
      platform,
      spool,
    });
    scope.postMessage({
      phase: 'done',
      storage: storage.report(),
      summary: {
        features: result.summary.features,
        maxzoom: result.maxzoom,
        ...result.totals,
      },
      timings: {
        ingestMs: ingested - started,
        tilingMs: performance.now() - ingested,
        totalMs: performance.now() - started,
      },
    });
  } catch (error) {
    scope.postMessage({
      phase: 'failed',
      message: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  } finally {
    pool?.terminate();
    try {
      storage?.close();
    } catch {
      // Already closed after a failure.
    }
  }
};
