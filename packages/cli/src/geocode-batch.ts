import {basename, dirname, extname, join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {geocode, GeocodingError, getGeocodingStorageEstimate} from '@tileflow/search';
import {openGeocodingCheckpoint} from './geocode-checkpoint';

export type GeocodeCsvOptions = {
  addressColumns: string[];
  apiKey?: string;
  apiUrl?: string;
  concurrency: string;
  output?: string;
  retryUnconfirmed?: boolean;
  yes?: boolean;
};

export async function geocodeCsv(
  input: string,
  options: GeocodeCsvOptions,
  io: {
    confirm(): Promise<boolean>;
    log(message: string): void;
    fetch?: typeof fetch;
  },
) {
  if (!options.apiKey)
    throw new Error('Set TILEFLOW_API_KEY to a Team credential with geocoding:read.');
  if (!/^[1-8]$/u.test(options.concurrency))
    throw new Error('Concurrency must be an integer from 1 to 8.');
  if (
    !options.addressColumns.length ||
    new Set(options.addressColumns).size !== options.addressColumns.length
  )
    throw new Error('Supply one or more distinct address columns.');

  const apiUrl = options.apiUrl ?? 'https://api.tileflow.dev';
  const apiKey = options.apiKey;
  const output = resolve(
    options.output ?? join(dirname(input), basename(input, extname(input)) + '.geojson'),
  );
  if ([output, output + '.unmatched.csv', output + '.geocode.sqlite'].includes(resolve(input)))
    throw new Error('Choose an output path distinct from the input.');
  const checkpoint = openGeocodingCheckpoint(output);
  try {
    await checkpoint.prepare(input, options.addressColumns, apiUrl, apiKey);
    const unconfirmed = checkpoint.count('active');
    if (unconfirmed && !options.retryUnconfirmed)
      throw new Error(
        `${unconfirmed} request(s) have unconfirmed usage. Check Team usage before resubmitting with --retry-unconfirmed.`,
      );
    const remaining = checkpoint.count('pending') + unconfirmed;

    const credentials = {apiKey, apiUrl, fetch: io.fetch};
    const estimate = remaining
      ? await getGeocodingStorageEstimate({...credentials, signal: AbortSignal.timeout(30_000)})
      : undefined;
    if (estimate) {
      const {unitsPerRequest} = estimate;
      const total = BigInt(remaining) * BigInt(unitsPerRequest);
      io.log(
        `Estimated usage: ${remaining} distinct request(s) × ${unitsPerRequest} = ${total} shared API units. Empty results count.`,
      );
      if (unconfirmed)
        io.log(`${unconfirmed} unconfirmed request(s) may already have consumed units.`);
      if (!options.yes && !(await io.confirm()))
        throw new Error('Canceled before sending addresses.');
    }

    checkpoint.acceptEstimate(unconfirmed > 0);
    if (estimate) {
      await dispatchRows(checkpoint.jobs, Number(options.concurrency), async (address) =>
        geocode(
          {
            query: address,
            limit: 1,
            retention: 'persistent',
            expectedUnits: estimate.unitsPerRequest,
          },
          {...credentials, signal: AbortSignal.timeout(30_000)},
        ),
      );
    }

    const result = await checkpoint.exportRows();
    io.log(
      `${result.matched} matched, ${result.unmatched} unmatched. ${result.recordedUnits} shared API units recorded. Report: ${output}.unmatched.csv`,
    );
    if (result.attribution.length) {
      io.log(
        'Tileset attribution: ' +
          result.attribution
            .map((entry) => (entry.url ? `${entry.text} (${entry.url})` : entry.text))
            .join(' · '),
      );
    }
    return output;
  } finally {
    checkpoint.close();
  }
}

async function dispatchRows(
  jobs: ReturnType<typeof openGeocodingCheckpoint>['jobs'],
  concurrency: number,
  lookup: (address: string) => ReturnType<typeof geocode>,
) {
  let stopped = false;
  async function worker() {
    while (!stopped) {
      const address = jobs.claim();
      if (address === undefined) return;
      try {
        const response = await lookupWithRetry(address, lookup, () => stopped);
        jobs.complete(address, response);
      } catch (error) {
        stopped = true;
        // A transport failure, unreadable success or lost acknowledgment may already be billed.
        if (confirmedFailure(error)) jobs.release(address);
        else
          throw new Error(
            'Usage is unconfirmed. Check Team usage before resubmitting with --retry-unconfirmed.',
            {cause: error},
          );
        throw error;
      }
    }
  }
  // Finish checkpointing already-dispatched work even when a different row stops the batch.
  const workers = await Promise.allSettled(Array.from({length: concurrency}, worker));
  const failed = workers.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

function confirmedFailure(error: unknown): boolean {
  if (!(error instanceof GeocodingError)) return false;
  if (error.code) return error.code !== 'GEOCODING_USAGE_UNCONFIRMED';
  return [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status);
}

async function lookupWithRetry(
  address: string,
  lookup: (address: string) => ReturnType<typeof geocode>,
  stopped: () => boolean,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await lookup(address);
    } catch (error) {
      if (
        !(error instanceof GeocodingError) ||
        !error.code ||
        ![
          'GEOCODING_UPSTREAM_THROTTLED',
          'GEOCODING_UPSTREAM_TIMEOUT',
          'GEOCODING_UPSTREAM_UNAVAILABLE',
          'GEOCODING_PICK_LIMIT_EXCEEDED',
        ].includes(error.code) ||
        stopped() ||
        attempt >= 2
      )
        throw error;
      const ms =
        error.retryAfterSeconds === null ? 250 * 2 ** attempt : error.retryAfterSeconds * 1000;
      if (ms > 30_000) throw error;
      await delay(ms);
      if (stopped()) throw error;
    }
  }
}
