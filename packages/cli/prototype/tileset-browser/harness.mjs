// Measures the GeoJSON tiling prototype in a real browser and writes one JSON report per run.
// Usage: node harness.mjs --browser chrome|firefox|safari --dataset points --data-dir <dir>
//   [--gzip-workers 3] [--cpu 50] [--no-upload] [--out <dir>] [--generator-version <v>] [--clean]
// Refuses to continue when the disk holding --out drops below 15 GB free.
import {execFileSync, spawn} from 'node:child_process';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {values} = parseArgs({
  options: {
    browser: {type: 'string', default: 'chrome'},
    clean: {type: 'boolean', default: false},
    cpu: {type: 'string'},
    'data-dir': {type: 'string'},
    dataset: {type: 'string', default: 'points'},
    foreground: {type: 'boolean', default: false},
    'generator-version': {type: 'string', default: '0.0.0-development'},
    'gzip-workers': {type: 'string', default: '0'},
    label: {type: 'string'},
    'no-upload': {type: 'boolean', default: false},
    out: {type: 'string', default: join(tmpdir(), 'tileflow-browser-build')},
    'timeout-seconds': {type: 'string', default: '1200'},
    'profile-dir': {type: 'string'},
  },
});
const outDirectory = resolve(values.out);
mkdirSync(outDirectory, {recursive: true});
const label =
  values.label ??
  `${values.browser}-${values.dataset}-gzip${values['gzip-workers']}-cpu${values.cpu ?? 100}`;
const inputPath = join(resolve(values['data-dir']), `${values.dataset}.geojson`);

// Bundling
const esbuild = require(require.resolve('esbuild', {paths: [require.resolve('tsup')]}));
const bundleDirectory = join(outDirectory, 'bundle');
esbuild.buildSync({
  bundle: true,
  entryPoints: [join(here, 'page.ts'), join(here, 'tile-worker.ts'), join(here, 'gzip-worker.ts')],
  format: 'iife',
  minify: false,
  outdir: bundleDirectory,
  platform: 'browser',
  target: 'es2022',
});

const contentTypes = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
};
const indexHtml = `<!doctype html><meta charset="utf-8"><title>Tiling</title><script src="/page.js"></script>`;

let resolveDone;
let rejectDone;
const done = new Promise((success, failure) => {
  resolveDone = success;
  rejectDone = failure;
});
let startedAt = null;
let archivePath = null;
const events = [];

function json(request) {
  return new Promise((success) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => success(JSON.parse(text)));
  });
}

const server = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  const url = new URL(request.url, 'http://127.0.0.1');
  try {
    if (request.method === 'GET') {
      if (url.pathname === '/') {
        response.setHeader('content-type', contentTypes.html);
        response.end(indexHtml);
      } else if (url.pathname.startsWith('/data/')) {
        response.setHeader('content-type', 'application/geo+json');
        await pipeline(createReadStream(inputPath), response);
      } else {
        response.setHeader('content-type', contentTypes.js);
        await pipeline(createReadStream(join(bundleDirectory, url.pathname.slice(1))), response);
      }
      return;
    }
    if (url.pathname === '/seeded') {
      events.push({at: Date.now(), event: 'seeded', ...(await json(request))});
      startedAt = Date.now();
      onRunStarted();
    } else if (url.pathname === '/progress') {
      const {message} = await json(request);
      events.push({at: Date.now() - startedAt, message});
    } else if (url.pathname === '/archive') {
      archivePath = join(outDirectory, `${label}.pmtiles`);
      await pipeline(request, createWriteStream(archivePath));
    } else if (url.pathname === '/done') {
      resolveDone(await json(request));
    } else if (url.pathname === '/failed') {
      rejectDone(new Error((await json(request)).message));
    }
    response.end('ok');
  } catch (error) {
    response.statusCode = 500;
    response.end(String(error));
  }
});
await new Promise((success) => server.listen(0, '127.0.0.1', success));
const port = server.address().port;

const query = new URLSearchParams({
  dataset: values.dataset,
  gzipWorkers: values['gzip-workers'],
  inputSize: String(statSync(inputPath).size),
  version: values['generator-version'],
});
if (values.clean) query.set('clean', '1');
if (values['no-upload']) query.set('upload', '0');
const pageUrl = `http://127.0.0.1:${port}/?${query}`;

// Browser processes
function processTable() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,pcpu=,command='], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return rows
    .trim()
    .split('\n')
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
      return {
        command: match[5],
        cpu: Number(match[4]),
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rss: Number(match[3]) * 1024,
      };
    });
}

function descendants(table, root) {
  const found = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of table) {
      if (found.has(row.ppid) && !found.has(row.pid)) {
        found.add(row.pid);
        grew = true;
      }
    }
  }
  return table.filter((row) => found.has(row.pid));
}

let child = null;
let contentProcesses;
const profile = values['profile-dir'] ?? join(outDirectory, `profile-${values.browser}`);
if (values.browser === 'chrome') {
  mkdirSync(profile, {recursive: true});
  child = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      pageUrl,
    ],
    {stdio: 'ignore'},
  );
  contentProcesses = (table) =>
    descendants(table, child.pid).filter((row) => row.command.includes('--type=renderer'));
} else if (values.browser === 'firefox') {
  mkdirSync(profile, {recursive: true});
  child = spawn(
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    ['--headless', '--no-remote', '--profile', profile, pageUrl],
    {env: {...process.env, MOZ_HEADLESS: '1'}, stdio: 'ignore'},
  );
  contentProcesses = (table) =>
    descendants(table, child.pid).filter((row) => row.command.includes('-isForBrowser'));
} else {
  execFileSync('open', [...(values.foreground ? [] : ['-g']), '-a', 'Safari', pageUrl]);
  contentProcesses = (table) =>
    table.filter((row) => row.command.includes('com.apple.WebKit.WebContent'));
}

// Sampling and throttling
const baseline = new Map();
let peakRss = 0;
let peakPid = null;
const samples = [];
let sampleTimer = null;

function sample() {
  const processes = contentProcesses(processTable());
  for (const row of processes) {
    if (!baseline.has(row.pid)) baseline.set(row.pid, row.rss);
    const delta = row.rss - baseline.get(row.pid);
    if (startedAt !== null && values.browser === 'safari' && delta < 32 * 1024 * 1024) continue;
    if (startedAt !== null && row.rss > peakRss) {
      peakRss = row.rss;
      peakPid = row.pid;
    }
  }
  if (startedAt !== null) {
    samples.push({
      rss: processes.reduce((largest, row) => Math.max(largest, row.rss), 0),
      t: Date.now() - startedAt,
    });
  }
}
sampleTimer = setInterval(sample, 500);

let dutyProcess = null;
let dutyReport = null;

function onRunStarted() {
  if (values.cpu === undefined || values.browser === 'safari') return;
  const targets = contentProcesses(processTable()).map((row) => String(row.pid));
  dutyProcess = spawn(process.execPath, [join(here, 'duty-cycle.mjs'), values.cpu, ...targets], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  dutyProcess.stdout.on('data', (data) => {
    dutyReport = JSON.parse(String(data));
  });
}

async function stopThrottle() {
  if (!dutyProcess) return;
  const exited = new Promise((success) => dutyProcess.once('exit', success));
  dutyProcess.kill('SIGTERM');
  await exited;
}

function freeBytes() {
  const row = execFileSync('df', ['-k', outDirectory]).toString().trim().split('\n').at(-1);
  return Number(row.trim().split(/\s+/)[3]) * 1024;
}
const minimumFreeBytes = 15 * 1024 ** 3;
const diskGuard = setInterval(() => {
  if (freeBytes() < minimumFreeBytes) {
    rejectDone(new Error('Stopped: fewer than 15 GB are free on the output disk.'));
  }
}, 2000);

// Result
let report;
try {
  const outcome = await Promise.race([
    done,
    new Promise((_, failure) =>
      setTimeout(
        () => failure(new Error(`timed out after ${values['timeout-seconds']} s`)),
        Number(values['timeout-seconds']) * 1000,
      ),
    ),
  ]);
  report = {
    browser: values.browser,
    cpuPercent: values.cpu === undefined ? 100 : Number(values.cpu),
    dataset: values.dataset,
    finishedAt: new Date().toISOString(),
    gzipWorkers: Number(values['gzip-workers']),
    label,
    peakContentProcessRssBytes: peakRss,
    peakPid,
    ...outcome,
  };
  if (archivePath) {
    report.archivePath = archivePath;
    report.sha256 = execFileSync('shasum', ['-a', '256', archivePath]).toString().split(' ')[0];
    const inspection = await import(
      pathToFileURL(join(here, '../../../dev/dist/tilesets.js')).href
    ).then((module) => module.inspectTileflowPmtiles(archivePath, {sample: true}));
    report.inspection = {
      entries: inspection.archive?.addressedTileCount,
      summary: Object.keys(inspection),
      warnings: inspection.warnings.map((item) => item.message),
    };
  }
} catch (error) {
  report = {browser: values.browser, dataset: values.dataset, failed: String(error), label};
} finally {
  clearInterval(sampleTimer);
  clearInterval(diskGuard);
  await stopThrottle();
  server.close();
  if (child) {
    const exited = new Promise((success) => child.once('exit', success));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((success) => setTimeout(success, 5000))]);
    child.kill('SIGKILL');
    await new Promise((success) => setTimeout(success, 1000));
  }
}
report.dutyCycle = dutyReport;
report.lastEvents = events.slice(-4);
report.rssTimeline = samples.filter((_, index) => index % 2 === 0);
writeFileSync(join(outDirectory, `${label}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({...report, rssTimeline: undefined}, null, 2));
if (values.browser !== 'safari' && values['profile-dir'] === undefined) {
  rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 500});
}
process.exit(report.failed ? 1 : 0);
