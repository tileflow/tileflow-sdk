import {Color} from '@maplibre/maplibre-gl-style-spec';
import type {ResourceRecord, TileRecord} from '../types';

export type Camera = {center: [number, number]; zoom: number; bearing: number; pitch: number};
export type CategoryId = 'performance' | 'network' | 'legibility' | 'style' | 'integrity';
export type Finding = {
  featureId?: string | number;
  message: string;
  layer?: string;
  camera?: Camera;
  coordinate?: [number, number];
};
export type Check = {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'fail' | 'manual' | 'unavailable' | 'info';
  score?: number;
  value: string;
  detail: string;
  findings?: Finding[];
};
export type Category = {id: CategoryId; title: string; score: number | null; checks: Check[]};
export type LabelSample = Finding & {size?: number; ratio?: number; background: string};
export type AuditInput = {
  frames: number[];
  settle: {name: string; duration: number; loaded: boolean}[];
  mapReadyMs?: number;
  resources?: ResourceRecord[];
  dropped: number;
  tiles?: TileRecord[];
  labels: LabelSample[];
  styleCost: {
    activeLayers: number;
    sources: number;
    geojson: {name: string; bytes: number}[];
    expressions: Finding[];
  };
  scenarios: Scenario[];
  styleIssues: Finding[];
  runtimeErrors: string[];
  missingImages: string[];
};
export type AuditReport = {
  version: 1;
  date: string;
  map: string;
  theme: string;
  profile: 'viewport' | 'navigation' | 'deep';
  camera: Camera;
  viewport: {width: number; height: number; dpr: number};
  duration: number;
  generation: number;
  categories: Category[];
  samples: number;
  scenarios: Scenario[];
};

export type Scenario = {
  name: string;
  viewport: string;
  width: number;
  height: number;
  camera: Camera;
  readyMs: number;
  tileWaitMs: number;
  loaded: boolean;
  frameP95?: number;
  longFrameRate?: number;
  tileP95?: number;
  transferred?: number;
  sizedRequests: number;
  requests: number;
  labels: number;
};
export const budgets = {
  frameMs: 20,
  tileMs: 300,
  readyMs: 1500,
  desktopBytes: 2 * 1048576,
  mobileBytes: 1048576,
};
export const profileNames = {
  viewport: 'Quick · current view',
  navigation: 'Standard · desktop + mobile',
  deep: 'Deep · desktop + mobile + tablet',
};

export const categoryNames: Record<CategoryId, string> = {
  performance: 'Performance',
  network: 'Tiles & network',
  legibility: 'Legibility',
  style: 'Style cost',
  integrity: 'Map health',
};
export function category(id: CategoryId, checks: Check[]): Category {
  const measured = checks.flatMap((check) => (check.score === undefined ? [] : [check.score]));
  return {
    id,
    title: categoryNames[id],
    checks,
    score: measured.length
      ? Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length)
      : null,
  };
}
export function ratioScore(passing: number, total: number): number | undefined {
  return total > 0 ? (100 * passing) / total : undefined;
}
export function metricScore(value: number, good: number, poor: number): number {
  return Math.round(Math.max(0, Math.min(100, (100 * (poor - value)) / (poor - good))));
}
export function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}
export function compositeColor(
  foreground: string,
  background: string,
  opacity = 1,
): string | undefined {
  const fg = Color.parse(foreground),
    bg = Color.parse(background);
  if (!fg || !bg || bg.a < 1 || !Number.isFinite(opacity)) return undefined;
  opacity = Math.max(0, Math.min(1, opacity));
  const alpha = fg.a * opacity;
  return new Color(
    fg.r * opacity + bg.r * (1 - alpha),
    fg.g * opacity + bg.g * (1 - alpha),
    fg.b * opacity + bg.b * (1 - alpha),
    1,
  ).toString();
}
export function contrastRatio(foreground: string, background: string): number | undefined {
  const bg = Color.parse(background),
    fg = Color.parse(foreground);
  if (!fg || !bg || bg.a < 1) return undefined;
  const solid = Color.parse(compositeColor(foreground, background));
  if (!solid) return undefined;
  const luminance = (color: Color) =>
    [color.r, color.g, color.b].reduce(
      (sum, c, i) =>
        sum +
        (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i],
      0,
    );
  const a = luminance(solid),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function check(
  id: string,
  title: string,
  score: number | undefined,
  value: string,
  detail: string,
  findings?: Finding[],
): Check {
  return {
    id,
    title,
    score,
    value,
    detail,
    findings,
    status:
      score === undefined ? 'unavailable' : score === 100 ? 'pass' : score >= 50 ? 'warn' : 'fail',
  };
}
function manual(id: string, title: string, detail: string, value = 'Review manually'): Check {
  return {id, title, status: 'manual', value, detail};
}
export function analyzeAudit(input: AuditInput): Category[] {
  const frames = input.frames.filter((n) => n > 0 && Number.isFinite(n));
  const frameP95s = input.scenarios.flatMap((s) => (s.frameP95 === undefined ? [] : [s.frameP95]));
  const p95 = frameP95s.length
    ? Math.max(...frameP95s)
    : frames.length >= 30
      ? percentile(frames, 0.95)
      : undefined;
  const longRates = input.scenarios.flatMap((s) =>
    s.longFrameRate === undefined ? [] : [s.longFrameRate],
  );
  const longRate = longRates.length
    ? Math.max(...longRates)
    : frames.filter((n) => n > 50).length / frames.length;
  const slow = frames.filter((n) => n > 50).length;
  const worstSettle = Math.max(0, ...input.settle.map((entry) => entry.duration));
  const resources = input.resources?.filter((item) => item.transport === 'resource');
  const known = resources?.filter((item) => /^(?:[1-5]\d\d|Cached)$/u.test(item.status)) || [];
  const failed = known.filter((item) => /^[45]\d\d$/u.test(item.status));
  const sizedTiles =
    resources?.filter((item) => item.kind === 'Tile' && item.bytes !== undefined) || [];
  const heavy = sizedTiles.filter((item) => item.bytes! > 512 * 1024);
  const failedTiles = input.tiles?.filter((tile) => /error|errored/iu.test(tile.state)) || [];
  const sizes =
    resources?.filter((item) => item.transferred !== undefined && item.bytes !== undefined) || [];
  const cached = sizes.filter((item) => item.status === 'Cached').length;
  const contrasts = input.labels.filter((label) => label.ratio !== undefined);
  const poorContrast = contrasts.filter((label) => label.ratio! < 4.5);
  const sizedLabels = input.labels.filter((label) => label.size !== undefined);
  const small = sizedLabels.filter((label) => label.size! < 12);
  const cost = input.styleCost;
  const tileTimings = input.scenarios.flatMap((scenario) =>
    scenario.tileP95 === undefined ? [] : [scenario.tileP95],
  );
  const slowestTiles = tileTimings.length ? Math.max(...tileTimings) : undefined;
  const embedded = cost.geojson;
  const oversized = embedded.filter((source) => source.bytes > 1048576);
  return [
    category('performance', [
      check(
        'frames',
        'Frame pacing · p95',
        p95 === undefined ? undefined : metricScore(p95, 20, 100),
        p95 === undefined ? 'Not enough frames' : `${p95.toFixed(1)} ms`,
        `${frames.length} browser animation-frame intervals. Score uses the worst scenario p95. 100 at ≤20 ms; 0 at ≥100 ms. Includes browser scheduling, not GPU timing.`,
      ),
      check(
        'stalls',
        'Long frames',
        frames.length >= 30 ? metricScore(longRate, 0.01, 0.25) : undefined,
        `${slow} / ${frames.length} over 50 ms`,
        'Worst-scenario long-frame rate: 100 at ≤1%; 0 at ≥25%. Measurements use the current device and viewport.',
      ),
      check(
        'settle',
        'Visible tiles ready',
        input.settle.length
          ? input.settle.every((s) => s.loaded)
            ? metricScore(worstSettle, budgets.readyMs, 8000)
            : 0
          : undefined,
        input.settle.every((s) => s.loaded)
          ? `${Math.round(worstSettle)} ms worst stop`
          : 'Readiness timed out',
        'Waits for map.loaded() and areTilesLoaded() at each stop, up to 8 seconds after each movement. 100 at ≤1.5 s; 0 at ≥8 s. Navigation animation time is excluded.',
        input.settle.map((s) => ({
          message: `${s.name}: ${Math.round(s.duration)} ms${s.loaded ? '' : ' (incomplete)'}`,
        })),
      ),
      {
        ...check(
          'startup',
          'Initial map load',
          undefined,
          input.mapReadyMs === undefined ? 'Not captured' : `${Math.round(input.mapReadyMs)} ms`,
          'Navigation start to MapLibre load, if captured by the preview observer. Informational: this audit does not reload the page or simulate a cold cache.',
        ),
        status: input.mapReadyMs === undefined ? 'unavailable' : 'info',
      },
    ]),
    category('network', [
      check(
        'tile-latency',
        'Tile / archive response time',
        slowestTiles === undefined ? undefined : metricScore(slowestTiles, budgets.tileMs, 1500),
        slowestTiles === undefined
          ? 'No new measurable requests'
          : `${Math.round(slowestTiles)} ms worst scenario p95`,
        'New tile and PMTiles archive requests during each scenario. Target ≤300 ms. Includes network and server time; cached responses may be faster. Missing timings are excluded.',
      ),
      check(
        'requests',
        'Observed request failures',
        ratioScore(known.length - failed.length, known.length),
        `${failed.length} failed / ${known.length} known statuses`,
        `Resource Timing from this preview, recorded during this audit. Missing cross-origin status is excluded. ${input.dropped} older records discarded.`,
        failed
          .slice(0, 30)
          .map((item) => ({message: `${item.status} · ${item.kind} · ${item.url}`})),
      ),
      check(
        'tile-budget',
        'Tile payload budget',
        ratioScore(sizedTiles.length - heavy.length, sizedTiles.length),
        `${heavy.length} over 512 KiB / ${sizedTiles.length} measurable tiles`,
        'A Beacon diagnostic budget per encoded tile response, not a universal limit. PMTiles archive range requests cannot be attributed to individual tiles.',
        heavy
          .slice(0, 30)
          .map((item) => ({message: `${Math.round(item.bytes! / 1024)} KiB · ${item.url}`})),
      ),
      check(
        'transfer-budget',
        'Transfer per scenario',
        input.scenarios.some((s) => s.transferred !== undefined)
          ? Math.min(
              ...input.scenarios
                .filter((s) => s.transferred !== undefined)
                .map((s) =>
                  metricScore(
                    s.transferred!,
                    s.viewport === 'Mobile' ? budgets.mobileBytes : budgets.desktopBytes,
                    (s.viewport === 'Mobile' ? budgets.mobileBytes : budgets.desktopBytes) * 4,
                  ),
                ),
            )
          : undefined,
        'Target ≤1 MiB mobile · ≤2 MiB desktop',
        'New HTTP transfers with observable sizes during each scenario. Unknown cross-origin sizes are excluded; read coverage in the scenario table. Cache is retained.',
      ),
      check(
        'tile-errors',
        'Resident tile errors',
        ratioScore((input.tiles?.length || 0) - failedTiles.length, input.tiles?.length || 0),
        `${failedTiles.length} errors / ${input.tiles?.length || 0} sampled resident tiles`,
        'Renderer cache observations at the route stops; cached tiles need not generate requests.',
        failedTiles.slice(0, 30).map((tile) => ({
          message: `${tile.source} · ${tile.z}/${tile.x}/${tile.y} · ${tile.state}`,
        })),
      ),
      manual(
        'cache',
        'Cache and repeated requests',
        `${cached} cached responses among ${sizes.length} responses with observable sizes. Archive requests may fetch different byte ranges; redacted URLs may represent different queries. Inspect Network before treating repetition as waste.`,
        sizes.length
          ? `${Math.round(sizes.reduce((sum, item) => sum + item.transferred!, 0) / 1024)} KiB observed transfer`
          : 'Transfer size unavailable',
      ),
    ]),
    category('legibility', [
      check(
        'contrast',
        'Estimated label contrast',
        ratioScore(contrasts.length - poorContrast.length, contrasts.length),
        `${poorContrast.length} below 4.5:1 / ${contrasts.length} evaluated`,
        'Style-based estimate using an opaque text halo or the rendered flat fill stack at the sampled anchor. Raster, 3D, patterns and unresolved expressions are excluded. Target 4.5:1; this is not a WCAG conformance result.',
        poorContrast.slice(0, 30).map((label) => ({
          ...label,
          message: `${label.ratio!.toFixed(2)}:1 · ${label.message} · ${label.background}`,
        })),
      ),
      check(
        'text-size',
        'Label size',
        ratioScore(sizedLabels.length - small.length, sizedLabels.length),
        `${small.length} below 12 px / ${sizedLabels.length} evaluated`,
        '12 CSS pixels is a Beacon readability heuristic. Font, script, viewing distance and density still need visual review.',
        small
          .slice(0, 30)
          .map((label) => ({...label, message: `${label.size!.toFixed(1)} px · ${label.message}`})),
      ),
      manual(
        'visual-review',
        'Placement and hierarchy',
        `${input.labels.length - contrasts.length} sampled labels have no reliable background estimate. Review overlaps, label offsets, halos and hierarchy across locations and theme/time-of-day combinations.`,
      ),
    ]),
    category('style', [
      check(
        'layer-budget',
        'Active layer budget',
        metricScore(cost.activeLayers, 200, 800),
        `${cost.activeLayers} peak active layers`,
        'Layers enabled at the sampled zooms, before feature filtering. Diagnostic budget: 100 at ≤200, 0 at ≥800. It flags complexity to investigate, not measured GPU cost.',
      ),
      check(
        'geojson-budget',
        'Embedded GeoJSON size',
        ratioScore(embedded.length - oversized.length, embedded.length),
        `${oversized.length} over 1 MiB / ${embedded.length} inline sources`,
        'Large inline datasets increase style serialization and worker transfer. Consider vector tiles or simplifying geometry. URL-based GeoJSON needs separate payload inspection.',
        oversized.map((source) => ({
          message: `${source.name}: ${(source.bytes / 1048576).toFixed(2)} MiB`,
        })),
      ),
      {
        id: 'source-count',
        title: 'Source fan-out',
        status: 'info',
        value: `${cost.sources} sources`,
        detail:
          'Each visible source can introduce tile requests, decoding and caches. Consolidate sources where practical; source count alone is not a performance failure.',
      },
      {
        id: 'expressions',
        title: 'Largest style expressions',
        status: 'info',
        value: `${cost.expressions.length} expressions to review`,
        detail:
          'Largest expression trees by node count. Simplify repeated work where possible; actual cost depends on feature count and evaluation frequency.',
        findings: cost.expressions,
      },
    ]),
    category('integrity', [
      check(
        'style',
        'Layer and source references',
        input.styleIssues.length ? 0 : 100,
        `${input.styleIssues.length} structural issues`,
        'Checks duplicate layer IDs, missing source references and empty zoom ranges in the current compiled style.',
        input.styleIssues,
      ),
      check(
        'runtime',
        'Preview runtime errors',
        input.runtimeErrors.length ? 0 : 100,
        `${input.runtimeErrors.length} recorded errors`,
        'Errors retained by the preview bridge, including those emitted before the audit.',
        input.runtimeErrors.slice(0, 30).map((message) => ({message})),
      ),
      check(
        'images',
        'Missing sprite images',
        input.missingImages.length ? 0 : 100,
        `${input.missingImages.length} unresolved images`,
        'Checks styleimagemissing events observed during the audit and constant icon-image references in rendered layers. Unvisited features may use other images.',
        input.missingImages.slice(0, 30).map((message) => ({message})),
      ),
      manual(
        'coverage',
        'Geographic and theme coverage',
        'This run covers the current concrete theme and the sampled cameras. Rerun for other locations, zoom ranges, themes and times of day. It cannot validate the whole dataset.',
      ),
    ]),
  ];
}
