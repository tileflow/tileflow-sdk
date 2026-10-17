import {Color} from '@maplibre/maplibre-gl-style-spec';
import type {MapGeoJSONFeature} from 'maplibre-gl';
import {AssetsPanel} from './assets';
import {BeaconPanel} from './beacon/panel';
import {moveCamera, readCamera} from './beacon/runner';
import {DebugPanel} from './debug';
import {GeometryEditor, geometryVertices} from './geometry';
import {safeContext} from './layers/model';
import {LayersPanel} from './layers/panel';
import {bindLiveColorInput} from './live-color';
import {mapValue} from './map-value';
import {OverdrawHeatmap} from './overdraw';
import {
  type EditTarget,
  evaluatedValue,
  propertiesFor,
  propertySpec,
  StyleEdits,
} from './style-edits';
import {TileDetailsPanel} from './tile-details';
import {tilePolygon, visibleTiles} from './tiles';
import type {DevtoolsHost, Dock, Panel, Side, TileRecord} from './types';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}
function button(text: string, action: () => void, className = '') {
  const result = element('button', className, text);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}
const paths: Record<string, string> = {
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clear: '<circle cx="12" cy="12" r="8"/><path d="m6 6 12 12"/>',
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7"/>',
  redo: '<path d="m16 5 5 5-5 5m5-5H11a7 7 0 0 0-7 7"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2.6 8.4M3 4v6h6"/>',
  bottom:
    '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 13h18"/><path d="M5 15h14v3H5z" fill="currentColor" stroke="none"/>',
  right:
    '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M14 4v16"/><path d="M16 6h3v12h-3z" fill="currentColor" stroke="none"/>',
  left: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M10 4v16"/><path d="M5 6h3v12H5z" fill="currentColor" stroke="none"/>',
  float:
    '<rect x="3" y="4" width="18" height="16" rx="1"/><rect x="8" y="9" width="10" height="8" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  inspect: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m4-10 8 4-5 1-1 5z"/>',
};
function icon(name: string, label: string, action: () => void) {
  const result = button('', action, 'dt-icon');
  result.title = label;
  result.setAttribute('aria-label', label);
  result.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  return result;
}
function format(value: unknown) {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '—');
}
function bytes(value?: number) {
  return value === undefined
    ? '—'
    : value < 1024
      ? `${value} B`
      : value < 1048576
        ? `${(value / 1024).toFixed(1)} kB`
        : `${(value / 1048576).toFixed(2)} MB`;
}
function nameOf(feature?: {properties?: Record<string, unknown>; layerId?: string}) {
  return String(
    feature?.properties?.name ||
      feature?.properties?.['name:en'] ||
      feature?.properties?.class ||
      feature?.layerId ||
      'Feature',
  );
}
function safe(action: () => void, report: (message: string) => void) {
  try {
    action();
  } catch (error) {
    report(error instanceof Error ? error.message : String(error));
  }
}

class Devtools {
  private workspace = document.querySelector<HTMLElement>('.workspace')!;
  private shell = element('section', 'dt-shell');
  private body = element('div', 'dt-body');
  private head = element('div', 'dt-head');
  private tabs = element('div', 'dt-tabs');
  private cameraControls = element('fieldset', 'dt-camera');
  private cameraFields: {
    key: 'zoom' | 'bearing' | 'pitch';
    input: HTMLInputElement;
    range?: HTMLInputElement;
  }[] = [];
  private initialCamera?: {
    map: NonNullable<Side['map']>;
    zoom: number;
    bearing: number;
    pitch: number;
  };
  private cameraFrame?: number;
  private historyPending = false;
  private theme: 'system' | 'light' | 'dark' = 'system';
  private menu = element('div', 'dt-menu');
  private panels = new Map<Panel, HTMLElement>();
  private tabButtons = new Map<Panel, HTMLButtonElement>();
  private activePanel: Panel = 'layers';
  private dock: Dock = 'right';
  private layout = {height: 440, width: 760};
  private selectedLayer?: {side: Side; id: string};
  private inspectHoverSide?: Side;
  private inspectedKey = '';
  private subtab = 'Styles';
  private scope: 'feature' | 'layer' = 'feature';
  private filter = '';
  private edits = new Map<string, StyleEdits>();
  private geometries = new Map<string, GeometryEditor>();
  private tree = element('div', 'dt-tree');
  private detail = element('div', 'dt-scroll');
  private scopeSelect = element('select');
  private curve = element('div', 'dt-zoom');
  private notice = document.getElementById('wb-notice')!;
  private noticeStore = element('div');
  private undoButton = icon('undo', 'Undo', () => this.changeHistory('undo'));
  private redoButton = icon('redo', 'Redo', () => this.changeHistory('redo'));
  private resetChangesButton = button('Reset all changes', () => this.resetAll());
  private message = element('div', 'dt-status-message');
  private networkFilter = '';
  private networkSidebar = element('div', 'dt-tiles-sidebar');
  private networkGrid = element('div', 'dt-tiles-grid-wrap');
  private networkLog = element('div', 'dt-scroll');
  private networkDetail = element('div', 'dt-network-detail');
  private networkBody = element('div', 'dt-network-body');
  private tileDetails = new TileDetailsPanel(
    this.networkDetail,
    () => {
      this.clearTileHighlight();
      this.renderNetwork();
    },
    (id) => {
      this.show('layers');
      this.layers.reveal(this.host.active(), id);
    },
    () => {
      if (this.networkTile) this.showTile(this.host.active(), this.networkTile);
    },
  );
  private networkSummary = element('div', 'dt-footer');
  private networkKey = '';
  private sideMaps = new Map<string, Side['map']>();
  private networkSelection?: string;
  private networkTile?: TileRecord;
  private tileHighlight?: {side: Side; map: NonNullable<Side['map']>; epoch: number; id: string};
  private debug!: DebugPanel;
  private overdraw = new OverdrawHeatmap();
  private layers!: LayersPanel;
  private beacon!: BeaconPanel;
  private assets!: AssetsPanel;
  private timer?: ReturnType<typeof setInterval>;
  private resizeObserver?: ResizeObserver;
  private disposed = false;
  private colorInputCleanups: (() => void)[] = [];

  constructor(private host: DevtoolsHost) {
    document.body.classList.add('devtools-ready');
    this.shell.setAttribute('aria-label', 'Map developer tools');
    this.restoreLayout();
    this.buildShell();
    this.buildInspect();
    this.layers = new LayersPanel(this.panels.get('layers')!, {
      host: this.host,
      network: (source) => {
        this.networkFilter = source;
        this.show('network');
      },
      assets: (category, filter) => {
        this.show('assets');
        this.assets.reveal(category, filter);
      },
      temporary: (side) => ({
        styleEdits: [...(this.edits.get(side.id)?.entries.values() ?? [])],
        geometryEdited: this.geometries.has(side.id),
      }),
      editor: (side) => this.editor(side),
      edited: () => this.syncHistoryControls(),
      report: this.report,
    });
    this.buildNetwork();
    this.buildScene();
    this.assets = new AssetsPanel(
      this.panels.get('assets')!,
      () => this.host.active(),
      (id) => {
        this.show('layers');
        this.layers.reveal(this.host.active(), id);
      },
    );
    this.buildPerformance();
    this.beacon = new BeaconPanel(this.panels.get('beacon')!, {
      active: () => this.host.active(),
      beforeRun: () => {
        this.stopPerformance();
        this.host.inspect(false);
        this.clearTileHighlight();
      },
      network: () => this.show('network'),
      overlay: (kind) => {
        this.show('performance');
        this.debug.setOverlay(
          kind === 'overdraw' ? 'showOverdrawInspector' : 'showCollisionBoxes',
          true,
        );
      },
      reveal: (side, finding) =>
        this.guarded(() => {
          if (!side.map || !finding.layer || !side.map.getLayer(finding.layer)) return;
          if (finding.camera) moveCamera(side.map, finding.camera);
          this.selectedLayer = {side, id: finding.layer};
          this.scope = 'layer';
          this.subtab = 'Styles';
          this.filter = '';
          this.show('layers');
          this.layers.reveal(side, finding.layer);
          const map = side.map,
            epoch = side.loadEpoch;
          requestAnimationFrame(() => {
            if (side.map !== map || side.loadEpoch !== epoch || !finding.coordinate) return;
            const feature = map
              .queryRenderedFeatures(undefined, {layers: [finding.layer!]})
              .find((feature) =>
                finding.featureId !== undefined
                  ? feature.id === finding.featureId
                  : feature.geometry.type === 'Point' &&
                    Math.abs(feature.geometry.coordinates[0] - finding.coordinate![0]) < 1e-6 &&
                    Math.abs(feature.geometry.coordinates[1] - finding.coordinate![1]) < 1e-6,
              );
            if (feature && side.inspectRenderedFeature) {
              this.scope = feature.id === undefined ? 'layer' : 'feature';
              side.inspectRenderedFeature(feature, finding.coordinate);
            }
          });
          this.report(`Beacon · ${finding.message}`);
        }),
    });
    this.workspace.append(this.shell);
    this.applyLayout();
    window.__tileflowDevtoolsUI = {
      show: (panel) => this.show(panel),
      feedback: this.report,
      selectionChanged: () => this.selectionChanged(),
      inspectionChanged: () => {
        if (this.host.inspecting()) this.show('layers');
      },
      controls: (open) => {
        if (open) this.show('scene');
      },
      hasChanges: (side) =>
        Boolean(this.edits.get(side.id)?.entries.size || this.geometries.has(side.id)),
      layerContext: () => this.layers.context(),
    };
    const oldInspector = document.getElementById('inspector')!;
    oldInspector.hidden = true;
    this.resizeObserver = new ResizeObserver(() => {
      for (const side of host.sides()) side.map?.resize();
    });
    this.resizeObserver.observe(document.getElementById('stage')!);
    this.timer = setInterval(() => this.tick(), 600);
    addEventListener('pagehide', () => this.dispose(), {once: true});
    addEventListener('keydown', this.keydown);
    addEventListener('resize', this.resizeWindow);
    const requested = new URL(location.href).searchParams.get('tab') ?? '';
    const panel =
      ({map: 'scene', tiles: 'network', debug: 'performance'} as Record<string, Panel>)[
        requested
      ] ?? (requested as Panel);
    this.show(panel && this.panels.has(panel) ? panel : 'layers');
    this.tick();
  }
  private report = (text: string) => {
    this.message.hidden = !text;
    this.message.textContent = text;
  };
  private guarded = (action: () => void) => safe(action, this.report);
  private buildShell() {
    const inspect = document.getElementById('inspect-toggle')!;
    inspect.className = 'dt-icon';
    inspect.innerHTML = icon('inspect', '', () => {}).innerHTML;
    inspect.setAttribute('aria-label', 'Select a map element (I)');
    const divider = element('span', 'dt-divider');
    this.tabs.setAttribute('role', 'tablist');
    this.tabs.setAttribute('aria-label', 'Developer tools');
    for (const [id, label] of Object.entries({
      inspect: 'Inspect',
      scene: 'Map',
      layers: 'Layers',
      network: 'Tiles',
      assets: 'Assets',
      performance: 'Debug',
      beacon: 'Beacon',
    })) {
      const panel = element('section', 'dt-panel');
      panel.id = `dt-panel-${id}`;
      panel.hidden = true;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `dt-tab-${id}`);
      const tab = button(label, () => {
        this.show(id as Panel);
      });

      tab.id = `dt-tab-${id}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      if (id !== 'inspect') this.tabButtons.set(id as Panel, tab);
      this.panels.set(id as Panel, panel);
      if (id !== 'inspect') this.tabs.append(tab);
      this.body.append(panel);
    }
    this.tabs.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const keys = [...this.tabButtons.keys()];
      const index = keys.indexOf(this.activePanel);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? keys.length - 1
            : (index + (event.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length;
      this.show(keys[next]);
      this.tabButtons.get(keys[next])!.focus();
    });
    const more = icon('more', 'Customize and control DevTools', () => {
      this.menu.hidden = !this.menu.hidden;
      more.setAttribute('aria-expanded', String(!this.menu.hidden));
    });
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'dt-menu');
    this.menu.id = 'dt-menu';
    this.menu.hidden = true;
    this.menu.append(element('div', 'dt-menu-label', 'Dock side'));
    const choices = element('div', 'dt-dock-options');
    for (const placement of ['left', 'bottom', 'right'] as Dock[]) {
      const choice = icon(placement, `Dock to ${placement}`, () => {
        this.dock = placement;
        this.applyLayout();
        this.saveLayout();
        this.menu.hidden = true;
        more.setAttribute('aria-expanded', 'false');
      });
      choice.dataset.dockOption = placement;
      choices.append(choice);
    }
    this.resetChangesButton.addEventListener('click', () => {
      this.menu.hidden = true;
      more.setAttribute('aria-expanded', 'false');
      more.focus();
    });
    const themes = element('div', 'dt-segments');
    try {
      const saved = localStorage.getItem('tileflow-devtools-theme');
      if (saved === 'light' || saved === 'dark') this.theme = saved;
    } catch {}
    const applyTheme = () => {
      document.body.dataset.inspectorTheme = this.theme;
      for (const b of themes.querySelectorAll<HTMLButtonElement>('button'))
        b.setAttribute('aria-pressed', String(b.dataset.theme === this.theme));
      try {
        localStorage.setItem('tileflow-devtools-theme', this.theme);
      } catch {}
    };
    for (const value of ['system', 'light', 'dark'] as const) {
      const b = button(value[0].toUpperCase() + value.slice(1), () => {
        this.theme = value;
        applyTheme();
      });
      b.dataset.theme = value;
      themes.append(b);
    }
    applyTheme();
    this.menu.append(
      choices,
      element('div', 'dt-menu-label', 'Theme'),
      themes,
      element('hr'),
      button('Restore default layout', () => {
        this.dock = 'bottom';
        this.layout = {height: 440, width: 760};
        this.applyLayout();
        this.saveLayout();
        this.menu.hidden = true;
        more.setAttribute('aria-expanded', 'false');
      }),
      element('hr'),
      this.resetChangesButton,
    );
    this.undoButton.title = 'Undo last preview change (Ctrl/⌘Z)';
    this.redoButton.title = 'Redo preview change (Ctrl/⌘Shift+Z)';
    this.syncHistoryControls();
    const navigation = element('div', 'dt-head-main');
    this.buildCameraControls();
    navigation.append(this.tabs);
    this.head.append(
      inspect,
      divider,
      navigation,
      this.undoButton,
      this.redoButton,
      more,
      icon('close', 'Close DevTools', () => {
        this.clearInspectHover();
        this.cancelColorPreviews();
        this.beacon?.cancel();
        this.layers?.cancel();
        this.workspace.dataset.collapsed = 'true';
        this.host.inspect(false);
      }),
    );
    const resize = element('div', 'dt-resize');
    resize.tabIndex = 0;
    resize.setAttribute('role', 'separator');
    resize.setAttribute('aria-label', 'Resize developer tools');
    this.installResize(resize);
    this.message.hidden = true;
    this.message.setAttribute('role', 'status');
    this.noticeStore.hidden = true;
    this.noticeStore.append(this.notice);
    this.shell.append(
      resize,
      this.head,
      this.cameraControls,
      this.menu,
      this.body,
      this.message,
      this.noticeStore,
    );
    const reopen = button('DevTools', () => this.show(this.activePanel));
    reopen.id = 'dt-reopen';
    reopen.setAttribute('aria-label', 'Open developer tools');
    this.workspace.append(reopen);
  }
  show(panel: Panel) {
    // Old links and picker integrations resolve to the unified layer inspector.
    if (panel === 'inspect') panel = 'layers';
    if (!this.panels.has(panel)) return;
    this.clearInspectHover();
    this.cancelColorPreviews();
    this.workspace.dataset.collapsed = 'false';
    this.activePanel = panel;
    const url = new URL(location.href);
    const publicTab =
      ({scene: 'map', network: 'tiles', performance: 'debug'} as Partial<Record<Panel, string>>)[
        panel
      ] ?? panel;
    if (url.searchParams.get('tab') !== publicTab) {
      url.searchParams.set('tab', publicTab);
      history.replaceState(history.state, '', url.href);
    }
    for (const [id, node] of this.panels) node.hidden = id !== panel;
    for (const [id, node] of this.tabButtons) {
      node.setAttribute('aria-selected', String(id === panel));
      node.tabIndex = id === panel ? 0 : -1;
    }
    document.getElementById('map-controls')!.hidden = panel !== 'scene';
    if (panel === 'scene') void this.host.controls();
    if (panel === 'layers') this.layers.show();
    else this.layers.cancel();
    if (panel === 'network') {
      this.networkKey = '';
      this.renderNetwork();
    }
    if (panel === 'performance') this.renderPerformance();
    if (panel === 'assets') this.assets.show();
    else this.assets.cancel();
    if (panel === 'beacon') this.beacon.refresh();
    else this.beacon?.cancel();
  }
  private restoreLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem('tileflow-devtools-layout-v1') || 'null');
      if (saved && ['bottom', 'left', 'right'].includes(saved.dock)) {
        this.dock = saved.dock;
        for (const key of Object.keys(this.layout) as (keyof typeof this.layout)[])
          if (Number.isFinite(saved[key])) this.layout[key] = saved[key];
      }
    } catch {}
  }
  private saveLayout() {
    try {
      localStorage.setItem(
        'tileflow-devtools-layout-v1',
        JSON.stringify({dock: this.dock, ...this.layout}),
      );
    } catch {}
  }
  private resizeWindow = () => this.applyLayout();
  private applyLayout() {
    const w = this.workspace.clientWidth || innerWidth,
      h = this.workspace.clientHeight || innerHeight;
    this.layout.width = Math.max(640, Math.min(this.layout.width, Math.max(640, w - 240)));
    this.layout.height = Math.max(180, Math.min(this.layout.height, Math.max(180, h - 160)));
    this.workspace.dataset.dock = this.dock;
    for (const [key, value] of Object.entries(this.layout))
      this.workspace.style.setProperty(
        '--dt-' + key.replace(/[A-Z]/gu, (c) => '-' + c.toLowerCase()),
        value + 'px',
      );
    for (const b of this.menu.querySelectorAll<HTMLElement>('[data-dock-option]'))
      b.setAttribute('aria-pressed', String(b.dataset.dockOption === this.dock));
    const resize = this.shell.querySelector('.dt-resize');
    resize?.setAttribute(
      'aria-orientation',
      this.dock === 'left' || this.dock === 'right' ? 'vertical' : 'horizontal',
    );
  }
  private installResize(handle: HTMLElement) {
    handle.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 20 : -20;
      if (this.dock === 'bottom') this.layout.height -= delta;
      else this.layout.width += this.dock === 'left' ? delta : -delta;
      this.applyLayout();
      this.saveLayout();
    });
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const initial = {...this.layout},
        x = event.clientX,
        y = event.clientY;
      this.pointerGesture(
        event,
        (e) => {
          const dx = e.clientX - x,
            dy = e.clientY - y;
          if (this.dock === 'bottom') this.layout.height = initial.height - dy;
          else this.layout.width = initial.width + (this.dock === 'left' ? dx : -dx);
          this.applyLayout();
        },
        () => this.saveLayout(),
      );
    });
  }
  private pointerGesture(
    event: PointerEvent,
    move: (event: PointerEvent) => void,
    end: () => void,
  ) {
    const shield = element('div', 'dt-resize-shield');
    this.workspace.append(shield);
    const owner = event.currentTarget as HTMLElement;
    owner.setPointerCapture(event.pointerId);
    const finish = () => {
      owner.removeEventListener('pointermove', move);
      owner.removeEventListener('pointerup', finish);
      owner.removeEventListener('pointercancel', finish);
      shield.remove();
      end();
    };
    owner.addEventListener('pointermove', move);
    owner.addEventListener('pointerup', finish);
    owner.addEventListener('pointercancel', finish);
  }
  private keydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.closest('input,select,textarea,[contenteditable]')) return;
    if (event.key === 'Escape') {
      this.menu.hidden = true;
      this.head.querySelector('[aria-controls="dt-menu"]')?.setAttribute('aria-expanded', 'false');
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.changeHistory(event.shiftKey ? 'redo' : 'undo');
    }
  };
  private buildInspect() {
    const grid = element('div', 'dt-inspect-grid'),
      treeColumn = element('div', 'dt-tree-column'),
      details = element('div', 'dt-details');
    this.curve.append(
      document.getElementById('curve-property')!,
      document.getElementById('curve-output')!,
    );
    treeColumn.append(this.tree);
    const sub = element('div', 'dt-subtabs');
    sub.setAttribute('role', 'tablist');
    sub.setAttribute('aria-label', 'Selected element details');
    for (const label of ['Styles', 'Properties', 'Geometry', 'Origin', 'Zoom']) {
      const b = button(label, () => {
        this.subtab = label;
        for (const item of sub.children) item.setAttribute('aria-selected', String(item === b));
        this.renderDetails();
      });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(label === this.subtab));
      sub.append(b);
    }
    const tools = element('div', 'dt-tools');
    const search = element('input');
    search.type = 'search';
    search.placeholder = 'Filter';
    search.setAttribute('aria-label', 'Filter properties');
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.renderDetails();
    });
    this.scopeSelect.setAttribute('aria-label', 'Edit scope');
    this.scopeSelect.append(
      new Option('Selected feature', 'feature'),
      new Option('Entire layer', 'layer'),
    );
    this.scopeSelect.addEventListener('change', () => {
      this.scope = this.scopeSelect.value as 'feature' | 'layer';
      this.renderDetails();
    });
    tools.append(search, this.scopeSelect);
    details.append(sub, tools, this.detail);
    grid.append(treeColumn, details);
    this.panels.get('inspect')!.append(grid);
  }
  selectionChanged() {
    this.selectedLayer = undefined;
    const selection = this.host.selection(),
      feature = selection?.features[selection.featureIndex],
      raw = selection?.side.getInspectedFeature?.();
    this.show('layers');
    if (selection && feature)
      this.layers.reveal(selection.side, feature.layerId, raw, selection.coordinate);
    else this.report('No rendered feature at this point.');
    const key = JSON.stringify([
      selection?.side.id,
      selection?.side.loadEpoch,
      feature?.layerId,
      feature?.id,
    ]);
    if (key !== this.inspectedKey) {
      this.inspectedKey = key;
      this.scope = feature?.id === null || feature?.id === undefined ? 'layer' : 'feature';
    }
    this.renderInspect();
  }
  private target() {
    const selection = this.host.selection();
    const side = this.selectedLayer?.side || selection?.side || this.host.active();
    const selected = !this.selectedLayer ? selection?.features[selection.featureIndex] : undefined;
    const layerId = this.selectedLayer?.id || selected?.layerId;
    const map = side.map,
      layer = map?.getStyle()?.layers.find((item) => item.id === layerId);
    const raw = selected ? side.getInspectedFeature?.() : undefined;
    return {side, map, layer, selected, raw};
  }
  private clearInspectHover() {
    this.inspectHoverSide?.hoverFeature?.(-1);
    this.inspectHoverSide = undefined;
  }
  private renderInspect() {
    this.clearInspectHover();
    this.tree.replaceChildren();
    const selection = this.host.selection(),
      {side, layer} = this.target();
    if (selection?.features.length && !this.selectedLayer) {
      const source = element('div', 'dt-tree-row');
      source.append(
        element('span', 'dt-dim', '▾'),
        element('span', 'dt-token', 'rendered-features'),
        element('span', 'dt-dim', `(${selection.features.length})`),
      );
      this.tree.append(source);
      selection.features.forEach((feature, index) => {
        const row = button('', () => this.host.selectFeature(index), 'dt-tree-row');
        const preview = () => {
          this.clearInspectHover();
          this.inspectHoverSide = side;
          side.hoverFeature?.(index);
        };
        row.addEventListener('pointerenter', preview);
        row.addEventListener('pointerleave', () => this.clearInspectHover());
        row.addEventListener('focus', preview);
        row.addEventListener('blur', () => this.clearInspectHover());
        row.style.paddingLeft = '20px';
        row.setAttribute('aria-selected', String(index === selection.featureIndex));
        row.title = `${feature.layerId} · ${feature.geometryType} · ${feature.id ?? 'no feature ID'}`;
        row.append(
          element('span', 'dt-dim', '›'),
          element('span', 'dt-token', feature.geometryType),
          element('span', 'dt-attr', `"${nameOf(feature)}"`),
          element('span', 'dt-dim dt-truncate', feature.layerId),
        );
        this.tree.append(row);
      });
    } else if (layer) {
      const row = element('div', 'dt-tree-row');
      row.setAttribute('aria-selected', 'true');
      row.append(element('span', 'dt-token', layer.type), element('span', 'dt-attr', layer.id));
      this.tree.append(row);
    } else
      this.tree.append(
        element(
          'div',
          'dt-empty',
          'Select an element in the map to inspect its styles, data and geometry.',
        ),
      );
    this.renderDetails();
  }
  private cancelColorPreviews() {
    for (const cleanup of this.colorInputCleanups) cleanup();
    this.colorInputCleanups = [];
  }
  private renderDetails() {
    this.cancelColorPreviews();
    this.detail.replaceChildren();
    const {side, map, layer, selected, raw} = this.target();
    const featureAvailable = selected?.id !== null && selected?.id !== undefined;
    this.scopeSelect.options[0].disabled = !featureAvailable;
    if (!featureAvailable) this.scope = 'layer';
    this.scopeSelect.value = this.scope;
    this.scopeSelect.hidden = this.subtab !== 'Styles';
    if (!map || !layer) {
      this.detail.append(element('div', 'dt-empty', 'Select a rendered element or a layer.'));
      return;
    }
    if (this.subtab === 'Zoom') {
      this.detail.append(
        this.selectedLayer
          ? element('p', 'dt-note', 'Pick a rendered feature to explore its zoom curves.')
          : this.curve,
      );
      return;
    }
    if (this.subtab === 'Properties') {
      const props = raw?.properties || selected?.properties || {};
      this.detail.append(this.keyValues(props, this.filter));
      return;
    }
    if (this.subtab === 'Geometry') {
      this.renderGeometry(side, raw);
      return;
    }
    if (this.subtab === 'Origin') {
      const owners = side.sidecar?.layers.find((item) => item.id === layer.id)?.contributions || [];
      this.detail.append(
        this.keyValues(
          {
            layer: layer.id,
            type: layer.type,
            source: 'source' in layer ? layer.source : '—',
            sourceLayer: 'source-layer' in layer ? layer['source-layer'] : '—',
            featureId: selected?.id ?? 'Unavailable',
            minzoom: layer.minzoom ?? 0,
            maxzoom: layer.maxzoom ?? 24,
            filter: 'filter' in layer ? layer.filter : undefined,
            generation: side.artifactGeneration,
            modules: [...new Set(owners.map((item) => item.owner))],
            targets: [...new Set(owners.map((item) => item.target))],
          },
          this.filter,
        ),
      );
      this.detail.append(
        element(
          'p',
          'dt-note',
          'Compiler attribution identifies semantic owners; exact source lines are not available.',
        ),
      );
      this.detail.append(
        button('Show source tiles', () => {
          this.networkFilter = 'source' in layer ? layer.source : '';
          this.show('network');
        }),
      );
      return;
    }
    const edits = this.editor(side);
    for (const section of ['paint', 'layout'] as const) {
      const authored = (layer as unknown as Record<string, Record<string, unknown>>)[section] || {};
      const specs = propertiesFor(layer.type, section);
      const priority: Record<string, string[]> = {
        fill: ['fill-color', 'fill-opacity', 'fill-outline-color'],
        line: ['line-color', 'line-width', 'line-opacity', 'line-gap-width'],
        symbol:
          section === 'paint'
            ? ['text-color', 'text-halo-color', 'text-halo-width', 'icon-color', 'icon-opacity']
            : ['text-size', 'icon-size', 'text-field', 'icon-image'],
        circle: [
          'circle-color',
          'circle-radius',
          'circle-opacity',
          'circle-stroke-color',
          'circle-stroke-width',
        ],
        'fill-extrusion': [
          'fill-extrusion-color',
          'fill-extrusion-height',
          'fill-extrusion-base',
          'fill-extrusion-opacity',
        ],
      };
      const names = [
        ...new Set([
          ...(priority[layer.type] || []).filter((name) => specs[name]),
          ...Object.keys(authored),
          ...(section === 'layout' ? ['visibility'] : []),
        ]),
      ].filter((name) => name.toLowerCase().includes(this.filter.toLowerCase()));
      const rule = element('div', 'dt-rule'),
        title = element('div', 'dt-rule-title');
      title.append(
        element('span', '', section + ' {'),
        element(
          'span',
          'dt-rule-origin',
          this.scope === 'feature' ? `feature #${selected?.id}` : layer.id,
        ),
      );
      rule.append(title);
      for (const property of names) {
        const spec = propertySpec(layer.type, section, property);
        if (!spec) continue;
        const target: EditTarget = {
          layer: layer.id,
          section,
          property,
          ...(this.scope === 'feature' ? {featureId: selected!.id!} : {}),
        };
        const existing = edits.entries.get(edits.key(target));
        const evaluated = evaluatedValue(map, layer.id, section, property, raw);
        let current =
          existing?.value ??
          (Array.isArray(authored[property]) ? evaluated : authored[property]) ??
          spec.default;
        const row = element('div', 'dt-property');
        row.dataset.modified = String(Boolean(existing));
        row.append(element('span', 'dt-property-name', property + ':'));
        const individualAllowed =
          this.scope !== 'feature' || Boolean(spec.expression?.parameters.includes('feature'));
        const apply = (value: unknown) =>
          this.guarded(() => {
            edits.set(target, value);
            this.report('');
            this.syncHistoryControls();
            this.renderDetails();
          });
        if (spec.type === 'color' && typeof current === 'string') {
          const parsed = Color.parse(current);
          if (parsed) {
            const swatch = element('input');
            swatch.type = 'color';
            swatch.setAttribute('aria-label', `Color for ${property}`);
            const alpha = parsed.a;
            swatch.value =
              '#' +
              [parsed.r, parsed.g, parsed.b]
                .map((n) =>
                  Math.round((alpha ? n / alpha : 0) * 255)
                    .toString(16)
                    .padStart(2, '0'),
                )
                .join('');
            swatch.disabled = !individualAllowed;
            const epoch = side.loadEpoch;
            this.colorInputCleanups.push(
              bindLiveColorInput(
                swatch,
                (color, gesture) =>
                  this.guarded(() => {
                    edits.set(target, color, gesture);
                    current = color;
                    input.value = color;
                    row.dataset.modified = 'true';
                    revert.disabled = false;
                    this.report('');
                    this.syncHistoryControls();
                  }),
                () =>
                  !this.disposed &&
                  swatch.isConnected &&
                  side.map === map &&
                  side.loadEpoch === epoch &&
                  Boolean(map.getLayer(target.layer)),
              ),
            );
            row.append(swatch);
          }
        }
        const input = spec.type === 'enum' ? element('select') : element('input');
        if (input instanceof HTMLSelectElement) {
          for (const value of Object.keys(spec.type === 'enum' ? spec.values : {}))
            input.append(new Option(value, value));
        } else input.type = 'text';
        input.value = format(current);
        input.disabled = !individualAllowed;
        input.setAttribute('aria-label', property);
        input.title = individualAllowed
          ? `Temporary ${this.scope} override`
          : 'Choose Entire layer to edit this property';
        const commit = () => {
          if (input.value === format(current)) return;
          let value: unknown = input.value;
          try {
            if (
              spec.type === 'number' ||
              spec.type === 'boolean' ||
              input.value.trim().startsWith('[')
            )
              value = JSON.parse(input.value);
          } catch {
            this.report('Enter a valid value or JSON expression.');
            return;
          }
          apply(value);
        };
        input.addEventListener('change', commit);
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (event) => {
          const e = event as KeyboardEvent;
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            input.value = format(current);
            input.blur();
          }
        });
        row.append(input, element('span', '', ';'));
        const revert = button(
          '↶',
          () =>
            this.guarded(() => {
              edits.remove(edits.key(target));
              this.renderDetails();
              this.syncHistoryControls();
            }),
          'dt-revert',
        );
        revert.title = 'Restore original property';
        revert.setAttribute('aria-label', `Reset ${property}`);
        revert.disabled = !existing;
        row.append(revert);
        rule.append(row);
        if (Array.isArray(authored[property])) {
          const expression = element('details', 'dt-expression');
          expression.append(
            element('summary', '', 'Expression'),
            element('code', '', format(existing ? edits.original(target) : authored[property])),
          );
          rule.append(expression);
        }
      }
      rule.append(element('span', '', '}'));
      this.detail.append(rule);
    }
    this.detail.append(
      element(
        'p',
        'dt-note',
        this.scope === 'feature'
          ? 'Changes affect this feature ID within the selected layer.'
          : 'Changes affect every feature drawn by this layer.',
      ),
    );
  }
  private keyValues(values: Record<string, unknown>, filter = '') {
    const dl = element('dl', 'dt-kv');
    for (const [key, value] of Object.entries(values))
      if (key.toLowerCase().includes(filter.toLowerCase()))
        dl.append(element('dt', '', key), element('dd', '', format(value)));
    return dl;
  }
  private editor(side: Side) {
    let editor = this.edits.get(side.id);
    if (!editor || editor.map !== side.map) {
      editor = new StyleEdits(side.map!);
      this.edits.set(side.id, editor);
    }
    return editor;
  }
  private changeHistory(action: 'undo' | 'redo') {
    if (this.historyPending) return;
    this.cancelColorPreviews();
    this.guarded(() => {
      const side = this.host.active();
      const editor = this.edits.get(side.id);
      const scene = window.__tileflowScene;
      const styleTime = action === 'undo' ? editor?.undoTime : editor?.redoTime;
      if ((scene?.history[action] ?? 0) > (styleTime ?? 0)) {
        this.historyPending = true;
        this.syncHistoryControls();
        const operation = scene![action]();
        void operation
          .then(
            () => {
              this.layers.refreshRules();
              this.syncHistoryControls();
            },
            (error) => this.report(String(error)),
          )
          .finally(() => {
            this.historyPending = false;
            this.syncHistoryControls();
          });
        return;
      }
      if (editor?.map === side.map) editor?.[action]();
      this.layers.refreshRules();
      this.renderDetails();
      this.syncHistoryControls();
    });
  }
  private resetAll() {
    this.cancelColorPreviews();
    this.guarded(() => {
      for (const side of this.host.sides()) {
        if (side.map === this.edits.get(side.id)?.map) this.edits.get(side.id)?.reset();
        this.geometries.get(side.id)?.dispose();
      }
      this.geometries.clear();
      void window.__tileflowScene?.reset().then(
        () => {
          this.layers.refreshRules();
          this.syncHistoryControls();
        },
        (error) => this.report(String(error)),
      );
      const activeMap = this.host.active().map;
      if (activeMap) {
        activeMap.showCollisionBoxes = false;
        activeMap.showTileBoundaries = false;
        this.overdraw.setEnabled(false);
        activeMap.setPixelRatio(devicePixelRatio);
        if (this.initialCamera?.map === activeMap)
          moveCamera(activeMap, {
            ...readCamera(activeMap),
            zoom: this.initialCamera.zoom,
            bearing: this.initialCamera.bearing,
            pitch: this.initialCamera.pitch,
          });
      }

      this.layers.refreshRules();
      this.renderDetails();
      this.syncHistoryControls();
      this.report('');
    });
  }
  private renderGeometry(side: Side, feature?: MapGeoJSONFeature) {
    const editor = this.geometries.get(side.id);
    this.detail.append(
      element(
        'p',
        'dt-note',
        'Tiled geometry may be clipped or simplified. Edit a temporary copy; the original source stays unchanged.',
      ),
    );
    const tools = element('div', 'dt-tools');
    const start = button(editor ? 'Replace with selected geometry' : 'Edit temporary copy', () =>
      this.guarded(() => {
        if (!feature || !side.map) throw new Error('Select a rendered vector feature first.');
        editor?.dispose();
        const next = new GeometryEditor(side.map, feature, () => {
          this.syncHistoryControls();
          if (this.activePanel === 'inspect' && this.subtab === 'Geometry') this.renderDetails();
        });
        this.geometries.set(side.id, next);
        this.host.inspect(false);
        this.renderDetails();
        this.syncHistoryControls();
      }),
    );
    start.disabled = !feature;
    tools.append(start);
    if (editor) {
      tools.append(
        button('Undo', () => {
          editor.undo();
          this.renderDetails();
        }),
        button('Redo', () => {
          editor.redo();
          this.renderDetails();
        }),
        button('Discard', () => {
          editor.dispose();
          this.geometries.delete(side.id);
          this.renderDetails();
          this.syncHistoryControls();
        }),
      );
    }
    this.detail.append(tools);
    const geometry = editor?.geometry || feature?.geometry;
    if (!geometry) return;
    const area = element('div');
    area.style.padding = '8px';
    area.append(
      element(
        'p',
        'dt-note',
        editor
          ? `${geometryVertices(editor.geometry).length} vertices · ${geometryVertices(editor.geometry).length > 256 ? 'edit coordinates (handles limited to 256 vertices)' : 'drag handles or edit coordinates'}`
          : `${geometry.type} · rendered geometry`,
      ),
    );
    const text = element('textarea', 'dt-geometry-json');
    text.setAttribute('aria-label', 'GeoJSON geometry');
    text.value = JSON.stringify(geometry, null, 2);
    text.readOnly = !editor;
    area.append(text);
    if (editor)
      area.append(
        button('Apply coordinates', () =>
          this.guarded(() => {
            if (text.value.length > 150000) throw new Error('Geometry input is too large.');
            editor.set(JSON.parse(text.value));
            this.renderDetails();
            this.syncHistoryControls();
          }),
        ),
      );
    this.detail.append(area);
  }
  private syncHistoryControls() {
    const side = this.host.active();
    const editor = this.edits.get(side.id);
    const current = editor?.map === side.map ? editor : undefined;
    this.undoButton.disabled =
      this.historyPending || (!current?.canUndo && !window.__tileflowScene?.history.undo);
    this.redoButton.disabled =
      this.historyPending || (!current?.canRedo && !window.__tileflowScene?.history.redo);
    this.resetChangesButton.disabled =
      !window.__tileflowScene?.history.changed &&
      !this.geometries.size &&
      !this.host.sides().some((entry) => {
        const edits = this.edits.get(entry.id);
        return (
          edits?.map === entry.map && (edits?.entries.size || edits?.canUndo || edits?.canRedo)
        );
      });
  }
  private buildNetwork() {
    const panel = this.panels.get('network')!;
    const tools = element('div', 'dt-tools'),
      search = element('input');
    search.type = 'search';
    search.placeholder = 'Filter by source, tile or state';
    search.setAttribute('aria-label', 'Filter tiles');
    search.addEventListener('input', () => {
      this.networkFilter = search.value;
      this.networkKey = '';
      this.renderNetwork();
    });
    const bounds = element('label'),
      toggle = element('input');
    toggle.type = 'checkbox';
    toggle.setAttribute('aria-label', 'Tile boundaries');
    toggle.addEventListener('change', () => {
      const map = this.host.active().map;
      if (map) map.showTileBoundaries = toggle.checked;
    });
    toggle.setAttribute('role', 'switch');
    bounds.append(toggle, document.createTextNode('Show tile boundaries on map'));
    tools.append(search, bounds);
    this.networkDetail.hidden = true;
    const list = element('div', 'dt-scroll');
    list.append(this.networkGrid, this.networkLog);
    this.networkLog.classList.remove('dt-scroll');
    this.networkSidebar.append(tools, list, this.networkSummary);
    this.networkBody.append(this.networkSidebar, this.networkDetail);
    panel.append(this.networkBody);
  }
  private renderNetwork() {
    const side = this.host.active(),
      map = side.map,
      tiles = map ? visibleTiles(map) : {supported: false, tiles: []};
    if (
      this.tileHighlight &&
      (this.tileHighlight.side !== side ||
        this.tileHighlight.map !== map ||
        this.tileHighlight.epoch !== side.loadEpoch)
    )
      this.clearTileHighlight();
    const panel = this.panels.get('network')!,
      search = panel.querySelector<HTMLInputElement>('[aria-label="Filter tiles"]')!,
      bounds = panel.querySelector<HTMLInputElement>('[aria-label="Tile boundaries"]')!;
    if (document.activeElement !== search) search.value = this.networkFilter;
    bounds.checked = map?.showTileBoundaries ?? false;
    bounds.disabled = !map;
    const selected = tiles.tiles.find((tile) => tile.key === this.networkSelection);
    if (map && this.networkTile && !this.networkDetail.hidden) {
      this.networkTile = selected ?? this.networkTile;
      this.tileDetails.update(map, this.networkTile);
    }
    const key = JSON.stringify([
      side.id,
      side.loadEpoch,
      Boolean(map),
      tiles.supported,
      this.networkFilter,
      this.networkSelection,
      tiles.tiles.map((tile) => [tile.key, tile.state, tile.overscaledZ, tile.bytes]),
    ]);
    if (key === this.networkKey) return;
    this.networkKey = key;
    const oldScroll = this.networkLog.scrollTop;
    this.networkLog.replaceChildren();
    if (!tiles.supported) {
      this.clearTileHighlight();
      this.networkSummary.textContent = '';
      this.networkLog.append(
        element(
          'div',
          'dt-empty',
          map
            ? 'Tile inspection is unavailable for this renderer version.'
            : 'Connecting to the map…',
        ),
      );
      return;
    }
    const table = element('table', 'dt-table');
    table.innerHTML = '<thead><tr><th>Tile z/x/y</th><th>Size</th></tr></thead>';
    const body = element('tbody'),
      filter = this.networkFilter.trim().toLowerCase();
    const filtered = tiles.tiles.filter((tile) =>
      `${tile.source} ${tile.z}/${tile.x}/${tile.y} ${tile.state}`.toLowerCase().includes(filter),
    );
    this.networkGrid.replaceChildren();
    const groups = new Map<string, TileRecord[]>();
    for (const tile of filtered) {
      const key = `${tile.source} · z${tile.z} · world ${tile.wrap ?? 0}`;
      const group = groups.get(key) ?? [];
      group.push(tile);
      groups.set(key, group);
    }
    for (const [name, group] of groups) {
      const minX = Math.min(...group.map((t) => t.x)),
        minY = Math.min(...group.map((t) => t.y)),
        width = Math.max(...group.map((t) => t.x)) - minX + 1,
        height = Math.max(...group.map((t) => t.y)) - minY + 1;
      if (width * height > 256 || width > 16) continue;
      const xs = Array.from({length: width}, (_, i) => minX + i),
        ys = Array.from({length: height}, (_, i) => minY + i);
      const grid = element('div', 'dt-tile-grid');
      grid.style.gridTemplateColumns = `repeat(${xs.length},minmax(0,1fr))`;
      const max = Math.max(1, ...group.map((t) => t.bytes ?? 0));
      for (const y of ys)
        for (const x of xs) {
          const tile = group.find((t) => t.x === x && t.y === y);
          if (!tile) {
            grid.append(element('span'));
            continue;
          }
          const cell = button(
            tile.bytes === undefined ? '—' : (tile.bytes / 1024).toFixed(0),
            () => {
              this.showTile(side, tile);
              this.renderNetwork();
            },
            'dt-tile-cell',
          );
          cell.style.setProperty(
            '--weight',
            `${tile.bytes === undefined ? 5 : (tile.bytes / max) * 65}%`,
          );
          cell.title = `${tile.z}/${tile.x}/${tile.y} · ${bytes(tile.bytes)} raw · ${tile.state}`;
          cell.setAttribute('aria-label', cell.title);
          cell.setAttribute('aria-pressed', String(tile.key === this.networkSelection));
          grid.append(cell);
        }
      this.networkGrid.append(element('div', 'dt-tile-grid-title', `${name} · raw kB`), grid);
    }
    for (const tile of filtered) {
      const row = element('tr');
      row.className = 'dt-tile-row';
      row.setAttribute('aria-selected', String(this.networkSelection === tile.key));
      row.title = `${tile.source} · ${tile.state} · display z${tile.overscaledZ}`;
      const select = () => {
        this.showTile(side, tile);
        this.renderNetwork();
      };
      row.addEventListener('click', (event) => {
        if (!(event.target as Element).closest('button')) select();
      });
      const cell = element('td');
      cell.append(button(`${tile.z}/${tile.x}/${tile.y}`, select, 'dt-cell-button'));
      row.append(
        cell,

        element('td', 'dt-number', bytes(tile.bytes)),
      );
      body.append(row);
    }
    table.append(body);
    this.networkLog.append(table);
    if (!filtered.length)
      this.networkLog.append(
        element(
          'div',
          'dt-empty',
          tiles.tiles.length
            ? 'No tiles match this filter.'
            : 'No tiles in view. Pan or zoom the map to load tiles.',
        ),
      );
    this.networkSummary.textContent = `${filtered.length} / ${tiles.tiles.length} tiles in view · renderer cache`;
    this.networkLog.scrollTop = oldScroll;
  }
  private showTile(side: Side, tile: TileRecord) {
    this.guarded(() => {
      this.clearTileHighlight();
      const map = side.map!,
        id = '__tileflow-devtools-tile';
      map.addSource(
        id,
        mapValue(map, {
          type: 'geojson',
          data: {type: 'Feature', properties: {}, geometry: tilePolygon(tile)},
        }),
      );
      map.addLayer(
        mapValue(map, {
          id,
          type: 'line',
          source: id,
          paint: {'line-color': '#1a73e8', 'line-width': 3, 'line-dasharray': [3, 2]},
        }),
      );
      this.tileHighlight = {side, map, epoch: side.loadEpoch, id};
      this.networkSelection = tile.key;
      this.networkTile = tile;
      this.networkDetail.hidden = false;
      this.networkBody.dataset.selected = 'true';
      this.tileDetails.update(map, tile);
    });
  }
  private clearTileHighlight() {
    this.networkDetail.hidden = true;
    this.networkBody.dataset.selected = 'false';
    this.tileDetails.clear();
    this.networkSelection = undefined;
    this.networkTile = undefined;
    this.networkKey = '';
    const entry = this.tileHighlight;
    if (!entry) return;
    try {
      if (entry.map.getLayer(entry.id)) entry.map.removeLayer(entry.id);
      if (entry.map.getSource(entry.id)) entry.map.removeSource(entry.id);
    } catch {}
    this.tileHighlight = undefined;
  }
  private buildCameraControls() {
    this.cameraControls.setAttribute('aria-label', 'Map camera');
    const apply = (key: 'zoom' | 'bearing' | 'pitch', value: number) => {
      if (!Number.isFinite(value)) return;
      if (this.cameraFrame !== undefined) cancelAnimationFrame(this.cameraFrame);
      this.cameraFrame = requestAnimationFrame(() => {
        this.cameraFrame = undefined;
        const map = this.host.active().map;
        if (map) moveCamera(map, {...readCamera(map), [key]: value}, 0, true);
        this.syncCameraControls();
      });
    };
    for (const key of ['zoom', 'bearing', 'pitch'] as const) {
      const field = element('label', 'dt-camera-field'),
        input = element('input');
      const label = key[0].toUpperCase() + key.slice(1);
      field.title = label;
      input.id = `dt-camera-${key}`;
      input.type = 'number';
      input.step = key === 'zoom' ? '0.1' : '1';
      input.setAttribute('aria-label', label);
      input.addEventListener('input', () => {
        if (input.value && input.validity.valid) apply(key, input.valueAsNumber);
      });
      field.append(element('span', '', label[0]), input);
      let range: HTMLInputElement | undefined;
      if (key === 'zoom') {
        range = element('input');
        range.type = 'range';
        range.step = '0.05';
        range.setAttribute('aria-label', 'Zoom slider');
        range.addEventListener('input', () => {
          input.value = range!.value;
          apply(key, range!.valueAsNumber);
        });
        field.append(range);
      }
      this.cameraFields.push({key, input, range});
      this.cameraControls.append(field);
    }
    const reset = icon('reset', 'Reset view', () => {
      if (this.cameraFrame !== undefined) cancelAnimationFrame(this.cameraFrame);
      const map = this.host.active().map,
        initial = this.initialCamera;
      if (map && initial?.map === map)
        moveCamera(
          map,
          {
            ...readCamera(map),
            zoom: initial.zoom,
            bearing: initial.bearing,
            pitch: initial.pitch,
          },
          0,
          true,
        );
      this.syncCameraControls();
    });
    reset.classList.add('dt-camera-reset');
    reset.title = 'Restore the initial zoom, bearing and pitch';
    const copy = button(
      'Copy for AI',
      () => {
        if (this.activePanel === 'layers') {
          this.layers.openContext();
          return;
        }
        if (this.activePanel === 'beacon') {
          void this.beacon.copyReport();
          return;
        }
        const side = this.host.active(),
          map = side.map;
        const context = safeContext({
          panel: this.activePanel,
          camera: map && readCamera(map),
          metadata: map?.getStyle()?.metadata,
          tile: this.networkTile,
          tiles: map && visibleTiles(map).tiles,
          edits: [...(this.edits.get(side.id)?.entries.values() ?? [])],
        }).value;
        void navigator.clipboard.writeText(JSON.stringify(context, null, 2)).then(
          () => this.report('Context copied'),
          () => this.report('Clipboard unavailable'),
        );
      },
      'dt-copy-agent',
    );
    copy.title = 'Copy map context for an AI agent';
    this.cameraControls.append(reset, copy);
  }
  private syncCameraControls() {
    const map = this.host.active().map;
    this.cameraControls.disabled = !map;
    if (!map) return;
    const camera = readCamera(map);
    if (this.initialCamera?.map !== map) this.initialCamera = {map, ...camera};
    for (const {key, input, range} of this.cameraFields) {
      const min = key === 'zoom' ? map.getMinZoom() : key === 'pitch' ? map.getMinPitch() : -180;
      const max = key === 'zoom' ? map.getMaxZoom() : key === 'pitch' ? map.getMaxPitch() : 180;
      input.min = String(min);
      input.max = String(max);
      if (document.activeElement !== input) input.value = camera[key].toFixed(2);
      if (range) {
        range.min = input.min;
        range.max = input.max;
        if (document.activeElement !== range) range.value = String(camera[key]);
      }
    }
  }
  private buildScene() {
    const panel = this.panels.get('scene')!;
    const content = element('div', 'dt-scene-content');
    content.append(document.getElementById('map-controls')!);
    panel.append(content);
  }
  private buildPerformance() {
    this.debug = new DebugPanel(
      this.panels.get('performance')!,
      () => this.host.active(),
      this.overdraw,
    );
  }
  private stopPerformance() {}
  private renderPerformance() {
    this.debug?.refresh();
  }
  private tick() {
    if (this.disposed) return;
    this.overdraw.setMap(this.host.active().map);
    for (const side of this.host.sides()) {
      const previous = this.sideMaps.get(side.id);
      this.sideMaps.set(side.id, side.map);
      if (previous && previous !== side.map) {
        const changed = Boolean(
          this.edits.get(side.id)?.entries.size || this.geometries.has(side.id),
        );
        this.edits.delete(side.id);
        try {
          this.geometries.get(side.id)?.dispose();
        } catch {}
        this.geometries.delete(side.id);
        this.selectedLayer = undefined;
        this.clearTileHighlight();
        if (changed) this.report('The map reloaded. Temporary edits for that map were cleared.');
        this.renderInspect();
      }
    }
    if (this.workspace.dataset.collapsed === 'true') return;
    if (this.activePanel === 'beacon') this.beacon.refresh();
    if (this.activePanel === 'network') this.renderNetwork();
    if (this.activePanel === 'layers') this.layers.refresh();
    if (this.activePanel === 'assets') this.assets.refresh();
    if (this.activePanel === 'performance') this.debug?.refresh();
    this.syncCameraControls();
    this.syncHistoryControls();
  }
  private dispose() {
    this.clearInspectHover();
    this.disposed = true;
    if (this.cameraFrame !== undefined) cancelAnimationFrame(this.cameraFrame);
    this.beacon.dispose();
    this.assets.dispose();
    this.layers.dispose();
    this.overdraw.dispose();
    this.debug?.dispose();
    this.cancelColorPreviews();
    clearInterval(this.timer);
    this.resizeObserver?.disconnect();
    removeEventListener('keydown', this.keydown);
    removeEventListener('resize', this.resizeWindow);
    for (const editor of this.geometries.values())
      try {
        editor.dispose();
      } catch {}
    this.clearTileHighlight();
    delete window.__tileflowDevtoolsUI;
  }
}

if (window.__tileflowDevtoolsHost?.schemaVersion === 1) new Devtools(window.__tileflowDevtoolsHost);
