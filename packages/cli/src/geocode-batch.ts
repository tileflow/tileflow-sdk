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
    wait?: (ms: number) => Promise<void>;
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
      await dispatchRows(
        checkpoint.jobs,
        Number(options.concurrency),
        io.wait ?? delay,
        io.log,
        async (address) =>
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
  wait: (ms: number) => Promise<void>,
  log: (message: string) => void,
  lookup: (address: string) => ReturnType<typeof geocode>,
) {
  const retries = new Map<string, number>();
  let waitsWithoutProgress = 0;

  for (;;) {
    let stopped = false;
    let burst: {until: number; error: GeocodingError} | undefined;

    async function worker() {
      while (!stopped) {
        const address = jobs.claim();
        if (address === undefined) return;

        try {
          const response = await lookup(address);
          jobs.complete(address, response);
          retries.delete(address);
          waitsWithoutProgress = 0;
        } catch (error) {
          if (!confirmedFailure(error)) {
            stopped = true;
            throw new Error(
              'Usage is unconfirmed. Check Team usage before resubmitting with --retry-unconfirmed.',
              {cause: error},
            );
          }

          if (
            error instanceof GeocodingError &&
            error.code === 'GEOCODING_PICK_LIMIT_EXCEEDED' &&
            error.retryAfterSeconds !== null &&
            error.retryAfterSeconds <= 120
          ) {
            const until = performance.now() + error.retryAfterSeconds * 1000;
            if (!burst || until > burst.until) burst = {until, error};
            stopped = true;
            jobs.release(address);
            return;
          }

          const used = retries.get(address) ?? 0;
          const ms = ordinaryRetryDelay(error, used);
          if (ms === undefined) {
            stopped = true;
            jobs.release(address);
            throw error;
          }

          retries.set(address, used + 1);
          log(`Retrying a geocoding request in ${ms} ms.`);
          try {
            await wait(ms);
          } finally {
            jobs.release(address);
          }
        }
      }
    }

    // Drain in-flight lookups before another worker can claim a throttled row.
    const workers = await Promise.allSettled(Array.from({length: concurrency}, worker));
    const failed = workers.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    if (!burst) return;

    const seconds = Math.max(0, Math.ceil((burst.until - performance.now()) / 1000));
    log(`Search rate limit reached. Pausing for ${seconds} s.`);
    await wait(seconds * 1000);
    waitsWithoutProgress++;
    if (waitsWithoutProgress >= 5) {
      log('Stopped after five rate-limit waits without a completed lookup. Rerun to resume.');
      throw burst.error;
    }
  }
}

function confirmedFailure(error: unknown): boolean {
  if (!(error instanceof GeocodingError)) return false;
  if (error.code) return error.code !== 'GEOCODING_USAGE_UNCONFIRMED';
  return [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status);
}

function ordinaryRetryDelay(error: unknown, used: number): number | undefined {
  if (
    !(error instanceof GeocodingError) ||
    !error.code ||
    used >= 2 ||
    ![
      'GEOCODING_UPSTREAM_THROTTLED',
      'GEOCODING_UPSTREAM_TIMEOUT',
      'GEOCODING_UPSTREAM_UNAVAILABLE',
      'GEOCODING_PICK_LIMIT_EXCEEDED',
    ].includes(error.code)
  )
    return undefined;
  const ms = error.retryAfterSeconds === null ? 250 * 2 ** used : error.retryAfterSeconds * 1000;
  return ms <= 30_000 ? ms : undefined;
}
