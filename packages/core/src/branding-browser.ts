import {readTileflowBrandingSources} from './branding';
import {
  createTileflowBrandingController,
  type TileflowBrandingControllerOptions,
} from './branding-controller';

type BrandingEvent = 'styledata' | 'style.load' | 'remove';
export type TileflowBrandingMap = {
  getContainer(): HTMLElement;
  getStyle():
    {sources?: unknown; layers?: unknown; terrain?: unknown; metadata?: unknown} | undefined;
  on(event: BrandingEvent, listener: () => void): unknown;
  off(event: BrandingEvent, listener: () => void): unknown;
};
export type TileflowBrandingOptions = Pick<
  TileflowBrandingControllerOptions,
  'fetch' | 'onError' | 'mobile'
> & {
  apiUrl?: string;
  baseUrl?: string;
  /** The native delivery binding, whose protected tile URLs carry no browser query. */
  mobileMapId?: string;
};
const mounted = new WeakMap<object, () => void>();

/** Attach synchronously after construction: unresolved rights never paint a provisional logo. */
export function attachTileflowBranding(
  map: TileflowBrandingMap,
  options: TileflowBrandingOptions = {},
): () => void {
  const existing = mounted.get(map);
  if (existing) return existing;
  const container = map.getContainer();
  let originalVisibility = container.style.visibility;
  let originalInert = container.inert;
  let concealed = false;
  let logo: HTMLAnchorElement | undefined;
  let disposed = false;
  const isCompact = () => (container.clientWidth || Infinity) <= compactWidth;
  const Observer = container.ownerDocument.defaultView?.ResizeObserver;
  const resizes =
    Observer &&
    new Observer(() => {
      if (logo) presentTileflowBranding(logo, isCompact());
    });
  const controller = createTileflowBrandingController({
    ...options,
    onChange(state) {
      if (state === 'required' && !logo) {
        logo = createTileflowBrandingLink(container.ownerDocument, {compact: isCompact()});
        container.appendChild(logo);
        resizes?.observe(container);
      } else if (state !== 'required') {
        resizes?.disconnect();
        logo?.remove();
        logo = undefined;
      }
      if (state === 'pending' && !concealed) {
        originalVisibility = container.style.visibility;
        originalInert = container.inert;
        container.style.visibility = 'hidden';
        container.inert = true;
        concealed = true;
      } else if (state !== 'pending' && concealed) {
        container.style.visibility = originalVisibility;
        container.inert = originalInert;
        concealed = false;
      }
      container.dataset.tileflowBranding = state;
    },
  });
  function sync() {
    if (disposed) return;
    try {
      const style = map.getStyle();
      const sources = style ? readTileflowBrandingSources(style, options) : undefined;
      controller.update(
        options.mobile && options.mobileMapId
          ? sources?.map((source) => ({...source, mapId: options.mobileMapId}))
          : sources,
      );
    } catch (error) {
      controller.update(undefined);
      options.onError?.(error instanceof Error ? error : new Error('Invalid Tileflow sources.'));
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.dispose();
    resizes?.disconnect();
    logo?.remove();
    if (concealed) {
      container.style.visibility = originalVisibility;
      container.inert = originalInert;
    }
    delete container.dataset.tileflowBranding;
    map.off('styledata', sync);
    map.off('style.load', sync);
    map.off('remove', dispose);
    container.ownerDocument.removeEventListener?.('visibilitychange', sync);
    mounted.delete(map);
  }
  mounted.set(map, dispose);
  map.on('styledata', sync);
  map.on('style.load', sync);
  map.on('remove', dispose);
  container.ownerDocument.addEventListener?.('visibilitychange', sync);
  sync();
  return dispose;
}

const svgNamespace = 'http://www.w3.org/2000/svg';
/** The Desfase symbol: six 4-unit tiles on a 16-unit grid. */
const symbolTiles = [
  [0, 0],
  [6, 0],
  [3, 6],
  [9, 6],
  [6, 12],
  [12, 12],
] as const;
/**
 * The public lockup, in its 22 px units: "Tileflow" set in Geist Sans Bold with -0.035 em tracking,
 * outlined so the map loads no font, and the symbol raised after it at x 74.
 */
const wordmarkPath =
  'M8.27 23.81L4.91 23.81L4.91 11.01L0.24 11.01L0.24 8.19L12.96 8.19L12.96 11.01L8.27 11.01L8.2' +
  '7 23.81M16.76 23.81L13.46 23.81L13.46 12.02L16.76 12.02L16.76 23.81M16.81 10.57L13.4 10.57L1' +
  '3.4 7.93L16.81 7.93L16.81 10.57M23.8 23.81L21.85 23.81Q20.39 23.81 19.58 23.1Q18.77 22.38 18' +
  '.77 20.73L18.77 8.19L22.07 8.19L22.07 20.38Q22.07 20.91 22.31 21.13Q22.55 21.35 23.01 21.35L' +
  '23.8 21.35L23.8 23.81M29.96 24.07Q28.16 24.07 26.83 23.3Q25.5 22.53 24.76 21.16Q24.02 19.78 ' +
  '24.02 17.91Q24.02 16.07 24.75 14.68Q25.48 13.29 26.81 12.52Q28.14 11.75 29.94 11.75Q31.7 11.' +
  '75 33 12.52Q34.3 13.29 35.01 14.72Q35.73 16.15 35.73 18.13L35.73 18.79L27.43 18.79Q27.5 20.2' +
  ' 28.19 20.88Q28.89 21.57 30.03 21.57Q31.75 21.57 32.23 20.14L35.55 20.33Q35.07 22.09 33.58 2' +
  '3.08Q32.1 24.07 29.96 24.07M27.43 16.77L32.34 16.77Q32.27 15.47 31.63 14.83Q30.98 14.2 29.94' +
  ' 14.2Q28.91 14.2 28.24 14.87Q27.57 15.54 27.43 16.77M41.12 23.81L37.82 23.81L37.82 14.48L36.' +
  '1 14.48L36.1 12.02L37.82 12.02L37.82 11.86Q37.82 10.13 38.76 9.16Q39.71 8.19 41.69 8.19L44.2' +
  '2 8.19L44.22 10.65L42.42 10.65Q41.73 10.65 41.43 11Q41.12 11.34 41.12 12.02L44.04 12.02L44.0' +
  '4 14.48L41.12 14.48L41.12 23.81M50.31 23.81L48.36 23.81Q46.9 23.81 46.09 23.1Q45.28 22.38 45' +
  '.28 20.73L45.28 8.19L48.58 8.19L48.58 20.38Q48.58 20.91 48.82 21.13Q49.06 21.35 49.52 21.35L' +
  '50.31 21.35L50.31 23.81M56.52 24.07Q54.71 24.07 53.37 23.32Q52.03 22.56 51.28 21.17Q50.53 19' +
  '.78 50.53 17.91Q50.53 16.04 51.28 14.67Q52.03 13.29 53.37 12.52Q54.71 11.75 56.52 11.75Q58.3' +
  '2 11.75 59.67 12.52Q61.03 13.29 61.76 14.67Q62.5 16.04 62.5 17.91Q62.5 19.78 61.76 21.17Q61.' +
  '03 22.56 59.67 23.32Q58.32 24.07 56.52 24.07M56.52 21.54Q57.75 21.54 58.43 20.59Q59.11 19.63' +
  ' 59.11 17.91Q59.11 16.2 58.43 15.24Q57.75 14.28 56.52 14.28Q55.29 14.28 54.6 15.24Q53.92 16.' +
  '2 53.92 17.91Q53.92 19.63 54.6 20.59Q55.29 21.54 56.52 21.54M69.06 23.81L65.87 23.81L62.37 1' +
  '2.02L65.69 12.02L67.72 20L69.89 12.02L72.58 12.02L74.76 20L76.8 12.02L80.12 12.02L76.63 23.8' +
  '1L73.41 23.81L71.24 16.44';
const symbolOffset = 74;
/** Maps this narrow or narrower show the symbol alone. */
const compactWidth = 250;
const fullBadge = {viewBox: '-1.5 -1.5 93 27', width: 79, height: 23, padding: 10};
const compactBadge = {
  viewBox: `${symbolOffset - 1.5} -1.5 19 19`,
  width: 20,
  height: 20,
  padding: 12,
};

/**
 * The official lockup; packaged with the runtime, without an image or font request. White with a
 * soft dark halo and no plate, so it reads on light and dark styles without covering the map.
 */
export function createTileflowBrandingLink(
  document: Document,
  options: {compact?: boolean} = {},
): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'tileflow-branding';
  link.href = 'https://tileflow.dev/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Visit Tileflow');
  link.title = 'Tileflow';
  Object.assign(link.style, {
    position: 'absolute',
    left: 'max(0px, env(safe-area-inset-left))',
    bottom: 'max(0px, env(safe-area-inset-bottom))',
    display: 'block',
    lineHeight: '0',
    zIndex: '2',
    pointerEvents: 'auto',
  });
  const badge = document.createElementNS(svgNamespace, 'svg');
  badge.setAttribute('aria-hidden', 'true');
  badge.style.overflow = 'visible';
  const element = (tag: string, attributes: Record<string, string | number>) => {
    const node = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
  };
  const words: SVGElement[] = [];
  // The halo sits under the fill, as one translucent layer so overlapping strokes do not darken.
  for (const layer of [
    {fill: '#000', opacity: 0.3, stroke: '#000', wordStroke: 3, tileStroke: 2},
    {fill: '#fff', opacity: 0.9},
  ]) {
    const group = element('g', {fill: layer.fill, opacity: layer.opacity});
    if (layer.stroke) {
      group.setAttribute('stroke', layer.stroke);
      group.setAttribute('stroke-linejoin', 'round');
    }
    const word = element('path', {d: wordmarkPath});
    if (layer.wordStroke) word.setAttribute('stroke-width', String(layer.wordStroke));
    words.push(word);
    group.appendChild(word);
    for (const [x, y] of symbolTiles) {
      const tile = element('rect', {x: symbolOffset + x, y, width: 4, height: 4});
      if (layer.tileStroke) tile.setAttribute('stroke-width', String(layer.tileStroke));
      group.appendChild(tile);
    }
    badge.appendChild(group);
  }
  link.appendChild(badge);
  presenters.set(link, (compact) => {
    const size = compact ? compactBadge : fullBadge;
    badge.setAttribute('viewBox', size.viewBox);
    badge.setAttribute('width', String(size.width));
    badge.setAttribute('height', String(size.height));
    link.style.padding = `${size.padding}px`;
    for (const word of words) word.setAttribute('visibility', compact ? 'hidden' : 'visible');
  });
  presentTileflowBranding(link, options.compact === true);
  return link;
}

const presenters = new WeakMap<HTMLAnchorElement, (compact: boolean) => void>();
function presentTileflowBranding(link: HTMLAnchorElement, compact: boolean) {
  presenters.get(link)?.(compact);
}
