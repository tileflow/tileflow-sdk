import {Color, featureFilter} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature, Map as MapLibreMap, MapSourceDataEvent} from 'maplibre-gl';
import {FontPreviews} from '../font-preview';
import {bindLiveColorInput} from '../live-color';
import {evaluatedValue, propertiesFor, propertySpec, type StyleEdits} from '../style-edits';
import type {DevtoolsHost, PreviewWindow, Side} from '../types';
import {explainFeatureVisibility} from './explain';
import {LayerHighlight} from './highlight';
import {
  contextMarkdown,
  diagnoseLayer,
  eligibility,
  expressionDependencies,
  type LayerChange,
  layerChanges,
  layerContext,
  layerGroups,
  layerInventory,
  layerLabel,
  layerMatches,
  type LayerRecord,
  type LayerSample,
  queryLayer,
  safeContext,
} from './model';
import {LayerPreview} from './preview';
import {layersStyles} from './styles';
import {layersInView} from './visibility';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function action(text: string, run: () => void, className = '') {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
}
const json = (value: unknown) =>
  JSON.stringify(safeContext(value).value, null, 2) ?? 'Not declared';
const pending = (): LayerSample => ({
  status: 'pending',
  reason: 'Waiting for a settled viewport…',
  features: [],
});
const kinds: Record<string, string> = {
  fill: '▰',
  line: '╱',
  symbol: 'T',
  circle: '●',
  'fill-extrusion': '⬡',
  custom: '◇',
  raster: '▧',
  background: '□',
  hillshade: '◩',
  heatmap: '◉',
};
type DetailTab = 'Diagnosis' | 'Rules' | 'Data' | 'Origin';
type Options = {
  host: DevtoolsHost;
  network: (source: string) => void;
  assets: (category: 'Sprites' | 'Fonts', filter: string) => void;
  temporary: (side: Side) => unknown;
  editor: (side: Side) => StyleEdits;
  edited: () => void;
  report: (message: string) => void;
};

export class LayersPanel {
  private search = el('input');
  private visibleOnly = el('input');
  private visibleIds?: Set<string>;
  private list = el('div', 'dt-layer-list');
  private detail = el('div', 'dt-layer-detail');
  private content = el('div', 'dt-scroll dt-layer-content');
  private heading = el('div', 'dt-layer-heading');
  private tabs = new Map<DetailTab, HTMLButtonElement>();
  private modes = new Map<string, HTMLButtonElement>();
  private total = el('span', 'dt-layer-total');
  private notice = el('span', 'dt-layer-notice');
  private copy = action('Copy context', () => this.openContext(), 'dt-layer-copy');
  private mode: 'module' | 'order' = 'module';
  private tab: DetailTab = 'Rules';
  private collapsed = new Set<string>();
  private selectedId = new URL(location.href).searchParams.get('layer') ?? '';
  private layers: LayerRecord[] = [];
  private history: LayerChange[] = [];
  private samples: LayerSample = pending();
  private sampleIndex = 0;
  private picked?: {
    feature: MapGeoJSONFeature;
    coordinate?: [number, number];
    at: string;
    revision: string;
  };
  private revealSelection = true;
  private ruleTarget?: {section: 'paint' | 'layout' | 'filter'; property: string};
  private focusTarget = false;
  private map?: MapLibreMap;
  private side?: Side;
  private epoch = -1;
  private key = '';
  private cameraKey = '';
  private runtimeKey = '';
  private listKey = '';
  private detailKey = '';
  private contextKey = '';
  private cachedContext?: Record<string, unknown>;
  private active = false;
  private dirty = true;
  private measurementDirty = true;
  private generation = 0;
  private observedAt = new Date().toISOString();
  private provenanceAttempt = '';
  private timer?: ReturnType<typeof setTimeout>;
  private cache = new Map<string, LayerSample>();
  private highlight = new LayerHighlight();
  private preview = new LayerPreview(
    (id) => this.showPreview(id),
    () => {
      this.highlight.clear();
      this.notice.textContent = '';
    },
  );
  private restoringFocus = false;
  private dialog?: HTMLDialogElement;
  private showDefaults = false;
  private ruleCleanups: (() => void)[] = [];
  private fontPreviews = new FontPreviews();
  private invalidate = () => {
    this.dirty = true;
  };
  private settled = () => {
    if (this.measurementDirty) this.scheduleMeasurement();
  };
  private sourceChanged = (event: MapSourceDataEvent) => {
    if (event.sourceId?.startsWith('__tileflow-devtools-')) return;
    this.cache.clear();
    this.measurementDirty = true;
    this.dirty = true;
    this.scheduleMeasurement();
  };
  private moving = () => {
    this.preview.pause();
    this.samples = pending();
    this.cache.clear();
    this.measurementDirty = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  };

  constructor(
    private root: HTMLElement,
    private options: Options,
  ) {
    const style = el('style');
    style.nonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce || '';
    style.textContent = layersStyles;
    root.append(style);
    const tools = el('div', 'dt-tools dt-layer-tools');
    const modes = el('div', 'dt-layer-modes');
    modes.setAttribute('aria-label', 'Layer organization');
    for (const [mode, label] of [
      ['module', 'By module'],
      ['order', 'Draw order'],
    ] as const) {
      const button = action(label, () => {
        this.mode = mode;
        this.renderList(true);
      });
      this.modes.set(mode, button);
      modes.append(button);
    }
    this.search.type = 'search';
    this.search.placeholder = 'Filter layers, modules, sources…';
    this.search.setAttribute('aria-label', 'Filter layers');
    this.search.addEventListener('input', () => this.renderList(true));
    const visible = el('label', 'dt-layer-visible');
    this.visibleOnly.type = 'checkbox';
    this.visibleOnly.setAttribute('aria-label', 'Visible only');
    visible.title =
      'Hide hidden or out-of-zoom layers and layers without rendered features in this view. Custom and raster layers stay listed when visibility is unknown.';
    this.visibleOnly.setAttribute('role', 'switch');
    visible.append(this.visibleOnly, document.createTextNode('Visible'));
    this.visibleOnly.addEventListener('change', () => {
      if (this.visibleOnly.checked && this.map && !this.map.isMoving())
        this.visibleIds = layersInView(this.map, this.layers);
      else if (!this.visibleOnly.checked) this.visibleIds = undefined;
      this.measurementDirty = true;
      this.renderList();
      this.scheduleMeasurement();
    });
    const toolsRow = el('div', 'dt-layer-tools-row');
    toolsRow.append(modes, visible, this.total);
    tools.append(this.search, toolsRow);
    const split = el('div', 'dt-layer-split');
    this.list.setAttribute('aria-label', 'Map layers');
    this.list.addEventListener('mouseleave', () => this.preview.hover());
    this.list.addEventListener('focusout', (event) => {
      if (!this.restoringFocus && !this.list.contains(event.relatedTarget as Node | null))
        this.preview.hover();
    });
    this.list.addEventListener('keydown', (event) => this.navigate(event));
    const tabs = el('div', 'dt-subtabs dt-layer-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Layer details');
    for (const name of ['Rules', 'Diagnosis', 'Data', 'Origin'] as const) {
      const button = action(name, () => this.selectTab(name));
      button.id = `dt-layer-tab-${name.toLowerCase()}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'dt-layer-details');
      button.addEventListener('keydown', (event) => {
        const names = [...this.tabs.keys()];
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
        if (!delta) return;
        event.preventDefault();
        const next = names[(names.indexOf(this.tab) + delta + names.length) % names.length];
        this.selectTab(next);
        this.tabs.get(next)!.focus();
      });
      this.tabs.set(name, button);
      tabs.append(button);
    }
    this.content.id = 'dt-layer-details';
    this.content.setAttribute('role', 'tabpanel');
    this.content.tabIndex = 0;
    this.detail.append(this.heading, tabs, this.content);
    const sidebar = el('div', 'dt-layer-sidebar');
    sidebar.append(tools, this.list);
    split.append(sidebar, this.detail);
    this.notice.setAttribute('role', 'status');
    root.append(split, this.notice);
    this.selectTab(this.tab);
  }

  show() {
    this.active = true;
    this.dirty = true;
    this.refresh();
  }
  cancel() {
    this.active = false;
    this.clearRuleInputs();
    this.detailKey = '';
    clearTimeout(this.timer);
    this.timer = undefined;
    this.clearPreview();
  }
  dispose() {
    this.cancel();
    this.detach();
    this.dialog?.remove();
  }
  private detach() {
    this.map?.off('styledata', this.invalidate);
    this.map?.off('sourcedata', this.sourceChanged);
    this.map?.off('idle', this.settled);
    this.map?.off('movestart', this.moving);
    this.map?.off('moveend', this.settled);
  }
  refresh() {
    if (!this.active) return;
    const side = this.options.host.active(),
      map = side.map;
    const replaced = map !== this.map || side !== this.side || side.loadEpoch !== this.epoch;
    if (replaced) {
      this.clearPreview();
      this.detach();
      this.map = map;
      this.side = side;
      this.epoch = side.loadEpoch;
      this.key = '';
      this.cameraKey = '';
      this.visibleIds = undefined;
      this.cache.clear();
      this.samples = pending();
      this.picked = undefined;
      this.measurementDirty = true;
      this.dirty = true;
      this.generation++;
      map?.on('styledata', this.invalidate);
      map?.on('idle', this.settled);
      map?.on('sourcedata', this.sourceChanged);
      map?.on('movestart', this.moving);
      map?.on('moveend', this.settled);
    }
    if (!map) {
      this.layers = [];
      this.renderList();
      this.renderDetail(replaced);
      return;
    }
    try {
      const camera = JSON.stringify([
        map.getCenter(),
        map.getZoom(),
        map.getBearing(),
        map.getPitch(),
        map.getContainer().clientWidth,
        map.getContainer().clientHeight,
      ]);
      if (camera !== this.cameraKey) {
        this.cameraKey = camera;
        this.cache.clear();
        this.measurementDirty = true;
        this.dirty = true;
      }
      // Native controllers can finish their own tile/model work without a styledata event.
      const runtime = JSON.stringify(
        (side.frame.contentWindow as PreviewWindow | null)?.__tileflowDescribeRuntimeLayers?.(),
      );
      if (runtime !== this.runtimeKey) {
        this.runtimeKey = runtime;
        this.dirty = true;
      }
      if (this.dirty) {
        if (this.picked && this.picked.revision !== this.pickRevision()) {
          this.picked = undefined;
          this.clearPreview();
        }
        const next = layerInventory(side);
        const key = JSON.stringify([
          side.loadEpoch,
          side.artifactGeneration,
          map.getStyle().metadata,
          map.getStyle().state,
          next,
        ]);
        if (key !== this.key) {
          if (this.key)
            this.history.push(...layerChanges(this.layers, next, side.artifactGeneration));
          this.history = this.history.slice(-250);
          this.layers = next;
          this.key = key;
          this.cache.clear();
          this.measurementDirty = true;
          this.generation++;
          this.observedAt = new Date().toISOString();
          if (!this.selectedId && this.layers.length) this.select(this.layers.at(-1)!.id, true);
        }
        this.dirty = false;
      }
      const provenanceKey = JSON.stringify([
        side.loadEpoch,
        side.artifactGeneration,
        (map.getStyle().metadata as Record<string, unknown> | undefined)?.['tileflow:theme'],
        map.getStyle().state,
      ]);
      if (provenanceKey !== this.provenanceAttempt) {
        this.provenanceAttempt = provenanceKey;
        const epoch = side.loadEpoch;
        void this.options.host
          .loadSidecar?.(side)
          .then(() => {
            if (this.side === side && epoch === side.loadEpoch) {
              this.dirty = true;
              this.refresh();
            }
          })
          .catch(() => {
            /* Unattributed remains explicit. */
          });
      }
      this.renderList();
      this.renderDetail(replaced);
      if (this.measurementDirty) this.scheduleMeasurement();
    } catch {
      this.dirty = true;
      this.notice.textContent = 'Style is updating; waiting for the current renderer.';
    }
  }
  private scheduleMeasurement() {
    if (!this.active || this.timer || this.map?.isMoving()) return;
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.active || !this.map || generation !== this.generation || this.map.isMoving())
        return;
      const layer = this.layers.find((entry) => entry.id === this.selectedId);
      this.samples = layer
        ? this.sample(layer)
        : {status: 'unavailable', reason: 'Selected layer is absent.', features: []};
      this.sampleIndex = Math.min(this.sampleIndex, Math.max(0, this.samples.features.length - 1));
      this.measurementDirty = false;
      this.observedAt = new Date().toISOString();
      if (this.visibleOnly.checked) {
        this.visibleIds = layersInView(this.map, this.layers);
        this.renderList();
      }
      this.renderDetail();
      this.preview.refresh();
    }, 250);
  }
  private sample(layer: LayerRecord) {
    let sample = this.cache.get(layer.id);
    if (!sample) {
      sample = queryLayer(this.map!, layer);
      if (this.cache.size >= 12) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(layer.id, sample);
    }
    return sample;
  }
  /** The map picker and the layer list share one selection and one Rules panel. */
  reveal(
    side: Side,
    id: string,
    feature?: MapGeoJSONFeature,
    coordinate?: [number, number],
    target?: {section: 'paint' | 'layout' | 'filter'; property: string},
    preview = false,
  ) {
    if (this.options.host.active() !== side) return;
    if (!target && feature && this.picked?.feature === feature && this.selectedId === id) return;
    this.refresh();
    this.select(id, true);
    this.ruleTarget = target;
    this.focusTarget = Boolean(target);
    if (target && target.section !== 'filter') this.showDefaults = true;
    if (feature) this.visibleIds?.add(id);
    if (feature)
      this.picked = {
        feature,
        coordinate,
        at: new Date().toISOString(),
        revision: this.pickRevision(),
      };
    const layer = this.layers.find((entry) => entry.id === id);
    if (layer && !layerMatches(layer, this.search.value)) this.search.value = '';
    for (const [group, layers] of layerGroups(this.layers, this.mode))
      if (layers.some((entry) => entry.id === id)) this.collapsed.delete(group);
    this.revealSelection = true;
    this.renderList(true);
    this.selectTab('Rules');
    if (preview) this.preview.select(id);
  }
  private focusRuleTarget() {
    const target = this.ruleTarget;
    if (!target) return;
    const row = [...this.content.querySelectorAll<HTMLElement>('[data-rule-property]')].find(
      (node) =>
        node.dataset.ruleSection === target.section &&
        node.dataset.ruleProperty === target.property,
    );
    if (!row) return;
    row.dataset.diagnosticTarget = 'true';
    row.tabIndex = -1;
    if (this.focusTarget) {
      row.scrollIntoView({block: 'nearest'});
      row.focus({preventScroll: true});
      this.focusTarget = false;
    }
  }
  private pickRevision() {
    return JSON.stringify([
      this.side?.loadEpoch,
      this.side?.artifactGeneration,
      this.map?.getStyle().state?.['tileflow:preview-revision'],
    ]);
  }
  private select(id: string, fromPicker = false) {
    this.selectedId = id;
    this.ruleTarget = undefined;
    this.picked = undefined;
    if (!fromPicker) this.options.host.clearFeatureSelection?.();
    this.sampleIndex = 0;
    this.samples = pending();
    this.measurementDirty = true;
    const url = new URL(location.href);
    url.searchParams.set('layer', id);
    history.replaceState(history.state, '', url.href);
    this.clearPreview();
    this.renderList();
    this.renderDetail();
    // Clicking a row pins its layer preview; the map picker keeps its own feature outline.
    this.preview.select(fromPicker ? undefined : id);
    this.scheduleMeasurement();
  }
  private selectTab(name: DetailTab) {
    this.tab = name;
    for (const [key, tab] of this.tabs) {
      tab.setAttribute('aria-selected', String(key === name));
      tab.tabIndex = key === name ? 0 : -1;
    }
    this.content.setAttribute('aria-labelledby', this.tabs.get(name)!.id);
    this.renderDetail(true);
  }
  private navigate(event: KeyboardEvent) {
    const rows = [...this.list.querySelectorAll<HTMLButtonElement>('[data-layer-id]')];
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, rows.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : -1;
    if (target < 0) return;
    event.preventDefault();
    const id = rows[target].dataset.layerId;
    rows[target].click();
    [...this.list.querySelectorAll<HTMLButtonElement>('[data-layer-id]')]
      .find((row) => row.dataset.layerId === id)
      ?.focus();
  }
  private prettyName(layer: LayerRecord) {
    const label = layerLabel(layer),
      index = Math.max(label.lastIndexOf('.'), label.lastIndexOf('/'));
    const span = el('span');
    span.append(
      el('span', 'dt-layer-prefix', label.slice(0, index + 1)),
      el('span', 'dt-layer-name', label.slice(index + 1)),
    );
    return span;
  }
  private zoomRange(layer: LayerRecord) {
    const range = el('span', 'dt-zrange'),
      bar = el('i'),
      marker = el('em');
    const max = Math.max(22, this.map?.getMaxZoom() ?? 22),
      percent = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
    bar.style.left = `${percent(layer.minzoom)}%`;
    bar.style.width = `${Math.max(0, percent(layer.maxzoom) - percent(layer.minzoom))}%`;
    marker.style.left = `${percent(this.map?.getZoom() ?? 0)}%`;
    range.title = `Zoom ${layer.minzoom}–${layer.maxzoom} (maximum excluded)`;
    if (layer.layout.visibility === 'none') bar.style.background = 'var(--faint)';
    range.append(bar, marker);
    return range;
  }
  private visibilityControl(layers: LayerRecord[], label: string) {
    const hidden = layers.every((layer) => layer.layout.visibility === 'none');
    const control = el('span', 'dt-eye');
    control.tabIndex = 0;
    control.setAttribute('role', 'button');
    control.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} ${label}`);
    control.setAttribute('aria-pressed', String(hidden));
    control.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>${hidden ? '<path d="m2 2 12 12"/>' : ''}</svg>`;
    control.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleVisibility(layers);
    });
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        control.click();
      }
    });
    return control;
  }
  private toggleVisibility(layers: LayerRecord[]) {
    if (!this.side) return;
    const edits = this.options.editor(this.side),
      hide = !layers.every((layer) => layer.layout.visibility === 'none');
    try {
      edits.batch(() => {
        for (const layer of layers)
          edits.set(
            {layer: layer.id, section: 'layout', property: 'visibility'},
            hide ? 'none' : 'visible',
          );
      });
      this.options.edited();
      this.dirty = true;
      this.measurementDirty = true;
      this.refresh();
    } catch (error) {
      this.options.report(String(error));
    }
  }
  private renderFilter(layer: LayerRecord) {
    const section = el('section', 'dt-layer-section'),
      head = el('div', 'dt-rule-toggle');
    section.dataset.ruleSection = 'filter';
    section.dataset.ruleProperty = 'filter';
    const edits = this.options.editor(this.side!),
      target = {layer: layer.id, section: 'filter' as const, property: 'filter'};
    const entry = edits.entries.get(edits.key(target)),
      raw = entry?.original ?? layer.filter;
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = !entry?.disabled;
    toggle.disabled = !raw;
    toggle.setAttribute('aria-label', 'Enable feature filter');
    toggle.addEventListener('change', () => {
      try {
        edits.setEnabled(target, toggle.checked);
        this.options.edited();
        this.refreshRules();
      } catch (e) {
        this.options.report(String(e));
      }
    });
    head.append(toggle, el('h4', '', 'Feature filter'));
    const chips = el('div', 'dt-filter-chips');
    const conditions = Array.isArray(raw) && raw[0] === 'all' ? raw.slice(1) : raw ? [raw] : [];
    const describe = (value: unknown): string => {
      if (!Array.isArray(value)) return String(value);
      const [op, ...args] = value;
      if (op === 'get') return String(args[0]);
      if (op === 'geometry-type') return 'geometry-type';
      if (op === 'has' || op === '!has') return `${op === '!has' ? 'no ' : 'has '}${args[0]}`;
      if (['==', '!=', '>', '>=', '<', '<=', 'in', '!in'].includes(op))
        return args.map(describe).join(` ${op} `);
      return JSON.stringify(value);
    };
    for (const condition of conditions)
      chips.append(el('span', 'dt-filter-chip', describe(condition)));
    if (!conditions.length) chips.append(el('span', 'dt-layer-muted', 'No filter declared'));
    const code = el('pre', 'dt-layer-json', json(raw));
    code.hidden = true;
    head.append(
      action('Show JSON', () => {
        code.hidden = !code.hidden;
      }),
    );
    section.append(head, chips, code);
    if (raw && layer.source) {
      try {
        const features = this.map!.querySourceFeatures(layer.source, {
          sourceLayer: layer.sourceLayer,
        }).slice(0, 2000);
        const filter = featureFilter(
          raw as Parameters<typeof featureFilter>[0],
          layer.id + '.filter',
          this.map!.getGlobalState?.(),
        );
        const count = entry?.disabled
          ? features.length
          : features.filter((f) =>
              filter.filter(
                {zoom: this.map!.getZoom()},
                {
                  id: f.id,
                  type: f.geometry.type.replace('Multi', '') as 'Point',
                  properties: f.properties,
                },
              ),
            ).length;
        section.append(
          el(
            'p',
            'dt-note',
            `${count} of ${features.length}${features.length === 2000 ? '+' : ''} sampled resident source features match`,
          ),
        );
      } catch {
        section.append(el('p', 'dt-note', 'Source-feature match count unavailable.'));
      }
    }
    if (entry?.disabled) chips.style.opacity = '.4';
    this.content.append(section);
  }
  private renderList(force = false) {
    const zoom = this.map?.getZoom() ?? 0;
    const key = JSON.stringify([
      this.key,
      this.mode,
      this.search.value,
      this.visibleOnly.checked,
      this.visibleOnly.checked && this.visibleIds ? [...this.visibleIds].sort() : null,
      this.selectedId,
      this.layers.map((layer) => eligibility(layer, zoom)),
      Math.round(zoom * 10),
      [...this.collapsed],
    ]);
    if (!force && key === this.listKey) return;
    this.listKey = key;
    const scroll = this.list.scrollTop;
    const focused = this.list.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.layerId
      : undefined;
    for (const [mode, button] of this.modes)
      button.setAttribute('aria-pressed', String(mode === this.mode));
    const filtered = this.layers.filter(
      (layer) =>
        layerMatches(layer, this.search.value) &&
        (!this.visibleOnly.checked || !this.visibleIds || this.visibleIds.has(layer.id)),
    );
    this.total.textContent = `${filtered.length} / ${this.layers.length}`;
    this.total.title = 'Matching layers / renderer layers';
    const fragment = document.createDocumentFragment();
    for (const [group, layers] of layerGroups(filtered, this.mode)) {
      const section = el('section', 'dt-layer-group');
      const closed = this.collapsed.has(group) && !this.search.value;
      const header = action(
        '',
        () => {
          if (this.collapsed.has(group)) this.collapsed.delete(group);
          else this.collapsed.add(group);
          this.renderList(true);
        },
        'dt-layer-group-title',
      );
      header.setAttribute('aria-expanded', String(!closed));
      header.append(
        el('span', '', closed ? '▸' : '▾'),
        el('strong', '', group),
        el('span', 'dt-layer-count', String(layers.length)),
      );
      const owners = this.layers.filter((layer) => layers.some((item) => item.id === layer.id));
      header.prepend(this.visibilityControl(owners, group));
      section.append(header);
      if (!closed)
        for (const layer of layers) {
          const row = action('', () => this.select(layer.id), 'dt-layer-row');
          row.dataset.layerId = layer.id;
          row.setAttribute('aria-pressed', String(layer.id === this.selectedId));
          row.setAttribute('aria-label', `${layer.id}, ${layer.type}, ${eligibility(layer, zoom)}`);
          row.title = `${layer.id}\n${layer.type}${layer.source ? ` · ${layer.source} / ${layer.sourceLayer ?? '—'}` : ''}\nDraw index ${layer.index}`;
          const glyph = el('span', 'dt-layer-glyph', kinds[layer.type] ?? '◇');
          const label = el('span', 'dt-layer-label');
          label.append(this.prettyName(layer));
          const state = eligibility(layer, zoom);
          const badge = el('span', 'dt-layer-state', state === 'Enabled' ? layer.type : state);
          badge.dataset.state = state;
          row.append(
            this.visibilityControl([layer], layerLabel(layer)),
            glyph,
            label,
            this.zoomRange(layer),
          );
          row.addEventListener('mouseenter', () => this.preview.hover(layer.id));
          row.addEventListener('focus', () => {
            if (!this.restoringFocus) this.preview.hover(layer.id);
          });
          row.addEventListener('blur', () => {
            if (!this.restoringFocus) this.preview.hover();
          });
          row.addEventListener('mouseleave', () => {
            if (!this.restoringFocus) this.preview.hover();
          });
          section.append(row);
        }
      fragment.append(section);
    }
    if (!filtered.length)
      fragment.append(
        el(
          'p',
          'dt-empty',
          this.map
            ? this.visibleOnly.checked
              ? 'No layers match this view and filter.'
              : 'No layers match this filter.'
            : 'Waiting for map layers…',
        ),
      );
    this.restoringFocus = true;
    this.list.replaceChildren(fragment);
    this.list.scrollTop = scroll;
    if (this.revealSelection) {
      const selected = [...this.list.querySelectorAll<HTMLButtonElement>('[data-layer-id]')].find(
        (row) => row.dataset.layerId === this.selectedId,
      );
      if (selected) {
        selected.scrollIntoView({block: 'nearest'});
        this.revealSelection = false;
      }
    }
    if (focused)
      [...this.list.querySelectorAll<HTMLButtonElement>('[data-layer-id]')]
        .find((row) => row.dataset.layerId === focused)
        ?.focus({preventScroll: true});
    this.restoringFocus = false;
    const hovered = this.list.querySelector<HTMLElement>('[data-layer-id]:hover')?.dataset.layerId;
    if (hovered && hovered !== this.preview.hovered) this.preview.hover(hovered);
    else if (!hovered && this.preview.hovered && !focused) this.preview.hover();
  }
  private showPreview(id: string) {
    if (!this.active || !this.map || this.map.isMoving() || this.preview.target !== id) return;
    const layer = this.layers.find((entry) => entry.id === id);
    if (!layer) {
      this.clearPreview();
      return;
    }
    const sample = this.sample(layer);
    const shown = this.highlight.show(this.map, sample.features);
    this.notice.textContent = shown
      ? `Preview · ${layerLabel(layer)} · up to 30 fragments`
      : sample.status === 'ready'
        ? 'No rendered geometry in this view.'
        : sample.reason;
  }
  private clearPreview() {
    this.preview.clear();
  }
  private renderDetail(force = false) {
    const layer = this.layers.find((entry) => entry.id === this.selectedId);
    const key = JSON.stringify([
      this.key,
      this.cameraKey,
      this.selectedId,
      this.tab,
      this.samples.status,
      this.samples.measuredAt,
      this.sampleIndex,
      this.showDefaults,
      this.history.length,
      this.picked?.at,
    ]);
    if (!force && key === this.detailKey) return;
    // Style events and sample refreshes must not close an active color picker or replace a draft.
    if (
      !force &&
      this.tab === 'Rules' &&
      this.content.contains(document.activeElement) &&
      document.activeElement?.closest('.dt-layer-rule-editor')
    )
      return;
    this.detailKey = key;
    this.copy.disabled = !this.map || !this.selectedId;
    const scroll = this.content.scrollTop;
    if ((document.activeElement as HTMLElement | null)?.dataset.diagnosticTarget === 'true')
      this.focusTarget = true;
    this.clearRuleInputs();
    this.heading.replaceChildren();
    this.content.replaceChildren();
    if (!this.selectedId || !this.map) {
      this.content.append(
        el('div', 'dt-empty', 'Select a layer to inspect its rules, data and runtime evidence.'),
      );
      return;
    }
    const title = el('div', 'dt-layer-title');
    title.append(
      el('strong', '', layer ? layerLabel(layer) : 'Layer no longer present'),
      el('code', '', this.selectedId),
    );
    if (layer) {
      const status = el('div', 'dt-layer-status');
      status.dataset.state = eligibility(layer, this.map.getZoom());
      status.append(this.zoomRange(layer), el('span', '', `z${layer.minzoom}–${layer.maxzoom}`));
      if (status.dataset.state === 'Outside zoom')
        status.append(
          action('Go to range', () =>
            this.map!.easeTo({
              zoom: this.map!.getZoom() < layer.minzoom ? layer.minzoom : layer.maxzoom - 0.1,
            }),
          ),
        );
      title.append(status);
    }
    this.heading.append(title);
    if (this.tab === 'Diagnosis') this.renderDiagnosis(layer);
    if (this.tab === 'Rules' && layer) this.renderRules(layer);
    if (this.tab === 'Data' && layer) this.renderData(layer);
    if (this.tab === 'Origin' && layer) this.renderOrigin(layer);
    if (!layer && this.tab !== 'Diagnosis')
      this.content.append(
        el(
          'p',
          'dt-note',
          'The layer is absent from this renderer. Its ID will stay selected if it returns.',
        ),
      );
    this.content.scrollTop = force ? 0 : scroll;
    if (this.tab === 'Rules') this.focusRuleTarget();
  }
  private renderDiagnosis(layer?: LayerRecord) {
    const evidence = el('div', 'dt-layer-evidence');
    const feature = this.picked?.feature ?? this.samples.features[this.sampleIndex];
    for (const item of [
      ...diagnoseLayer(this.map!, layer, this.samples),
      ...(layer ? explainFeatureVisibility(this.map!, layer, feature) : []),
    ]) {
      const row = el('div', 'dt-layer-evidence-row');
      row.dataset.state = item.state;
      row.append(
        el(
          'span',
          'dt-layer-indicator',
          item.state === 'pass' ? '✓' : item.state === 'warn' ? '!' : '·',
        ),
        el('strong', '', item.label),
        el('span', '', item.value),
      );
      evidence.append(row);
    }
    this.content.append(evidence);
    if (!layer) return;
    if (layer.runtime) this.section('Runtime controller', layer.runtime);
    const neighbors = el('div', 'dt-layer-neighbors');
    neighbors.append(el('strong', '', 'Renderer sequence'));
    for (const [label, entry] of [
      ['Earlier', this.layers[layer.index - 1]],
      ['Selected', layer],
      ['Later', this.layers[layer.index + 1]],
    ] as const) {
      const row = el('div');
      row.append(el('span', 'dt-layer-muted', label));
      row.append(
        entry
          ? action(entry.id, () => this.select(entry.id), 'dt-layer-link')
          : el('span', '', 'End of stack'),
      );
      neighbors.append(row);
    }
    this.content.append(neighbors);
  }
  private renderRules(layer: LayerRecord) {
    if (layer.type === 'custom') {
      this.content.append(
        el(
          'p',
          'dt-note',
          'Custom rendering is controlled by its runtime. Style paint, layout and feature filters are unavailable. See Diagnosis and Origin.',
        ),
      );
      return;
    }
    const tools = el('div', 'dt-tools');
    const defaults = el('label', 'dt-rule-defaults'),
      toggle = el('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.checked = this.showDefaults;
    toggle.addEventListener('change', () => {
      this.showDefaults = toggle.checked;
      this.renderDetail(true);
    });
    defaults.append(toggle, document.createTextNode('Show defaults'));
    tools.append(defaults);
    const sample = this.picked?.feature ?? this.samples.features[this.sampleIndex];
    tools.append(
      el(
        'span',
        'dt-layer-muted',
        `At zoom ${this.map!.getZoom().toFixed(2)}${this.picked ? ' · picked feature' : sample ? ` · sample ${this.sampleIndex + 1}` : ' · no feature sample'}`,
      ),
    );
    this.content.append(tools);
    const edits = this.options.editor(this.side!);
    for (const section of ['paint', 'layout'] as const) {
      const declared = layer[section],
        specs = propertiesFor(layer.type, section);
      const disabledRules = [...edits.entries.values()].filter(
        (entry) => entry.layer === layer.id && entry.section === section && entry.disabled,
      );
      const keys = [
        ...new Set([
          ...Object.keys(declared),
          ...disabledRules.map((entry) => entry.property),
          ...(this.showDefaults ? Object.keys(specs) : []),
        ]),
      ];
      const table = el('table', 'dt-layer-rules');
      const head = el('thead'),
        header = el('tr');
      for (const text of [
        section === 'paint' ? `Paint · ${keys.length}` : `Layout · ${keys.length}`,
        '',
      ])
        header.append(el('th', '', text));
      head.append(header);
      table.append(head);
      const body = el('tbody');
      for (const key of keys.sort()) {
        const disabled = disabledRules.find((entry) => entry.property === key);
        const raw =
          (disabled ? (disabled.value ?? disabled.original) : declared[key]) ?? specs[key]?.default;
        const row = el('tr'),
          rule = el('td'),
          value = el('td');
        row.dataset.ruleSection = section;
        row.dataset.ruleProperty = key;
        rule.append(
          el('code', 'dt-layer-rule-name', key),
          el(
            'span',
            'dt-layer-dependency',
            `${disabled ? 'disabled · ' : key in declared ? '' : 'default · '}${expressionDependencies(raw).join(' + ')}`,
          ),
        );
        const evaluated = evaluatedValue(
          this.map!,
          layer.id,
          section,
          key,
          sample,
          this.map!.getZoom(),
          disabled ? raw : undefined,
        );
        if (
          key === 'text-font' &&
          Array.isArray(evaluated) &&
          evaluated.every((v) => typeof v === 'string')
        ) {
          const preview = el('div', 'dt-rule-font-preview'),
            controller = new AbortController();
          rule.append(preview);
          this.ruleCleanups.push(() => controller.abort());
          void this.fontPreviews
            .render(evaluated.join(','), this.map!.getStyle(), this.side!, controller.signal)
            .then((canvas) => {
              if (!controller.signal.aborted && preview.isConnected) preview.append(canvas);
            })
            .catch(() => {
              if (!controller.signal.aborted) preview.textContent = 'Font preview unavailable';
            });
        }
        if (expressionDependencies(raw).includes('zoom')) {
          const points = Array.from({length: 23}, (_, z) =>
            evaluatedValue(this.map!, layer.id, section, key, sample, z, raw),
          );
          if (points.every((point) => typeof point === 'number' && Number.isFinite(point))) {
            const nums = points as number[],
              lo = Math.min(...nums),
              hi = Math.max(...nums);
            const spark = el('div', 'dt-rule-spark');
            spark.innerHTML = `<svg viewBox="0 0 130 26"><polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${nums.map((n, z) => `${(z / 22) * 130},${25 - ((n - lo) / (hi - lo || 1)) * 24}`).join(' ')}"/><line stroke="currentColor" stroke-dasharray="2 2" x1="${(this.map!.getZoom() / 22) * 130}" x2="${(this.map!.getZoom() / 22) * 130}" y1="0" y2="26"/></svg>`;
            spark.append(
              el(
                'span',
                '',
                `z0–22 → ${typeof evaluated === 'number' ? +evaluated.toFixed(2) : '—'}`,
              ),
            );
            value.append(spark);
          }
        }
        this.renderRuleInput(value, row, layer, section, key, evaluated);
        if (key === 'icon-image' && typeof evaluated === 'string')
          value.append(
            action('Sprite ↗', () => this.options.assets('Sprites', evaluated), 'dt-layer-link'),
          );
        if (key === 'text-font')
          value.append(
            action('Font preview ↗', () => this.options.assets('Fonts', ''), 'dt-layer-link'),
          );
        row.append(rule, value);
        body.append(row);
      }
      if (!keys.length) {
        const row = el('tr'),
          cell = el('td', 'dt-layer-muted', 'No explicit rules. Renderer defaults apply.');
        cell.colSpan = 2;
        row.append(cell);
        body.append(row);
      }
      table.append(body);
      const card = el('div', 'dt-card dt-card-table');
      card.append(table);
      this.content.append(card);
    }
    this.renderFilter(layer);
  }
  /** Reconcile Rules immediately after a header undo, redo or reset, discarding queued previews. */
  refreshRules() {
    this.clearRuleInputs();
    this.detailKey = '';
    this.dirty = true;
    this.refresh();
  }
  private clearRuleInputs() {
    for (const cleanup of this.ruleCleanups) cleanup();
    this.ruleCleanups = [];
  }
  private renderRuleInput(
    cell: HTMLElement,
    row: HTMLElement,
    layer: LayerRecord,
    section: 'paint' | 'layout',
    property: string,
    evaluated: unknown,
  ) {
    const spec = propertySpec(layer.type, section, property);
    if (!spec) {
      cell.append(el('code', '', evaluated === undefined ? 'Unavailable' : json(evaluated)));
      return;
    }
    const side = this.side!,
      map = this.map!,
      epoch = side.loadEpoch;
    const edits = this.options.editor(side),
      target = {layer: layer.id, section, property};
    const editKey = edits.key(target);
    const format = (value: unknown) =>
      typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    let current = evaluated;
    const controls = el('div', 'dt-layer-rule-editor');
    const enabled = el('input');
    if (enabled) {
      enabled.type = 'checkbox';
      enabled.setAttribute('aria-label', `Enable ${property}`);
      // Row cells are mounted after this editor is constructed.
      queueMicrotask(() => {
        if (row.isConnected) {
          const rule = row.firstElementChild!;
          const wrap = el('label', 'dt-rule-toggle');
          wrap.append(enabled, rule.firstChild!);
          rule.prepend(wrap);
        }
      });
    }
    const input = spec.type === 'enum' || spec.type === 'boolean' ? el('select') : el('input');
    if (input instanceof HTMLSelectElement) {
      const values = spec.type === 'enum' ? Object.keys(spec.values) : ['true', 'false'];
      if (current === undefined) input.append(new Option('Needs evaluation context', ''));
      for (const value of values) input.append(new Option(value, value));
    } else {
      input.type = 'text';
      input.spellcheck = false;
      input.placeholder = 'Needs evaluation context';
      if (spec.type === 'number') input.inputMode = 'decimal';
    }
    input.value = format(current);
    input.setAttribute('aria-label', property);
    input.title = 'Temporary override for the entire layer';
    const error = el('span', 'dt-layer-rule-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const isCurrent = () =>
      this.active &&
      controls.isConnected &&
      side.map === map &&
      this.side === side &&
      this.selectedId === layer.id &&
      side.loadEpoch === epoch &&
      Boolean(map.getLayer(layer.id));
    const showError = (message = '') => {
      error.textContent = message;
      error.hidden = !message;
      input.setAttribute('aria-invalid', String(Boolean(message)));
    };
    let swatch: HTMLInputElement | undefined;
    const sync = () => {
      const disabled = edits.entries.get(editKey)?.disabled === true;
      row.dataset.disabled = String(disabled);
      row.dataset.modified = String(edits.entries.has(editKey));
      reset.disabled = !edits.entries.has(editKey);
      input.disabled = disabled;
      if (swatch) swatch.disabled = disabled;
      if (enabled) {
        enabled.checked = !disabled;
        enabled.disabled = !(property in layer[section]) && !edits.entries.has(editKey);
        enabled.title = enabled.disabled
          ? 'Renderer default. Edit the value to create an explicit rule.'
          : disabled
            ? 'Enable this rule and restore its saved value'
            : 'Disable this rule temporarily; use the renderer default';
      }
      if (swatch && typeof current === 'string') {
        const color = Color.parse(current);
        if (color)
          swatch.value =
            '#' +
            [color.r, color.g, color.b]
              .map((channel) =>
                Math.round((color.a ? channel / color.a : 0) * 255)
                  .toString(16)
                  .padStart(2, '0'),
              )
              .join('');
      }
    };
    enabled?.addEventListener('change', () => {
      if (!isCurrent()) return;
      try {
        edits.setEnabled(target, enabled.checked);
        this.clearRuleInputs();
        this.dirty = true;
        this.options.edited();
        this.refresh();
        const scroll = this.content.scrollTop;
        this.renderDetail(true);
        this.content.scrollTop = scroll;
        [...this.content.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
          .find((checkbox) => checkbox.getAttribute('aria-label') === `Enable ${property}`)
          ?.focus({preventScroll: true});
      } catch (cause) {
        sync();
        showError(cause instanceof Error ? cause.message : 'Unable to toggle this rule.');
      }
    });
    const apply = (value: unknown, gesture?: symbol) => {
      if (!isCurrent() || edits.entries.get(editKey)?.disabled) return;
      try {
        edits.set(target, value, gesture);
        current = evaluatedValue(
          map,
          layer.id,
          section,
          property,
          this.picked?.feature ?? this.samples.features[this.sampleIndex],
        );
        input.value = format(current ?? value);
        showError();
        sync();
        this.dirty = true;
        this.options.edited();
      } catch (cause) {
        showError(cause instanceof Error ? cause.message : 'Unable to preview this value.');
      }
    };
    if (spec.type === 'color') {
      swatch = el('input');
      swatch.type = 'color';
      swatch.setAttribute('aria-label', `Color for ${property}`);
      this.ruleCleanups.push(
        bindLiveColorInput(
          swatch,
          (hex, gesture) => {
            const alpha = typeof current === 'string' ? (Color.parse(current)?.a ?? 1) : 1;
            const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
            apply(alpha < 1 ? `rgba(${channels.join(',')},${alpha})` : hex, gesture);
          },
          isCurrent,
        ),
      );
      controls.append(swatch);
    }
    const commit = () => {
      if (input.value === format(current)) return;
      try {
        const text = input.value.trim();
        const value: unknown =
          spec.type === 'number' ||
          spec.type === 'boolean' ||
          spec.type === 'array' ||
          text.startsWith('[')
            ? JSON.parse(text)
            : input.value;
        if (spec.type === 'array' && !Array.isArray(value)) throw new Error('Enter a JSON array.');
        apply(value);
      } catch {
        showError('Enter a valid value or JSON expression.');
      }
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter') {
        event.preventDefault();
        commit();
      }
      if (key === 'Escape') {
        event.stopPropagation();
        input.value = format(current);
        showError();
        input.blur();
      }
    });
    const reset = action(
      '↶',
      () => {
        if (!isCurrent()) return;
        try {
          edits.remove(editKey);
          this.dirty = true;
          this.options.edited();
          this.refresh();
          this.renderDetail(true);
        } catch (cause) {
          showError(cause instanceof Error ? cause.message : 'Unable to restore this rule.');
        }
      },
      'dt-layer-rule-reset',
    );
    reset.title = 'Restore original rule';
    reset.setAttribute('aria-label', `Reset ${property}`);
    sync();
    controls.append(input);
    if (spec.type === 'enum') {
      input.hidden = true;
      const choices = el('div', 'dt-rule-choices');
      for (const value of Object.keys(spec.values)) {
        const choice = action(value, () => {
          apply(value);
          for (const b of choices.children)
            b.setAttribute('aria-pressed', String(b.textContent === current));
        });
        choice.setAttribute('aria-pressed', String(current === value));
        choice.disabled = input.disabled;
        choices.append(choice);
      }
      controls.append(choices);
    } else if (spec.type === 'boolean') {
      input.hidden = true;
      const toggle = el('input');
      toggle.type = 'checkbox';
      toggle.setAttribute('role', 'switch');
      toggle.checked = current === true;
      toggle.disabled = input.disabled;
      toggle.setAttribute('aria-label', property);
      toggle.addEventListener('change', () => apply(toggle.checked));
      controls.append(toggle);
    } else if (spec.type === 'number') {
      const range = el('input');
      range.type = 'range';
      range.min = String(spec.minimum ?? Math.min(0, Number(current) || 0));
      range.max = String(spec.maximum ?? Math.max(4, (Number(current) || 1) * 2));
      range.step = '0.05';
      range.value = String(current ?? 0);
      range.disabled = input.disabled;
      range.setAttribute('aria-label', `Adjust ${property}`);
      this.ruleCleanups.push(
        bindLiveColorInput(range, (value, gesture) => apply(Number(value), gesture), isCurrent),
      );
      controls.append(range);
    }
    controls.append(reset);
    cell.append(controls, error);
  }
  private renderData(layer: LayerRecord) {
    const toolbar = el('div', 'dt-tools');
    toolbar.append(
      action('Refresh samples', () => {
        this.cache.clear();
        this.samples = pending();
        this.measurementDirty = true;
        this.renderDetail(true);
        this.scheduleMeasurement();
      }),
    );
    this.content.append(toolbar, el('p', 'dt-note', this.samples.reason));
    if (this.picked)
      this.section('Picked feature', {
        coordinate: this.picked.coordinate,
        id: this.picked.feature.id,
        geometryType: this.picked.feature.geometry.type,
        properties: this.picked.feature.properties,
      });
    if (this.samples.status === 'ready')
      this.content.append(
        el(
          'p',
          'dt-layer-data-summary',
          `${this.samples.total} returned fragments · ${this.samples.features.length} retained`,
        ),
      );
    const table = el('table', 'dt-layer-rules'),
      body = el('tbody');
    this.samples.features.forEach((feature, index) => {
      const row = el('tr');
      row.dataset.selected = String(this.sampleIndex === index);
      const name = String(
        feature.properties?.name ??
          feature.properties?.class ??
          feature.id ??
          `Fragment ${index + 1}`,
      );
      const cell = el('td');
      const button = action(
        name,
        () => {
          this.sampleIndex = index;
          this.picked = undefined;
          this.renderDetail(true);
          this.highlight.show(this.map!, [feature]);
        },
        'dt-layer-link',
      );
      button.title = `Sample ${index + 1} · ${feature.geometry.type}`;
      cell.append(button);
      const inspect = el('td');
      inspect.append(
        action('Use for rules ↗', () => this.inspectFeature(feature), 'dt-layer-link'),
      );
      row.append(cell, el('td', '', feature.geometry.type), inspect);
      body.append(row);
    });
    table.append(body);
    const samples = el('div', 'dt-layer-samples');
    samples.append(table);
    this.content.append(samples);
    const feature = this.samples.features[this.sampleIndex];
    if (feature)
      this.section(`Sample ${this.sampleIndex + 1} properties`, {
        id: feature.id,
        source: feature.source,
        sourceLayer: feature.sourceLayer,
        properties: feature.properties,
      });
    if (layer.source) {
      const source = this.map!.getStyle().sources[layer.source];
      this.section(
        `Source · ${layer.source}${layer.sourceLayer ? ` / ${layer.sourceLayer}` : ''}`,
        source
          ? Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'data'))
          : 'Source not present',
      );
    }
  }
  private inspectFeature(feature: MapGeoJSONFeature) {
    const center = this.map!.getCenter();
    let coordinate: unknown =
      'coordinates' in feature.geometry ? feature.geometry.coordinates : undefined;
    while (Array.isArray(coordinate) && Array.isArray(coordinate[0])) coordinate = coordinate[0];
    const point: [number, number] =
      Array.isArray(coordinate) &&
      typeof coordinate[0] === 'number' &&
      typeof coordinate[1] === 'number'
        ? [coordinate[0], coordinate[1]]
        : [center.lng, center.lat];
    this.side?.inspectRenderedFeature?.(feature, point);
  }
  private renderOrigin(layer: LayerRecord) {
    if (!layer.contributions.length)
      this.content.append(
        el(
          'p',
          'dt-note',
          layer.type === 'custom'
            ? 'Runtime layer. No compiler contribution is attached to this layer.'
            : 'Unattributed. No matching compiler sidecar contribution is available.',
        ),
      );
    for (const contribution of layer.contributions) {
      const card = el('section', 'dt-layer-origin');
      card.append(el('strong', '', contribution.owner), el('code', '', contribution.target));
      const dl = el('dl');
      for (const [name, value] of [
        ['Slot', contribution.slot ?? 'Not provided'],
        [
          'Authoring paths',
          [
            ...new Set([
              `modules.${contribution.owner}`,
              ...(contribution.authoringPaths ?? []),
              ...(contribution.operations?.length
                ? [`modules.${contribution.owner}.renderStack`]
                : []),
            ]),
          ].join(', '),
        ],
        [
          'Theme tokens',
          contribution.themeTokens?.join(', ') || 'Not provided; not inferred from colors',
        ],
      ])
        dl.append(el('dt', '', name), el('dd', '', value));
      card.append(dl);
      if (contribution.operations?.length)
        card.append(el('pre', 'dt-layer-json', json(contribution.operations)));
      this.content.append(card);
    }
    this.content.append(
      el(
        'p',
        'dt-note',
        'These are semantic owners and compiler operations, not exact file or line locations. Shared physical layers retain all contributions.',
      ),
    );
    if (layer.runtime) this.section('Runtime capability', layer.runtime);
  }
  private section(title: string, value: unknown) {
    const section = el('section', 'dt-layer-section');
    section.append(el('h4', '', title), el('pre', 'dt-layer-json', json(value)));
    this.content.append(section);
  }
  context(): Record<string, unknown> | undefined {
    if (!this.active || !this.map || !this.side || !this.selectedId) return undefined;
    try {
      this.refresh();
      const temporary = this.options.temporary(this.side);
      const key = JSON.stringify([
        this.key,
        this.cameraKey,
        this.selectedId,
        this.samples.measuredAt,
        this.sampleIndex,
        this.measurementDirty,
        temporary,
        this.side.runtimeErrors,
        this.picked?.at,
      ]);
      if (key !== this.contextKey) {
        this.contextKey = key;
        this.cachedContext = {
          ...layerContext(
            this.side,
            this.selectedId,
            this.layers,
            this.measurementDirty ? pending() : this.samples,
            this.history,
            temporary,
            '',
            this.sampleIndex,
            this.picked,
          ),
          capturedAt: this.observedAt,
        };
      }
      return this.cachedContext;
    } catch {
      return undefined;
    }
  }
  openContext() {
    const context = structuredClone(this.context());
    if (!context) {
      this.options.report('The map is updating. Try copying context once it is ready.');
      return;
    }
    this.dialog?.remove();
    const dialog = el('dialog', 'dt-layer-dialog');
    this.dialog = dialog;
    dialog.setAttribute('aria-label', 'Layer context preview');
    const head = el('div', 'dt-layer-dialog-head');
    head.append(
      el('strong', '', 'Copy layer context'),
      action('Close', () => dialog.close()),
    );
    const label = el('label', '', 'Investigation (optional)');
    const question = el('input');
    question.placeholder = 'What should your agent investigate?';
    question.maxLength = 1200;
    label.append(question);
    const preview = el('textarea');
    preview.readOnly = true;
    preview.setAttribute('aria-label', 'Context preview');
    preview.spellcheck = false;
    const tools = el('div', 'dt-tools');
    let format: 'Markdown' | 'JSON' = 'Markdown';
    const buttons = new Map<string, HTMLButtonElement>();
    const render = () => {
      context.investigation = question.value;
      preview.value =
        format === 'Markdown' ? contextMarkdown(context) : JSON.stringify(context, null, 2);
      for (const [name, button] of buttons)
        button.setAttribute('aria-pressed', String(name === format));
    };
    for (const name of ['Markdown', 'JSON'] as const) {
      const button = action(name, () => {
        format = name;
        render();
      });
      tools.append(button);
      buttons.set(name, button);
    }
    const status = el('span', 'dt-layer-muted', 'Snapshot frozen while this preview is open.');
    status.setAttribute('role', 'status');
    const copy = action(
      'Copy to clipboard',
      () => {
        void navigator.clipboard
          .writeText(preview.value)
          .then(() => {
            status.textContent = 'Copied. Paste this context into your agent.';
          })
          .catch(() => {
            preview.focus();
            preview.select();
            status.textContent = 'Clipboard unavailable. Copy the selected text manually.';
          });
      },
      'dt-layer-copy',
    );
    tools.append(copy);
    question.addEventListener('input', render);
    dialog.append(head, label, tools, preview, status);
    this.root.append(dialog);
    render();
    dialog.showModal();
  }
}
