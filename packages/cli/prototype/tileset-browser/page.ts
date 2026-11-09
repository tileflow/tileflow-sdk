const parameters = new URLSearchParams(location.search);
const dataset = parameters.get('dataset') as string;
// Unique per run, because a tab that never finished keeps its files locked.
const directoryName = `tileflow-build-${dataset}-${Date.now()}`;

async function post(path: string, body: unknown): Promise<void> {
  await fetch(path, {
    body: JSON.stringify(body),
    headers: {'content-type': 'application/json'},
    method: 'POST',
  });
}

async function seedInput(): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(`${dataset}.input`, {create: true});
  const expected = Number(parameters.get('inputSize'));
  const existing = await handle.getFile();
  if (existing.size === expected) return existing;
  const response = await fetch(`/data/${dataset}.geojson`);
  const writable = await handle.createWritable();
  await (response.body as ReadableStream<Uint8Array>).pipeTo(writable);
  return handle.getFile();
}

async function run(): Promise<void> {
  const input = await seedInput();
  await post('/seeded', {size: input.size, estimate: await navigator.storage.estimate()});

  const worker = new Worker('/tile-worker.js');
  const finished = new Promise<Record<string, unknown>>((resolve, reject) => {
    worker.onerror = (event) => reject(new Error(event.message));
    worker.onmessage = ({data}: MessageEvent<Record<string, unknown>>) => {
      if (data.phase === 'progress') void post('/progress', data);
      if (data.phase === 'done') resolve(data);
      else if (data.phase === 'failed') reject(new Error(String(data.message)));
    };
  });
  worker.postMessage({
    directory: directoryName,
    generatorVersion: parameters.get('version'),
    gzipWorkers: Number(parameters.get('gzipWorkers') ?? 0),
    input,
    layer: dataset,
  });
  const started = performance.now();
  const result = await finished;
  const wallMs = performance.now() - started;
  worker.terminate();

  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(directoryName);
  const archive = await (await directory.getFileHandle('archive.pmtiles')).getFile();
  if (parameters.get('upload') !== '0') {
    await fetch('/archive', {body: archive, method: 'POST'});
  }
  await post('/done', {result, userAgent: navigator.userAgent, wallMs, archiveSize: archive.size});
  await root.removeEntry(directoryName, {recursive: true});
  if (parameters.get('clean') === '1') {
    await root.removeEntry(`${dataset}.input`);
  }
}

// When the harness has gone, stop the workers instead of leaving a tab running.
setInterval(() => {
  fetch('/').catch(() => location.replace('about:blank'));
}, 5000);

run().catch((error: unknown) => {
  void post('/failed', {
    message: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
});
