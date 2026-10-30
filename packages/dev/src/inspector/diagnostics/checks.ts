import {
  Color,
  createPropertyExpression,
  Formatted,
  isExpression,
  validateStyleMin,
  ZoomConstantExpression,
  ZoomDependentExpression,
} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {sanitizeDiagnosticSecrets} from '../../diagnostic-sanitization';
import {propertySpec} from '../style-edits';
import {
  type DiagnosticCamera,
  diagnosticFinding,
  type DiagnosticFinding,
  type DiagnosticProvenance,
  type DiagnosticSample,
  diagnosticSignature,
  type DiagnosticTarget,
} from './model';

const internalLayer = (id: string) => id.startsWith('__tileflow-inspector-');
export const diagnosticLimits = {
  detailedLayers: 2000,
  renderedCandidates: 5000,
  labelAttempts: 200,
  labelSamples: 100,
} as const;
type Layer = StyleSpecification['layers'][number];
export type MissingDiagnosticImage = {
  id: string;
  layers?: string[];
  /** A loading opportunity has completed for the current style revision. */
  settled: boolean;
  /** Only set after resolving a required final image, rather than an optional fallback. */
  required?: boolean;
};
export type DiagnosticLabelSample = DiagnosticSample & {
  layer: string;
  text: string;
  foreground: string;
  background: string;
  ratio: number;
  method: 'opaque halo';
};
export type DiagnosticsOptions = {
  style: StyleSpecification;
  zoom: number;
  styleReady: boolean;
  provenance?: DiagnosticProvenance;
  availableImages?: readonly string[];
  missingImages?: readonly MissingDiagnosticImage[];
  /** Omit during automatic checks. An empty array means no eligible view samples. */
  labels?: readonly DiagnosticLabelSample[];
};

function eligible(layer: Layer, zoom: number): boolean {
  return (
    layer.layout?.visibility !== 'none' &&
    zoom >= (layer.minzoom ?? 0) &&
    zoom < (layer.maxzoom ?? 24)
  );
}

/** No renderer calls, camera changes, network requests or scoring. */
export function collectDiagnostics(options: DiagnosticsOptions): DiagnosticFinding[] {
  if (!options.styleReady) return [];
  const layers = options.style.layers.filter((layer) => !internalLayer(layer.id));
  const detailed = layers.slice(0, diagnosticLimits.detailedLayers);
  const findings = [
    ...styleFindings(options.style, detailed),
    ...imageFindings(options, detailed),
    ...stackFindings(options, layers),
    ...repeatedFindings(detailed),
    ...contrastFindings(options.labels ?? []),
  ];
  return findings.sort((a, b) =>
    a.kind === b.kind ? a.title.localeCompare(b.title) : a.kind === 'problem' ? -1 : 1,
  );
}

function styleFindings(style: StyleSpecification, layers: Layer[]): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  for (const layer of layers) {
    if ((layer.minzoom ?? 0) < (layer.maxzoom ?? 24)) continue;
    findings.push(
      diagnosticFinding(
        layer.id,
        {
          check: 'empty-zoom-range',
          category: 'style',
          kind: 'problem',
          title: 'Empty layer zoom range',
          summary: `${layer.id} cannot become eligible at any zoom.`,
          detail: 'Set minzoom below maxzoom. The upper bound is exclusive.',
          scope: 'style',
          layers: [layer.id],
          evidence: [
            {label: 'Minimum zoom', value: layer.minzoom ?? 0},
            {label: 'Maximum zoom (exclusive)', value: layer.maxzoom ?? 24},
          ],
          limitations: [],
        },
        [layer.minzoom, layer.maxzoom],
      ),
    );
  }
  // Custom layers have their own contracts. Runtime observation flags are not style rules.
  const validated = layers.filter((layer) => String(layer.type) !== 'custom');
  const authored = JSON.parse(
    JSON.stringify({
      ...style,
      layers: validated,
      // The style validator does not validate GeoJSON geometry. Do not clone large inline data.
      sources: Object.fromEntries(
        Object.entries(style.sources).map(([id, source]) => [
          id,
          source.type === 'geojson' && typeof source.data === 'object'
            ? {...source, data: {type: 'FeatureCollection', features: []}}
            : source,
        ]),
      ),
    }),
  );
  delete authored.collectResourceTiming;
  for (const source of Object.values(authored.sources) as Record<string, unknown>[])
    delete source.collectResourceTiming;
  for (const error of validateStyleMin(authored)) {
    const message = sanitizeDiagnosticSecrets(error.message);
    const match = /^layers\[(\d+)\](?:\.(paint|layout)\.([^:[]+)|\.(filter))?/.exec(message);
    const layer = match ? validated[Number(match[1])] : undefined;
    const section = match?.[2] as 'paint' | 'layout' | undefined;
    const property = match?.[3];
    const target: DiagnosticTarget | undefined =
      layer && section && property
        ? {layer: layer.id, section, property}
        : layer && match?.[4]
          ? {layer: layer.id, section: 'filter', property: 'filter'}
          : undefined;
    const brokenSource = /source .+ not found/.test(message);
    const location = layer ? message.replace(/^layers\[\d+\]/, layer.id) : message;
    const warning = error.severity === 'warning';
    findings.push(
      diagnosticFinding(
        `${layer?.id ?? 'style'}:${target?.section ?? ''}:${target?.property ?? ''}:${location}`,
        {
          check: brokenSource ? 'broken-style-reference' : 'invalid-style-rule',
          category: 'style',
          kind: warning ? 'review' : 'problem',
          title: brokenSource
            ? 'Missing layer source'
            : warning
              ? 'Style compatibility warning'
              : 'Invalid style rule',
          summary: location,
          detail: brokenSource
            ? 'Restore the referenced source or point this layer at a source present in the style.'
            : 'Review the reported value against the MapLibre style specification.',
          scope: 'style',
          layers: layer ? [layer.id] : [],
          target,
          evidence: [{label: 'Style validation', value: location}],
          limitations: ['Custom runtime layers are excluded from style-spec validation.'],
        },
        [location, layer],
      ),
    );
  }
  return findings;
}

function imageFindings(options: DiagnosticsOptions, layers: Layer[]): DiagnosticFinding[] {
  if (!options.availableImages) return [];
  const available = new Set(options.availableImages);
  const observations = new Map<string, MissingDiagnosticImage[]>();
  for (const observation of options.missingImages ?? []) {
    if (!observation.settled || available.has(observation.id)) continue;
    const values = observations.get(observation.id) ?? [];
    values.push(observation);
    observations.set(observation.id, values);
  }
  const findings: DiagnosticFinding[] = [];
  for (const [id, observed] of observations) {
    const requiredLayers = new Set(
      observed.filter((entry) => entry.required).flatMap((entry) => entry.layers ?? []),
    );
    const affected = layers.filter((layer): layer is Extract<Layer, {type: 'symbol'}> => {
      if (layer.type !== 'symbol' || !eligible(layer, options.zoom)) return false;
      const reference = layer.layout?.['icon-image'];
      return (
        reference === id ||
        (Array.isArray(reference) &&
          reference.length === 2 &&
          reference[0] === 'image' &&
          reference[1] === id) ||
        requiredLayers.has(layer.id)
      );
    });
    if (!affected.length) continue;
    findings.push(
      diagnosticFinding(
        id,
        {
          check: 'missing-icon',
          category: 'assets',
          kind: 'problem',
          title: `Missing icon “${id}”`,
          summary: `Requested by the renderer and still unavailable after loading settled. Referenced by ${affected.length} eligible ${affected.length === 1 ? 'layer' : 'layers'}.`,
          detail:
            'Check the icon identifier and asset registration. Dynamically supplied images can resolve this finding on a later check.',
          scope: 'view',
          layers: affected.map((layer) => layer.id),
          target: {layer: affected[0].id, section: 'layout', property: 'icon-image'},
          evidence: [
            {label: 'Image ID', value: id},
            {label: 'Required references', value: affected.length},
          ],
          limitations: [
            'Only observed, settled requests with a required reference are included. Optional expression fallback candidates are excluded.',
          ],
        },
        [id, affected.map((layer) => [layer.id, layer.layout?.['icon-image']])],
      ),
    );
  }
  return findings;
}

function stackFindings(options: DiagnosticsOptions, layers: Layer[]): DiagnosticFinding[] {
  const active = layers.filter((layer) => eligible(layer, options.zoom));
  // A deliberately high review trigger, not a renderer limit or a performance score.
  if (layers.length < 1000 && active.length < 500) return [];
  const origins = new Map(
    options.provenance?.layers.map((layer) => [layer.id, layer.contributions]),
  );
  const owners = new Map<string, number>();
  for (const layer of active) {
    const contributions = origins.get(layer.id) ?? [];
    const names = [...new Set(contributions.map((contribution) => contribution.owner))];
    for (const name of names.length ? names : ['Unattributed'])
      owners.set(name, (owners.get(name) ?? 0) + 1);
  }
  return [
    diagnosticFinding(
      'style',
      {
        check: 'large-layer-stack',
        category: 'performance',
        kind: 'review',
        title: 'Large rendering layer stack',
        summary: `${layers.length} declared layers; ${active.length} eligible at zoom ${options.zoom.toFixed(2)}.`,
        detail:
          'Review modules with large contributions and unused or repeated rendering rules. Generated layers may be intentional; use the performance observation before attributing a slowdown.',
        scope: 'style',
        layers: active.slice(0, 100).map((layer) => layer.id),
        evidence: [
          {label: 'Declared layers', value: layers.length},
          {label: 'Eligible by zoom and visibility', value: active.length},
          ...[...owners]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([label, value]) => ({label: `Module: ${label}`, value})),
        ],
        limitations: [
          'Review trigger: 1,000 declared layers or 500 eligible layers. This is a conservative complexity indication, not a measured renderer limit.',
          'Eligible layers are not necessarily drawn. Features, filters, geometry and custom rendering affect the actual work.',
          'A generated layer may have several module contributions; module counts can overlap.',
          ...(layers.length > diagnosticLimits.detailedLayers
            ? [
                `Detailed style, icon-reference and repeated-rule checks inspect the first ${diagnosticLimits.detailedLayers} non-internal layers; stack counts cover all ${layers.length}.`,
              ]
            : []),
        ],
      },
      [layers.length, active.length, [...owners].sort(([a], [b]) => a.localeCompare(b))],
    ),
  ];
}

function repeatedFindings(layers: Layer[]): DiagnosticFinding[] {
  const groups = new Map<string, Layer[]>();
  for (const layer of layers) {
    if (String(layer.type) === 'custom' || layer.layout?.visibility === 'none') continue;
    // Compare every renderer input, not names or inferred intent. Metadata describes authorship.
    const {id: _id, metadata: _metadata, ...rule} = layer;
    const signature = diagnosticSignature(rule);
    const group = groups.get(signature) ?? [];
    group.push(layer);
    groups.set(signature, group);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      const ids = group.map((layer) => layer.id);
      return diagnosticFinding(
        ids.join('\u0000'),
        {
          check: 'repeated-rendering-rules',
          category: 'performance',
          kind: 'review',
          title: 'Potentially repeated rendering rules',
          summary: `${group.length} layers have identical renderer inputs.`,
          detail:
            'Compare these contributions before removing anything. Repeated translucent paint, placement priority or intervening layers can make identical rules intentional.',
          scope: 'style',
          layers: ids,
          evidence: [
            {label: 'Matching layers', value: group.length},
            {label: 'Layer type', value: group[0].type},
          ],
          limitations: [
            'Exact equality does not prove redundant pixels or wasted draw calls. Layer order and composition can change the result.',
          ],
        },
        group,
      );
    });
}

export function contrastFindings(samples: readonly DiagnosticLabelSample[]): DiagnosticFinding[] {
  const byLayer = new Map<string, DiagnosticLabelSample[]>();
  for (const sample of samples) {
    // Below 3:1 is a conservative review reference even for large text; not WCAG certification.
    if (
      sample.method !== 'opaque halo' ||
      !Number.isFinite(sample.ratio) ||
      sample.ratio < 1 ||
      sample.ratio >= 3
    )
      continue;
    const group = byLayer.get(sample.layer) ?? [];
    group.push(sample);
    byLayer.set(sample.layer, group);
  }
  return [...byLayer].map(([layer, group]) => {
    const minimum = Math.min(...group.map((sample) => sample.ratio));
    const combinations = [
      ...new Set(group.map((sample) => `${sample.foreground} / ${sample.background}`)),
    ];
    return diagnosticFinding(
      layer,
      {
        check: 'low-text-contrast',
        category: 'readability',
        kind: 'review',
        title: 'Low text and halo contrast',
        summary: `${group.length} sampled ${group.length === 1 ? 'label has' : 'labels have'} a text/halo contrast below 3:1.`,
        detail:
          'Inspect the text and halo colors together. The colors are resolved from this view; the detector does not measure glyph pixels or certify readability.',
        scope: 'view',
        layers: [layer],
        target: {layer, section: 'paint', property: 'text-color'},
        evidence: [
          {label: 'Lowest sampled contrast', value: `${minimum.toFixed(2)}:1`},
          {label: 'Affected samples', value: group.length},
          ...combinations.slice(0, 4).map((value) => ({label: 'Text / halo', value})),
        ],
        samples: group.slice(0, 8).map((sample) => ({
          layer: sample.layer,
          featureId: sample.featureId,
          coordinate: sample.coordinate,
          camera: sample.camera,
          text: sample.text,
          value: `${sample.ratio.toFixed(2)}:1`,
        })),
        limitations: [
          'Only opaque text over an opaque, unblurred halo at least 1 CSS px wide is sampled. Unknown backgrounds and per-section formatting are skipped.',
          'The 3:1 threshold is a review reference, not a complete accessibility test or a minimum font-size rule.',
        ],
      },
      combinations.sort(),
    );
  });
}

/** Small explicit-view probe. It never reads pixels or infers a background from nearby geometry. */
export function sampleDiagnosticLabels(map: MapLibreMap, limit = 40): DiagnosticLabelSample[] {
  const sampleLimit = Math.min(diagnosticLimits.labelSamples, Math.max(0, limit));
  if (!sampleLimit) return [];
  const zoom = map.getZoom();
  const layers = map
    .getStyle()
    .layers.filter(
      (layer) =>
        layer.type === 'symbol' &&
        !internalLayer(layer.id) &&
        eligible(layer, zoom) &&
        !!layer.layout?.['text-field'],
    )
    .map((layer) => layer.id);
  // Filter inside the renderer query: slicing an all-layer result would still visit and
  // allocate unrelated fill/line geometry, and it could exhaust the budget before labels.
  if (!layers.length) return [];
  const camera: DiagnosticCamera = {
    center: [map.getCenter().lng, map.getCenter().lat],
    zoom,
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  const compiled = new Map<string, ReturnType<typeof createPropertyExpression>>();
  const globals = {zoom: camera.zoom, globalState: map.getGlobalState?.()};
  const evaluate = (
    feature: MapGeoJSONFeature,
    section: 'paint' | 'layout',
    property: string,
  ): unknown => {
    const spec = propertySpec('symbol', section, property);
    if (!spec) return undefined;
    const key = `${feature.layer.id}:${section}:${property}`;
    let expression = compiled.get(key);
    if (!expression) {
      const raw =
        section === 'paint'
          ? map.getPaintProperty(feature.layer.id, property as 'text-color')
          : map.getLayoutProperty(feature.layer.id, property as 'text-field');
      const value = raw ?? spec.default;
      expression = createPropertyExpression(
        Array.isArray(value) && !isExpression(value) ? ['literal', value] : value,
        property,
        spec,
        globals.globalState,
      );
      compiled.set(key, expression);
    }
    if (expression.result === 'error') return undefined;
    const evaluator = expression.value;
    if (!(
      evaluator instanceof ZoomConstantExpression || evaluator instanceof ZoomDependentExpression
    ))
      return undefined;
    try {
      const state =
        feature.id !== undefined && feature.source
          ? map.getFeatureState({
              source: feature.source,
              sourceLayer: feature.sourceLayer,
              id: feature.id,
            })
          : {};
      return evaluator.evaluateWithoutErrorHandling(
        globals,
        {
          id: feature.id,
          type: feature.geometry.type.replace('Multi', '') as 'Point',
          properties: feature.properties,
        },
        state,
      );
    } catch {
      return undefined;
    }
  };
  const groups = new Map<string, MapGeoJSONFeature[]>();
  for (const feature of map
    .queryRenderedFeatures(undefined, {layers})
    .slice(0, diagnosticLimits.renderedCandidates)) {
    if (feature.layer.type !== 'symbol' || internalLayer(feature.layer.id)) continue;
    const group = groups.get(feature.layer.id) ?? [];
    group.push(feature);
    groups.set(feature.layer.id, group);
  }
  const samples: DiagnosticLabelSample[] = [];
  const seen = new Set<string>();
  let remaining = [...groups.values()];
  let examined = 0;
  for (
    let index = 0;
    remaining.length && samples.length < sampleLimit && examined < diagnosticLimits.labelAttempts;
    index++
  ) {
    remaining = remaining.filter((group) => group.length > index);
    for (const group of remaining) {
      if (samples.length >= sampleLimit || examined++ >= diagnosticLimits.labelAttempts) break;
      const feature = group[index];
      const field = evaluate(feature, 'layout', 'text-field');
      if (
        field instanceof Formatted &&
        field.sections.some((section) => section.textColor || section.image || section.scale)
      )
        continue;
      const text =
        field instanceof Formatted ? field.toString() : typeof field === 'string' ? field : '';
      if (!text.trim()) continue;
      const foreground = evaluate(feature, 'paint', 'text-color');
      const background = evaluate(feature, 'paint', 'text-halo-color');
      const opacity = evaluate(feature, 'paint', 'text-opacity');
      const width = evaluate(feature, 'paint', 'text-halo-width');
      const blur = evaluate(feature, 'paint', 'text-halo-blur');
      const size = evaluate(feature, 'layout', 'text-size');
      if (
        !(foreground instanceof Color) ||
        foreground.a !== 1 ||
        !(background instanceof Color) ||
        background.a !== 1 ||
        opacity !== 1 ||
        typeof width !== 'number' ||
        width < 1 ||
        blur !== 0 ||
        typeof size !== 'number' ||
        size <= 0
      )
        continue;
      const identity = diagnosticSignature([
        feature.layer.id,
        feature.id ?? feature.geometry,
        text,
        foreground.toString(),
        background.toString(),
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const luminance = (color: Color) =>
        [color.r, color.g, color.b].reduce(
          (sum, value, i) =>
            sum +
            (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
              [0.2126, 0.7152, 0.0722][i],
          0,
        );
      const a = luminance(foreground),
        b = luminance(background);
      const coordinate =
        feature.geometry.type === 'Point'
          ? (feature.geometry.coordinates.slice(0, 2) as [number, number])
          : undefined;
      samples.push({
        layer: feature.layer.id,
        featureId: feature.id,
        coordinate,
        camera,
        text: text.slice(0, 120),
        foreground: foreground.toString(),
        background: background.toString(),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        method: 'opaque halo',
      });
    }
  }
  return samples;
}
