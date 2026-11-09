import {serializeCanonicalJson} from '@tileflow/core';
import type {FeatureIngest, IngestSummary} from './ingest';
import type {TilesetPlatform} from './platform';
import {type ArchiveSummary, TileArchiveWriter} from './pmtiles-writer';
import type {FeatureSpool, SpoolDirectory} from './spool';
import {buildPyramid, type ZoomStatistics} from './tiler';
import {chooseMaxzoom} from './zoom';

export type TileFeaturesOptions = Readonly<{
  archiveName: string;
  attribution?: string;
  description?: string;
  directory: SpoolDirectory;
  generatorVersion: string;
  /** Holds every feature to tile. The caller has already read the source into it. */
  ingest: FeatureIngest;
  layer: string;
  maxzoom?: number;
  minzoom: number;
  name?: string;
  onProgress?: (message: string) => void;
  platform: TilesetPlatform;
  spool: FeatureSpool;
}>;

export type TileFeaturesResult = Readonly<{
  maxzoom: number;
  summary: IngestSummary;
  totals: ArchiveSummary;
  zooms: readonly ZoomStatistics[];
}>;

/** Turn ingested features into a finished archive in the platform's storage. */
export async function tileFeatures(options: TileFeaturesOptions): Promise<TileFeaturesResult> {
  const {ingest, layer, minzoom, platform, spool} = options;
  const summary = ingest.finish();
  const maxzoom = options.maxzoom ?? Math.max(chooseMaxzoom(ingest, summary), minzoom);
  const fieldMetadata = Object.fromEntries(summary.fields.map((item) => [item.name, item.type]));
  options.onProgress?.(`Tiling ${summary.features} features through zoom ${maxzoom}.`);

  const archive = new TileArchiveWriter(platform);
  try {
    // Tiles keep the first features per cell, so this order is what decides which ones survive.
    const root = ingest.rankedSpool(spool);
    const zooms = await buildPyramid(root, {
      archive,
      directory: options.directory,
      keys: ingest.keyNames(summary),
      layer,
      maxzoom,
      minzoom,
      onTile: (count) => {
        if (count % 65_536 < 256) options.onProgress?.(`Wrote ${count} tiles.`);
      },
      platform,
    });
    const bounds = summary.bounds;
    const totals = await archive.finish(
      options.archiveName,
      {
        bounds,
        center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, minzoom],
        maxzoom,
        minzoom,
      },
      serializeCanonicalJson({
        ...(options.attribution ? {attribution: options.attribution} : {}),
        ...(options.description ? {description: options.description} : {}),
        format: 'pbf',
        generator: 'tileflow tileset build',
        generator_version: options.generatorVersion,
        name: options.name ?? layer,
        type: 'overlay',
        vector_layers: [{fields: fieldMetadata, id: layer, maxzoom, minzoom}],
        version: '1',
      }),
    );
    return {maxzoom, summary, totals, zooms};
  } finally {
    archive.close();
  }
}
