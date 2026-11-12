import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {cliFixtureArguments} from '../../../test-support/cli-fixture';
import {geocodeCsv, type GeocodeCsvOptions} from '../src/geocode-batch';

const units = 83;
const attribution = [{text: 'Fixture credits', url: 'https://example.org/credits'}];
const runCli = promisify(execFile);
const confirmed = {confirm: async () => true, log: () => {}};

async function workspace(t: TestContext, csv: string) {
  const dir = await mkdtemp(join(tmpdir(), 'tileflow-geocode-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const input = join(dir, 'stores.csv');
  const output = join(dir, 'points.geojson');
  await writeFile(input, csv);
  const options: GeocodeCsvOptions = {
    output,
    addressColumns: ['address'],
    concurrency: '1',
    apiKey: 'synthetic-key',
    yes: true,
  };
  return {input, output, options, dir};
}

function stored(found = true) {
  return {
    usage: {units},
    schemaVersion: 1,
    retention: 'persistent',
    queryId: 'gq_11111111-1111-4111-8111-111111111111',
    source: {id: 'fixture', revision: null},
    attribution,
    results: found
      ? [{kind: 'address', label: 'Synthetic address', address: {}, position: [-9.1, 38.7]}]
      : [],
  };
}

function provider(lookup: (address: string) => Promise<Response> | Response) {
  return (async (resource, init) => {
    if (String(resource).endsWith('/storage')) return Response.json({unitsPerRequest: units});
    assert.ok(String(resource).endsWith('/forward'));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.retention, 'persistent');
    assert.equal(body.expectedUnits, units);
    assert.equal(body.limit, 1);
    return lookup(body.query);
  }) satisfies typeof fetch;
}

function refusal(code: string, status: number, seconds: number | null = 0) {
  return Response.json(
    {code, error: 'Synthetic refusal'},
    {
      status,
      headers: seconds === null ? {} : {'Retry-After': String(seconds)},
    },
  );
}

test('CLI confirms before sending addresses and builds a PMTiles layer from ordered CSV rows', async (t) => {
  const {input, output, dir} = await workspace(
    t,
    '\ufeffid,street,city,zip\r\n001,"Test, Road",Sample,00123\r\n002,"Test, Road",Sample,00456\r\n003,Missing,Other,00999\r\n004,,,00000\r\n',
  );
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    assert.equal(req.headers.authorization, 'Bearer synthetic-key');
    if (req.url === '/v1/geocoding/storage') {
      calls.push('estimate');
      res.end(JSON.stringify({unitsPerRequest: units}));
      return;
    }
    assert.equal(req.url, '/v1/geocoding/forward');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(request.retention, 'persistent');
    assert.equal(request.expectedUnits, units);
    calls.push(request.query);
    res.end(JSON.stringify(stored(request.query !== 'Missing, Other')));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const args = [
    'geocode',
    input,
    '-o',
    output,
    '--address-columns',
    'street',
    'city',
    '--api-url',
    apiUrl,
    '--concurrency',
    '1',
  ];
  const env = {...process.env, TILEFLOW_API_KEY: 'synthetic-key'};
  await assert.rejects(runCli(process.execPath, cliFixtureArguments(args), {env}), (error) => {
    const stderr = (error as {stderr: string}).stderr;
    return stderr.includes('166 shared API units') && stderr.includes('--yes');
  });
  assert.deepEqual(calls, ['estimate']);

  await runCli(process.execPath, cliFixtureArguments([...args, '--yes']), {env});
  assert.deepEqual(calls, ['estimate', 'estimate', 'Test, Road, Sample', 'Missing, Other']);
  const data = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(data.attribution, attribution);
  assert.deepEqual(
    data.features.map(
      (f: {id: number; properties: {zip: string}; geometry: {coordinates: number[]}}) => [
        f.id,
        f.properties.zip,
        f.geometry.coordinates,
      ],
    ),
    [
      [2, '00123', [-9.1, 38.7]],
      [3, '00456', [-9.1, 38.7]],
    ],
  );
  assert.equal(
    await readFile(output + '.unmatched.csv', 'utf8'),
    'row,reason\n4,no_match\n5,empty_address\n',
  );

  await runCli(process.execPath, cliFixtureArguments(args), {env});
  assert.equal(calls.length, 4);
  const pmtiles = join(dir, 'stores.pmtiles');
  const {stdout} = await runCli(
    process.execPath,
    cliFixtureArguments([
      'tileset',
      'build',
      output,
      '-o',
      pmtiles,
      '--minzoom',
      '0',
      '--maxzoom',
      '0',
      '--attribution',
      'Fixture credits (https://example.org/credits)',
      '--json',
    ]),
  );
  assert.equal(JSON.parse(stdout).input.features, 2);
  assert.equal((await readFile(pmtiles)).subarray(0, 7).toString(), 'PMTiles');
});

test('completed rows survive a quota stop, an edited input and a bounded throttling retry', async (t) => {
  const {input, output, options} = await workspace(t, 'address\nFirst\nMissing\nLast\n');
  const calls: string[] = [];
  let phase = 0;
  const lookup = provider((address) => {
    calls.push(address);
    if (address === 'Last' && phase++ === 0) return refusal('GEOCODING_QUOTA_EXCEEDED', 429);
    if (address === 'Last' && phase === 2) return refusal('GEOCODING_UPSTREAM_THROTTLED', 429);
    return Response.json(stored(address !== 'Missing'));
  });
  await assert.rejects(geocodeCsv(input, options, {...confirmed, fetch: lookup}), {
    code: 'GEOCODING_QUOTA_EXCEEDED',
  });
  await writeFile(input, 'address\nChanged\n');
  await assert.rejects(geocodeCsv(input, options, {...confirmed, fetch: lookup}), /changed/u);
  await writeFile(input, 'address\nFirst\nMissing\nLast\n');
  await geocodeCsv(input, options, {...confirmed, fetch: lookup});
  assert.deepEqual(calls, ['First', 'Missing', 'Last', 'Last', 'Last']);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).features.length, 2);
});

test('unconfirmed requests need explicit resubmission and a new estimate', async (t) => {
  const {input, options} = await workspace(t, 'address\nFirst\nSecond\n');
  let attempts = 0;
  const fetch = provider(() =>
    ++attempts === 1 ? refusal('GEOCODING_USAGE_UNCONFIRMED', 503) : Response.json(stored()),
  );
  await assert.rejects(geocodeCsv(input, options, {...confirmed, fetch}), /unconfirmed/iu);
  await assert.rejects(geocodeCsv(input, options, {...confirmed, fetch}), /--retry-unconfirmed/u);
  assert.equal(attempts, 1);

  const messages: string[] = [];
  await assert.rejects(
    geocodeCsv(
      input,
      {...options, retryUnconfirmed: true, yes: false},
      {fetch, log: (text) => messages.push(text), confirm: async () => false},
    ),
    /Canceled/u,
  );
  assert.equal(attempts, 1);
  assert.ok(messages.some((text) => text.includes('166 shared API units')));
  await geocodeCsv(input, {...options, retryUnconfirmed: true}, {...confirmed, fetch});
  assert.equal(attempts, 3);
});

test('limits concurrency, excludes overlapping runs and protects existing output', async (t) => {
  const {input, output, options} = await workspace(t, 'address\nA\nB\nC\nD\n');
  let active = 0;
  let peak = 0;
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let allow!: () => void;
  const resume = new Promise<void>((resolve) => {
    allow = resolve;
  });
  const fetch = provider(async () => {
    peak = Math.max(++active, peak);
    notifyStarted();
    await resume;
    await delay(1);
    active--;
    return Response.json(stored());
  });
  const running = geocodeCsv(input, {...options, concurrency: '2'}, {...confirmed, fetch});
  await started;
  try {
    await assert.rejects(
      geocodeCsv(input, options, {...confirmed, fetch}),
      /another geocode process/iu,
    );
  } finally {
    allow();
    await running;
  }
  assert.equal(peak, 2);
  await writeFile(output, 'edited');
  await assert.rejects(
    geocodeCsv(input, options, {...confirmed, fetch}),
    /differs from the checkpoint/u,
  );
  assert.equal(await readFile(output, 'utf8'), 'edited');
});

test('a refused first estimate leaves the output free for a corrected CSV', async (t) => {
  const {input, options} = await workspace(t, 'address\nOriginal\n');
  let calls = 0;
  const fetch = provider(() => {
    calls++;
    return Response.json(stored());
  });
  await assert.rejects(
    geocodeCsv(input, {...options, yes: false}, {log: () => {}, confirm: async () => false, fetch}),
    /Canceled/u,
  );
  assert.equal(calls, 0);
  await writeFile(input, 'address\nCorrected\n');
  await geocodeCsv(input, options, {...confirmed, fetch});
  assert.equal(calls, 1);
});

test('quoted address column names can contain other CSV delimiters', async (t) => {
  const {input, output, options} = await workspace(
    t,
    '"address; street; city",id\r\n"One, Plaza",001\r\n',
  );
  const fetch = provider((address) => {
    assert.equal(address, 'One, Plaza');
    return Response.json(stored());
  });
  await geocodeCsv(
    input,
    {...options, addressColumns: ['address; street; city']},
    {...confirmed, fetch},
  );
  assert.equal(JSON.parse(await readFile(output, 'utf8')).features[0].properties.id, '001');
});

test('a minute burst pauses both workers, then resumes every address exactly once', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const {input, options} = await workspace(t, 'address\nA\nB\nC\nD\n');
  const complete: string[] = [];
  const waits: number[] = [];
  const messages: string[] = [];
  const cStarted = Promise.withResolvers<void>();
  let resumed = false;
  let refused = false;
  const fetch = provider(async (address) => {
    if (address === 'B' && !refused) {
      await cStarted.promise;
      refused = true;
      return refusal('GEOCODING_PICK_LIMIT_EXCEEDED', 429, 60);
    }
    if (address === 'C') {
      cStarted.resolve();
      await delay(5);
    }
    if (address === 'D' || (address === 'B' && refused)) assert.ok(resumed);
    complete.push(address);
    return Response.json(stored());
  });
  await geocodeCsv(
    input,
    {...options, concurrency: '2'},
    {
      ...confirmed,
      fetch,
      log: (message) => messages.push(message),
      wait: async (ms: number) => {
        waits.push(ms);
        await delay(10);
        resumed = true;
      },
    },
  );
  assert.deepEqual(waits, [60_000]);
  assert.equal(messages.filter((message) => message.includes('60')).length, 1);
  assert.deepEqual(complete.sort(), ['A', 'B', 'C', 'D']);
});

test('a daily limit releases the row for the next run without a wait', async (t) => {
  const {input, options} = await workspace(t, 'address\nFirst\nSecond\n');
  const calls: string[] = [];
  const fetch = provider((address) => {
    calls.push(address);
    return calls.length === 2
      ? refusal('GEOCODING_PICK_LIMIT_EXCEEDED', 429, 3600)
      : Response.json(stored());
  });
  const io = {...confirmed, fetch, wait: async () => assert.fail('unexpected wait')};
  await assert.rejects(geocodeCsv(input, options, io), {code: 'GEOCODING_PICK_LIMIT_EXCEEDED'});
  await geocodeCsv(input, options, io);
  assert.deepEqual(calls, ['First', 'Second', 'Second']);
});

test('the persistent daily ceiling stops cleanly with a resume time and keeps completed rows', async (t) => {
  const {input, output, options} = await workspace(t, 'address\nFirst\nSecond\nThird\n');
  const calls: string[] = [];
  let capped = true;
  const fetch = provider((address) => {
    calls.push(address);
    return capped && address === 'Second'
      ? refusal('GEOCODING_PERSISTENCE_LIMIT_REACHED', 429, 7200)
      : Response.json(stored());
  });
  const io = {...confirmed, fetch, wait: async () => assert.fail('unexpected wait')};
  await assert.rejects(geocodeCsv(input, options, io), (error: Error) => {
    assert.match(error.message, /daily persistent Search limit/u);
    assert.match(error.message, /after \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/u);
    assert.equal((error.cause as {code: string}).code, 'GEOCODING_PERSISTENCE_LIMIT_REACHED');
    return true;
  });
  capped = false;
  await geocodeCsv(input, options, io);
  assert.deepEqual(calls, ['First', 'Second', 'Second', 'Third']);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).features.length, 3);
});

test('the estimate announces how many days a list longer than the daily ceiling needs', async (t) => {
  const {input, options} = await workspace(t, 'address\nA\nB\nC\nD\nE\n');
  const logs: string[] = [];
  const fetch = (async (resource, init) => {
    if (String(resource).endsWith('/storage'))
      return Response.json({unitsPerRequest: units, dailyRequestLimit: 2});
    return provider(() => Response.json(stored()))(resource, init);
  }) satisfies typeof fetch;
  await geocodeCsv(input, options, {...confirmed, fetch, log: (line) => logs.push(line)});
  assert.ok(
    logs.some((line) => line.includes('about 2 results per UTC day') && line.includes('3 days')),
  );
});

test('five shared burst waits without progress stop cleanly and leave every row resumable', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const {input, options} = await workspace(t, 'address\nA\nB\n');
  const waits: number[] = [];
  const calls: string[] = [];
  let limited = true;
  const fetch = provider((address) => {
    calls.push(address);
    return limited ? refusal('GEOCODING_PICK_LIMIT_EXCEEDED', 429, 120) : Response.json(stored());
  });
  const io = {
    ...confirmed,
    fetch,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
  const parallel = {...options, concurrency: '2'};
  await assert.rejects(geocodeCsv(input, parallel, io), {code: 'GEOCODING_PICK_LIMIT_EXCEEDED'});
  assert.deepEqual(waits, Array(5).fill(120_000));
  limited = false;
  calls.length = 0;
  await geocodeCsv(input, parallel, io);
  assert.deepEqual(calls.sort(), ['A', 'B']);
});

test('completed rows reset the burst streak and ordinary retries retain their limits', async (t) => {
  t.mock.method(performance, 'now', () => 0);
  const {input, options} = await workspace(t, 'address\nA\nB\n');
  const attempts = new Map<string, number>();
  const waits: number[] = [];
  const fetch = provider((address) => {
    const attempt = (attempts.get(address) ?? 0) + 1;
    attempts.set(address, attempt);
    if (attempt <= 2) return refusal('GEOCODING_PICK_LIMIT_EXCEEDED', 429, null);
    if (attempt <= 6) return refusal('GEOCODING_PICK_LIMIT_EXCEEDED', 429, 60);
    return Response.json(stored(false));
  });
  await geocodeCsv(input, options, {
    ...confirmed,
    fetch,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(
    waits,
    [...Array(2)].flatMap(() => [250, 500, 60_000, 60_000, 60_000, 60_000]),
  );
});

test('normal retries stop at two attempts after the first failure and honor the 30-second cap', async (t) => {
  for (const [code, seconds, expectedWaits] of [
    ['GEOCODING_PICK_LIMIT_EXCEEDED', null, [250, 500]],
    ['GEOCODING_UPSTREAM_THROTTLED', 30, [30_000, 30_000]],
    ['GEOCODING_UPSTREAM_THROTTLED', 31, []],
  ] as const) {
    const {input, options} = await workspace(t, 'address\nA\n');
    const waits: number[] = [];
    const signals = new Set<AbortSignal | null | undefined>();
    const send = provider(() => refusal(code, 429, seconds));
    const fetch: typeof globalThis.fetch = (resource, init) => {
      if (init?.method === 'POST') signals.add(init.signal);
      return send(resource, init);
    };
    await assert.rejects(
      geocodeCsv(input, options, {
        ...confirmed,
        fetch,
        wait: async (ms) => {
          waits.push(ms);
        },
      }),
      {code},
    );
    assert.deepEqual(waits, expectedWaits);
    assert.equal(signals.size, expectedWaits.length + 1);
    assert.ok([...signals].every((signal) => signal instanceof AbortSignal));
    await geocodeCsv(input, options, {
      ...confirmed,
      fetch: provider(() => Response.json(stored())),
    });
  }
});
