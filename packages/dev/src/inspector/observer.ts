import type {Map as MapLibreMap} from 'maplibre-gl';
import type {PreviewObserver, ResourceRecord} from './types';

/** URLs are reduced before entering the retained log or crossing the frame boundary. */
export function resourceAddress(input: string, base = 'http://localhost'): string {
  try {
    const url = new URL(input.replace(/^(?:tileflow-pmtiles|pmtiles):\/\//u, ''), base);
    if (!['http:', 'https:'].includes(url.protocol)) return url.protocol;
    return `${url.origin}${url.pathname}`.slice(0, 2048);
  } catch {
    return '(unavailable URL)';
  }
}

export function resourceKind(url: string, initiator = ''): string {
  if (/\.(?:pbf|mvt|mlt)(?:$|\?)/iu.test(url)) return /glyph|font/iu.test(url) ? 'Font' : 'Tile';
  if (/\.pmtiles(?:$|\?)/iu.test(url)) return 'Archive';
  if (/\/(?:\d+)\/(?:\d+)\/(?:\d+)(?:\.[a-z]+)?(?:$|\?)/iu.test(url)) return 'Tile';
  if (/sprite/iu.test(url)) return 'Sprite';
  if (/\.(?:woff2?|ttf|otf)(?:$|\?)/iu.test(url)) return 'Font';
  if (/\.(?:glb|gltf)(?:$|\?)/iu.test(url)) return 'Model';
  if (/\.json(?:$|\?)/iu.test(url)) return 'JSON';
  return initiator === 'script' || /\.m?js(?:$|\?)/iu.test(url) ? 'Script' : 'Other';
}

/** Runs before MapLibre starts. Resource timing includes buffered initial document resources. */
export function createPreviewObserver(): PreviewObserver {
  let nextId = 0;
  const seen = new Set<string>();
  const limit = 2000;
  let map: MapLibreMap | undefined;
  const observer: PreviewObserver = {
    records: [],
    revision: 0,
    dropped: 0,
    recording: true,
    attach(value) {
      map = value;
      map.on('data', onData);
      if (!map.loaded()) map.once('load', onLoad);
    },
    clear() {
      observer.records.length = 0;
      observer.dropped = 0;
      observer.revision++;
    },
    dispose() {
      performanceObserver?.disconnect();
      map?.off('data', onData);
      map?.off('load', onLoad);
      seen.clear();
    },
  };
  function onLoad() {
    observer.mapReadyMs = performance.now();
  }
  function record(entry: PerformanceResourceTiming) {
    if (!observer.recording) return;
    const key = `${entry.name}|${entry.startTime}|${entry.duration}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > limit * 2) seen.delete(seen.values().next().value!);
    const url = resourceAddress(entry.name, location.href);
    if (/\/__(?:status|events|workbench|inspection)/u.test(url)) return;
    const sizesAvailable = entry.decodedBodySize > 0 || entry.encodedBodySize > 0;
    const status = entry.responseStatus;
    const item: ResourceRecord = {
      id: ++nextId,
      url,
      name:
        /\/\d+\/\d+\/\d+(?:\.[a-z]+)?$/iu.exec(url)?.[0].slice(1) || url.split('/').pop() || url,
      kind: resourceKind(url, entry.initiatorType),
      transport: 'resource',
      start: Number.isFinite(entry.startTime) ? Math.max(0, entry.startTime) : 0,
      duration: Number.isFinite(entry.duration) && entry.duration >= 0 ? entry.duration : undefined,
      status: status ? String(status) : '—',
      ...(sizesAvailable ? {bytes: entry.encodedBodySize, transferred: entry.transferSize} : {}),
    };
    if (entry.transferSize === 0 && sizesAvailable) item.status = 'Cached';
    observer.records.push(item);
    if (observer.records.length > limit) {
      observer.records.shift();
      observer.dropped++;
    }
    observer.revision++;
  }
  function onData(event: unknown) {
    const timings = (event as {resourceTiming?: PerformanceResourceTiming[]}).resourceTiming;
    for (const timing of timings || []) record(timing);
  }
  const performanceObserver =
    typeof PerformanceObserver === 'undefined'
      ? undefined
      : new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) record(entry as PerformanceResourceTiming);
        });
  performanceObserver?.observe({type: 'resource', buffered: true});
  addEventListener('pagehide', observer.dispose, {once: true});
  return observer;
}
