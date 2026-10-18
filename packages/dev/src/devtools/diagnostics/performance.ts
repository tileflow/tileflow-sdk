import type {Map as MapLibreMap} from 'maplibre-gl';
import {rendererProbe, sampleOverdraw} from '../beacon/probes';
import {type DiagnosticCamera, type DiagnosticFinding, diagnosticFinding} from './model';

export type PerformanceDistribution = {median: number; p95: number; max: number};
export type PerformanceObservation = {
  status: 'measured' | 'unavailable' | 'cancelled';
  durationMs: number;
  frames: number;
  drawCalls?: PerformanceDistribution;
  placementMs?: PerformanceDistribution;
  customCpuMs?: PerformanceDistribution;
  overdraw?: {
    averagePasses: number;
    saturatedFraction: number;
    samples: number;
    saturationPasses: 8;
  };
  limitations: string[];
};

const active = new WeakSet<MapLibreMap>();
const drawMethods = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
] as const;

function distribution(values: number[]): PerformanceDistribution | undefined {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return;
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted[sorted.length - 1],
  };
}

function debugEnabled(map: MapLibreMap) {
  return (
    map.showOverdrawInspector ||
    map.showCollisionBoxes ||
    map.showTileBoundaries ||
    map.showPadding ||
    map.vertices
  );
}

/**
 * Explicit, bounded observation of the current composition. It never moves the camera,
 * changes the style, emulates hardware, scores performance or starts a persistent loop.
 * The caller must discard results when its map/scene revision changes.
 */
export async function samplePerformance(
  map: MapLibreMap,
  signal: AbortSignal,
  options: {includeOverdraw?: boolean; durationMs?: number} = {},
): Promise<PerformanceObservation> {
  const result: PerformanceObservation = {
    status: 'unavailable',
    durationMs: 0,
    frames: 0,
    limitations: [],
  };
  const started = performance.now();
  if (signal.aborted) return {...result, status: 'cancelled'};
  if (active.has(map)) {
    result.limitations.push('A performance observation is already running for this map.');
    return result;
  }
  let probe: ReturnType<typeof rendererProbe> | undefined;
  const controller = new AbortController();
  const cleanup: (() => void)[] = [];
  let abortReason = 'The observation was cancelled.';
  const cancel = (reason: string) => {
    abortReason = reason;
    probe?.stop();
    controller.abort();
  };
  const externalAbort = () => cancel('The observation was cancelled before it completed.');
  active.add(map);
  try {
    const canvas = map.getCanvas();
    const document = canvas.ownerDocument;
    const gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) {
      result.limitations.push('A live WebGL2 context is required to observe renderer work.');
      return result;
    }
    if (document.hidden || !canvas.width || !canvas.height) {
      result.limitations.push(
        'Performance was not observed while the map was hidden or had no canvas area.',
      );
      return result;
    }
    if (!map.isStyleLoaded() || !map.areTilesLoaded() || map.isMoving()) {
      result.limitations.push(
        'Wait until the current view has finished loading and moving, then check again.',
      );
      return result;
    }
    if (debugEnabled(map)) {
      result.limitations.push(
        'Turn off map debugging visualizations before observing drawing work.',
      );
      return result;
    }
    const style = map.getStyle();
    if (!style) {
      result.limitations.push('The current map style is unavailable.');
      return result;
    }
    if (style.layers.some((layer) => layer.id.startsWith('__tileflow-devtools-'))) {
      result.limitations.push(
        'Clear map highlights or geometry editing overlays before observing drawing work.',
      );
      return result;
    }
    const customLayers = map.getLayersOrder().flatMap((id) => {
      const layer = map.getLayer(id) as any;
      if (layer?.type !== 'custom') return [];
      const target = layer.implementation ?? layer;
      return [{target, render: target.render}];
    });
    const listen = (type: string, reason: string) => {
      const handler = () => cancel(reason);
      map.on(type as any, handler);
      cleanup.push(() => map.off(type as any, handler));
    };
    listen('movestart', 'The camera moved during the observation. Check the new view again.');
    listen('resize', 'The viewport changed during the observation.');
    listen('styledata', 'The style changed during the observation.');
    listen('style.load', 'The style was replaced during the observation.');
    listen('sourcedataloading', 'Source loading restarted during the observation.');
    listen('terrain', 'The terrain changed during the observation.');
    listen('remove', 'The map was removed during the observation.');
    const visibility = () => {
      if (document.hidden) cancel('The page became hidden during the observation.');
    };
    document.addEventListener('visibilitychange', visibility);
    cleanup.push(() => document.removeEventListener('visibilitychange', visibility));
    const interact = () => cancel('A map interaction interrupted the observation.');
    for (const event of ['pointerdown', 'wheel', 'keydown', 'webglcontextlost']) {
      canvas.addEventListener(event, interact, {capture: true, passive: true});
      cleanup.push(() => canvas.removeEventListener(event, interact, {capture: true}));
    }
    signal.addEventListener('abort', externalAbort, {once: true});
    cleanup.push(() => signal.removeEventListener('abort', externalAbort));
    if (signal.aborted) externalAbort();
    if (controller.signal.aborted) return {...result, status: 'cancelled'};

    const originalDraws = drawMethods.map((name) => gl[name]);
    probe = rendererProbe(map);
    const drawsSupported = drawMethods.every((name, index) => gl[name] !== originalDraws[index]);
    const customSupported = customLayers.every(({target, render}) => target.render !== render);
    if (!drawsSupported)
      result.limitations.push(
        'Not all WebGL draw entry points could be observed; draw counts are omitted.',
      );
    if (!probe.placementSupported)
      result.limitations.push(
        'This renderer does not expose the label-placement observation hook.',
      );
    if (!customSupported)
      result.limitations.push(
        'Custom renderer CPU work could not be observed completely and is omitted.',
      );

    // Debug controls can change without a style event. Never mix these frames into the sample.
    let readingOverdraw = false;
    const guard = () => {
      if (
        map.showOverdrawInspector !== readingOverdraw ||
        map.showCollisionBoxes ||
        map.showTileBoundaries ||
        map.showPadding ||
        map.vertices
      )
        cancel('A debugging visualization was enabled during the observation.');
    };
    map.on('render', guard);
    cleanup.push(() => map.off('render', guard));
    const requested = options.durationMs ?? 650;
    const duration = Number.isFinite(requested) ? Math.max(200, Math.min(1000, requested)) : 650;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', finish);
        probe?.stop();
        resolve();
      };
      const timer = setTimeout(finish, duration);
      controller.signal.addEventListener('abort', finish, {once: true});
      if (controller.signal.aborted) finish();
      else probe!.start();
    });
    if (controller.signal.aborted) {
      result.status = 'cancelled';
      result.limitations.push(abortReason);
      return result;
    }
    result.frames = probe.frames.length;
    if (result.frames >= 10) {
      if (drawsSupported) result.drawCalls = distribution(probe.drawCalls);
      if (probe.placementSupported) result.placementMs = distribution(probe.placementMs);
      if (customLayers.length && customSupported) result.customCpuMs = distribution(probe.customMs);
    } else {
      result.limitations.push(
        `Only ${result.frames} complete repaint samples were observed; at least 10 are required for a workload indication.`,
      );
    }
    // Stop all wrapping before enabling overdraw. Its diagnostic passes must not count as map work.
    probe.dispose();
    probe = undefined;
    result.limitations.push(
      'Current view only, using forced repaints. Counts are observed WebGL draw submissions, not layers or GPU time; extension draw methods can be excluded.',
      'Placement and custom-renderer durations are synchronous CPU time, including instrumentation overhead; they do not measure GPU execution or user interaction latency.',
    );
    if (options.includeOverdraw !== false) {
      const unsupported = customLayers.length
        ? 'custom renderers do not participate reliably in the native overdraw shader'
        : map.getTerrain()
          ? 'terrain uses additional rendering passes that this observation cannot account for'
          : style.sky || (style.projection?.type && style.projection.type !== 'mercator')
            ? 'sky or globe rendering can contaminate the native overdraw pixels'
            : !/^6\./.test(map.version)
              ? 'the native overdraw shader has not been verified for this renderer version'
              : undefined;
      if (unsupported) result.limitations.push(`Overdraw was skipped: ${unsupported}.`);
      else {
        readingOverdraw = true;
        const overdraw = await sampleOverdraw(map, controller.signal);
        readingOverdraw = false;
        if (
          overdraw &&
          overdraw.samples > 0 &&
          Number.isFinite(overdraw.average) &&
          Number.isFinite(overdraw.hot)
        ) {
          result.overdraw = {
            averagePasses: overdraw.average,
            saturatedFraction: overdraw.hot,
            samples: overdraw.samples,
            saturationPasses: 8,
          };
          result.limitations.push(
            'Overdraw samples at most 16 scanlines of the final native framebuffer, using its central 4096 pixels on wider canvases. Counts saturate at eight; offscreen work is not included.',
          );
        } else
          result.limitations.push(
            'Native overdraw pixels could not be sampled before the timeout.',
          );
      }
    }
    if (controller.signal.aborted) {
      result.status = 'cancelled';
      result.limitations.push(abortReason);
    } else if (result.drawCalls || result.placementMs || result.customCpuMs || result.overdraw)
      result.status = 'measured';
  } catch {
    result.status = controller.signal.aborted ? 'cancelled' : 'unavailable';
    result.limitations.push(
      controller.signal.aborted
        ? abortReason
        : 'The renderer observation is not supported in this map state.',
    );
  } finally {
    // Teardown is best effort if an iframe or map has already been removed.
    try {
      probe?.dispose();
    } catch {}
    for (const dispose of cleanup.reverse()) {
      try {
        dispose();
      } catch {}
    }
    active.delete(map);
    result.durationMs = performance.now() - started;
  }
  return result;
}

/** Conservative, explicitly disclosed review triggers; no failure grades or causal claims. */
export function performanceFindings(
  observation: PerformanceObservation,
  camera?: DiagnosticCamera,
): DiagnosticFinding[] {
  if (observation.status !== 'measured') return [];
  const findings: DiagnosticFinding[] = [];
  const samples = camera ? [{camera, text: 'Observed view'}] : undefined;
  const common = {
    category: 'performance' as const,
    kind: 'review' as const,
    scope: 'view' as const,
    layers: [],
    samples,
    limitations: observation.limitations,
  };
  if (observation.drawCalls && observation.frames >= 10 && observation.drawCalls.median >= 1000) {
    const calls = observation.drawCalls;
    findings.push(
      diagnosticFinding(
        'current-view',
        {
          ...common,
          check: 'drawing-workload',
          title: 'Many drawing submissions in this view',
          summary: `${Math.round(calls.median).toLocaleString('en-US')} observed draw submissions per repaint (median).`,
          detail:
            'Inspect the composition in Debug if this view feels slow. Submissions may include multiple tiles, symbols, effects and custom renderers. This count does not identify an expensive layer or establish that the map is too slow.',
          evidence: [
            {label: 'Median draw submissions', value: calls.median},
            {label: '95th percentile', value: calls.p95},
            {label: 'Complete repaint samples', value: observation.frames},
            {
              label: 'Review trigger',
              value:
                'At least 1,000 observed submissions per repaint (median); an indication, not a performance budget.',
            },
          ],
        },
        {camera, median: Math.round(calls.median)},
      ),
    );
  }
  const overdraw = observation.overdraw;
  if (overdraw && overdraw.saturatedFraction >= 0.25) {
    findings.push(
      diagnosticFinding(
        'current-view',
        {
          ...common,
          check: 'overlapping-paint',
          title: 'Repeated painting across this view',
          summary: `${Math.round(overdraw.saturatedFraction * 100)}% of sampled pixels reached the native 8+ pass limit.`,
          detail:
            'Use Overdraw in Debug to locate the areas and review overlapping fills, casings and effects. Repeated paint can be intentional. This view-level sample does not establish GPU cost or attribute the work to an individual layer.',
          evidence: [
            {label: 'Pixels sampled', value: overdraw.samples},
            {
              label: 'Sampled pixels at 8+ passes',
              value: `${(overdraw.saturatedFraction * 100).toFixed(1)}%`,
            },
            {label: 'Capped average passes', value: Number(overdraw.averagePasses.toFixed(2))},
            {
              label: 'Review trigger',
              value:
                'At least 25% of sampled pixels at the 8+ pass saturation limit; not a GPU performance budget.',
            },
          ],
        },
        {camera, saturatedPercent: Math.round(overdraw.saturatedFraction * 100)},
      ),
    );
  }
  return findings;
}
