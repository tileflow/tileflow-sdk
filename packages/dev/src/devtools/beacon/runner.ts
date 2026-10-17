import {Color, isExpression} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {mapValue} from '../map-value';
import {evaluatedValue} from '../style-edits';
import {visibleTiles} from '../tiles';
import type {PreviewWindow, Side, TileRecord} from '../types';
import {
  analyzeAudit,
  type AuditReport,
  type Camera,
  compositeColor,
  contrastRatio,
  type Finding,
  type LabelSample,
  percentile,
  type Scenario,
} from './audit';
import {sampledTextSize} from './quality';
import {previewViewport, type ViewportSize} from './viewport';

export function readCamera(map: MapLibreMap): Camera {
  const center = map.getCenter();
  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}
export function moveCamera(map: MapLibreMap, camera: Camera, duration = 0, userInput = false) {
  const options = mapValue(map, {...camera, duration});
  const event = {tileflowDevtools: true, ...(userInput ? {tileflowUserCamera: true} : {})};
  if (duration) map.easeTo(options, event);
  else map.jumpTo(options, event);
}
export function styleIssues(style: StyleSpecification): Finding[] {
  const ids = new Set<string>();
  return style.layers.flatMap((layer) => {
    if (layer.id.startsWith('__tileflow-devtools-')) return [];
    const issues: Finding[] = [];
    if (ids.has(layer.id))
      issues.push({layer: layer.id, message: `Duplicate layer ID: ${layer.id}`});
    ids.add(layer.id);
    if ('source' in layer && typeof layer.source === 'string' && !style.sources[layer.source])
      issues.push({layer: layer.id, message: `Missing source: ${layer.source}`});
    if ((layer.minzoom ?? 0) >= (layer.maxzoom ?? 24))
      issues.push({layer: layer.id, message: 'The layer has an empty zoom range.'});
    return issues;
  });
}
function sampleCoordinate(feature: MapGeoJSONFeature): [number, number] | undefined {
  const geometry = feature.geometry;
  const coordinates =
    geometry.type === 'Point'
      ? geometry.coordinates
      : geometry.type === 'LineString'
        ? geometry.coordinates[Math.floor(geometry.coordinates.length / 2)]
        : undefined;
  return coordinates && [coordinates[0], coordinates[1]];
}
/** Bounded samples of evaluated style properties. Never changes a layer or reads GPU pixels. */
export function sampleLabels(map: MapLibreMap, limit = 40): LabelSample[] {
  const style = map.getStyle(),
    camera = readCamera(map),
    samples: LabelSample[] = [];
  const seen = new Set<string>();
  // Share the bounded label sample between layers; a dense topmost POI layer must
  // not crowd road or place labels out of the text-size benchmark.
  const byLayer = new Map<string, MapGeoJSONFeature[]>();
  for (const feature of map.queryRenderedFeatures().slice(0, 5000)) {
    if (feature.layer.type !== 'symbol' || !feature.layer.layout?.['text-field']) continue;
    const list = byLayer.get(feature.layer.id) ?? [];
    list.push(feature);
    byLayer.set(feature.layer.id, list);
  }
  const features: MapGeoJSONFeature[] = [];
  let groups = [...byLayer.values()];
  for (let index = 0; groups.length; index++) {
    groups = groups.filter((group) => index < group.length);
    for (const group of groups) features.push(group[index]);
  }
  for (const feature of features) {
    if (feature.layer.type !== 'symbol' || !feature.layer.layout?.['text-field']) continue;
    const id = feature.layer.id;
    if (id.startsWith('__tileflow-devtools-')) continue;
    const text = evaluatedValue(map, id, 'layout', 'text-field', feature);
    if (typeof text !== 'string' || !text.trim()) continue;
    const identity = `${id}:${feature.id ?? text}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const color = evaluatedValue(map, id, 'paint', 'text-color', feature);
    const opacity = evaluatedValue(map, id, 'paint', 'text-opacity', feature);
    if (opacity === 0) continue;
    const size = sampledTextSize(map, feature);
    const halo = evaluatedValue(map, id, 'paint', 'text-halo-color', feature);
    const haloWidth = evaluatedValue(map, id, 'paint', 'text-halo-width', feature);
    const coordinate = sampleCoordinate(feature);
    let background: string | undefined;
    let method = 'Background unavailable';
    if (
      typeof halo === 'string' &&
      Color.parse(halo)?.a === 1 &&
      typeof haloWidth === 'number' &&
      haloWidth >= 1 &&
      opacity === 1
    ) {
      background = halo;
      method = 'opaque halo';
    } else if (coordinate && map.getPitch() === 0) {
      const point = map.project(mapValue(map, coordinate));
      const canvas = map.getCanvas();
      if (
        point.x >= 0 &&
        point.x <= canvas.clientWidth &&
        point.y >= 0 &&
        point.y <= canvas.clientHeight
      ) {
        const backgroundLayer = [...style.layers]
          .reverse()
          .find((layer) => layer.type === 'background' && layer.layout?.visibility !== 'none');
        const base =
          backgroundLayer && evaluatedValue(map, backgroundLayer.id, 'paint', 'background-color');
        const baseOpacity =
          backgroundLayer && evaluatedValue(map, backgroundLayer.id, 'paint', 'background-opacity');
        if (typeof base === 'string' && Color.parse(base)?.a === 1 && baseOpacity === 1)
          background = base;
        const stack = map
          .queryRenderedFeatures(point)
          .filter(
            (item) =>
              item.layer.type !== 'symbol' && !item.layer.id.startsWith('__tileflow-devtools-'),
          );
        const unsupported =
          style.layers.some(
            (layer) =>
              ['raster', 'hillshade', 'color-relief', 'custom'].includes(layer.type) &&
              layer.layout?.visibility !== 'none',
          ) || stack.some((item) => item.layer.type !== 'fill');
        if (unsupported) background = undefined;
        else
          for (const fill of stack.reverse()) {
            const pattern = evaluatedValue(map, fill.layer.id, 'paint', 'fill-pattern', fill);
            const fillColor = evaluatedValue(map, fill.layer.id, 'paint', 'fill-color', fill);
            const fillOpacity = evaluatedValue(map, fill.layer.id, 'paint', 'fill-opacity', fill);
            if (
              pattern ||
              typeof fillColor !== 'string' ||
              typeof fillOpacity !== 'number' ||
              !background
            ) {
              background = undefined;
              break;
            }
            background = compositeColor(fillColor, background, fillOpacity);
          }
        method = 'estimated fill stack at anchor';
      }
    }
    const foreground =
      typeof color === 'string' && background && typeof opacity === 'number'
        ? compositeColor(color, background, opacity)
        : undefined;
    samples.push({
      layer: id,
      featureId: feature.id,
      camera,
      coordinate,
      message: text.slice(0, 100),
      size: typeof size === 'number' && Number.isFinite(size) ? size : undefined,
      ratio: foreground && background ? contrastRatio(foreground, background) : undefined,
      background: method,
    });
    if (samples.length >= limit) break;
  }
  return samples;
}
export type RunOptions = {
  side: Side;
  profile: AuditReport['profile'];
  signal: AbortSignal;
  isCurrent: () => boolean;
  progress: (fraction: number, message: string) => void;
};
export function analyzeStyleCost(style: StyleSpecification, zooms: number[]) {
  const layers = style.layers.filter((layer) => !layer.id.startsWith('__tileflow-devtools-'));
  const expressions: (Finding & {nodes: number})[] = [];
  const count = (value: unknown, depth = 0): number =>
    depth > 32
      ? 1
      : Array.isArray(value)
        ? 1 + value.slice(0, 2048).reduce<number>((sum, child) => sum + count(child, depth + 1), 0)
        : 1;
  for (const layer of layers)
    for (const [property, value] of Object.entries({...layer.layout, ...layer.paint})) {
      if (!isExpression(value)) continue;
      const nodes = count(value);
      if (nodes >= 20)
        expressions.push({
          layer: layer.id,
          nodes,
          message: `${property}: ${nodes} expression nodes`,
        });
    }
  return {
    activeLayers: Math.max(
      0,
      ...zooms.map(
        (zoom) =>
          layers.filter(
            (layer) =>
              layer.layout?.visibility !== 'none' &&
              zoom >= (layer.minzoom ?? 0) &&
              zoom < (layer.maxzoom ?? 24),
          ).length,
      ),
    ),
    sources: Object.keys(style.sources).filter((id) => !id.startsWith('__tileflow-devtools-'))
      .length,
    geojson: Object.entries(style.sources).flatMap(([name, source]) =>
      source.type === 'geojson' && typeof source.data === 'object'
        ? [{name, bytes: new TextEncoder().encode(JSON.stringify(source.data)).byteLength}]
        : [],
    ),
    expressions: expressions.sort((a, b) => b.nodes - a.nodes).slice(0, 8),
  };
}
export async function runAudit({
  side,
  profile,
  signal,
  isCurrent,
  progress,
}: RunOptions): Promise<AuditReport> {
  const map = side.map;
  const win = side.frame.contentWindow as PreviewWindow | null;
  if (!map || !win || !map.isStyleLoaded())
    throw new Error('Wait for the map style to finish loading.');
  const document = map.getCanvas().ownerDocument;
  if (document.hidden) throw new Error('Keep the map visible while running an audit.');
  const original = readCamera(map),
    start = performance.now(),
    epoch = side.loadEpoch;
  const style = map.getStyle(),
    signature = JSON.stringify(style);
  const canvas = map.getCanvas();
  const viewport = {
    width: canvas.clientWidth,
    height: canvas.clientHeight,
    dpr: win.devicePixelRatio,
  };
  const viewportControl = previewViewport(side.frame, map);
  const paneBounds = side.frame.parentElement!.getBoundingClientRect();
  let expectedViewport = {...viewport};
  const resources = win.__tileflowDevtoolsObserver;
  const originalRecording = resources?.recording,
    firstId = resources?.records.at(-1)?.id || 0;
  if (resources) resources.recording = true;
  const frames: number[] = [],
    labels: LabelSample[] = [],
    tiles = new Map<string, TileRecord>();
  const scenarios: Scenario[] = [];
  const missing = new Set<string>();
  let interrupted = false,
    resized = false,
    changingViewport = false,
    sampling = false,
    frame: number | undefined,
    lastFrame: number | undefined;
  const userMove = (event: {originalEvent?: unknown}) => {
    if (event.originalEvent) interrupted = true;
  };
  const resize = () => {
    if (
      !changingViewport &&
      (canvas.clientWidth !== expectedViewport.width ||
        canvas.clientHeight !== expectedViewport.height)
    )
      resized = true;
  };
  const missingImage = (event: {id: string}) => {
    if (missing.size < 100) missing.add(event.id);
  };
  map.on('movestart', userMove);
  map.on('resize', resize);
  map.on('styleimagemissing', missingImage);
  function assertCurrent() {
    if (signal.aborted) throw new Error('Audit cancelled.');
    if (interrupted) throw new Error('Audit stopped because you moved the map.');
    const bounds = side.frame.parentElement!.getBoundingClientRect();
    if (resized || bounds.width !== paneBounds.width || bounds.height !== paneBounds.height)
      throw new Error('The viewport changed. Run the audit again at its new size.');
    if (!isCurrent() || side.map !== map || side.loadEpoch !== epoch)
      throw new Error('The map changed. Run a new audit.');
    if (document.hidden) throw new Error('Audit stopped because the map is no longer visible.');
  }
  const sample = (now: number) => {
    if (sampling && lastFrame !== undefined && frames.length < 30000) frames.push(now - lastFrame);
    lastFrame = sampling ? now : undefined;
    frame = win!.requestAnimationFrame(sample);
  };
  const wait = (duration: number, ready?: () => boolean) =>
    new Promise<boolean>((resolve, reject) => {
      const began = performance.now();
      let timer: ReturnType<typeof setTimeout>;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new Error('Audit cancelled.'));
      };
      const poll = () => {
        try {
          assertCurrent();
          const done = ready?.() ?? false;
          if (done || performance.now() - began >= duration) {
            cleanup();
            resolve(done);
            return;
          }
          timer = setTimeout(poll, 40);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      signal.addEventListener('abort', abort, {once: true});
      poll();
    });
  frame = win.requestAnimationFrame(sample);
  try {
    map.stop();
    // Coordinates are fixed before any resizing: desktop and phone visit the same places.
    const at = (x: number, y: number): [number, number] => {
      const point = map.unproject(mapValue(map, [viewport.width * x, viewport.height * y]));
      return [point.lng, point.lat];
    };
    const zoom = (offset: number) =>
      Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), original.zoom + offset));
    const route = [
      {name: 'Starting view', camera: original},
      ...(profile !== 'viewport'
        ? [
            {name: 'Overview', camera: {...original, zoom: zoom(-3), pitch: 0}},
            {name: 'Street pan east', camera: {...original, center: at(0.9, 0.5), zoom: zoom(-1)}},
            {name: 'Detail west', camera: {...original, center: at(0.1, 0.5), zoom: zoom(1)}},
            {
              name: 'Tilt and rotate',
              camera: {
                ...original,
                zoom: zoom(1),
                pitch: Math.min(60, map.getMaxPitch()),
                bearing: original.bearing + 45,
              },
            },
          ]
        : []),
      ...(profile === 'deep'
        ? [
            {name: 'Distant north', camera: {...original, center: at(0.5, -0.5), zoom: zoom(-2)}},
            {
              name: 'Close south',
              camera: {
                ...original,
                center: at(0.5, 1.5),
                zoom: zoom(2),
                bearing: original.bearing + 180,
              },
            },
          ]
        : []),
    ];
    const sizes: ViewportSize[] = [
      {
        name: profile === 'viewport' ? 'Current' : 'Desktop',
        width: profile === 'viewport' ? viewport.width : 1280,
        height: profile === 'viewport' ? viewport.height : 800,
      },
      ...(profile !== 'viewport' ? [{name: 'Mobile', width: 390, height: 844}] : []),
      ...(profile === 'deep' ? [{name: 'Tablet', width: 768, height: 1024}] : []),
    ];
    let completed = 0;
    for (const size of sizes) {
      changingViewport = true;
      expectedViewport = {...viewport, ...size};
      viewportControl.set(size);
      await wait(100);
      changingViewport = false;
      assertCurrent();
      for (let i = 0; i < route.length; i++) {
        assertCurrent();
        const stop = route[i],
          fromId = resources?.records.at(-1)?.id || 0,
          frameStart = frames.length;
        progress(
          completed / (route.length * sizes.length),
          `${size.name} ${size.width}×${size.height} · ${stop.name} · ${completed + 1}/${route.length * sizes.length}`,
        );
        sampling = true;
        lastFrame = undefined;
        const began = performance.now();
        moveCamera(map, stop.camera, profile === 'viewport' ? 0 : 1200);
        await wait(profile === 'viewport' ? 80 : 1280);
        const tilesBegan = performance.now();
        const loaded = await wait(
          8000,
          () => !map.isMoving() && map.loaded() && map.areTilesLoaded(),
        );
        const tileWaitMs = performance.now() - tilesBegan,
          readyMs = performance.now() - began;
        await wait(Math.max(0, (profile === 'viewport' ? 2000 : 4000) - readyMs));
        sampling = false;
        lastFrame = undefined;
        assertCurrent();
        if (JSON.stringify(map.getStyle()) !== signature)
          throw new Error('The map style changed during the audit. Run it again.');
        const newLabels = sampleLabels(map),
          runFrames = frames.slice(frameStart);
        labels.push(...newLabels);
        for (const tile of visibleTiles(map).tiles) tiles.set(tile.key, tile);
        const requests = resources?.records.filter((record) => record.id > fromId) || [];
        const timedTiles = requests
          .filter(
            (record) => ['Tile', 'Archive'].includes(record.kind) && record.duration !== undefined,
          )
          .map((record) => record.duration!);
        const sized = requests.filter((record) => record.transferred !== undefined);
        scenarios.push({
          name: stop.name,
          viewport: size.name,
          width: size.width,
          height: size.height,
          camera: stop.camera,
          readyMs,
          tileWaitMs,
          loaded,
          frameP95: runFrames.length >= 30 ? percentile(runFrames, 0.95) : undefined,
          longFrameRate:
            runFrames.length >= 30
              ? runFrames.filter((n) => n > 50).length / runFrames.length
              : undefined,
          tileP95: percentile(timedTiles, 0.95),
          transferred: sized.length
            ? sized.reduce((sum, record) => sum + record.transferred!, 0)
            : undefined,
          sizedRequests: sized.length,
          requests: requests.length,
          labels: newLabels.length,
        });
        completed++;
        await wait(0);
      }
    }
    const sampledLayers = new Set(labels.map((label) => label.layer));
    for (const layer of style.layers) {
      if (layer.type !== 'symbol' || layer.layout?.visibility === 'none') continue;
      const image = layer.layout?.['icon-image'];
      if (
        typeof image === 'string' &&
        image &&
        !image.includes('{') &&
        !map.hasImage(image) &&
        (sampledLayers.has(layer.id) ||
          map.queryRenderedFeatures(undefined, {layers: [layer.id]}).length)
      )
        missing.add(image);
    }
    for (const id of [...missing]) if (map.hasImage(id)) missing.delete(id);
    progress(1, 'Building report…');
    const categories = analyzeAudit({
      frames,
      scenarios,
      labels,
      settle: scenarios.map((s) => ({
        name: `${s.viewport} · ${s.name}`,
        duration: s.tileWaitMs,
        loaded: s.loaded,
      })),
      mapReadyMs: resources?.mapReadyMs,
      resources: resources?.records
        .filter((record) => record.id > firstId)
        .map((record) => ({...record})),
      dropped: resources?.dropped || 0,
      tiles: visibleTiles(map).supported ? [...tiles.values()] : undefined,
      styleCost: analyzeStyleCost(
        style,
        route.map((stop) => stop.camera.zoom),
      ),
      styleIssues: styleIssues(style),
      runtimeErrors: [...side.runtimeErrors],
      missingImages: [...missing],
    });
    const meta = style.metadata as Record<string, string> | undefined;
    return {
      version: 1,
      date: new Date().toISOString(),
      map: meta?.['tileflow:map'] || side.definition.label,
      theme: meta?.['tileflow:theme'] || 'Unknown',
      profile,
      camera: original,
      viewport,
      duration: performance.now() - start,
      generation: side.artifactGeneration,
      categories,
      scenarios,
      samples: labels.length,
    };
  } finally {
    sampling = false;
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    map.off('movestart', userMove);
    map.off('resize', resize);
    map.off('styleimagemissing', missingImage);
    if (resources) resources.recording = originalRecording!;
    changingViewport = true;
    viewportControl.restore(side.map === map && side.loadEpoch === epoch && isCurrent());
    if (side.map === map && side.loadEpoch === epoch && isCurrent() && !interrupted) {
      map.stop();
      moveCamera(map, original);
    }
  }
}
