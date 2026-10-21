import {readTileflowNotices} from './notices';

export type TileflowNoticeControlPosition =
  'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

/** A MapLibre control; its methods receive the map that owns it. */
export type TileflowNoticeControl = {
  onAdd(map: unknown): HTMLElement;
  onRemove(map: unknown): void;
};

type TileflowNoticeEvent = 'remove' | 'style.load' | 'styledata';

/** Structural MapLibre capabilities; importing this module never loads a renderer. */
export type TileflowNoticesMap = {
  addControl(control: TileflowNoticeControl, position?: TileflowNoticeControlPosition): unknown;
  getContainer(): HTMLElement;
  getStyle(): {metadata?: unknown} | undefined;
  off(event: TileflowNoticeEvent, listener: () => void): unknown;
  on(event: TileflowNoticeEvent, listener: () => void): unknown;
  removeControl(control: TileflowNoticeControl): unknown;
};

export type TileflowNoticesOptions = {
  /** Map corner for the notice. Defaults to the attribution corner, `bottom-right`. */
  position?: TileflowNoticeControlPosition;
};

// Theme blends change paint every frame; read the style once they settle.
const styleChangeDelayMs = 200;

/**
 * Render the notices a compiled style declares, such as "Not for navigation" for Nautical, as a
 * compact always-visible map control. Call after constructing a browser map. Follows style
 * replacements and removes its control, listeners, and pending read on disposal or map removal.
 */
export function attachTileflowNotices(
  map: TileflowNoticesMap,
  options: TileflowNoticesOptions = {},
): () => void {
  const container = map.getContainer();
  const document = container.ownerDocument;
  const browser = document.defaultView;
  const position = options.position ?? 'bottom-right';
  const element = document.createElement('div');
  element.className = 'maplibregl-ctrl tileflow-notice';
  element.setAttribute('role', 'note');
  Object.assign(element.style, {
    background: 'rgba(255, 255, 255, 0.82)',
    borderRadius: '3px',
    color: 'rgba(0, 0, 0, 0.78)',
    font: '600 11px/18px "Helvetica Neue", Arial, Helvetica, sans-serif',
    letterSpacing: '0.01em',
    padding: '0 6px',
    whiteSpace: 'nowrap',
  });
  const control: TileflowNoticeControl = {
    onAdd: () => element,
    onRemove: () => element.remove(),
  };
  let added = false;
  let disposed = false;
  let pending: ReturnType<typeof setTimeout> | undefined;

  function sync() {
    pending = undefined;
    if (disposed) return;
    let metadata: unknown;
    try {
      metadata = map.getStyle()?.metadata;
    } catch {
      return;
    }
    const notices = readTileflowNotices(metadata);
    if (notices.length === 0) {
      if (added) map.removeControl(control);
      added = false;
      return;
    }
    element.textContent = notices.map(({text}) => text).join(' · ');
    element.dataset.tileflowNotice = notices.map(({id}) => id).join(' ');
    if (!added) map.addControl(control, position);
    added = true;
  }

  function cancelPending() {
    if (pending !== undefined) browser?.clearTimeout(pending);
    pending = undefined;
  }

  function scheduleSync() {
    if (disposed || !browser) return;
    cancelPending();
    pending = browser.setTimeout(sync, styleChangeDelayMs);
  }

  function onStyleLoad() {
    cancelPending();
    sync();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPending();
    map.off('style.load', onStyleLoad);
    map.off('styledata', scheduleSync);
    map.off('remove', dispose);
    if (added) map.removeControl(control);
    added = false;
  }

  map.on('style.load', onStyleLoad);
  map.on('styledata', scheduleSync);
  map.on('remove', dispose);
  sync();
  return dispose;
}
