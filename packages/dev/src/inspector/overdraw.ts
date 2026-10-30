import type {Map as MapLibreMap} from 'maplibre-gl';

// MapLibre adds 1/8 to each RGB channel per fragment, saturating at eight passes.
// Share the palette between the canvas transfer function and the visible legend.
export const overdrawColors = [
  '#151b27',
  '#2563eb',
  '#38bdf8',
  '#bae6fd',
  '#facc15',
  '#f59e0b',
  '#f97316',
  '#f45138',
  '#ef4444',
] as const;

let filterSequence = 0;

function colorize(map: MapLibreMap) {
  const canvas = map.getCanvas();
  // The map lives in a preview iframe: SVG references must belong to its document.
  const document = canvas.ownerDocument;
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  const defs = document.createElementNS(namespace, 'defs');
  const filter = document.createElementNS(namespace, 'filter');
  const id = `tileflow-overdraw-${++filterSequence}`;
  filter.id = id;
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  const transfer = document.createElementNS(namespace, 'feComponentTransfer');
  for (const [index, channel] of ['R', 'G', 'B'].entries()) {
    const component = document.createElementNS(namespace, `feFunc${channel}`);
    component.setAttribute('type', 'table');
    component.setAttribute(
      'tableValues',
      overdrawColors
        .map((color) =>
          (Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) / 255).toFixed(6),
        )
        .join(' '),
    );
    transfer.append(component);
  }
  filter.append(transfer);
  defs.append(filter);
  svg.append(defs);
  const previousFilter = canvas.style.getPropertyValue('filter');
  const previousPriority = canvas.style.getPropertyPriority('filter');
  const previousOverdraw = map.showOverdrawInspector;
  document.body.append(svg);
  // A compositor filter recolors the native count without CPU pixel reads or a render loop.
  canvas.style.setProperty('filter', `url("#${id}")`);
  map.showOverdrawInspector = true;
  return () => {
    if (previousFilter) canvas.style.setProperty('filter', previousFilter, previousPriority);
    else canvas.style.removeProperty('filter');
    svg.remove();
    map.showOverdrawInspector = previousOverdraw;
  };
}

/** Own the temporary visualization across map reconnections and active-map changes. */
export class OverdrawHeatmap {
  private map?: MapLibreMap;
  private enabled = false;
  private cleanup?: () => void;

  setMap(map?: MapLibreMap) {
    if (map === this.map) return;
    this.clear();
    this.map = map;
    if (this.enabled && map) this.cleanup = colorize(map);
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.clear();
    this.enabled = enabled;
    if (enabled && this.map) this.cleanup = colorize(this.map);
  }

  dispose() {
    this.clear();
    this.enabled = false;
    this.map = undefined;
  }

  private clear() {
    const cleanup = this.cleanup;
    this.cleanup = undefined;
    // A replaced iframe may already have removed its MapLibre map.
    try {
      cleanup?.();
    } catch {}
  }
}
