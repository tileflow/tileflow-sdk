import {type ElevationOptions, elevationProfile as requestElevationProfile} from './client';
import {metersPerFoot} from './constants';
import {type ElevationProfileResponse, elevationProfileResponseSchema} from './contract';
import {readGpx} from './gpx';
import {
  convertElevationProfile,
  type ElevatedLine,
  type ElevationProfile,
  elevationProfileAt,
  elevationProfileFromLine,
  elevationProfileFromResponse,
  type ElevationProfilePoint,
  nearestElevationSample,
  sliceElevationProfile,
} from './profile';

/**
 * An elevation profile control for MapLibre GL JS maps. It draws a line's profile as a chart,
 * colours it by grade, follows the pointer on the chart and on the map, lets the reader select a
 * stretch to measure it, and reads lines that already carry heights (GPX tracks, GeoJSON with
 * altitudes) without any request. Lines without heights are sampled by the Tileflow Elevation API.
 *
 * The control imports no MapLibre code: it works with any map object that has the methods of
 * {@link TileflowElevationProfileMap}, and it reaches the document only through the map's container
 * or the given one, so importing it on a server is safe.
 */

/**
 * The map methods the control uses; a MapLibre GL JS `Map` has all of them. The control adds one
 * GeoJSON source and line and circle layers; their parameters are `never` so that any map's own
 * source and layer types are accepted.
 */
export type TileflowElevationProfileMap = {
  getContainer(): HTMLElement;
  addSource(id: string, source: never): unknown;
  getSource(id: string): unknown;
  removeSource(id: string): unknown;
  addLayer(layer: never): unknown;
  getLayer(id: string): unknown;
  removeLayer(id: string): unknown;
  on(type: 'style.load' | 'mousemove' | 'mouseout', listener: (event: unknown) => void): unknown;
  off(type: 'style.load' | 'mousemove' | 'mouseout', listener: (event: unknown) => void): unknown;
  project(position: [number, number]): {x: number; y: number};
  fitBounds?(bounds: [[number, number], [number, number]], options?: {padding?: number}): unknown;
};

/** What `setData` accepts: a line, a GeoJSON feature or collection of lines, GPX text, or a profile. */
export type TileflowElevationProfileData =
  | ElevatedLine
  | Readonly<{type: 'Feature'; geometry: ElevatedLine | null}>
  | Readonly<{type: 'FeatureCollection'; features: readonly Readonly<{geometry: unknown}>[]}>
  | ElevationProfileResponse
  | ElevationProfile
  | string;

export type TileflowElevationProfileSelection = Readonly<{
  from: number;
  to: number;
  /** The selected stretch, in metres, with its own summary. */
  profile: ElevationProfile;
}>;

export type TileflowElevationProfileOptions = Readonly<
  Partial<Omit<ElevationOptions, 'signal'>> & {
    /** Display unit; the profile itself is always kept in metres. Default `metric`. */
    unit?: 'metric' | 'imperial';
    /** Draw the control here instead of in a map corner. */
    container?: HTMLElement;
    /** Chart height in CSS pixels. Default 160. */
    height?: number;
    /** Width inside a map corner. Default `360px`. */
    width?: string;
    /** Default `auto`, which follows the reader's system setting. */
    colorScheme?: 'light' | 'dark' | 'auto';
    /** Colour the profile line by grade. Default true. */
    colorByGrade?: boolean;
    /** Draw the line on the map. Default true; the hover point and selection are always drawn. */
    showLine?: boolean;
    /** Fit the map to each new line. Default false. */
    fitBounds?: boolean;
    /** Requested sample spacing in metres, for lines sampled by the API. Default 30. */
    interval?: number;
    /** Most samples requested from the API, 2 to 1,000. Default 500 (five API units). */
    maxSamples?: number;
    /** Smaller climbs and drops are not counted, in metres. Default 2. */
    climbThreshold?: number;
    /** A BCP 47 locale for numbers. Default `en`. */
    locale?: string;
    lineColor?: string;
    /** Prefix of the map source and layers the control adds. Default `tileflow-elevation-profile`. */
    idPrefix?: string;
    onHover?: (point: ElevationProfilePoint | null) => void;
    onClick?: (point: ElevationProfilePoint) => void;
    onSelect?: (selection: TileflowElevationProfileSelection | null) => void;
    onData?: (profile: ElevationProfile) => void;
    onError?: (error: unknown) => void;
  }
>;

export type TileflowElevationProfile = Readonly<{
  /** MapLibre's control entry point: `map.addControl(profile, 'bottom-left')`. */
  onAdd(map: TileflowElevationProfileMap): HTMLElement;
  onRemove(): void;
  getDefaultPosition(): 'bottom-left';
  /** The control's root element, available once added. */
  getElement(): HTMLElement | null;
  /** Shows a line or a profile; lines without heights are sampled by the Elevation API. */
  setData(
    data: TileflowElevationProfileData,
    options?: Readonly<{signal?: AbortSignal}>,
  ): Promise<ElevationProfile>;
  /** The profile shown, in metres. */
  getProfile(): ElevationProfile | null;
  clear(): void;
  setUnit(unit: 'metric' | 'imperial'): void;
  /** Selects the stretch between two distances in metres. */
  select(from: number, to: number): void;
  clearSelection(): void;
}>;

type Palette = {
  surface: string;
  text: string;
  muted: string;
  grid: string;
  line: string;
  fill: string;
  accent: string;
  selection: string;
};

const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    surface: 'rgba(255, 255, 255, 0.96)',
    text: '#1f2933',
    muted: '#5f6b7a',
    grid: 'rgba(31, 41, 51, 0.1)',
    line: '#2563eb',
    fill: 'rgba(37, 99, 235, 0.16)',
    accent: '#111827',
    selection: 'rgba(245, 158, 11, 0.22)',
  },
  dark: {
    surface: 'rgba(17, 24, 39, 0.94)',
    text: '#e5e9f0',
    muted: '#9aa5b5',
    grid: 'rgba(229, 233, 240, 0.1)',
    line: '#60a5fa',
    fill: 'rgba(96, 165, 250, 0.2)',
    accent: '#f9fafb',
    selection: 'rgba(251, 191, 36, 0.24)',
  },
};

/** Grade classes by absolute grade in percent, from flat to extreme. */
const gradeClasses = [
  {below: 3, color: '#2f9e44', label: '< 3%'},
  {below: 6, color: '#94b81d', label: '3–6%'},
  {below: 10, color: '#f2a900', label: '6–10%'},
  {below: 15, color: '#e8590c', label: '10–15%'},
  {below: 20, color: '#c92a2a', label: '15–20%'},
  {below: Number.POSITIVE_INFINITY, color: '#862e9c', label: '> 20%'},
] as const;

const svgNamespace = 'http://www.w3.org/2000/svg';
const padding = {top: 10, right: 12, bottom: 22, left: 46};
const mapHoverPixels = 16;

function gradeClass(grade: number | null) {
  const value = Math.abs(grade ?? 0);
  return gradeClasses.findIndex((entry) => value < entry.below);
}

function niceStep(range: number, count: number) {
  const raw = range / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return (
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power
  );
}

function ticks(min: number, max: number, count: number) {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, count);
  const values: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step)
    values.push(Math.round(value / step) * step);
  return values;
}

function isProfile(value: unknown): value is ElevationProfile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as ElevationProfile).samples) &&
    Array.isArray((value as ElevationProfile).lines) &&
    'climbThreshold' in value
  );
}

/** Every line of a GeoJSON value, joined into one, or null if it has none. */
function linesOf(data: unknown): ElevatedLine | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = data as {type?: unknown; geometry?: unknown; features?: unknown};
  if (value.type === 'LineString' || value.type === 'MultiLineString') return value as ElevatedLine;
  if (value.type === 'Feature') return linesOf(value.geometry);
  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    const parts: (readonly (readonly number[])[])[] = [];
    for (const feature of value.features) {
      const line = linesOf((feature as {geometry?: unknown})?.geometry);
      if (line?.type === 'LineString') parts.push(line.coordinates);
      else if (line?.type === 'MultiLineString') parts.push(...line.coordinates);
    }
    return parts.length ? {type: 'MultiLineString', coordinates: parts} : null;
  }
  return null;
}

function hasHeights(line: ElevatedLine) {
  const parts = line.type === 'LineString' ? [line.coordinates] : line.coordinates;
  return parts.every((part) => part.every((position) => Number.isFinite(position[2])));
}

export function createTileflowElevationProfile(
  options: TileflowElevationProfileOptions = {},
): TileflowElevationProfile {
  const prefix = options.idPrefix ?? 'tileflow-elevation-profile';
  const ids = {
    source: prefix,
    line: `${prefix}-line`,
    selection: `${prefix}-selection`,
    hover: `${prefix}-hover`,
  };
  const chartHeight = options.height ?? 160;
  const colorByGrade = options.colorByGrade ?? true;
  const showLine = options.showLine ?? true;
  const lineColor = options.lineColor ?? '#2563eb';
  let unit = options.unit ?? 'metric';
  let map: TileflowElevationProfileMap | null = null;
  let root: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  let documentRef: Document | null = null;
  let profile: ElevationProfile | null = null;
  let hover: ElevationProfilePoint | null = null;
  let selection: {from: number; to: number} | null = null;
  let drag: {start: number; moved: boolean} | null = null;
  let scheme: 'light' | 'dark' = 'light';
  let width = 0;
  let pending: AbortController | null = null;
  let message: string | null = 'No profile yet.';
  let mediaQuery: MediaQueryList | null = null;
  let resizeObserver: ResizeObserver | null = null;
  const elements: {
    header?: HTMLElement;
    status?: HTMLElement;
    svg?: SVGSVGElement;
    plot?: SVGGElement;
    overlay?: SVGGElement;
    tooltip?: HTMLElement;
    footer?: HTMLElement;
  } = {};

  const palette = () => palettes[scheme];
  const color = (name: keyof Palette) =>
    `var(--tileflow-elevation-${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}, ${palette()[name]})`;
  const numberFormat = (digits: number) =>
    new Intl.NumberFormat(options.locale ?? 'en', {maximumFractionDigits: digits});
  const formatElevation = (meters: number | null) => {
    if (meters === null) return '–';
    return unit === 'imperial'
      ? `${numberFormat(0).format(meters / metersPerFoot)} ft`
      : `${numberFormat(0).format(meters)} m`;
  };
  const formatDistance = (meters: number) => {
    if (unit === 'imperial') {
      const miles = meters / 1609.344;
      return miles < 0.1
        ? `${numberFormat(0).format(meters / metersPerFoot)} ft`
        : `${numberFormat(miles < 100 ? 1 : 0).format(miles)} mi`;
    }
    return meters < 1000
      ? `${numberFormat(0).format(meters)} m`
      : `${numberFormat(meters < 100_000 ? 1 : 0).format(meters / 1000)} km`;
  };
  const formatGrade = (grade: number | null) =>
    grade === null ? '–' : `${grade < -0.05 ? '−' : ''}${numberFormat(1).format(Math.abs(grade))}%`;

  const element = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    style: Partial<CSSStyleDeclaration> = {},
    attributes: Record<string, string> = {},
  ) => {
    const node = documentRef!.createElement(tag);
    Object.assign(node.style, style);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const svgElement = <K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string | number> = {},
  ) => {
    const node = documentRef!.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) {
      // Presentation attributes do not resolve custom properties; styles do.
      if (typeof value === 'string' && value.startsWith('var('))
        node.style.setProperty(name, value);
      else node.setAttribute(name, String(value));
    }
    return node;
  };

  // --- map ------------------------------------------------------------------------------------

  const featureCollection = () => {
    const features: unknown[] = [];
    if (profile) {
      features.push({
        type: 'Feature',
        properties: {kind: 'line'},
        geometry: {
          type: 'MultiLineString',
          coordinates: profile.lines.map(([first, last]) =>
            profile!.samples.slice(first, last + 1).map(([lng, lat]) => [lng, lat]),
          ),
        },
      });
      const stretch = selection
        ? sliceElevationProfile(profile, selection.from, selection.to)
        : null;
      if (stretch)
        features.push({
          type: 'Feature',
          properties: {kind: 'selection'},
          geometry: {
            type: 'MultiLineString',
            coordinates: stretch.lines.map(([first, last]) =>
              stretch.samples.slice(first, last + 1).map(([lng, lat]) => [lng, lat]),
            ),
          },
        });
    }
    if (hover)
      features.push({
        type: 'Feature',
        properties: {kind: 'hover'},
        geometry: {type: 'Point', coordinates: [...hover.position]},
      });
    return {type: 'FeatureCollection', features};
  };

  const updateMap = () => {
    try {
      const source = map?.getSource(ids.source) as {setData?: (data: unknown) => void} | undefined;
      source?.setData?.(featureCollection());
    } catch {
      // The style is still loading; `style.load` draws the current state.
    }
  };

  const installLayers = () => {
    if (!map) return;
    try {
      addLayers(map);
    } catch {
      // The style is still loading; `style.load` adds the layers.
    }
  };

  const addLayers = (map: TileflowElevationProfileMap) => {
    const addLayer = (layer: Record<string, unknown>) => map.addLayer(layer as never);
    if (!map.getSource(ids.source))
      map.addSource(ids.source, {type: 'geojson', data: featureCollection()} as never);
    if (showLine && !map.getLayer(ids.line))
      addLayer({
        id: ids.line,
        type: 'line',
        source: ids.source,
        filter: ['==', ['get', 'kind'], 'line'],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': lineColor, 'line-width': 4, 'line-opacity': 0.9},
      });
    if (!map.getLayer(ids.selection))
      addLayer({
        id: ids.selection,
        type: 'line',
        source: ids.source,
        filter: ['==', ['get', 'kind'], 'selection'],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': '#f59e0b', 'line-width': 7, 'line-opacity': 0.95},
      });
    if (!map.getLayer(ids.hover))
      addLayer({
        id: ids.hover,
        type: 'circle',
        source: ids.source,
        filter: ['==', ['get', 'kind'], 'hover'],
        paint: {
          'circle-radius': 6,
          'circle-color': lineColor,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
  };

  const removeLayers = () => {
    if (!map) return;
    try {
      for (const id of [ids.hover, ids.selection, ids.line])
        if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(ids.source)) map.removeSource(ids.source);
    } catch {
      // A map being removed may no longer have a style.
    }
  };

  const onStyleLoad = () => {
    installLayers();
    updateMap();
  };

  const onMapMove = (event: {
    point: {x: number; y: number};
    lngLat: {lng: number; lat: number};
  }) => {
    if (!profile || !map || drag) return;
    const index = nearestElevationSample(profile, [event.lngLat.lng, event.lngLat.lat]);
    const sample = profile.samples[index];
    if (!sample) return;
    const projected = map.project([sample[0], sample[1]]);
    const close =
      Math.hypot(projected.x - event.point.x, projected.y - event.point.y) <= mapHoverPixels;
    setHover(close ? elevationProfileAt(profile, sample[3]) : null);
  };

  const onMapOut = () => setHover(null);

  // --- chart ----------------------------------------------------------------------------------

  const plotWidth = () => Math.max(40, width - padding.left - padding.right);
  const plotHeight = () => Math.max(40, chartHeight - padding.top - padding.bottom);

  type Scale = {
    x: (meters: number) => number;
    y: (meters: number) => number;
    distance: number;
    min: number;
    max: number;
  };
  let scale: Scale | null = null;

  const computeScale = (): Scale | null => {
    if (!profile || profile.samples.length === 0) return null;
    const distance = profile.samples.at(-1)![3];
    let min = profile.summary.minElevation;
    let max = profile.summary.maxElevation;
    if (min === null || max === null) return null;
    const margin = Math.max((max - min) * 0.08, 5);
    min -= margin;
    max += margin;
    const w = plotWidth();
    const h = plotHeight();
    return {
      distance,
      min,
      max,
      x: (meters) => padding.left + (distance > 0 ? (meters / distance) * w : 0),
      y: (meters) => padding.top + h - ((meters - min) / (max - min)) * h,
    };
  };

  /** Sample indexes to draw: every sample, or each pixel column's extremes on long profiles. */
  const drawnRuns = () => {
    const runs: number[][] = [];
    if (!profile || !scale) return runs;
    const columns = plotWidth();
    for (const [first, last] of profile.lines) {
      let run: number[] = [];
      const flush = () => {
        if (run.length > 1) runs.push(run);
        run = [];
      };
      if (last - first + 1 <= columns * 2) {
        for (let index = first; index <= last; index += 1) {
          if (profile.samples[index]![2] === null) flush();
          else run.push(index);
        }
        flush();
        continue;
      }
      let column = -1;
      let low = -1;
      let high = -1;
      const emit = () => {
        if (low < 0) return;
        for (const index of low < high ? [low, high] : [high, low])
          if (run.at(-1) !== index) run.push(index);
      };
      for (let index = first; index <= last; index += 1) {
        const sample = profile.samples[index]!;
        if (sample[2] === null) {
          emit();
          flush();
          column = -1;
          low = high = -1;
          continue;
        }
        const at = Math.floor(scale.x(sample[3]));
        if (at !== column) {
          emit();
          column = at;
          low = high = index;
        } else {
          if (sample[2] < profile.samples[low]![2]!) low = index;
          if (sample[2] > profile.samples[high]![2]!) high = index;
        }
      }
      emit();
      flush();
    }
    return runs;
  };

  const renderChart = () => {
    const svg = elements.svg;
    if (!svg || !documentRef) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${width} ${chartHeight}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(chartHeight));
    scale = computeScale();
    if (!profile || !scale) {
      elements.plot = undefined;
      elements.overlay = undefined;
      return;
    }
    const {x, y} = scale;
    const metric = unit === 'metric';
    const grid = svgElement('g', {'aria-hidden': 'true'});
    const labelStyle = (anchor: string) => ({
      fill: color('muted'),
      'font-size': 11,
      'text-anchor': anchor,
      'font-family': 'inherit',
    });
    const displayFactor = metric ? 1 : 1 / metersPerFoot;
    for (const value of ticks(scale.min * displayFactor, scale.max * displayFactor, 4)) {
      const meters = value / displayFactor;
      const at = y(meters);
      if (at < padding.top - 1 || at > padding.top + plotHeight() + 1) continue;
      grid.append(
        svgElement('line', {
          x1: padding.left,
          x2: padding.left + plotWidth(),
          y1: at,
          y2: at,
          stroke: color('grid'),
        }),
      );
      const label = svgElement('text', {x: padding.left - 6, y: at + 4, ...labelStyle('end')});
      label.textContent = numberFormat(0).format(value);
      grid.append(label);
    }
    const distanceUnit = metric
      ? scale.distance < 1000
        ? 1
        : 1000
      : scale.distance < 160.9344
        ? metersPerFoot
        : 1609.344;
    const ticksX = ticks(
      0,
      scale.distance / distanceUnit,
      Math.max(2, Math.floor(plotWidth() / 80)),
    );
    for (const value of ticksX) {
      const at = x(value * distanceUnit);
      const label = svgElement('text', {x: at, y: chartHeight - 6, ...labelStyle('middle')});
      label.textContent = numberFormat(2).format(value);
      grid.append(label);
    }
    const unitLabel = svgElement('text', {
      x: padding.left - 6,
      y: chartHeight - 6,
      ...labelStyle('end'),
    });
    unitLabel.textContent = `${metric ? 'm' : 'ft'} / ${
      distanceUnit === 1
        ? 'm'
        : distanceUnit === 1000
          ? 'km'
          : distanceUnit === metersPerFoot
            ? 'ft'
            : 'mi'
    }`;
    grid.append(unitLabel);
    svg.append(grid);

    const runs = drawnRuns();
    const bottom = padding.top + plotHeight();
    const point = (index: number) => {
      const sample = profile!.samples[index]!;
      return `${x(sample[3]).toFixed(1)},${y(sample[2]!).toFixed(1)}`;
    };
    const area = (indexes: readonly number[]) =>
      `M${x(profile!.samples[indexes[0]!]![3]).toFixed(1)},${bottom}L${indexes.map(point).join('L')}L${x(
        profile!.samples[indexes.at(-1)!]![3],
      ).toFixed(1)},${bottom}Z`;
    if (colorByGrade) {
      // Bands of the mean grade over stretches of at least 200 m (or an 80th of the profile), so
      // that the trees and buildings of surface models do not make the colour flicker.
      const stretch = Math.max(200, scale.distance / 80, 3 * (profile.interval ?? 0));
      const bands = new Map<number, string>();
      for (const indexes of runs) {
        let from = 0;
        for (let to = 1; to < indexes.length; to += 1) {
          const first = profile.samples[indexes[from]!]!;
          const last = profile.samples[indexes[to]!]!;
          if (last[3] - first[3] < stretch && to < indexes.length - 1) continue;
          const run = last[3] - first[3];
          const grade = gradeClass(run > 0 ? ((last[2]! - first[2]!) / run) * 100 : 0);
          bands.set(grade, (bands.get(grade) ?? '') + area(indexes.slice(from, to + 1)));
          from = to;
        }
      }
      for (const [grade, d] of bands)
        svg.append(
          svgElement('path', {
            d,
            fill: gradeClasses[grade]!.color,
            'fill-opacity': scheme === 'dark' ? 0.55 : 0.45,
            stroke: 'none',
          }),
        );
    } else {
      svg.append(
        svgElement('path', {d: runs.map(area).join(''), fill: color('fill'), stroke: 'none'}),
      );
    }
    svg.append(
      svgElement('path', {
        d: runs.map((indexes) => `M${indexes.map(point).join('L')}`).join(''),
        fill: 'none',
        stroke: colorByGrade ? color('accent') : color('line'),
        'stroke-opacity': colorByGrade ? 0.8 : 1,
        'stroke-width': 1.75,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    );

    elements.overlay = svgElement('g', {'pointer-events': 'none'});
    svg.append(elements.overlay);
    renderOverlay();
  };

  const renderOverlay = () => {
    const overlay = elements.overlay;
    if (!overlay || !scale || !profile) return;
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
    const top = padding.top;
    const bottom = padding.top + plotHeight();
    if (selection) {
      const from = scale.x(Math.min(selection.from, selection.to));
      const to = scale.x(Math.max(selection.from, selection.to));
      overlay.append(
        svgElement('rect', {
          x: from,
          y: top,
          width: Math.max(1, to - from),
          height: bottom - top,
          fill: color('selection'),
        }),
      );
    }
    if (hover) {
      const at = scale.x(hover.distance);
      overlay.append(
        svgElement('line', {
          x1: at,
          x2: at,
          y1: top,
          y2: bottom,
          stroke: color('accent'),
          'stroke-opacity': 0.5,
        }),
      );
      if (hover.elevation !== null)
        overlay.append(
          svgElement('circle', {
            cx: at,
            cy: scale.y(hover.elevation),
            r: 4,
            fill: color('accent'),
            stroke: color('surface'),
            'stroke-width': 2,
          }),
        );
    }
    renderTooltip();
  };

  const renderTooltip = () => {
    const tooltip = elements.tooltip;
    if (!tooltip || !scale) return;
    if (!hover) {
      tooltip.style.display = 'none';
      return;
    }
    tooltip.textContent = '';
    for (const [label, value] of [
      ['Distance', formatDistance(hover.distance)],
      ['Elevation', formatElevation(hover.elevation)],
      ['Grade', formatGrade(hover.grade)],
      ['Ascent so far', formatElevation(hover.ascent)],
    ] as const) {
      const row = element('div', {display: 'flex', justifyContent: 'space-between', gap: '12px'});
      const name = element('span', {color: color('muted')});
      name.textContent = label;
      const content = element('span', {fontVariantNumeric: 'tabular-nums', fontWeight: '600'});
      content.textContent = value;
      row.append(name, content);
      tooltip.append(row);
    }
    tooltip.style.display = 'block';
    const at = scale.x(hover.distance);
    const left = at > width / 2 ? at - 12 - 150 : at + 12;
    tooltip.style.left = `${Math.max(4, left)}px`;
    elements.svg?.setAttribute('aria-valuenow', String(Math.round(hover.distance)));
    elements.svg?.setAttribute(
      'aria-valuetext',
      `${formatDistance(hover.distance)}, ${formatElevation(hover.elevation)}, grade ${formatGrade(hover.grade)}`,
    );
  };

  const renderHeader = () => {
    const header = elements.header;
    const status = elements.status;
    if (!header || !status) return;
    header.textContent = '';
    status.textContent = '';
    // A message is shown; a summary is only announced, since the chips show it.
    Object.assign(
      status.style,
      !profile || message
        ? {position: '', width: '', height: '', overflow: '', clip: '', whiteSpace: ''}
        : {
            position: 'absolute',
            width: '1px',
            height: '1px',
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
            whiteSpace: 'nowrap',
          },
    );
    if (!profile || message) {
      status.textContent = message ?? '';
      header.append(status);
      return;
    }
    const stretch = selection ? sliceElevationProfile(profile, selection.from, selection.to) : null;
    const shown = stretch ?? profile;
    const {summary} = shown;
    const chip = (label: string, value: string) => {
      const node = element('span', {whiteSpace: 'nowrap'});
      const name = element('span', {color: color('muted'), marginRight: '4px'});
      name.textContent = label;
      const content = element('span', {fontWeight: '600', fontVariantNumeric: 'tabular-nums'});
      content.textContent = value;
      node.append(name, content);
      return node;
    };
    if (stretch) {
      const title = element('span', {fontWeight: '600'});
      title.textContent = 'Selection';
      header.append(title);
    }
    header.append(
      chip('Distance', formatDistance(summary.distance)),
      chip('Ascent', formatElevation(summary.ascent)),
      chip('Descent', formatElevation(summary.descent)),
      chip(
        stretch ? 'Steepest' : 'Highest',
        stretch ? formatGrade(summary.maxGrade) : formatElevation(summary.maxElevation),
      ),
    );
    if (stretch) {
      const clear = element(
        'button',
        {
          marginLeft: 'auto',
          border: '0',
          background: 'transparent',
          color: color('text'),
          cursor: 'pointer',
          font: 'inherit',
          textDecoration: 'underline',
          padding: '0',
        },
        {type: 'button'},
      );
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => api.clearSelection());
      header.append(clear);
    }
    status.textContent = stretch
      ? `Selection of ${formatDistance(summary.distance)}, ascent ${formatElevation(summary.ascent)}.`
      : `Profile of ${formatDistance(summary.distance)}, ascent ${formatElevation(summary.ascent)}, descent ${formatElevation(summary.descent)}.`;
    header.append(status);
  };

  const renderFooter = () => {
    const footer = elements.footer;
    if (!footer) return;
    footer.textContent = '';
    if (colorByGrade && profile && !message) {
      const legend = element(
        'span',
        {display: 'flex', gap: '8px', flexWrap: 'wrap'},
        {'aria-hidden': 'true'},
      );
      for (const entry of gradeClasses) {
        const item = element('span', {display: 'inline-flex', alignItems: 'center', gap: '3px'});
        const swatch = element('span', {
          width: '10px',
          height: '3px',
          borderRadius: '2px',
          background: entry.color,
          display: 'inline-block',
        });
        const text = element('span');
        text.textContent = entry.label;
        item.append(swatch, text);
        legend.append(item);
      }
      footer.append(legend);
    }
    if (profile?.attribution) {
      const credit = element('span', {marginLeft: 'auto'});
      credit.textContent = profile.attribution;
      footer.append(credit);
    }
  };

  const render = () => {
    if (!root) return;
    root.style.background = color('surface');
    root.style.color = color('text');
    if (elements.tooltip) elements.tooltip.style.background = color('surface');
    if (elements.footer) elements.footer.style.color = color('muted');
    width = Math.max(
      120,
      Math.round(elements.svg?.parentElement?.getBoundingClientRect?.().width || 0) ||
        (options.container ? 480 : 360),
    );
    renderHeader();
    renderChart();
    renderFooter();
    if (elements.svg) {
      elements.svg.setAttribute(
        'aria-valuemax',
        String(Math.round(profile?.samples.at(-1)?.[3] ?? 0)),
      );
      elements.svg.style.cursor = profile ? 'crosshair' : 'default';
    }
  };

  const setHover = (point: ElevationProfilePoint | null) => {
    if (point === hover || (point && hover && point.distance === hover.distance)) return;
    hover = point;
    renderOverlay();
    updateMap();
    options.onHover?.(point);
  };

  const distanceAt = (clientX: number) => {
    const rect = elements.svg!.getBoundingClientRect();
    const local = ((clientX - rect.left) / Math.max(1, rect.width)) * width;
    const fraction = (local - padding.left) / plotWidth();
    return Math.min(1, Math.max(0, fraction)) * (scale?.distance ?? 0);
  };

  const notifySelection = () => {
    if (!options.onSelect) return;
    const stretch =
      profile && selection ? sliceElevationProfile(profile, selection.from, selection.to) : null;
    options.onSelect(
      stretch && selection
        ? {
            from: Math.min(selection.from, selection.to),
            to: Math.max(selection.from, selection.to),
            profile: stretch,
          }
        : null,
    );
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!profile || !scale) return;
    const distance = distanceAt(event.clientX);
    if (drag) {
      if (Math.abs(distance - drag.start) > scale.distance * 0.005) drag.moved = true;
      if (drag.moved) {
        selection = {from: drag.start, to: distance};
        renderHeader();
        updateMap();
      }
    }
    setHover(elevationProfileAt(profile, distance));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!profile || !scale || event.button !== 0) return;
    drag = {start: distanceAt(event.clientX), moved: false};
    elements.svg?.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || !profile) return;
    const finished = drag;
    drag = null;
    elements.svg?.releasePointerCapture?.(event.pointerId);
    if (finished.moved && selection) {
      renderHeader();
      renderOverlay();
      updateMap();
      notifySelection();
      return;
    }
    const point = elevationProfileAt(profile, distanceAt(event.clientX));
    if (point) options.onClick?.(point);
  };

  const onPointerLeave = () => {
    if (!drag && documentRef?.activeElement !== elements.svg) setHover(null);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!profile || !scale) return;
    const step = scale.distance * (event.shiftKey ? 0.1 : 0.01);
    const current = hover?.distance ?? 0;
    const go = (distance: number) => {
      event.preventDefault();
      setHover(elevationProfileAt(profile!, distance));
    };
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') go(current + step);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') go(current - step);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(scale.distance);
    else if (event.key === 'Escape' && selection) {
      event.preventDefault();
      api.clearSelection();
    } else if ((event.key === 'Enter' || event.key === ' ') && hover) {
      event.preventDefault();
      options.onClick?.(hover);
    }
  };

  const onFocus = () => {
    if (profile && !hover) setHover(elevationProfileAt(profile, 0));
  };

  const onBlur = () => setHover(null);

  const applyScheme = () => {
    const preferred = options.colorScheme ?? 'auto';
    scheme = preferred === 'auto' ? (mediaQuery?.matches ? 'dark' : 'light') : preferred;
    render();
  };

  const build = (ownerDocument: Document) => {
    documentRef = ownerDocument;
    const inside = !options.container;
    root = element(
      'div',
      {
        boxSizing: 'border-box',
        width: inside ? (options.width ?? '360px') : '100%',
        maxWidth: inside ? 'calc(100vw - 20px)' : '100%',
        padding: '8px 10px 6px',
        borderRadius: inside ? '8px' : '0',
        boxShadow: inside ? '0 1px 4px rgba(0, 0, 0, 0.25)' : 'none',
        font: 'var(--tileflow-elevation-font, 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif)',
        position: 'relative',
        pointerEvents: 'auto',
      },
      {
        class: `tileflow-elevation-profile${inside ? ' maplibregl-ctrl' : ''}`,
        role: 'group',
        'aria-label': 'Elevation profile',
        'data-tileflow-elevation-profile': '',
      },
    );
    elements.header = element('div', {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '4px 12px',
      minHeight: '18px',
      marginBottom: '4px',
    });
    elements.status = element(
      'span',
      {},
      {'aria-live': 'polite', class: 'tileflow-elevation-profile-status'},
    );
    const chart = element('div', {position: 'relative', width: '100%'});
    const svg = documentRef.createElementNS(svgNamespace, 'svg') as SVGSVGElement;
    for (const [name, value] of Object.entries({
      role: 'slider',
      tabindex: '0',
      'aria-label': 'Position along the elevation profile',
      'aria-valuemin': '0',
      'aria-valuemax': '0',
      'aria-valuenow': '0',
      focusable: 'true',
      class: 'tileflow-elevation-profile-chart',
    }))
      svg.setAttribute(name, value);
    Object.assign(svg.style, {
      display: 'block',
      width: '100%',
      height: `${chartHeight}px`,
      touchAction: 'none',
      outlineOffset: '2px',
    });
    elements.svg = svg;
    elements.tooltip = element(
      'div',
      {
        position: 'absolute',
        top: `${padding.top}px`,
        width: '150px',
        padding: '6px 8px',
        borderRadius: '6px',
        background: color('surface'),
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'none',
        display: 'none',
      },
      {class: 'tileflow-elevation-profile-tooltip'},
    );
    chart.append(svg, elements.tooltip);
    elements.footer = element('div', {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '2px',
      fontSize: '10px',
      color: color('muted'),
    });
    root.append(elements.header, chart, elements.footer);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerdown', onPointerDown);
    // A pointer does not focus the chart, so its focus ring appears only for the keyboard.
    svg.addEventListener('mousedown', (event) => event.preventDefault());
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointerleave', onPointerLeave);
    svg.addEventListener('keydown', onKeyDown);
    svg.addEventListener('focus', onFocus);
    svg.addEventListener('blur', onBlur);
    svg.addEventListener('dblclick', () => api.clearSelection());
    const view = ownerDocument.defaultView;
    mediaQuery = view?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    mediaQuery?.addEventListener?.('change', applyScheme);
    if (view?.ResizeObserver) {
      resizeObserver = new view.ResizeObserver(() => {
        const next = Math.round(chart.getBoundingClientRect().width);
        if (next > 0 && next !== width) render();
      });
      resizeObserver.observe(chart);
    }
    return root;
  };

  const fail = (error: unknown) => {
    profile = null;
    hover = null;
    selection = null;
    message =
      error instanceof Error && error.message
        ? error.message
        : 'The elevation profile could not be loaded.';
    render();
    updateMap();
    options.onError?.(error);
  };

  const show = (next: ElevationProfile) => {
    profile = next.unit === 'meters' ? next : convertElevationProfile(next, 'meters');
    hover = null;
    selection = null;
    message = profile.samples.length > 1 ? null : 'The line is too short for a profile.';
    render();
    updateMap();
    if (options.fitBounds && map?.fitBounds && profile.samples.length > 1) {
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const [lng, lat] of profile.samples) {
        west = Math.min(west, lng);
        east = Math.max(east, lng);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {padding: 48},
      );
    }
    options.onData?.(profile);
    return profile;
  };

  const api: TileflowElevationProfile = Object.freeze({
    onAdd(nextMap: TileflowElevationProfileMap) {
      map = nextMap;
      const ownerDocument = (options.container ?? nextMap.getContainer()).ownerDocument;
      const node = build(ownerDocument);
      if (options.container) {
        options.container.append(node);
        placeholder = ownerDocument.createElement('div');
        placeholder.style.display = 'none';
      }
      installLayers();
      nextMap.on('style.load', onStyleLoad as (event: unknown) => void);
      nextMap.on('mousemove', onMapMove as (event: unknown) => void);
      nextMap.on('mouseout', onMapOut as (event: unknown) => void);
      applyScheme();
      return placeholder ?? node;
    },
    onRemove() {
      pending?.abort();
      if (map) {
        map.off('style.load', onStyleLoad as (event: unknown) => void);
        map.off('mousemove', onMapMove as (event: unknown) => void);
        map.off('mouseout', onMapOut as (event: unknown) => void);
        removeLayers();
      }
      mediaQuery?.removeEventListener?.('change', applyScheme);
      resizeObserver?.disconnect();
      root?.remove();
      placeholder?.remove();
      map = null;
      root = null;
      placeholder = null;
    },
    getDefaultPosition: () => 'bottom-left' as const,
    getElement: () => root,
    async setData(data, setOptions = {}) {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      const outer = setOptions.signal;
      if (outer?.aborted) controller.abort(outer.reason);
      else outer?.addEventListener('abort', () => controller.abort(outer.reason), {once: true});
      const signal = controller.signal;
      try {
        if (isProfile(data)) return show(data);
        const parsedResponse =
          typeof data === 'object' && data !== null && 'schemaVersion' in data
            ? elevationProfileResponseSchema.safeParse(data)
            : null;
        if (parsedResponse?.success)
          return show(
            elevationProfileFromResponse(parsedResponse.data, {
              climbThreshold: options.climbThreshold ?? 2,
            }),
          );
        const line = typeof data === 'string' ? readGpx(data).line : linesOf(data);
        if (!line) throw new Error('The data has no line to profile.');
        if (hasHeights(line))
          return show(
            elevationProfileFromLine(line, {climbThreshold: options.climbThreshold ?? 2}),
          );
        if (!options.apiKey)
          throw new Error('This line has no heights; an API key is needed to read them.');
        message = 'Loading elevation…';
        render();
        const coordinates = (
          line.type === 'LineString' ? [line.coordinates] : line.coordinates
        ).map((part) => part.map((position) => [position[0]!, position[1]!] as [number, number]));
        const response = await requestElevationProfile(
          {
            line:
              coordinates.length === 1
                ? {type: 'LineString', coordinates: coordinates[0]!}
                : {type: 'MultiLineString', coordinates},
            ...(options.interval ? {interval: options.interval} : {}),
            maxSamples: Math.max(options.maxSamples ?? 500, 2 * coordinates.length),
            ...(options.climbThreshold !== undefined
              ? {climbThreshold: options.climbThreshold}
              : {}),
          },
          {
            apiKey: options.apiKey,
            ...(options.apiUrl ? {apiUrl: options.apiUrl} : {}),
            ...(options.app ? {app: options.app} : {}),
            ...(options.fetch ? {fetch: options.fetch} : {}),
            signal,
          },
        );
        if (pending !== controller) throw signal.reason ?? new Error('Superseded');
        return show(
          elevationProfileFromResponse(response, {climbThreshold: options.climbThreshold ?? 2}),
        );
      } catch (error) {
        if (pending === controller && !signal.aborted) fail(error);
        throw error;
      } finally {
        if (pending === controller) pending = null;
      }
    },
    getProfile: () => profile,
    clear() {
      pending?.abort();
      profile = null;
      hover = null;
      selection = null;
      message = 'No profile yet.';
      render();
      updateMap();
    },
    setUnit(next) {
      unit = next;
      render();
    },
    select(from, to) {
      if (!profile) return;
      const end = profile.samples.at(-1)![3];
      const low = Math.max(0, Math.min(from, to));
      const high = Math.min(end, Math.max(from, to));
      selection = high > low ? {from: low, to: high} : null;
      renderHeader();
      renderOverlay();
      updateMap();
      notifySelection();
    },
    clearSelection() {
      if (!selection) return;
      selection = null;
      renderHeader();
      renderOverlay();
      updateMap();
      notifySelection();
    },
  });
  return api;
}
