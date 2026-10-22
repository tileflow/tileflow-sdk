import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import {sanitizeDiagnosticSecrets} from '../../diagnostic-sanitization';
import {moveCamera} from '../beacon/runner';
import {safeContext} from '../layers/model';
import {themeLabel, themeVariantLabel} from '../theme-labels';
import type {Side} from '../types';
import {collectDiagnostics, contrastFindings, sampleDiagnosticLabels} from './checks';
import {
  type DiagnosticCamera,
  type DiagnosticCategory,
  type DiagnosticFinding,
  diagnosticFingerprint,
} from './model';
import {performanceFindings, samplePerformance} from './performance';
import {diagnosticsStyles} from './styles';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
};
const button = (text: string, action: () => void, cls = '') => {
  const node = el('button', cls, text);
  node.type = 'button';
  node.onclick = action;
  return node;
};
const categories: Record<DiagnosticCategory, string> = {
  readability: 'Readability',
  style: 'Style',
  assets: 'Assets',
  performance: 'Performance',
};
type Options = {
  active: () => Side;
  beforeRun: () => void;
  reveal: (side: Side, finding: DiagnosticFinding, action?: 'rule' | 'map') => void;
  overlay: (kind: 'overdraw') => void;
  assets: (category: 'Sprites' | 'Glyphs' | 'Fonts' | 'Models', filter?: string) => void;
  temporary?: (side: Side) => unknown;
  loadProvenance?: (side: Side) => Promise<void>;
};
type Snapshot = {
  side: Side;
  map: MapLibreMap;
  epoch: number;
  generation: number;
  dataRevision: number;
  styleKey: string;
  viewKey: string;
  at: string;
  name: string;
  theme?: string;
  themeLabel?: string;
  camera: DiagnosticCamera;
  viewport: {width: number; height: number; dpr: number};
};
type Entry = {
  finding: DiagnosticFinding;
  snapshot: Snapshot;
  declarations: {value: unknown; omitted: string[]};
  pendingReason?: string;
};
const imageGraceMs = 1800;
const assetCoverage =
  'Missing-image checks cover observed renderer requests with known required references, after loading settles. Complex icon expressions and optional fallbacks are not inferred.';

/** A live list of design findings. Measurements never move or resize the map. */
export class DiagnosticsPanel {
  private active = false;
  private disposed = false;
  private side?: Side;
  private map?: MapLibreMap;
  private epoch = -1;
  private generation = -1;
  private dataRevision = 0;
  private provenanceAttempt = '';
  private revealCleanup?: () => void;
  private styleKey = '';
  private dirty = true;
  private running?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private staticEntries: Entry[] = [];
  private resourceEntries: Entry[] = [];
  private viewEntries: Entry[] = [];
  private styleSnapshot?: Snapshot;
  private viewSnapshot?: Snapshot;
  private viewComplete = false;
  private viewLimitations: string[] = [];
  private styleLimitations: string[] = [];
  private filter: 'all' | DiagnosticCategory = 'all';
  private dismissed = new Map<string, string>();
  private expanded = new Set<string>();
  private missingImages = new Map<string, number>();
  private renderKey = '';
  private toolbar = el('div', 'inspector-tools inspector-diagnostics-toolbar');
  private filters = el('div', 'inspector-diagnostics-filters');
  private summary = el('div', 'inspector-diagnostics-summary');
  private list = el('div', 'inspector-scroll inspector-diagnostics-list');
  private status = el('div', 'inspector-footer inspector-diagnostics-status');
  private check = button('Check view', () => void this.checkView(), 'inspector-diagnostics-check');
  private copy = button('Copy findings', () => void this.copyReport());
  private cancelButton = button('Cancel', () => this.cancel());
  private filterButtons = new Map<'all' | DiagnosticCategory, HTMLButtonElement>();
  private invalidate = () => {
    this.dirty = true;
    this.schedule();
  };
  private sourceChanged = (event: {sourceId?: string}) => {
    if (event.sourceId?.startsWith('__tileflow-inspector-')) return;
    this.dataRevision++;
    this.invalidate();
  };
  private moving = () => {
    this.cancel();
    this.clearTimer();
    if (this.active) this.render();
  };
  private settled = () => {
    this.schedule();
    if (this.active) this.render();
  };
  private imageMissing = (event: {id: string}) => {
    if (!this.missingImages.has(event.id)) this.missingImages.set(event.id, performance.now());
    this.dirty = true;
    this.schedule();
  };
  private removed = () => {
    this.cancel();
    this.clearTimer();
  };

  constructor(
    private root: HTMLElement,
    private options: Options,
  ) {
    root.classList.add('inspector-diagnostics');
    const style = el('style');
    style.nonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce || '';
    style.textContent = diagnosticsStyles;
    const actions = el('div', 'inspector-diagnostics-actions');
    actions.append(this.check, this.cancelButton, this.copy);
    this.toolbar.append(el('strong', '', 'Diagnostics'), actions);
    this.cancelButton.hidden = true;
    this.filters.setAttribute('aria-label', 'Finding categories');
    for (const category of ['all', ...Object.keys(categories)] as const) {
      const id = category as 'all' | DiagnosticCategory;
      const action = button(id === 'all' ? 'All' : categories[id], () => {
        this.filter = id;
        this.render(true);
      });
      action.setAttribute('aria-pressed', String(id === this.filter));
      this.filterButtons.set(id, action);
      this.filters.append(action);
    }
    this.list.setAttribute('aria-label', 'Map design findings');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    root.append(style, this.toolbar, this.filters, this.summary, this.list, this.status);
    this.refresh();
  }

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active) this.refresh();
    else {
      this.cancel();
      this.clearTimer();
    }
  }

  refresh() {
    if (this.disposed) return;
    const side = this.options.active();
    if (side !== this.side || side.map !== this.map || side.loadEpoch !== this.epoch) {
      this.detach();
      this.side = side;
      this.map = side.map;
      this.epoch = side.loadEpoch;
      this.generation = side.artifactGeneration;
      this.dataRevision = 0;
      this.provenanceAttempt = '';
      this.styleKey = '';
      this.dirty = true;
      this.missingImages.clear();
      if (this.map) {
        this.map.on('styledata', this.invalidate);
        this.map.on('sourcedata', this.sourceChanged);
        this.map.on('styleimagemissing', this.imageMissing);
        this.map.on('movestart', this.moving);
        this.map.on('moveend', this.settled);
        this.map.on('idle', this.settled);
        this.map.on('remove', this.removed);
      }
    }
    if (this.generation !== side.artifactGeneration) {
      this.generation = side.artifactGeneration;
      this.dirty = true;
      this.cancel();
    }
    if (this.active && this.dirty && !this.running) this.schedule();
    if (this.active) this.render();
  }

  cancel() {
    if (!this.running) return;
    this.running.abort();
    this.status.textContent = 'Check cancelled. Previous findings have been kept.';
  }

  dispose() {
    this.disposed = true;
    this.detach();
    this.root.classList.remove('inspector-diagnostics');
  }

  private detach() {
    this.cancel();
    this.clearTimer();
    this.revealCleanup?.();
    this.map?.off('styledata', this.invalidate);
    this.map?.off('sourcedata', this.sourceChanged);
    this.map?.off('styleimagemissing', this.imageMissing);
    this.map?.off('movestart', this.moving);
    this.map?.off('moveend', this.settled);
    this.map?.off('idle', this.settled);
    this.map?.off('remove', this.removed);
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delay = 450) {
    if (!this.active || this.disposed || !this.map || this.running || this.map.isMoving()) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.active || this.running || this.map?.isMoving() || this.disposed) return;
      this.checkStyle();
    }, delay);
  }

  private camera(map: MapLibreMap): DiagnosticCamera {
    const center = map.getCenter();
    return {
      center: [center.lng, center.lat],
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
  }

  private viewKey(map: MapLibreMap) {
    const camera = this.camera(map),
      container = map.getContainer();
    return JSON.stringify([
      ...camera.center.map((n) => n.toFixed(6)),
      camera.zoom.toFixed(4),
      camera.bearing.toFixed(3),
      camera.pitch.toFixed(3),
      container.clientWidth,
      container.clientHeight,
      map.getPixelRatio(),
    ]);
  }

  private snapshot(style = this.map?.getStyle()): Snapshot | undefined {
    const side = this.side,
      map = this.map;
    if (!side || !map) return;
    const container = map.getContainer();
    const metadata = style?.metadata as Record<string, unknown> | undefined;
    const theme =
      typeof metadata?.['tileflow:theme'] === 'string' ? metadata['tileflow:theme'] : undefined;
    const variant =
      typeof window === 'undefined'
        ? undefined
        : window.__tileflowScene?.variants().find((candidate) => candidate.theme === theme);
    return {
      side,
      map,
      epoch: side.loadEpoch,
      generation: side.artifactGeneration,
      dataRevision: this.dataRevision,
      styleKey: this.styleKey,
      viewKey: this.viewKey(map),
      at: new Date().toISOString(),
      name:
        typeof metadata?.['tileflow:map'] === 'string'
          ? metadata['tileflow:map']
          : side.definition.label,
      theme,
      themeLabel: variant
        ? themeVariantLabel(variant, metadata)
        : theme
          ? themeLabel(theme, metadata)
          : undefined,
      camera: this.camera(map),
      viewport: {
        width: container.clientWidth,
        height: container.clientHeight,
        dpr: map.getPixelRatio(),
      },
    };
  }

  private sameMap(snapshot?: Snapshot) {
    return (
      !!snapshot &&
      snapshot.side === this.side &&
      snapshot.map === this.map &&
      snapshot.epoch === this.epoch &&
      snapshot.generation === this.generation
    );
  }

  private current(snapshot?: Snapshot, view = false) {
    return (
      this.sameMap(snapshot) &&
      snapshot?.styleKey === this.styleKey &&
      !this.dirty &&
      (!view ||
        (!!this.map &&
          snapshot?.viewKey === this.viewKey(this.map) &&
          snapshot.dataRevision === this.dataRevision))
    );
  }

  private collectInput(style: StyleSpecification) {
    const map = this.map!;
    const availableImages = map.listImages();
    const images = new Set(availableImages);
    for (const id of images) this.missingImages.delete(id);
    const styleReady = !!map.isStyleLoaded();
    return {
      style,
      zoom: map.getZoom(),
      styleReady,
      provenance: this.provenance(style),
      availableImages,
      missingImages: [...this.missingImages].map(([id, at]) => ({
        id,
        settled: styleReady && map.areTilesLoaded() && performance.now() - at >= imageGraceMs,
      })),
    };
  }

  private provenance(style: StyleSpecification) {
    const metadata = style.metadata as Record<string, unknown> | undefined;
    const sidecar = this.side?.sidecar;
    return (!sidecar?.map || sidecar.map === metadata?.['tileflow:map']) &&
      (!sidecar?.theme || sidecar.theme === metadata?.['tileflow:theme'])
      ? sidecar
      : undefined;
  }

  private ensureProvenance(style: StyleSpecification) {
    const side = this.side,
      map = this.map;
    if (!this.active || !side || !map || !this.options.loadProvenance || this.provenance(style))
      return;
    const metadata = style.metadata as Record<string, unknown> | undefined;
    const key = JSON.stringify([
      side.loadEpoch,
      side.artifactGeneration,
      metadata?.['tileflow:map'],
      metadata?.['tileflow:theme'],
    ]);
    if (key === this.provenanceAttempt) return;
    this.provenanceAttempt = key;
    void this.options
      .loadProvenance(side)
      .then(() => {
        if (
          this.disposed ||
          side !== this.side ||
          map !== this.map ||
          this.provenanceAttempt !== key
        )
          return;
        this.dirty = true;
        this.schedule(0);
      })
      .catch(() => {
        // Provenance is optional. Keep findings unattributed and do not repeatedly fetch a
        // missing sidecar while the user edits a temporary paint property.
      });
  }

  private checkStyle() {
    const map = this.map;
    if (!map || map.isMoving() || this.disposed) return;
    try {
      const style = map.getStyle();
      if (!style) {
        this.styleLimitations = ['Waiting for the map style.'];
        return;
      }
      const previousKey = this.styleKey;
      this.styleKey = diagnosticFingerprint({
        ...style,
        layers: style.layers.filter((layer) => !layer.id.startsWith('__tileflow-inspector')),
        sources: Object.fromEntries(
          Object.entries(style.sources)
            .filter(([id]) => !id.startsWith('__tileflow-inspector'))
            .map(([id, source]) => [
              id,
              source.type === 'geojson' && typeof source.data === 'object'
                ? {...source, data: '[inline data omitted from style identity]'}
                : source,
            ]),
        ),
      });
      if (previousKey && previousKey !== this.styleKey) {
        // Demand from another style revision cannot establish that the new style requested
        // an image. Wait for a fresh renderer event instead of inferring demand from rules.
        this.missingImages.clear();
      }
      const input = this.collectInput(style);
      if (!input.styleReady) {
        this.styleLimitations = [
          'The style or its resources are still loading. Checks are pending; earlier findings are retained.',
        ];
        this.dirty = true;
        return;
      }
      this.ensureProvenance(style);
      const findings = collectDiagnostics(input);
      this.dirty = false;
      const snapshot = this.snapshot(style)!;
      this.styleSnapshot = snapshot;
      this.staticEntries = this.captureEntries(
        findings.filter((finding) => finding.scope === 'style'),
        snapshot,
        style,
      );
      const resources = this.captureEntries(
        findings.filter((finding) => finding.scope === 'view'),
        snapshot,
        style,
      );
      // Keep a missing-image observation from another camera until the resource is actually
      // available. Looking away is not evidence that its required image has been repaired.
      const available = new Set(input.availableImages);
      this.resourceEntries = [
        ...resources,
        ...this.resourceEntries
          .filter((entry) => {
            if (!this.sameMap(entry.snapshot)) return false;
            if (resources.some(({finding}) => finding.id === entry.finding.id)) return false;
            const id = entry.finding.evidence.find((item) => item.label === 'Image ID')?.value;
            if (typeof id !== 'string' || available.has(id)) return false;
            return entry.finding.layers.some((layerId) => {
              const layer = style.layers.find((candidate) => candidate.id === layerId);
              if (layer?.type !== 'symbol') return false;
              const icon = layer.layout?.['icon-image'];
              return icon === id || (Array.isArray(icon) && icon[0] === 'image' && icon[1] === id);
            });
          })
          .map((entry) => ({
            ...entry,
            pendingReason:
              'This image has not been verified in the latest view. Its earlier observation is retained until the resource resolves or its rule changes.',
          })),
      ].slice(0, 100);
      this.styleLimitations = [];
      const pending = input.missingImages.filter((image) => !image.settled);
      if (pending.length) {
        this.styleLimitations.push(
          'Required images are being given time to load before reporting them missing.',
        );
        this.schedule(imageGraceMs);
      }
    } catch {
      this.styleLimitations = ['Style checks are unavailable while the map is being replaced.'];
      this.dirty = true;
    } finally {
      this.render();
    }
  }

  private async checkView() {
    this.refresh();
    const map = this.map,
      side = this.side;
    if (!map || !side || this.running || map.isMoving()) return;
    this.options.beforeRun();
    this.clearTimer();
    this.checkStyle();
    if (!map.isStyleLoaded() || !map.areTilesLoaded()) {
      this.status.textContent =
        'The view is still loading. Check again when it has settled; earlier findings have been kept.';
      return;
    }
    const controller = new AbortController();
    const snapshot = this.snapshot()!;
    this.running = controller;
    this.status.textContent = 'Checking this view…';
    this.render();
    try {
      // Yield before bounded feature evaluation so the busy state can be painted.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (controller.signal.aborted || !this.sameMap(snapshot)) return;
      const labels = sampleDiagnosticLabels(map, 40);
      const style = map.getStyle();
      if (!style) return;
      const viewFindings = contrastFindings(labels);
      const observation = await samplePerformance(map, controller.signal, {includeOverdraw: true});
      if (
        controller.signal.aborted ||
        this.disposed ||
        !this.sameMap(snapshot) ||
        this.viewKey(map) !== snapshot.viewKey ||
        snapshot.dataRevision !== this.dataRevision
      ) {
        if (!controller.signal.aborted && !this.disposed)
          this.status.textContent =
            'The view changed during the check. Previous findings have been kept.';
        return;
      }
      if (observation.status === 'cancelled') {
        this.status.textContent =
          'The view changed during the check. Previous findings have been kept; check again when it settles.';
        return;
      }
      // Reconcile styledata generated by the renderer's temporary measurement mode.
      this.checkStyle();
      if (this.styleKey !== snapshot.styleKey) {
        this.status.textContent =
          'The style changed during the check. Previous findings have been kept.';
        return;
      }
      this.viewSnapshot = snapshot;
      this.viewComplete = labels.length > 0 && !!observation.drawCalls && !!observation.overdraw;
      const next = this.captureEntries(
        [...viewFindings, ...performanceFindings(observation, snapshot.camera)],
        snapshot,
        style,
      );
      this.updateViewEntries(
        next,
        snapshot,
        (entry) => {
          if (entry.finding.category === 'readability')
            return this.readabilityChecked(entry, labels, style);
          if (entry.finding.check === 'drawing-workload') return !!observation.drawCalls;
          if (entry.finding.check === 'overlapping-paint') return !!observation.overdraw;
          return false;
        },
        'This detector could not be repeated in the latest check.',
      );
      this.viewLimitations = [
        labels.length
          ? `Readability uses up to 40 sampled labels with resolvable opaque text and halo colors; ${labels.length} eligible samples were examined.`
          : 'No eligible opaque text/halo combinations could be sampled. Readability was not assessed.',
        'Only this view and the current variant were checked. Tile delivery and map data completeness are not design checks.',
        ...observation.limitations,
      ];
      this.status.textContent = 'View checked. Findings describe this view and variant.';
    } catch {
      if (!controller.signal.aborted) {
        this.status.textContent = 'This check could not finish. Previous findings have been kept.';
      }
    } finally {
      if (this.running === controller) this.running = undefined;
      if (!this.disposed) {
        this.render(true);
        if (this.dirty) this.schedule();
      }
    }
  }

  private dismissKey(entry: Entry) {
    return `${entry.snapshot.name}:${entry.finding.id}${
      entry.finding.scope === 'view' ? `:${entry.snapshot.styleKey}:${entry.snapshot.viewKey}` : ''
    }`;
  }

  private readabilityChecked(
    entry: Entry,
    labels: ReturnType<typeof sampleDiagnosticLabels>,
    style: StyleSpecification,
  ) {
    return entry.finding.layers.every((id) => {
      if (!style.layers.some((layer) => layer.id === id)) return true;
      const previous = entry.finding.samples?.filter((sample) => sample.layer === id) ?? [];
      if (!previous.length) return false;
      return previous.every((before) =>
        labels.some((after) => {
          if (after.layer !== id) return false;
          if (before.featureId !== undefined) return before.featureId === after.featureId;
          return (
            before.text === after.text &&
            !!before.coordinate &&
            !!after.coordinate &&
            before.coordinate.every(
              (value, index) => Math.abs(value - after.coordinate![index]) < 1e-7,
            )
          );
        }),
      );
    });
  }

  private updateViewEntries(
    next: Entry[],
    snapshot: Snapshot,
    checked: (entry: Entry) => boolean,
    reason: string,
  ) {
    const retained = this.viewEntries
      .filter((entry) => {
        if (next.some(({finding}) => finding.id === entry.finding.id)) return false;
        return !(
          this.sameMap(entry.snapshot) &&
          entry.snapshot.viewKey === snapshot.viewKey &&
          checked(entry)
        );
      })
      .map((entry) => ({...entry, pendingReason: reason}));
    this.viewEntries = [...next, ...retained].slice(0, 160);
  }

  private entryCurrent(entry: Entry) {
    return !entry.pendingReason && this.current(entry.snapshot, entry.finding.scope === 'view');
  }

  private captureEntries(
    findings: DiagnosticFinding[],
    snapshot: Snapshot,
    style: StyleSpecification,
  ): Entry[] {
    const layers = new Map(style.layers.map((layer) => [layer.id, layer]));
    const origins = new Map(
      this.provenance(style)?.layers.map((layer) => [layer.id, layer.contributions]),
    );
    return findings.map((finding) => ({
      finding,
      snapshot,
      declarations: safeContext(
        {
          layers: finding.layers.slice(0, 12).map((id) => ({
            declaration: layers.get(id),
            contributions: origins.get(id),
          })),
          omittedLayers: Math.max(0, finding.layers.length - 12),
        },
        2400,
      ),
    }));
  }

  private isDismissed(entry: Entry) {
    return this.dismissed.get(this.dismissKey(entry)) === entry.finding.fingerprint;
  }

  private entries() {
    const seen = new Set<string>();
    return [...this.staticEntries, ...this.resourceEntries, ...this.viewEntries]
      .filter(({finding}) => {
        const key = `${finding.id}:${finding.fingerprint}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          Number(a.finding.kind === 'review') - Number(b.finding.kind === 'review') ||
          a.finding.category.localeCompare(b.finding.category) ||
          a.finding.title.localeCompare(b.finding.title),
      );
  }

  private render(force = false) {
    if (this.disposed) return;
    const entries = this.entries(),
      visible = entries.filter((entry) => !this.isDismissed(entry));
    const filtered = visible.filter(
      ({finding}) => this.filter === 'all' || finding.category === this.filter,
    );
    const styleCurrent = this.current(this.styleSnapshot),
      viewCurrent = this.current(this.viewSnapshot, true);
    const moving = this.map?.isMoving() ?? false;
    this.check.disabled = !this.map || !!this.running || moving;
    this.check.textContent = this.running ? 'Checking…' : 'Check view';
    this.cancelButton.hidden = !this.running;
    this.copy.disabled = !this.styleSnapshot && !this.viewSnapshot;
    const key = JSON.stringify([
      entries.map((entry) => [
        entry.finding.id,
        entry.finding.fingerprint,
        this.isDismissed(entry),
        this.entryCurrent(entry),
        entry.pendingReason,
      ]),
      this.filter,
      styleCurrent,
      viewCurrent,
      !!this.map,
      moving,
      !!this.running,
      this.styleLimitations,
      this.viewLimitations,
    ]);
    if (!force && key === this.renderKey) return;
    this.renderKey = key;
    for (const [id, filter] of this.filterButtons)
      filter.setAttribute('aria-pressed', String(id === this.filter));
    const problems = visible.filter(({finding}) => finding.kind === 'problem').length;
    const reviews = visible.length - problems;
    this.summary.replaceChildren(
      el('span', '', `${problems} problem${problems === 1 ? '' : 's'} · ${reviews} to review`),
    );
    const scope = !this.map
      ? 'Waiting for map'
      : moving
        ? 'Map moving'
        : !styleCurrent
          ? 'Style checks pending'
          : viewCurrent
            ? this.viewComplete
              ? 'Current view'
              : 'Current view · partial coverage'
            : this.viewSnapshot
              ? 'Previous view · check again'
              : 'Style checked · view not checked';
    this.summary.append(el('span', 'inspector-diagnostics-scope', scope));
    const hidden = entries.length - visible.length;
    if (hidden)
      this.summary.append(
        button(`Restore ${hidden} dismissed`, () => {
          for (const entry of entries) this.dismissed.delete(this.dismissKey(entry));
          this.render(true);
        }),
      );
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = this.list.contains(focused) ? focused?.dataset.diagnosticFocus : undefined;
    const scroll = this.list.scrollTop;
    if (filtered.length) this.list.replaceChildren(...filtered.map((entry) => this.row(entry)));
    else {
      const empty = el('div', 'inspector-diagnostics-empty');
      const title = !this.map
        ? 'Waiting for the map'
        : !styleCurrent
          ? 'Style checks are pending'
          : this.filter !== 'all'
            ? `No ${categories[this.filter].toLowerCase()} findings in this list`
            : hidden
              ? 'All current findings are dismissed'
              : viewCurrent
                ? 'No issues found in completed checks'
                : 'No style issues detected';
      const detail = !this.map
        ? 'Diagnostics will be available when the preview connects.'
        : !styleCurrent
          ? 'Configuration and resource checks run automatically after the map settles.'
          : viewCurrent
            ? 'This result applies to the current view and variant.'
            : 'Check this view to examine sampled label contrast and rendering work. Other locations and variants are not inferred.';
      empty.append(el('strong', '', title), el('p', '', detail));
      this.list.replaceChildren(empty);
    }
    this.list.scrollTop = scroll;
    if (focusKey)
      this.list
        .querySelector<HTMLElement>(`[data-diagnostic-focus="${CSS.escape(focusKey)}"]`)
        ?.focus({preventScroll: true});
  }

  private row(entry: Entry) {
    const {finding, snapshot} = entry;
    const current = this.entryCurrent(entry);
    const key = `${finding.id}:${finding.fingerprint}`;
    const row = el('details', 'inspector-diagnostic');
    row.dataset.kind = finding.kind;
    row.dataset.stale = String(!current);
    row.open = this.expanded.has(key);
    row.addEventListener('toggle', () =>
      row.open ? this.expanded.add(key) : this.expanded.delete(key),
    );
    const summary = el('summary');
    summary.dataset.diagnosticFocus = key;
    const indicator = el(
      'span',
      'inspector-diagnostic-indicator',
      finding.kind === 'problem' ? '●' : '◐',
    );
    indicator.setAttribute('aria-label', finding.kind === 'problem' ? 'Problem' : 'Review');
    const title = el('span');
    title.append(
      el('span', 'inspector-diagnostic-title', finding.title),
      el('span', 'inspector-diagnostic-subtitle', finding.summary),
    );
    const context =
      finding.scope === 'view'
        ? `${snapshot.themeLabel ? `${snapshot.themeLabel} · ` : ''}z${snapshot.camera.zoom.toFixed(2)}`
        : 'Style configuration';
    title.append(
      el(
        'span',
        'inspector-diagnostic-context',
        `${context}${current ? '' : ' · earlier observation'}`,
      ),
    );
    summary.append(
      indicator,
      title,
      el('span', 'inspector-diagnostic-category', categories[finding.category]),
    );
    const body = el('div', 'inspector-diagnostic-detail');
    body.append(el('p', '', finding.detail));
    if (!current)
      body.append(
        el(
          'p',
          'inspector-diagnostic-state',
          entry.pendingReason ??
            'This finding belongs to an earlier view or style. Check again before treating it as resolved.',
        ),
      );
    if (finding.evidence.length) {
      const evidence = el('dl', 'inspector-diagnostic-evidence');
      for (const item of finding.evidence)
        evidence.append(el('dt', '', item.label), el('dd', '', String(item.value)));
      body.append(evidence);
    }
    const canReveal = this.sameMap(snapshot);
    if (finding.layers.length > 1) {
      const layers = el('div', 'inspector-diagnostic-layers');
      for (const layer of finding.layers.slice(0, 8)) {
        const link = button(layer, () =>
          this.options.reveal(
            snapshot.side,
            {
              ...finding,
              layers: [layer],
              target: finding.target?.layer === layer ? finding.target : undefined,
            },
            'rule',
          ),
        );
        link.title = `Open ${layer}`;
        link.disabled = !canReveal || !this.map?.getLayer(layer);
        layers.append(link);
      }
      if (finding.layers.length > 8)
        layers.append(el('span', '', `+${finding.layers.length - 8} more in copied context`));
      body.append(layers);
    }
    if (finding.samples?.length) {
      const samples = el('div', 'inspector-diagnostic-samples');
      for (const sample of finding.samples.slice(0, 4)) {
        const sampleFinding = {
          ...finding,
          layers: sample.layer ? [sample.layer] : finding.layers,
          samples: [sample],
        };
        const action = button(sample.text || sample.layer || 'Show example', () =>
          this.revealOnMap(entry, sampleFinding),
        );
        action.disabled = !this.current(snapshot);
        samples.append(action);
      }
      body.append(samples);
    }
    if (finding.limitations.length) {
      const limitations = el('ul', 'inspector-diagnostic-limitations');
      for (const text of finding.limitations) limitations.append(el('li', '', text));
      body.append(limitations);
    }
    const actions = el('div', 'inspector-diagnostic-links');
    if (finding.layers.length) {
      const open = button(finding.target ? 'Open rule' : 'Open layer', () =>
        this.options.reveal(snapshot.side, finding, 'rule'),
      );
      open.disabled = !canReveal;
      actions.append(open);
    }
    if (finding.category === 'assets') {
      const id = finding.evidence.find((item) => item.label === 'Image ID')?.value;
      const asset = button('Open assets', () =>
        this.options.assets('Sprites', typeof id === 'string' ? id : undefined),
      );
      asset.disabled = !canReveal;
      actions.append(asset);
    }
    if (finding.check === 'overlapping-paint') {
      const overdraw = button('Show overdraw', () => {
        this.revealOnMap(entry, finding);
        this.options.overlay('overdraw');
      });
      overdraw.disabled = !this.current(snapshot);
      actions.append(overdraw);
    }
    actions.append(
      button('Copy for agent', () => void this.copyEntries([entry])),
      button(
        'Dismiss',
        () => {
          if (this.dismissed.size >= 500)
            this.dismissed.delete(this.dismissed.keys().next().value!);
          this.dismissed.set(this.dismissKey(entry), finding.fingerprint);
          this.render(true);
        },
        'inspector-diagnostic-dismiss',
      ),
    );
    body.append(actions);
    row.append(summary, body);
    return row;
  }

  private revealOnMap(entry: Entry, finding: DiagnosticFinding) {
    if (!this.current(entry.snapshot) || !this.map) return;
    this.revealCleanup?.();
    const map = this.map;
    const camera = finding.samples?.[0]?.camera ?? entry.snapshot.camera;
    moveCamera(map, camera, 0, true);
    if (!finding.layers.length && !finding.samples?.some((sample) => sample.layer)) return;
    const key = this.viewKey(map);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      map.off('idle', reveal);
      map.off('render', reveal);
      this.revealCleanup = undefined;
    };
    const reveal = () => {
      if (!this.sameMap(entry.snapshot) || this.disposed || this.viewKey(map) !== key) {
        finish();
        return;
      }
      if (map.isMoving() || !map.areTilesLoaded()) return;
      finish();
      this.options.reveal(entry.snapshot.side, finding, 'map');
    };
    const timeout = setTimeout(() => {
      const current = this.sameMap(entry.snapshot) && !this.disposed && this.viewKey(map) === key;
      finish();
      if (current) this.options.reveal(entry.snapshot.side, finding, 'map');
    }, 1200);
    this.revealCleanup = finish;
    map.on('idle', reveal);
    map.on('render', reveal);
    map.triggerRepaint();
  }

  async copyReport() {
    await this.copyEntries(this.entries().filter((entry) => !this.isDismissed(entry)));
  }

  private async copyEntries(entries: Entry[]) {
    const context = (snapshot: Snapshot) => ({
      map: snapshot.name,
      theme: snapshot.theme,
      themeLabel: snapshot.themeLabel,
      checkedAt: snapshot.at,
      camera: snapshot.camera,
      viewport: snapshot.viewport,
      generation: snapshot.generation,
      dataRevision: snapshot.dataRevision,
      styleFingerprint: snapshot.styleKey,
    });
    const packet = {
      schemaVersion: 1,
      type: 'tileflow-diagnostics',
      copiedAt: new Date().toISOString(),
      purpose: 'Map design findings, not a score or certification of the entire map.',
      findingCount: entries.length,
      findings: entries.map((entry) => ({
        ...entry.finding,
        current: this.entryCurrent(entry),
        pendingReason: entry.pendingReason,
        context: context(entry.snapshot),
        affectedRules: entry.declarations.value,
        omittedDeclarationPaths: entry.declarations.omitted,
      })),
      checkedStyle: this.styleSnapshot && context(this.styleSnapshot),
      checkedView: this.viewSnapshot && context(this.viewSnapshot),
      limitations: [assetCoverage, ...this.styleLimitations, ...this.viewLimitations],
      temporaryChanges: this.side && this.options.temporary?.(this.side),
      dismissedCount: this.entries().filter((entry) => this.isDismissed(entry)).length,
    };
    const safe = safeContext(packet, 16000);
    const scrub = (value: unknown): unknown => {
      if (typeof value === 'string') return sanitizeDiagnosticSecrets(value);
      if (Array.isArray(value)) return value.map(scrub);
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrub(entry)]));
      return value;
    };
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            ...(scrub(safe.value) as Record<string, unknown>),
            export: {
              sanitized: true,
              omittedPaths: safe.omitted,
              note: 'Credentials and URL queries are removed. Omitted paths identify bounded export truncation.',
            },
          },
          null,
          2,
        ),
      );
      this.status.textContent =
        entries.length === 1 ? 'Finding copied for agent.' : 'Findings copied for agent.';
    } catch {
      this.status.textContent = 'Clipboard access failed. Try copying again.';
    }
  }
}
