import type {Map as MapLibreMap} from 'maplibre-gl';
import {overdrawColors, OverdrawHeatmap} from './overdraw';
import type {Side} from './types';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  return node;
};
export class DebugPanel {
  private map?: MapLibreMap;
  private switches = new Map<string, HTMLInputElement>();
  private ratio = el('input');
  private slider = el('input');
  private help = el('div', 'dt-overdraw-help');
  private collisionHelp = el('div', 'dt-overdraw-help');
  private ratios = el('div', 'dt-segments');
  private specimen = el('div', 'dt-debug-specimen');
  private sample = el('span', '', 'Main Street');
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    root: HTMLElement,
    private active: () => Side,
    private overdraw: OverdrawHeatmap,
  ) {
    const content = el('div', 'dt-scroll');
    content.append(el('div', 'dt-section-heading', 'Map overlays'));
    const specs = [
      ['showOverdrawInspector', 'Overdraw', 'How many times each pixel is painted per frame'],
      ['showCollisionBoxes', 'Collision boxes', 'Which labels and icons are placed or dropped'],
      ['showTileBoundaries', 'Tile boundaries', 'Edges and z/x/y of every loaded tile'],
    ] as const;
    for (const [key, title, description] of specs) {
      const row = el('label', 'dt-debug-overlay'),
        preview = el('span', 'dt-debug-preview'),
        copy = el('span'),
        toggle = el('input');
      preview.innerHTML = this.preview(key);
      copy.append(el('strong', '', title), el('small', '', description));
      toggle.type = 'checkbox';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', title);
      toggle.addEventListener('change', () => this.setOverlay(key, toggle.checked));
      this.switches.set(key, toggle);
      row.append(preview, copy, toggle);
      content.append(row);
      if (key === 'showOverdrawInspector') content.append(this.help);
      if (key === 'showCollisionBoxes') content.append(this.collisionHelp);
    }
    const legend = el('div', 'dt-overdraw-legend');
    for (const passes of [0, 1, 2, 4, 8]) {
      const item = el('span', 'dt-overdraw-key'),
        swatch = el('i', 'dt-overdraw-swatch');
      swatch.style.background = overdrawColors[passes];
      item.append(swatch, document.createTextNode(passes === 8 ? '8+' : String(passes)));
      legend.append(item);
    }
    this.help.append(
      el('strong', '', 'Passes per pixel'),
      legend,
      el(
        'p',
        '',
        'Red is where to look, not necessarily a problem. Counts MapLibre render passes; custom 3D layers may be missing.',
      ),
    );
    this.collisionHelp.append(
      el('strong', '', 'Collision boxes'),
      el(
        'p',
        '',
        'Renderer boxes show symbol placement and collision candidates. Colors come from the renderer and may differ for text, icons and line labels.',
      ),
    );
    this.help.hidden = this.collisionHelp.hidden = true;
    content.append(el('div', 'dt-section-heading', 'Scale factor'));
    const controls = el('div', 'dt-debug-scale');
    controls.append(el('span', '', 'Pixel ratio'));
    for (const value of [1, 1.5, 2, 3]) {
      const b = el('button', '', `${value}×`);
      b.type = 'button';
      b.dataset.ratio = String(value);
      b.onclick = () => this.applyRatio(value);
      this.ratios.append(b);
    }
    this.ratio.type = 'number';
    this.ratio.min = '.5';
    this.ratio.max = '4';
    this.ratio.step = '.1';
    this.ratio.setAttribute('aria-label', 'Pixel ratio');
    this.slider.type = 'range';
    this.slider.min = '.5';
    this.slider.max = '4';
    this.slider.step = '.1';
    this.slider.setAttribute('aria-label', 'Pixel ratio slider');
    for (const input of [this.ratio, this.slider])
      input.addEventListener('input', () => {
        if (!input.value || !input.checkValidity()) return;
        const value = input.valueAsNumber;
        this.ratio.value = this.slider.value = String(value);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.applyRatio(value), 120);
      });
    controls.append(this.ratios, this.ratio, this.slider);
    content.append(
      controls,
      el(
        'p',
        'dt-note',
        'Changes the actual map canvas resolution. Camera and CSS layout stay unchanged.',
      ),
    );
    const preview = el('div', 'dt-debug-scale');
    preview.append(el('span', '', 'Preview'));
    this.specimen.append(this.sample);
    this.specimen.insertAdjacentHTML(
      'beforeend',
      '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="var(--accent)"/><path d="M8 3v10M3.5 8.5 8 7l4.5 1.5M6 12.5h4" stroke="var(--paper)" stroke-width="1.2" fill="none"/></svg>',
    );
    preview.append(this.specimen);
    content.append(preview);
    root.append(content);
  }
  setOverlay(key: string, enabled: boolean) {
    const map = this.active().map;
    if (!map) return;
    if (key === 'showOverdrawInspector') {
      this.overdraw.setMap(map);
      this.overdraw.setEnabled(enabled);
    } else if (key === 'showCollisionBoxes') map.showCollisionBoxes = enabled;
    else if (key === 'showTileBoundaries') map.showTileBoundaries = enabled;
    this.refresh();
  }
  private applyRatio(value: number) {
    const map = this.active().map;
    if (!map) return;
    map.setPixelRatio(Math.max(0.5, Math.min(4, value)));
    this.refresh();
  }
  refresh() {
    this.map = this.active().map;
    for (const [key, toggle] of this.switches) {
      toggle.disabled = !this.map;
      toggle.checked =
        this.map?.[key as 'showOverdrawInspector' | 'showCollisionBoxes' | 'showTileBoundaries'] ??
        false;
    }
    this.help.hidden = !this.switches.get('showOverdrawInspector')!.checked;
    this.collisionHelp.hidden = !this.switches.get('showCollisionBoxes')!.checked;
    const ratio = this.map?.getPixelRatio() ?? devicePixelRatio;
    this.sample.style.fontSize = `${11 * ratio}px`;
    const glyph = this.specimen.querySelector('svg')!;
    glyph.setAttribute('width', String(18 * ratio));
    glyph.setAttribute('height', String(18 * ratio));
    for (const input of [this.ratio, this.slider]) {
      input.disabled = !this.map;
      if (document.activeElement !== input) input.value = String(+ratio.toFixed(2));
    }
    for (const b of this.ratios.children)
      b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.ratio) === ratio));
  }
  dispose() {
    clearTimeout(this.timer);
  }
  private preview(key: string) {
    const over = key === 'showOverdrawInspector';
    return `<svg viewBox="0 0 84 58" aria-hidden="true"><rect width="84" height="58" fill="${over ? '#2F66E8' : '#efece6'}"/><path d="M48 0h36v25L60 20z" fill="${over ? '#3DB8F0' : '#dce5cf'}"/><path d="M0 45Q25 36 50 47T84 42v16H0" fill="${over ? '#3DB8F0' : '#c6d8e4'}"/><g fill="${over ? '#3DB8F0' : '#d9d2c7'}"><rect x="6" y="5" width="16" height="13"/><rect x="32" y="8" width="13" height="16"/><rect x="57" y="31" width="18" height="10"/></g><path d="M-5 30Q30 20 90 29M29 -5L42 63" fill="none" stroke="${over ? '#F9C21B' : '#fff'}" stroke-width="6"/>${over ? '<circle cx="35" cy="25" r="4" fill="#EF4B3C"/>' : key === 'showTileBoundaries' ? '<path d="M42 0v58M0 29h84" stroke="#38668B" fill="none"/>' : '<rect x="6" y="22" width="30" height="9" fill="none" stroke="#38668B"/><rect x="28" y="27" width="27" height="9" fill="none" stroke="#B13C34" stroke-dasharray="3 2"/>'}</svg>`;
  }
}
