type AttributionOptions = {
  compact?: boolean;
  customAttribution?: string | string[];
};

/** Keep source attribution visible during map interaction. */
export function tileflowAttributionControlOptions(
  options?: false | AttributionOptions,
): AttributionOptions {
  return {...(options || {}), compact: false};
}

type TileflowAttributionMap = {
  getContainer(): HTMLElement;
  once(event: 'remove', listener: () => void): unknown;
};

/** Let readers open the full linked credits without collapsing the map's attribution. */
export function attachTileflowAttributionDetails(map: TileflowAttributionMap): void {
  const mapContainer = map.getContainer();
  const attribution = mapContainer.querySelector<HTMLElement>('.maplibregl-ctrl-attrib');
  const credits = attribution?.querySelector('.maplibregl-ctrl-attrib-inner');
  const corner = attribution?.parentElement;
  if (!attribution || !credits || !corner) return;

  const document = attribution.ownerDocument;
  const details = document.createElement('div');
  details.dataset.tileflowAttributionDetails = '';
  details.hidden = true;
  const gap = 4;
  Object.assign(details.style, {
    background: 'white',
    boxSizing: 'border-box',
    color: 'rgba(0, 0, 0, 0.82)',
    fontSize: '14px',
    insetBlockEnd: `calc(100% + ${gap}px)`,
    insetInlineEnd: '0',
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    overflowY: 'auto',
    pointerEvents: 'auto',
    position: 'absolute',
    width: 'max-content',
  });
  const fullCredits = document.createElement('div');
  fullCredits.style.padding = '4px 6px';
  details.append(fullCredits);

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'ⓘ';
  button.title = 'Map credits';
  button.setAttribute('aria-label', 'Map credits');
  button.setAttribute('aria-expanded', 'false');
  Object.assign(button.style, {
    background: 'none',
    border: '0',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '16px',
    insetBlockStart: '0',
    insetInlineEnd: '2px',
    lineHeight: '24px',
    padding: '0',
    position: 'absolute',
    width: '24px',
  });
  Object.assign(attribution.style, {
    background: 'rgba(255, 255, 255, 0.82)',
    boxSizing: 'border-box',
    color: 'rgba(0, 0, 0, 0.82)',
    minHeight: '24px',
    overflowWrap: 'anywhere',
    paddingInlineEnd: '28px',
    position: 'relative',
  });

  let expanded = false;
  // Reuse MapLibre's sanitized links and follow its attribution updates.
  const sync = () => {
    details.hidden = !expanded || attribution.classList.contains('maplibregl-attrib-empty');
    if (!details.hidden) {
      fullCredits.replaceChildren(
        ...Array.from(credits.childNodes, (node) => node.cloneNode(true)),
      );
    }
  };

  const fit = () => {
    const room = mapContainer.clientHeight - corner.offsetHeight - gap;
    details.style.maxHeight = `${Math.max(0, Math.min(160, room))}px`;
  };

  button.addEventListener('click', () => {
    expanded = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    sync();
  });
  attribution.append(button);
  corner.append(details);
  fit();

  const observer = new MutationObserver(sync);
  observer.observe(credits, {childList: true});
  observer.observe(attribution, {attributes: true, attributeFilter: ['class']});
  const resize = new ResizeObserver(fit);
  resize.observe(mapContainer);
  resize.observe(corner);
  map.once('remove', () => {
    observer.disconnect();
    resize.disconnect();
  });
}
