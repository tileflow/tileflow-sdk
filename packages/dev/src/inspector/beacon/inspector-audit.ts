import {
  Color,
  featureFilter,
  isExpression,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {mapValue} from '../map-value';
import {evaluatedValue} from '../style-edits';
import {inspectTile, sourceLayerBytes, visibleTiles} from '../tiles';
import type {PreviewWindow, Side} from '../types';
import {type Camera, contrastRatio, type Finding, type LabelSample, percentile} from './audit';
import {auditCategories} from './catalog';
import {
  glyphObservation,
  placementObservation,
  rendererProbe,
  residentGpuBytes,
  sampleOverdraw,
} from './probes';
import {
  combineQualitySamples,
  labelSizeSample,
  type QualitySample,
  scaleContinuitySample,
} from './quality';
import {moveCamera, readCamera, sampleLabels} from './runner';
import {inspectionSample, inspectorAssessment, inspectorScoringPolicy} from './scoring';
import {activeTour, activeTourProtocol, frameSample, type FrameSample, type TourStop} from './tour';
import {previewViewport} from './viewport';

export type InspectorCheck = {
  assessment: 'diagnostic' | 'measured';
  id: string;
  title: string;
  target: string;
  what: string;
  status: 'pass' | 'warn' | 'fail' | 'unavailable' | 'info';
  value: string;
  evidence: string;
  fix?: string;
  findings: Finding[];
  overlay?: string;
  score?: number;
  sample?: Omit<QualitySample, 'findings'>;
};
export type InspectorCategory = {
  id: string;
  title: string;
  description: string;
  score: number | null;
  checks: InspectorCheck[];
  scoreBasis?: string;
};
export type InspectorReport = {
  version: 4;
  scoring: typeof inspectorScoringPolicy;
  date: string;
  map: string;
  theme: string;
  device: 'desktop' | 'mobile';
  scope: 'view' | 'sweep' | 'tour';
  protocol: string;
  plannedViews: number;
  budgetExhausted: boolean;
  camera: Camera;
  viewport: {width: number; height: number; dpr: number};
  duration: number;
  generation: number;
  categories: InspectorCategory[];
  scenarios: {
    id: string;
    location: string;
    camera: Camera;
    theme: string;
    zoom: number;
    motion?: FrameSample;
    settled: FrameSample;
    /** End-to-end view readiness, including the scripted camera movement. */
    readyMs: number;
    /** Remaining readiness wait after scripted navigation; used for loading scores. */
    tileWaitMs: number;
    loaded: boolean;
    labels: number;
    requests: number;
    transferred?: number;
  }[];
  score: number | null;
  coverage: string[];
};
type Options = {
  side: Side;
  device: InspectorReport['device'];
  scope: InspectorReport['scope'];
  signal: AbortSignal;
  isCurrent: () => boolean;
  progress: (fraction: number, message: string) => void;
};
type Observation = {
  ready: boolean;
  scaleContinuity: QualitySample;
  theme: string;
  time?: string;
  palette: string;
  camera: Camera;
  labels: LabelSample[];
  symbolCount: number;
  tileCount: number;
  style: StyleSpecification;
  eligible: string[];
  drawn: string[];
  placement?: ReturnType<typeof placementObservation>;
  glyphs?: ReturnType<typeof glyphObservation>;
  unusedBytes: number;
  sourceBytes: number;
  nulls: Finding[];
  filters: Map<string, {samples: number; matches: number}>;
  missing: string[];
  language: {localized: number; total: number};
  fillFraction: number;
};
const round = (n: number, d = 1) => Number(n.toFixed(d));
const issue = (layer: string, message: string, camera?: Camera): Finding => ({
  layer,
  message,
  camera,
});
const bytes = (n: number) => (n >= 1048576 ? `${round(n / 1048576)} MB` : `${round(n / 1024)} KB`);
const active = (layer: StyleSpecification['layers'][number], zoom: number) =>
  layer.layout?.visibility !== 'none' &&
  zoom >= (layer.minzoom ?? 0) &&
  zoom < (layer.maxzoom ?? 24) &&
  !layer.id.startsWith('__tileflow-inspector-');

export function summarizeChecks(checks: InspectorCheck[]): number | null {
  const measured = checks.flatMap((c) => (c.score === undefined ? [] : [c.score]));
  return measured.length ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length) : null;
}

function observe(
  map: MapLibreMap,
  theme: string,
  time: string | undefined,
  palette: string,
  ready: boolean,
): Observation {
  const style = map.getStyle(),
    camera = readCamera(map),
    features = map
      .queryRenderedFeatures()
      .filter((f) => !f.layer.id.startsWith('__tileflow-inspector-'))
      .slice(0, 4000);
  const labels = sampleLabels(map, 100),
    filters = new Map<string, {samples: number; matches: number}>(),
    nulls: Finding[] = [],
    missing = new Set<string>();
  const bySource = new Map<string, MapGeoJSONFeature[]>();
  let unusedBytes = 0,
    sourceBytes = 0,
    localized = 0,
    total = 0;
  for (const tile of visibleTiles(map).tiles.slice(0, 64)) {
    const sizes = sourceLayerBytes(map, tile);
    for (const [name, size] of Object.entries(sizes ?? {})) {
      sourceBytes += size;
      if (
        !style.layers.some(
          (l) =>
            'source' in l &&
            l.source === tile.source &&
            'source-layer' in l &&
            l['source-layer'] === name,
        )
      )
        unusedBytes += size;
    }
    const data = inspectTile(map, tile);
    for (const [name, layer] of Object.entries(data.layers ?? {})) {
      const key = `${tile.source}\0${name}`,
        list = bySource.get(key) ?? [];
      for (let i = 0; i < Math.min(layer.length, 80) && list.length < 200; i++) {
        const f = layer.feature(i).toGeoJSON(tile.x, tile.y, tile.z) as MapGeoJSONFeature;
        f.source = tile.source;
        f.sourceLayer = name;
        list.push(f);
      }
      bySource.set(key, list);
    }
  }
  for (const layer of style.layers) {
    if (!active(layer, camera.zoom)) continue;
    const candidates =
      'source' in layer
        ? (bySource.get(
            `${layer.source}\0${'source-layer' in layer ? layer['source-layer'] : ''}`,
          ) ?? features.filter((f) => f.layer.id === layer.id))
        : [];
    const filter =
      'filter' in layer && layer.filter
        ? featureFilter(layer.filter, layer.id + '.filter', map.getGlobalState?.())
        : undefined;
    let matches = 0;
    const sampled = inspectionSample(candidates);
    for (const f of sampled) {
      const type = f.geometry.type.replace('Multi', '');
      if (
        filter &&
        !filter.filter(
          {zoom: camera.zoom},
          {id: f.id, type: type as 'Point', properties: f.properties},
        )
      )
        continue;
      matches++;
      for (const section of ['paint', 'layout'] as const)
        for (const [property, value] of Object.entries(layer[section] ?? {})) {
          if (!isExpression(value)) continue;
          const resolved = evaluatedValue(map, layer.id, section, property, f);
          if (resolved === undefined || resolved === null)
            nulls.push(
              issue(
                layer.id,
                `${property} could not resolve for feature ${f.id ?? '(no id)'}`,
                camera,
              ),
            );
        }
      if (layer.type === 'symbol') {
        const image = evaluatedValue(map, layer.id, 'layout', 'icon-image', f);
        if (typeof image === 'string' && image && !map.hasImage(image)) missing.add(image);
        const field = JSON.stringify(layer.layout?.['text-field'] ?? ''),
          keys = [...field.matchAll(/"(name:[a-zA-Z_-]+)"/gu)].map((m) => m[1]);
        if (keys.length) {
          total++;
          if (keys.some((key) => typeof f.properties[key] === 'string' && f.properties[key]))
            localized++;
        }
      }
    }
    if (filter) filters.set(layer.id, {samples: sampled.length, matches});
    if (layer.type === 'symbol') {
      const image = layer.layout?.['icon-image'];
      if (typeof image === 'string' && image && !image.includes('{') && !map.hasImage(image))
        missing.add(image);
    }
  }
  let fills = 0;
  const canvas = map.getCanvas();
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const point = map.project(
        map.unproject({
          x: ((x + 0.5) * canvas.clientWidth) / 8,
          y: ((y + 0.5) * canvas.clientHeight) / 8,
        } as any),
      );
      if (
        map
          .queryRenderedFeatures(point)
          .some(
            (f) =>
              f.layer.type === 'fill' &&
              evaluatedValue(map, f.layer.id, 'paint', 'fill-opacity', f) !== 0,
          )
      )
        fills++;
    }
  return {
    ready,
    scaleContinuity: ready
      ? scaleContinuitySample(map, style, features, camera)
      : combineQualitySamples([]),
    theme,
    time,
    palette,
    camera,
    labels,
    symbolCount: features.filter((f) => f.layer.type === 'symbol').length,
    tileCount: visibleTiles(map).tiles.length,
    style,
    eligible: style.layers.filter((l) => active(l, camera.zoom)).map((l) => l.id),
    drawn: [...new Set(features.map((f) => f.layer.id))],
    placement: placementObservation(map),
    glyphs: glyphObservation(map),
    unusedBytes,
    sourceBytes,
    nulls: nulls.slice(0, 100),
    filters,
    missing: [...missing],
    language: {localized, total},
    fillFraction: fills / 64,
  };
}

export async function runInspectorAudit({
  side,
  device,
  scope,
  signal,
  isCurrent,
  progress,
}: Options): Promise<InspectorReport> {
  const map = side.map,
    win = side.frame.contentWindow as PreviewWindow | null;
  if (!map || !win || !map.isStyleLoaded())
    throw new Error('Wait for the map style to finish loading.');
  const initial = readCamera(map),
    start = performance.now(),
    epoch = side.loadEpoch,
    scene = window.__tileflowScene,
    sceneSnapshot = scene?.snapshot();
  const initialStyle = map.getStyle(),
    meta = initialStyle.metadata as Record<string, string> | undefined;
  const currentTheme = meta?.['tileflow:theme'] ?? 'Current';
  const variants = scene?.variants() ?? [],
    variant = variants.find((v) => v.theme === currentTheme);
  const themes =
    scope === 'sweep' && variants.length
      ? variants
      : [variant ?? {theme: currentTheme, palette: currentTheme, timeOfDay: undefined}];
  const zooms =
    scope === 'sweep'
      ? Array.from({length: 23}, (_, i) => i).filter(
          (z) => z >= map.getMinZoom() && z <= map.getMaxZoom(),
        )
      : [initial.zoom];
  const bounds = map.getMaxBounds?.();
  const tour = activeTour(initial, {
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
    maxPitch: map.getMaxPitch(),
    bounds: bounds
      ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
      : undefined,
  });
  const plan: TourStop[] =
    scope === 'tour'
      ? tour.stops
      : zooms.map((zoom, index) => ({
          id: `view-${index}`,
          location: 'Current view',
          camera: {...initial, zoom},
        }));
  const plannedViews = plan.length * themes.length;
  const routeDeadline = scope === 'tour' ? start + activeTourProtocol.routeBudgetMs : Infinity;
  const budgetRemaining = () => Math.max(0, routeDeadline - performance.now());
  const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let budgetExhausted = false;
  const view = previewViewport(side.frame, map),
    ratio = map.getPixelRatio();
  const oldOverdraw = map.showOverdrawInspector,
    oldCollision = map.showCollisionBoxes,
    oldBoundaries = map.showTileBoundaries;
  const viewport = {
    width: device === 'mobile' ? 390 : 1280,
    height: device === 'mobile' ? 844 : 800,
    dpr: ratio,
  };
  const resources = win.__tileflowInspectorObserver,
    recording = resources?.recording;
  const observations: Observation[] = [],
    scenarios: InspectorReport['scenarios'] = [],
    missing = new Set<string>();
  const auditResourceCursor = resources?.records.at(-1)?.id ?? 0;
  const priorRuntimeErrors = new Set(side.runtimeErrors);
  const auditErrors = new Set<string>();
  const recordError = (event: {error?: {message?: string}}) => {
    if (event.error?.message) auditErrors.add(event.error.message);
  };
  let resourceCursor = auditResourceCursor;
  let interrupted = false,
    probe: ReturnType<typeof rendererProbe> | undefined,
    overdraw: Awaited<ReturnType<typeof sampleOverdraw>>,
    gpu: number | undefined,
    scaleDelta: number | undefined;
  const userMove = (event: {originalEvent?: unknown; tileflowUserCamera?: boolean}) => {
    if (event.originalEvent || event.tileflowUserCamera) interrupted = true;
  };
  const imageMissing = (event: {id: string}) => missing.add(event.id);
  map.on('movestart', userMove);
  map.on('styleimagemissing', imageMissing);
  map.on('error', recordError);
  const assert = () => {
    if (signal.aborted) throw new Error('Audit cancelled.');
    if (interrupted) throw new Error('Audit stopped because you moved the map.');
    if (!isCurrent() || side.map !== map || side.loadEpoch !== epoch)
      throw new Error('The active map changed.');
    if (map.getCanvas().ownerDocument.hidden)
      throw new Error('Keep the map visible while auditing.');
  };
  const wait = async (duration: number, ready?: () => boolean) => {
    const began = performance.now();
    do {
      assert();
      if (ready?.()) return true;
      await new Promise((r) => setTimeout(r, 32));
    } while (performance.now() - began < duration);
    assert();
    return ready?.() ?? true;
  };
  if (resources) resources.recording = true;
  try {
    scene?.audit(true);
    map.stop();
    map.showOverdrawInspector = map.showCollisionBoxes = map.showTileBoundaries = false;
    view.set({name: device, ...viewport});
    await wait(100);
    probe = rendererProbe(map);
    let completed = 0;
    for (const theme of themes) {
      if (theme.theme !== (map.getStyle().metadata as any)?.['tileflow:theme']) {
        assert();
        await scene!.apply(theme.theme, signal);
      }
      for (const stop of plan) {
        if (scope === 'tour' && budgetRemaining() < activeTourProtocol.motionMs + 800) {
          budgetExhausted = true;
          break;
        }
        assert();
        const label = `${stop.location} · z${round(stop.camera.zoom, 2)} · ${completed + 1}/${plannedViews}`;
        const update = (phase: string) =>
          progress(
            Math.min(
              0.89,
              scope === 'tour'
                ? (performance.now() - start) / activeTourProtocol.budgetMs
                : (completed / plannedViews) * 0.89,
            ),
            `${label} · ${phase}${scope === 'tour' ? ` · ${Math.round((performance.now() - start) / 1000)}s / ~60s` : ''}`,
          );
        const began = performance.now();
        let motion: FrameSample | undefined;
        if (scope === 'tour') {
          update(reducedMotion ? 'Moving without animation' : 'Measuring navigation');
          const from = probe.frames.length;
          probe.start();
          map.flyTo(mapValue(map, {...stop.camera, duration: activeTourProtocol.motionMs}), {
            tileflowInspector: true,
          });
          await wait(activeTourProtocol.motionMs);
          probe.stop();
          if (!reducedMotion) motion = frameSample(probe.frames.slice(from));
        } else {
          update('Loading');
          moveCamera(map, stop.camera);
          await wait(64);
        }
        update('Waiting for tiles');
        const tilesBegan = performance.now();
        const loaded = await wait(
          scope === 'tour'
            ? Math.min(activeTourProtocol.readinessMs, Math.max(0, budgetRemaining() - 800))
            : 5000,
          () => Boolean(map.isStyleLoaded() && map.areTilesLoaded() && !map.isMoving()),
        );
        const tileWaitMs = performance.now() - tilesBegan;
        const readyMs = performance.now() - began;
        map.stop();
        update('Measuring settled frames');
        const from = probe.frames.length;
        probe.start();
        await wait(
          scope === 'tour'
            ? Math.min(activeTourProtocol.settledMs, budgetRemaining())
            : scope === 'view'
              ? 1500
              : 150,
        );
        probe.stop();
        const settled = frameSample(probe.frames.slice(from));
        const observation = observe(map, theme.theme, theme.timeOfDay, theme.palette, loaded);
        // One immutable style per concrete theme; do not retain geometry across a sweep.
        observation.style =
          observations.find((v) => v.theme === theme.theme)?.style ?? observation.style;
        observations.push(observation);
        const newRequests = (resources?.records ?? []).filter(
          (r) =>
            r.id > resourceCursor &&
            r.transport === 'resource' &&
            ['Tile', 'Archive', 'Font', 'Sprite', 'Model', 'JSON'].includes(r.kind),
        );
        resourceCursor = resources?.records.at(-1)?.id ?? resourceCursor;
        scenarios.push({
          id: `${theme.theme}:${stop.id}`,
          location: stop.location,
          camera: observation.camera,
          motion,
          settled,
          theme: theme.theme,
          zoom: observation.camera.zoom,
          readyMs,
          tileWaitMs,
          loaded,
          labels: observation.labels.length,
          requests: newRequests.length,
          transferred: newRequests.every((r) => r.transferred !== undefined)
            ? newRequests.reduce((sum, r) => sum + r.transferred!, 0)
            : undefined,
        });
        completed++;
      }
    }
    if (!observations.length) throw new Error('No view could be sampled within the audit budget.');
    progress(0.94, 'Measuring overdraw and resolution scaling…');
    gpu = residentGpuBytes(map);
    if (scope !== 'tour' || performance.now() - start < activeTourProtocol.budgetMs - 3000)
      overdraw = await sampleOverdraw(map, signal);
    if (scope !== 'tour' || performance.now() - start < activeTourProtocol.budgetMs - 2500) {
      const before = new Set(
        sampleLabels(map, 100).map((l) => `${l.layer}:${l.featureId ?? l.message}`),
      );
      map.setPixelRatio(3);
      await wait(150);
      await wait(2000, () => map.areTilesLoaded());
      const after = new Set(
        sampleLabels(map, 100).map((l) => `${l.layer}:${l.featureId ?? l.message}`),
      );
      if (before.size) scaleDelta = [...before].filter((id) => !after.has(id)).length / before.size;
      map.setPixelRatio(ratio);
    }
    const report = analyzeInspector({
      map,
      observations,
      scenarios,
      probe,
      overdraw,
      gpu,
      scaleDelta,
      resources: resources?.records ?? [],
      auditResourceCursor,
      mapReady: resources?.mapReadyMs,
      runtimeErrors: [
        ...new Set([
          ...auditErrors,
          ...side.runtimeErrors.filter((error) => !priorRuntimeErrors.has(error)),
        ]),
      ],
      missing: [...missing].filter((id) => !map.hasImage(id)),
      initialTheme: currentTheme,
      scope,
      variantCount: variants.length,
      win,
    });
    progress(1, 'Building report…');
    const scores = report.map((c) => c.score).filter((n): n is number => n !== null);
    return {
      version: 4,
      scoring: inspectorScoringPolicy,
      protocol: scope === 'tour' ? activeTourProtocol.id : `inspector-${scope}-v2`,
      plannedViews,
      budgetExhausted,
      date: new Date().toISOString(),
      map: meta?.['tileflow:map'] ?? side.definition.label,
      theme: currentTheme,
      device,
      scope,
      camera: initial,
      viewport,
      duration: performance.now() - start,
      generation: side.artifactGeneration,
      categories: report,
      scenarios,
      score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      coverage: [
        `${observations.length}/${plannedViews} views · ${themes.length} concrete themes · ${new Set(scenarios.map((s) => s.zoom.toFixed(2))).size} zoom levels · ${new Set(scenarios.map((s) => s.location)).size} locations`,
        ...(scope === 'tour'
          ? [
              `Active tour v1: 60-second budget, including navigation, loading, settled sampling and diagnostics. ${budgetExhausted ? 'Budget reached; remaining views were not sampled.' : 'All planned views sampled.'} Synchronous analysis and restoration may add a small overhead.`,
              `${scenarios.filter((s) => !s.loaded).length} views did not finish loading before their sampling window. ${scenarios.filter((s) => s.settled.frames < 60).length} views have fewer than 60 settled frame intervals; fewer than 30 are not scored individually.`,
              reducedMotion
                ? 'Reduced motion enabled: camera jumps were used; animated navigation was not measured.'
                : 'Navigation and settled frame windows are measured separately. Inspection and GPU readbacks are excluded from frame timings.',
              ...(tour.skipped.length
                ? [`Outside map bounds, not visited: ${tour.skipped.join(', ')}.`]
                : []),
              'Only the current theme is toured. All zooms remains the exhaustive theme/time-of-day check.',
            ]
          : []),
        'Mobile uses a 390×844 CSS viewport on this computer; CPU, GPU and network are not throttled.',
        'Network observations include the existing session cache. No cold-load claim is made. Error scoring covers this audit only; earlier session errors remain in Debug.',
        'Loading scores use tileWaitMs after scripted navigation. readyMs also includes camera motion and remains available as end-to-end readiness.',
        `Scoring: ${inspectorScoringPolicy}. Structural and cartographic diagnostics are unscored; scores from older policies are not comparable.`,
        'Legibility scores sampled text-size against a 10 CSS px design budget. Cartography scores size-rule continuity at declared zoom stops (jumps exceeding both 1 px and 25%). These are explicit benchmarks, not a complete visual-quality assessment. Only ready views contribute; missing data never passes.',
        'Style-based contrast is a bounded estimate, not accessibility certification. Diagnostics never establish a defect by themselves.',
        'Overdraw saturates at 8 passes and excludes unsupported custom renderers. GPU memory is a lower-bound estimate.',
      ],
    };
  } finally {
    probe?.dispose();
    map.off('movestart', userMove);
    map.off('styleimagemissing', imageMissing);
    map.off('error', recordError);
    if (resources) resources.recording = recording!;
    const same = side.map === map && side.loadEpoch === epoch;
    try {
      if (same) {
        map.setPixelRatio(ratio);
        map.showOverdrawInspector = oldOverdraw;
        map.showCollisionBoxes = oldCollision;
        map.showTileBoundaries = oldBoundaries;
        if (sceneSnapshot && scope === 'sweep') await scene?.restore(sceneSnapshot);
      }
    } finally {
      scene?.audit(false);
      view.restore(same);
      if (same && !interrupted) {
        map.stop();
        moveCamera(map, initial);
      }
    }
  }
}

type Input = {
  map: MapLibreMap;
  observations: Observation[];
  scenarios: InspectorReport['scenarios'];
  probe: ReturnType<typeof rendererProbe>;
  overdraw?: Awaited<ReturnType<typeof sampleOverdraw>>;
  gpu?: number;
  scaleDelta?: number;
  resources: NonNullable<PreviewWindow['__tileflowInspectorObserver']>['records'];
  mapReady?: number;
  auditResourceCursor: number;
  runtimeErrors: string[];
  missing: string[];
  initialTheme: string;
  scope: InspectorReport['scope'];
  variantCount: number;
  win: PreviewWindow;
};

function analyzeInspector(input: Input): InspectorCategory[] {
  const {map, observations: views, probe, overdraw} = input;
  const checks = new Map<string, InspectorCheck>();
  for (const cat of auditCategories)
    for (const check of cat.checks)
      checks.set(check.id, {
        ...check,
        assessment: inspectorAssessment(check.id),
        status: 'unavailable',
        value: 'Not measurable in this sample',
        evidence: 'No usable observation was returned for this check.',
        findings: [],
      });
  const set = (
    id: string,
    value: string,
    evidence: string,
    score?: number,
    findings: Finding[] = [],
    fix?: string,
  ) => {
    const check = checks.get(id)!;
    if (check.assessment === 'diagnostic') score = undefined;
    Object.assign(check, {
      value,
      evidence,
      score,
      status: score === undefined ? 'info' : score >= 90 ? 'pass' : score >= 50 ? 'warn' : 'fail',
      findings: findings.slice(0, 20),
      fix,
    });
  };
  const metric = (
    id: string,
    value: number | undefined,
    target: number,
    unit: string,
    evidence: string,
    findings: Finding[] = [],
    fix?: string,
    inverse = false,
  ) => {
    if (value === undefined || !Number.isFinite(value)) {
      checks.get(id)!.evidence = evidence;
      return;
    }
    const ratio = inverse ? target / Math.max(0.001, value) : value / Math.max(0.001, target);
    set(
      id,
      `${round(value, 2)}${unit}`,
      evidence,
      ratio <= 1 ? 100 : ratio <= 1.5 ? 70 : ratio <= 2 ? 45 : 0,
      findings,
      fix,
    );
  };
  const count = (id: string, findings: Finding[], evidence: string, fix: string) =>
    set(id, `${findings.length} to review`, evidence, findings.length ? 60 : 100, findings, fix);
  const quality = (id: string, sample: QualitySample, evidence: string, fix: string) => {
    const {findings, ...coverage} = sample;
    const check = checks.get(id)!;
    check.sample = coverage;
    check.evidence = `${evidence} ${sample.skipped} ${sample.unit} excluded because evaluation was incomplete. ${views.filter((v) => v.ready).length}/${views.length} views ready.`;
    if (!sample.total) {
      check.value = 'No eligible samples in ready views';
      return;
    }
    set(
      id,
      `${sample.passed}/${sample.total} ${sample.unit} within budget`,
      check.evidence,
      Math.round((100 * sample.passed) / sample.total),
      findings,
      fix,
    );
    // Keep sparse outliers actionable even when the percentage rounds to a high score.
    if (sample.passed < sample.total && check.status === 'pass') check.status = 'warn';
  };
  const allLabels = views.flatMap((v) => v.labels),
    first = views.find((v) => v.theme === input.initialTheme) ?? views[0],
    style = first.style;
  const layers = style.layers.filter((l) => !l.id.startsWith('__tileflow-inspector-'));
  const tourFrames = input.scenarios
    .flatMap((s) => [s.motion, s.loaded ? s.settled : undefined])
    .flatMap((s) => (s?.p95Ms === undefined ? [] : [s.p95Ms]));
  metric(
    'render-0',
    input.scope === 'tour'
      ? tourFrames.length
        ? Math.max(...tourFrames)
        : undefined
      : percentile(
          probe.frames.filter((n) => n > 0 && Number.isFinite(n)),
          0.95,
        ),
    16.7,
    ' ms',
    input.scope === 'tour'
      ? 'Worst per-view p95 across navigation and loaded settled windows with at least 30 intervals. Slow locations are not averaged away. Includes browser scheduling, not isolated GPU time. See Tour measurements for sample counts, stalls and incomplete loading.'
      : 'Inter-render interval p95 during continuous repaints of settled views. Excludes inspection and readback work. Includes main-thread scheduling; this is not isolated GPU duration.',
    [],
    'Review overdraw and draw-call counts; repeat while the browser is otherwise idle.',
  );
  if (input.scope === 'tour') {
    const moving = input.scenarios.flatMap((s) =>
      s.motion?.p95Ms === undefined ? [] : [s.motion.p95Ms],
    );
    const settled = input.scenarios.flatMap((s) =>
      !s.loaded || s.settled.p95Ms === undefined ? [] : [s.settled.p95Ms],
    );
    const display = (values: number[]) =>
      values.length ? `${round(Math.max(...values), 1)} ms` : 'unavailable';
    checks.get('render-0')!.value = `${display(moving)} moving · ${display(settled)} settled`;
    checks.get('render-0')!.findings = input.scenarios.flatMap((s) =>
      (['motion', 'settled'] as const).flatMap((phase) => {
        const sample = s[phase];
        if (!sample?.p95Ms || sample.p95Ms <= 16.7 || (phase === 'settled' && !s.loaded)) return [];
        return [
          {
            camera: s.camera,
            message: `${s.location} · ${phase === 'motion' ? 'moving' : 'settled'}: ${round(sample.p95Ms, 1)} ms p95 from ${sample.frames} frame intervals.`,
          },
        ];
      }),
    );
  }
  metric(
    'render-1',
    overdraw ? overdraw.hot * 100 : undefined,
    1,
    '% of sampled pixels at 8+ passes',
    `Native overdraw probe across ${overdraw?.samples ?? 0} pixels of the final sampled view. Custom 3D renderers may be excluded.`,
    [],
    'Inspect Overdraw and simplify stacks of overlapping casings and fills.',
  );
  metric(
    'render-2',
    overdraw?.average,
    3,
    ' passes (8+ capped)',
    'Average of the same native overdraw sample; eight is a saturation limit.',
  );
  metric(
    'render-3',
    Math.max(...views.map((v) => v.eligible.length)),
    150,
    ' eligible layers',
    `${Math.max(...views.map((v) => v.drawn.length))} queried rendered layers. Eligibility follows visibility and min/max zoom; background, raster and custom draws are not queryable features.`,
  );
  metric(
    'render-4',
    probe.drawsSupported ? percentile(probe.drawCalls, 0.95) : undefined,
    600,
    ' calls/frame (p95)',
    'Intercepts WebGL drawArrays, drawElements and instanced variants during the audit, including custom layers.',
  );
  metric(
    'render-5',
    probe.placementSupported ? percentile(probe.placementMs, 0.95) : undefined,
    4,
    ' ms/frame (p95)',
    'CPU wall time in MapLibre’s placement update, including incremental placement bookkeeping.',
  );
  const dataDriven = layers.flatMap((l) =>
    Object.entries(l.paint ?? {})
      .filter(
        ([, v]) =>
          Array.isArray(v) && /"(?:get|feature-state|id|properties)"/u.test(JSON.stringify(v)),
      )
      .map(([p]) => issue(l.id, p)),
  );
  metric(
    'render-6',
    dataDriven.length,
    10,
    ' expressions',
    'Paint declarations that depend on feature data; count is complexity, not measured evaluation time.',
    dataDriven,
    'Simplify repeated expressions where their cost is confirmed in profiling.',
  );
  const runtime = input.win.__tileflowDescribeRuntimeLayers?.() ?? {},
    instances = Object.values(runtime)
      .map((v) => `${v.controller}: ${JSON.stringify(v.stats ?? {})}`)
      .join('; ');
  metric(
    'render-7',
    percentile(probe.customMs, 0.95),
    3,
    ' ms/frame CPU submission (p95)',
    `${instances || 'No custom 3D controllers active.'} GPU execution is asynchronous and is not included.`,
  );
  metric(
    'render-8',
    input.gpu === undefined ? undefined : input.gpu / 1048576,
    256,
    ' MB observed allocation estimate',
    'Resident renderer buffer sizes plus observable RGBA textures. Driver caches and inaccessible allocations are excluded; a low value does not prove low total GPU memory.',
  );
  const rawTotal = views.reduce((a, v) => a + v.sourceBytes, 0),
    unused = views.reduce((a, v) => a + v.unusedBytes, 0);
  metric(
    'loading-0',
    rawTotal ? (unused / rawTotal) * 100 : undefined,
    10,
    '% of sampled MVT layer bytes',
    'Encoded source-layer messages in up to 64 resident tiles per view, before HTTP compression. Unused means no style layer references that source-layer.',
    [],
    'Inspect Tiles → Source layers and remove unused data from the tileset or add intended consumers.',
  );
  metric(
    'loading-1',
    input.mapReady === undefined ? undefined : input.mapReady / 1000,
    1,
    ' s from preview navigation',
    'Original preview map load event recorded since navigation. This includes load readiness, not the first GPU pixel, and is not a simulated mobile cold start.',
  );
  const requests = input.resources.filter(
      (r) =>
        ['Tile', 'Archive', 'Font', 'Sprite', 'Model', 'JSON'].includes(r.kind) &&
        r.transport === 'resource',
    ),
    tiles = requests.filter((r) => r.kind === 'Tile' && r.bytes !== undefined),
    average = tiles.length ? tiles.reduce((a, r) => a + r.bytes!, 0) / tiles.length : undefined;
  const largest = tiles.slice().sort((a, b) => b.bytes! - a.bytes!)[0];
  metric(
    'loading-2',
    largest && average ? largest.bytes! / average : undefined,
    2,
    '× average',
    largest
      ? `${largest.name}: ${bytes(largest.bytes!)} encoded response bytes.`
      : 'No individual tile response sizes are exposed. PMTiles archive ranges are not individual tile sizes.',
    [],
    'Inspect large tiles and simplify geometry or drop unused attributes.',
  );
  metric(
    'loading-3',
    Math.max(...input.scenarios.map((s) => s.tileWaitMs)) / 1000,
    2,
    ' s worst wait after navigation',
    `${input.scenarios.filter((s) => !s.loaded).length} timed-out views. Waits for style, tiles and camera readiness after the scripted movement. Camera animation is excluded from loading cost.`,
  );
  if (input.scenarios.some((s) => !s.loaded)) {
    checks.get('loading-3')!.score = 0;
    checks.get('loading-3')!.status = 'fail';
  }
  const sized = input.scenarios.filter((s) => s.transferred !== undefined);
  metric(
    'loading-4',
    sized.length ? Math.max(...sized.map((s) => s.transferred!)) / 1048576 : undefined,
    1,
    ' MB worst sampled view transfer',
    `${sized.length}/${input.scenarios.length} views have complete response-size coverage. Counts new completed map responses during each view; cache is retained, so this is not a fresh visitor estimate.`,
  );
  metric(
    'loading-5',
    average === undefined ? undefined : average / 1024,
    50,
    ' KB encoded tile response',
    'Average individual tile HTTP response size in retained session timings; archive ranges are excluded.',
  );
  metric(
    'loading-6',
    Math.max(...input.scenarios.map((s) => s.requests)),
    60,
    ' requests in the busiest sampled view',
    'Counts new completed tile/archive, font, sprite, model and style HTTP requests per view. Cached resident views may need none. Prior session requests are excluded.',
  );
  const timing = input.win.performance.getEntriesByType('resource') as PerformanceResourceTiming[],
    compressed = timing.filter(
      (r) => r.decodedBodySize > r.encodedBodySize && r.encodedBodySize > 0,
    );
  set(
    'loading-7',
    `${compressed.length} compressed · ${requests.filter((r) => r.status === 'Cached').length} cache hits`,
    'Compression is inferred from encoded/decoded sizes. Resource Timing does not expose Cache-Control TTL; no caching policy is asserted.',
  );
  const placements = views.flatMap((v) =>
      v.placement && v.placement.candidates ? [v.placement] : [],
    ),
    candidates = placements.reduce((a, p) => a + p.candidates, 0);
  metric(
    'legibility-0',
    candidates ? (placements.reduce((a, p) => a + p.dropped, 0) / candidates) * 100 : undefined,
    20,
    '% text placement rejections',
    'Current symbol placement candidates, deduplicated by cross-tile ID. Rejection can include collision, offscreen or line-fit constraints; use collision boxes to identify the cause.',
    [],
    'Inspect symbol spacing, padding, priority and overlap rules before reducing label size.',
  );
  set(
    'legibility-1',
    `${placements.reduce((a, p) => a + p.lineDropped, 0)} rejected line-label candidates`,
    'Line placement rejections are observed; the renderer does not expose a separate line-too-short reason. Confirm with Collision boxes.',
  );
  const repeated: Finding[] = [];
  for (const view of views)
    for (let i = 0; i < view.labels.length; i++)
      for (let j = i + 1; j < view.labels.length; j++) {
        const a = view.labels[i],
          b = view.labels[j];
        if (a.layer === b.layer && a.featureId !== undefined && a.featureId === b.featureId)
          continue;
        if (a.message !== b.message || !a.coordinate || !b.coordinate) continue;
        // Project using the observed zoom without changing the live map; Mercator screen distance is approximate at pitch.
        const lng =
            (a.coordinate[0] - b.coordinate[0]) * Math.cos((a.coordinate[1] * Math.PI) / 180),
          lat = a.coordinate[1] - b.coordinate[1];
        const px = (Math.hypot(lng, lat) / 360) * 512 * 2 ** view.camera.zoom;
        if (px < 200)
          repeated.push({
            ...a,
            message: `“${a.message}” repeats within approximately ${Math.round(px)} px`,
          });
      }
  count(
    'legibility-2',
    repeated,
    'Pairs of sampled label anchors within approximately 200 px. Repeated names on different features may be intentional.',
    'Increase symbol-spacing or review repetition at these zoom levels.',
  );
  quality(
    'legibility-3',
    labelSizeSample(views.filter((v) => v.ready).flatMap((v) => v.labels)),
    'Percentage of sampled labels with an evaluated text-size of at least 10 CSS px. Up to 100 labels per ready view; this design budget does not measure glyph rasterization, perspective, script or font readability.',
    'Increase the smallest text size or hide low-priority labels until a closer zoom.',
  );
  metric(
    'legibility-4',
    Math.max(...views.map((v) => v.symbolCount / Math.max(1, v.tileCount))),
    60,
    ' queried symbols per resident tile',
    'Approximate density: rendered query results can include duplicates across tile boundaries.',
  );
  const symbols = layers.filter((l) => l.type === 'symbol'),
    noHalo = symbols
      .filter(
        (l) =>
          l.layout?.['text-field'] &&
          !(
            l.layout?.['icon-image'] &&
            ['both', 'width', 'height'].includes(String(l.layout?.['icon-text-fit']))
          ) &&
          !(Number(evaluatedValue(map, l.id, 'paint', 'text-halo-width')) > 0),
      )
      .map((l) =>
        issue(
          l.id,
          'No positive constant halo width; feature-dependent values require a feature sample.',
        ),
      );
  count(
    'legibility-5',
    noHalo,
    'Checks declared text layers without a fitted icon background for a positive evaluated halo width. Halos are optional; review actual contrast before changing them.',
    'Review text contrast against real backgrounds; add a halo where needed.',
  );
  const angles = symbols
    .filter((l) => l.layout?.['symbol-placement'] === 'line')
    .map((l) => Number(evaluatedValue(map, l.id, 'layout', 'text-max-angle')))
    .filter(Number.isFinite);
  metric(
    'legibility-6',
    angles.length ? Math.max(...angles) : undefined,
    45,
    '° configured maximum',
    'Evaluated text-max-angle limits, not measurement of the final glyph baseline curvature.',
  );
  const lang = views.reduce(
    (a, v) => ({total: a.total + v.language.total, localized: a.localized + v.language.localized}),
    {total: 0, localized: 0},
  );
  if (lang.total)
    metric(
      'legibility-7',
      (lang.localized / lang.total) * 100,
      90,
      '% with requested name fields',
      'Samples source features for localized name:* fields referenced by text expressions.',
      [],
      'Supply missing localized name properties or use an explicit fallback.',
      true,
    );
  else
    set(
      'legibility-7',
      'Local names / no explicit language',
      'No localized name:* field was found in sampled text expressions. Set a display language to measure its coverage.',
    );
  const contrast = (id: string, labels: LabelSample[], evidence: string) => {
    const known = labels.filter((l) => l.ratio !== undefined);
    metric(
      id,
      known.length ? Math.min(...known.map((l) => l.ratio!)) : undefined,
      4.5,
      ':1 lowest sampled',
      evidence,
      known.filter((l) => l.ratio! < 4.5),
      'Adjust text color or an opaque halo; verify over the actual background.',
      true,
    );
  };
  contrast(
    'a11y-0',
    views.filter((v) => v.theme === input.initialTheme).flatMap((v) => v.labels),
    'Estimated from evaluated text, halo and supported flat fill stacks. Raster, 3D and unresolved backgrounds are excluded.',
  );
  contrast(
    'a11y-1',
    views.filter((v) => v.time === 'night' || /night|dark/u.test(v.theme)).flatMap((v) => v.labels),
    'Night variants sampled by All zooms, or the current view if already at night.',
  );
  contrast(
    'a11y-3',
    views.filter((v) => v.theme !== input.initialTheme).flatMap((v) => v.labels),
    'Other concrete themes actually visited by All zooms. Run All zooms to collect this evidence.',
  );
  const colors = layers.flatMap((l) =>
    Object.entries(l.paint ?? {}).flatMap(([p, v]) =>
      p.endsWith('-color') && typeof v === 'string' && Color.parse(v)
        ? [{layer: l.id, type: l.type, property: p, color: v}]
        : [],
    ),
  );
  const colorPairs = confusablePairs(colors);
  count(
    'a11y-2',
    colorPairs,
    'Linear-RGB simulations of protanopia, deuteranopia and tritanopia. Flags same-geometry layer colors that converge; semantic significance needs review.',
    'Distinguish important categories with dash, width, shape or labels in addition to color.',
  );
  const background = colors.find((c) => c.type === 'background')?.color,
    nonText = colors
      .filter((c) => ['line', 'circle'].includes(c.type))
      .flatMap((c) => {
        const ratio = background ? contrastRatio(c.color, background) : undefined;
        return ratio === undefined ? [] : [{...c, ratio}];
      });
  metric(
    'a11y-4',
    nonText.length ? Math.min(...nonText.map((c) => c.ratio)) : undefined,
    3,
    ':1 against style background',
    'Static line/circle colors against the background paint. Actual overlapping fills, opacity, patterns and semantics can change perceived contrast.',
    nonText.filter((c) => c.ratio < 3).map((c) => issue(c.layer, c.property)),
    'Review essential boundaries and symbols against their local background.',
    true,
  );
  const colorOnly = layers
    .filter(
      (l) =>
        Object.entries(l.paint ?? {}).some(
          ([p, v]) =>
            p.endsWith('-color') &&
            Array.isArray(v) &&
            /"(?:match|case|step)"/u.test(JSON.stringify(v)),
        ) &&
        !Object.keys(l.layout ?? {}).some((p) => ['text-field', 'icon-image'].includes(p)) &&
        !Object.keys(l.paint ?? {}).some((p) => /dasharray|pattern/u.test(p)),
    )
    .map((l) =>
      issue(
        l.id,
        'Categorical color expression without a declared pattern, icon or text in this layer.',
      ),
    );
  count(
    'a11y-5',
    colorOnly,
    'Checks categorical color rules for redundant cues within the same layer; related labels may exist in other layers.',
    'Confirm related labels or add patterns, widths or symbols for essential distinctions.',
  );
  const reduced = input.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  set(
    'a11y-6',
    reduced ? 'System requests reduced motion' : 'System has no reduced-motion preference',
    'Observed OS preference. Animated custom controllers must expose their motion policy before compliance can be asserted.',
  );
  metric(
    'a11y-7',
    input.scaleDelta === undefined ? undefined : input.scaleDelta * 100,
    5,
    '% sampled labels lost at 3×',
    'Changes the real canvas pixel ratio to 3, waits for loading and compares sampled label identities. Restores the original ratio. This detects placement changes, not every clipped glyph.',
    [],
    'Inspect Fonts and Collision boxes at 3× and check text/icon padding.',
  );
  const gaps: Finding[] = [],
    pop: Finding[] = [],
    inversions: Finding[] = [],
    hierarchy: Finding[] = [];
  let roadComparisons = 0,
    placeComparisons = 0;
  const groups = new Map<string, typeof layers>();
  for (const layer of layers) {
    const key = 'source-layer' in layer ? `${layer.type}:${layer['source-layer']}` : layer.type;
    groups.set(key, [...(groups.get(key) ?? []), layer]);
    if ((layer.minzoom ?? 0) > 0 && layer.type !== 'symbol') {
      const opacity = Object.entries(layer.paint ?? {}).find(([k]) => k.endsWith('-opacity'))?.[1];
      if (opacity === undefined || (typeof opacity === 'number' && opacity > 0))
        pop.push(issue(layer.id, `Starts at z${layer.minzoom} without a zoom opacity ramp.`));
    }
  }
  for (const [key, group] of groups) {
    const ranges = group
      .filter((l) => l.layout?.visibility !== 'none')
      .map((l) => ({min: l.minzoom ?? 0, max: l.maxzoom ?? 24, id: l.id}))
      .sort((a, b) => a.min - b.min);
    let end = ranges[0]?.max ?? 0;
    for (const range of ranges.slice(1)) {
      if (range.min > end) gaps.push(issue(range.id, `${key}: gap z${end}–${range.min}`));
      end = Math.max(end, range.max);
    }
  }
  const ranked = [
    [/runway/u, 3],
    [/taxiway/u, 2],
    [/motorway|highway/u, 3],
    [/primary/u, 2],
    [/minor|service|footway/u, 1],
  ] as const;
  const rank = (id: string) => ranked.find(([r]) => r.test(id))?.[1];
  for (let z = 0; z <= 22; z++)
    for (const group of groups.values())
      for (const a of group)
        for (const b of group) {
          if (
            a.id >= b.id ||
            a.type !== 'line' ||
            b.type !== 'line' ||
            !active(a, z) ||
            !active(b, z) ||
            rank(a.id) === undefined ||
            rank(b.id) === undefined ||
            rank(a.id) === rank(b.id)
          )
            continue;
          const wa = evaluatedValue(map, a.id, 'paint', 'line-width', undefined, z),
            wb = evaluatedValue(map, b.id, 'paint', 'line-width', undefined, z);
          if (typeof wa === 'number' && typeof wb === 'number') roadComparisons++;
          if (
            typeof wa === 'number' &&
            typeof wb === 'number' &&
            ((rank(a.id)! > rank(b.id)! && wa < wb) || (rank(a.id)! < rank(b.id)! && wa > wb))
          )
            inversions.push(issue(a.id, `${a.id} (${wa}px) vs ${b.id} (${wb}px) at z${z}`));
        }
  const labelRank = (id: string) =>
    /city/u.test(id) ? 3 : /town/u.test(id) ? 2 : /village/u.test(id) ? 1 : undefined;
  for (const a of symbols)
    for (const b of symbols) {
      if (
        a.id >= b.id ||
        labelRank(a.id) === undefined ||
        labelRank(b.id) === undefined ||
        labelRank(a.id) === labelRank(b.id)
      )
        continue;
      for (let z = 0; z <= 22; z++) {
        if (!active(a, z) || !active(b, z)) continue;
        const sa = evaluatedValue(map, a.id, 'layout', 'text-size', undefined, z),
          sb = evaluatedValue(map, b.id, 'layout', 'text-size', undefined, z);
        if (typeof sa === 'number' && typeof sb === 'number') placeComparisons++;
        if (
          typeof sa === 'number' &&
          typeof sb === 'number' &&
          (sa - sb) * (labelRank(a.id)! - labelRank(b.id)!) < 0
        )
          hierarchy.push(issue(a.id, `${a.id} ${sa}px vs ${b.id} ${sb}px at z${z}`));
      }
    }
  count(
    'carto-0',
    gaps,
    'Union of enabled zoom ranges grouped by geometry type and source-layer. Groups are inferred from actual source bindings.',
    'Review gaps and extend the appropriate replacement layer.',
  );
  count(
    'carto-1',
    pop,
    'Layers entering above z0 without a declared zoom-dependent opacity ramp. A potential pop-in, not a measured visual discontinuity.',
    'Interpolate opacity around minzoom where a gradual reveal is intended.',
  );
  count(
    'carto-2',
    inversions,
    'Width hierarchy heuristic using recognizable runway/taxiway and road-class IDs; unmatched names are not assessed.',
    'Review width rules at the reported zoom; intentional casing stacks may explain a difference.',
  );
  count(
    'carto-3',
    hierarchy,
    'City/town/village text-size comparisons where layer IDs expose those roles. Data-driven sizes without samples are excluded.',
    'Review place label sizes and priorities across shared zoom ranges.',
  );
  quality(
    'carto-4',
    combineQualitySamples(views.filter((v) => v.ready).map((v) => v.scaleContinuity)),
    'Percentage of sampled size rules without a jump exceeding both 1 px and 25% across a declared zoom stop (±0.0001 zoom). One rule per visible layer per ready view, with up to four feature contexts. Constant sizes and continuous scaling pass. Layer entry/exit is excluded. This evaluates authored line widths, text sizes and circle radii, not final screen pixels or transitions.',
    'Review the reported zoom stop. Use interpolation if smooth scaling is intended; deliberate step changes can be valid design choices.',
  );
  const coverage = Array.from({length: 23}, (_, z) => layers.filter((l) => active(l, z)).length),
    dead = coverage.slice(1).flatMap((n, i) => (n === coverage[i] ? [i + 1] : []));
  set(
    'carto-5',
    `${dead.length} zooms with unchanged eligible-layer count`,
    `z${dead.join(', z') || '—'}. Layer count is only a structural clue: tiles and expressions can add detail without adding layers.`,
  );
  metric(
    'carto-6',
    Math.max(...views.map((v) => v.fillFraction)) * 100,
    75,
    '% grid points intersect fills',
    '8×8 screen grid per sampled view; counts nonzero-opacity fill intersections. Measures coverage, not perceived visual weight.',
    [],
    'Inspect opaque fill stacks and check whether labels retain enough separation.',
  );
  const missingImages = [...new Set([...input.missing, ...views.flatMap((v) => v.missing)])];
  set(
    'integrity-0',
    `${missingImages.length} missing images`,
    'Observed styleimagemissing events and evaluated/literal icon references in sampled features.',
    missingImages.length ? 0 : 100,
    missingImages.map((name) => ({message: name})),
    'Add missing sprite IDs or correct icon-image expressions.',
  );
  const inventories = views.map((v) => ({
    theme: v.theme,
    icons: new Set(
      v.style.layers.flatMap((l) =>
        l.type === 'symbol' && typeof l.layout?.['icon-image'] === 'string'
          ? [l.layout['icon-image']]
          : [],
      ),
    ),
  }));
  if (input.scope === 'sweep')
    set(
      'integrity-1',
      `${new Set(inventories.map((v) => v.theme)).size} themes inspected`,
      `${missingImages.length} missing references across actual variants. Shared images are valid; a “-dark” suffix is not required.`,
      missingImages.length ? 50 : 100,
    );
  else
    checks.get('integrity-1')!.evidence =
      'Run All zooms to inspect the registered themes and times of day.';
  const resident = new Set(visibleTiles(map).tiles.map((t) => t.source)),
    hidden = layers
      .filter((l) => l.layout?.visibility === 'none' && 'source' in l && resident.has(l.source))
      .map((l) =>
        issue(
          l.id,
          `Source ${'source' in l ? l.source : ''} has resident tiles; it may be shared with visible layers.`,
        ),
      );
  set(
    'integrity-2',
    `${hidden.length} hidden layers reference resident sources`,
    'Source residency is observed; it does not prove the hidden layer caused a download or was parsed.',
    undefined,
    hidden,
    'Check source sharing before removing a hidden layer or disabling its module.',
  );
  const glyphs = views.flatMap((v) => v.glyphs?.missing ?? []),
    glyphCount = views.reduce((a, v) => a + (v.glyphs?.total ?? 0), 0);
  if (glyphCount)
    set(
      'integrity-3',
      `${new Set(glyphs).size} missing glyph entries`,
      `${glyphCount} cached glyph observations across font variants. Whitespace is excluded.`,
      glyphs.length ? 0 : 100,
      glyphs.map((message) => ({message})),
      'Supply the required glyph range or a font face covering these characters.',
    );
  count(
    'integrity-4',
    views.flatMap((v) => v.nulls),
    'Evaluated paint/layout expressions against bounded resident source-feature samples. A missing evaluation context is reported as unresolved, not proof of a bad expression.',
    'Inspect property inputs and add appropriate coalesce/default branches.',
  );
  const filters = new Map<string, {samples: number; matches: number}>();
  for (const view of views)
    for (const [id, value] of view.filters) {
      const prev = filters.get(id) ?? {samples: 0, matches: 0};
      filters.set(id, {
        samples: prev.samples + value.samples,
        matches: prev.matches + value.matches,
      });
    }
  const noMatches = [...filters]
    .filter(([, v]) => v.samples > 0 && v.matches === 0)
    .map(([id, v]) =>
      issue(
        id,
        `No matches in ${v.samples} evaluated source-feature samples across visited views.`,
      ),
    );
  count(
    'integrity-5',
    noMatches,
    'Checks only filters whose source data was sampled; zero matches is local evidence, not proof that a filter never matches globally.',
    'Review property names, value types and filter intent in Layers → Rules.',
  );
  // Validation's object guards belong to the inspector realm; normalize iframe objects first.
  const authoredStyle = JSON.parse(JSON.stringify(style));
  delete authoredStyle.collectResourceTiming;
  for (const source of Object.values(authoredStyle.sources) as Record<string, unknown>[])
    delete source.collectResourceTiming;
  const validation = validateStyleMin({
    ...authoredStyle,
    layers: authoredStyle.layers.filter(
      (l: {id: string; type: string}) =>
        l.type !== 'custom' && !l.id.startsWith('__tileflow-inspector-'),
    ),
  }).map((e) => ({message: e.message}));
  set(
    'integrity-6',
    validation.length ? `${validation.length} validation errors` : 'Valid MapLibre style',
    'Validates the serialized style against the installed MapLibre style specification; custom runtime layers are excluded.',
    validation.length ? 0 : 100,
    validation,
    'Correct the reported style-spec errors in the map configuration.',
  );
  const errors = [
    ...new Set([
      ...input.runtimeErrors,
      ...input.resources
        .filter((r) => r.id > input.auditResourceCursor && /^([45]\d\d|error)/iu.test(r.status))
        .map((r) => `${r.name}: ${r.error ?? r.status}`),
    ]),
  ];
  set(
    'integrity-7',
    `${errors.length} errors`,
    'MapLibre/runtime errors and failed resource responses observed during this audit. Earlier session errors and console messages outside the bridge are excluded.',
    errors.length ? 0 : 100,
    errors.map((message) => ({message})),
    'Inspect the failed resource or runtime error and rerun the audit.',
  );
  for (const [id, covered] of [
    ['legibility-2', allLabels.length > 1],
    ['legibility-5', symbols.length > 0],
    ['a11y-2', colors.length > 1],
    ['carto-2', roadComparisons > 0],
    ['carto-3', placeComparisons > 0],
    ['integrity-5', [...filters.values()].some((v) => v.samples > 0)],
  ] as const) {
    if (!covered) {
      const check = checks.get(id)!;
      check.score = undefined;
      check.status = 'unavailable';
      check.value = 'No eligible samples';
    }
  }
  return auditCategories.map((category) => {
    const items = category.checks.map((c) => checks.get(c.id)!);
    return {
      id: category.id,
      title: category.title,
      description: category.description,
      score: summarizeChecks(items),
      ...(category.id === 'legibility'
        ? {scoreBasis: 'Text-size budget'}
        : category.id === 'carto'
          ? {scoreBasis: 'Size-rule continuity'}
          : {}),
      checks: items,
    };
  });
}

export function confusablePairs(colors: {layer: string; type: string; color: string}[]): Finding[] {
  // Full-severity linear-RGB approximation, with three independent deficiency matrices.
  const matrices = [
    [
      [0.152286, 1.052583, -0.204868],
      [0.114503, 0.786281, 0.099216],
      [-0.003882, -0.048116, 1.051998],
    ],
    [
      [0.367322, 0.860646, -0.227968],
      [0.280085, 0.672501, 0.047413],
      [-0.01182, 0.04294, 0.968881],
    ],
    [
      [1.255528, -0.076749, -0.178779],
      [-0.078411, 0.930809, 0.147602],
      [0.004733, 0.691367, 0.3039],
    ],
  ];
  const names = ['protanopia', 'deuteranopia', 'tritanopia'];
  const linear = (n: number) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  const result: Finding[] = [];
  const data = colors.slice(0, 160).map((c) => {
    const parsed = Color.parse(c.color)!;
    return {...c, rgb: [parsed.r, parsed.g, parsed.b].map(linear)};
  });
  for (let i = 0; i < data.length; i++)
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i],
        b = data[j];
      if (a.layer === b.layer || a.type !== b.type) continue;
      const distance = (x: number[], y: number[]) => Math.hypot(...x.map((v, k) => v - y[k]));
      if (distance(a.rgb, b.rgb) < 0.15) continue;
      for (let k = 0; k < matrices.length; k++) {
        const transform = (v: number[]) =>
          matrices[k].map((row) =>
            Math.max(
              0,
              Math.min(
                1,
                row.reduce((sum, n, index) => sum + n * v[index], 0),
              ),
            ),
          );
        if (distance(transform(a.rgb), transform(b.rgb)) < 0.08) {
          result.push(issue(a.layer, `${a.layer} and ${b.layer} converge under ${names[k]}.`));
          break;
        }
      }
      if (result.length >= 30) return result;
    }
  return result;
}
