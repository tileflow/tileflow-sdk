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
  const controller = createTileflowBrandingController({
    ...options,
    onChange(state) {
      if (state === 'required' && !logo) {
        logo = createTileflowBrandingLink(container.ownerDocument);
        container.appendChild(logo);
      } else if (state !== 'required') {
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

/** The official six-square symbol; packaged with the runtime, without an image request. */
export function createTileflowBrandingLink(document: Document): HTMLAnchorElement {
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
    width: '44px',
    height: '44px',
    display: 'grid',
    placeItems: 'center',
    zIndex: '2',
    pointerEvents: 'auto',
  });
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('viewBox', '0 0 16 16');
  mark.setAttribute('width', '24');
  mark.setAttribute('height', '24');
  mark.setAttribute('aria-hidden', 'true');
  Object.assign(mark.style, {
    color: '#252525',
    fill: 'currentColor',
    background: 'rgba(255,255,255,0.9)',
    borderRadius: '4px',
    padding: '3px',
    boxSizing: 'content-box',
    boxShadow: '0 1px 3px rgba(0,0,0,0.22)',
  });
  for (const [x, y] of [
    [0, 0],
    [6, 0],
    [3, 6],
    [9, 6],
    [6, 12],
    [12, 12],
  ]) {
    const square = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [name, value] of Object.entries({x, y, width: 4, height: 4}))
      square.setAttribute(name, String(value));
    mark.appendChild(square);
  }
  link.appendChild(mark);
  return link;
}
