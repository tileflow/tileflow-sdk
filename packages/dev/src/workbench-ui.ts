/** Small, decorative line icons. Visible text remains the accessible action name. */
export function workbenchIcon(name: 'inspect' | 'settings' | 'close') {
  const paths = {
    inspect:
      '<path d="M9 3H4a1 1 0 0 0-1 1v5m12-6h5a1 1 0 0 1 1 1v5M3 15v5a1 1 0 0 0 1 1h5"/><path d="m11 11 10 4-5 1-1 5z"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  return `<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

/** Shared foundations for the map and developer tools. */
export const workbenchStyles = `
  body { display:flex; flex-direction:column; }
  .workspace { flex:1; min-height:0; }
  input[type=range] { accent-color:var(--accent); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  select,input[type=text],input[type=number] { background:var(--paper); color:var(--ink); border:1px solid var(--border); padding:5px 8px; }
  summary { cursor:pointer; }
  .tool-icon { width:17px; height:17px; flex:none; vertical-align:middle; }
  button:has(.tool-icon) { display:inline-flex; align-items:center; justify-content:center; gap:7px; }
  .inspect-hint { position:absolute; z-index:4; top:8px; left:8px; pointer-events:none; }
  .compact-note { font-size:12px; color:var(--muted); line-height:1.5; }
  .property-list { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; }
  .property-list dd { margin:0; }
  .authoring-path { display:block; overflow-wrap:anywhere; }
  .color-swatch { width:16px; height:16px; border:1px solid var(--border); border-radius:2px; display:inline-block; }
`;

export const workbenchPanels = `<div id="wb-notice" role="status" hidden></div>`;
