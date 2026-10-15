/** Small, decorative line icons. Visible text remains the accessible action name. */
export function workbenchIcon(
  name: 'inspect' | 'compare' | 'capture' | 'history' | 'settings' | 'close' | 'pin',
) {
  const paths = {
    inspect:
      '<path d="M9 3H4a1 1 0 0 0-1 1v5m12-6h5a1 1 0 0 1 1 1v5M3 15v5a1 1 0 0 0 1 1h5"/><path d="m11 11 10 4-5 1-1 5z"/>',
    compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16m-5-8h2m6 0h2"/>',
    capture:
      '<path d="m8 5 2-2h4l2 2h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1z"/><circle cx="12" cy="12" r="4"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    pin: '<path d="M9 3h6l-1 6 4 4v2H6v-2l4-4zM12 15v6"/>',
  };
  return `<svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

/** Product chrome shared by single-map and comparison views in Map DevTools. */
export const workbenchStyles = `
  :root { --accent:#a73b4d; --border:#e0d5c4; --ink:#30251f; --muted:#756457; --paper:#faf6eb; --surface:#f4edde; }
  body { display:flex; flex-direction:column; font-family:'Mona Sans','Helvetica Neue',Arial,sans-serif; }
  .workspace { flex:1; }
  input[type=range] { accent-color:var(--accent); }
  button, input, select { border-radius:3px; min-height:32px; }
  button { background:var(--paper); padding:6px 11px; }
  button:hover { border-color:#c5b49f; background:var(--surface); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  button[aria-pressed="true"] { background:#f0dfe0; }
  select,input[type=text],input[type=number] { background:var(--paper); color:var(--ink); border:1px solid var(--border); padding:5px 8px; }
  .brandbar { display:flex; align-items:center; gap:12px; min-height:51px; padding:10px 18px; background:var(--ink); color:var(--paper); }
  .wordmark { font-size:19px; font-weight:650; letter-spacing:-.8px; }
  .wordmark,.onboarding h2,.panel-heading h2,.feature-summary h3 { font-family:'Hubot Sans','Mona Sans',sans-serif; }
  .brandbar .product-name { font-size:13px; color:#c5b49f; border-left:1px solid #635449; padding-left:12px; }
  .brandbar .project { margin-left:auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:45%; color:#e0d5c4; font-size:12px; }
  .toolbar { min-height:52px; padding:8px 14px; background:var(--paper); gap:8px; flex-wrap:wrap; }
  .toolbar-group { flex:0 1 auto; gap:6px; }
  .toolbar .view-picker { display:flex; min-width:140px; flex:1 1 180px; max-width:340px; }
  .view-picker select { width:100%; min-width:0; }
  .toolbar-title { display:none; }
  .primary { background:var(--ink); color:var(--paper); border-color:var(--ink); }
  .primary:hover { background:#4b382d; color:var(--paper); border-color:#4b382d; }
  .toolbar .primary { margin-left:auto; }
  .export-menu { position:relative; }
  summary { cursor:pointer; }
  .export-menu > summary { padding:6px 10px; list-style:none; border:1px solid var(--border); border-radius:3px; }
  .export-menu > div { position:absolute; right:0; top:calc(100% + 8px); width:280px; padding:14px; display:grid; gap:10px; border:1px solid var(--border); background:var(--paper); box-shadow:0 10px 30px #30251f24; z-index:30; }
  .export-menu label { display:grid; gap:5px; }
  .export-menu input[type=text] { width:100%; }
  .export-menu .dimensions { display:flex; gap:8px; }
  .dimensions label { min-width:0; flex:1; }
  .dimensions input { width:100%; }
  .comparison-tools { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:7px 14px; background:var(--surface); border-bottom:1px solid var(--border); }
  .comparison-tools label { display:flex; align-items:center; gap:6px; }
  .comparison-tools input { width:90px; }
  .pane-label { background:var(--paper); border-color:var(--border); border-radius:3px; box-shadow:0 3px 12px #30251f12; }
  .pane-label-text { font-size:12px; }
  .side-state-text { font-size:11px; text-transform:none; letter-spacing:0; }
  .inspector { width:340px; max-width:42vw; background:var(--paper); padding:16px; }
  .inspector-heading { margin:-16px -16px 14px; padding:13px 16px; top:-16px; background:var(--paper); }
  .inspector h2 { font-size:14px; font-weight:600; }
  .inspector h3 { font-size:11px; letter-spacing:.08em; margin-top:22px; }
  .inspector pre { background:var(--surface); font-size:12px; border-radius:3px; }
  .inspector details { border-top:1px solid var(--border); margin-top:16px; padding-top:12px; }
  .inspector details summary { color:var(--muted); }
  .inspector details h3 { margin-top:12px; }
  .inspector .empty { padding:8px 0; line-height:1.65; }
  .feature-summary { margin:14px 0; }
  .feature-summary h3 { font-size:20px; color:var(--ink); letter-spacing:-.03em; text-transform:none; margin:0 0 6px; }
  .property-list { margin:12px 0; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:8px; font-size:12px; }
  .property-list dt { color:var(--muted); overflow-wrap:anywhere; }
  .property-list dd { margin:0; text-align:right; overflow-wrap:anywhere; }
  .authoring-path { display:block; padding:7px 8px; margin:5px 0; background:var(--surface); overflow-wrap:anywhere; font-size:12px; }
  .curve { background:var(--surface); border-radius:3px; }
  .onboarding { position:absolute; z-index:5; bottom:24px; left:24px; max-width:330px; padding:18px; background:var(--paper); border:1px solid var(--border); box-shadow:0 8px 28px #30251f20; border-radius:4px; }
  .onboarding h2 { margin:0 0 7px; font-size:18px; font-weight:550; letter-spacing:-.03em; }
  .onboarding p { margin:0 0 14px; color:var(--muted); line-height:1.55; }
  .onboarding .actions { display:flex; gap:8px; }
  .statusbar { min-height:30px; display:flex; gap:12px; align-items:center; padding:5px 14px; border-top:1px solid var(--border); font-size:11px; color:var(--muted); background:var(--paper); }
  .statusbar .feedback { margin-left:auto; color:var(--accent); text-align:right; }
  .statusbar button { min-height:24px; border:0; padding:0 4px; font-size:11px; }
  .drawer { position:absolute; z-index:25; inset:auto 0 0; max-height:50%; overflow:auto; background:var(--paper); border-top:1px solid var(--border); padding:14px; box-shadow:0 -8px 30px #30251f14; }
  .panel-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
  .panel-heading h2 { margin:0; font-size:16px; font-weight:550; }
  .capture-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
  .capture-card { padding:0; overflow:hidden; text-align:left; border:1px solid var(--border); }
  .capture-card img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; background:var(--surface); }
  .capture-card span { display:block; margin:7px 10px; }
  .capture-card small { color:var(--muted); }
  .review-panel { position:absolute; inset:0; z-index:24; padding:18px; background:var(--paper); overflow:auto; }
  .review-controls { display:flex; align-items:end; flex-wrap:wrap; gap:10px; margin:14px 0; }
  .review-controls label { display:grid; gap:5px; flex:1; min-width:140px; color:var(--muted); }
  .review-controls select { width:100%; min-width:0; }
  .review-controls > button { flex:0 0 auto; }
  .review-images { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; }
  .review-images figure { margin:0; min-width:0; }
  .review-images img { width:100%; display:block; max-height:52vh; object-fit:contain; background:var(--surface); }
  .review-images figcaption { font-size:12px; margin:6px 0; color:var(--muted); }
  .review-result { margin:12px 0; padding:12px; background:var(--surface); line-height:1.6; overflow-wrap:anywhere; }
  .review-result[data-status]:not([data-status=comparable]) { border-left:3px solid var(--accent); }
  .review-diff { width:100%; max-height:45vh; object-fit:contain; }
  .review-notes { color:var(--muted); font-size:12px; line-height:1.6; margin:12px 0; }
  .capture-swipe { position:relative; overflow:hidden; margin:12px 0; }
  .capture-swipe img { width:100%; display:block; }
  .capture-swipe img:first-child { position:absolute; inset:0; clip-path:inset(0 50% 0 0); z-index:1; }
  .capture-swipe::after { content:""; position:absolute; z-index:2; top:0; bottom:0; left:var(--swipe,50%); width:2px; background:var(--paper); box-shadow:0 0 0 1px var(--ink); }
  .swipe-control { display:flex; align-items:center; gap:10px; }
  .swipe-control input { flex:1; }
  .notice { position:absolute; z-index:8; top:52px; left:12px; right:12px; padding:10px 12px; background:var(--paper); border:1px solid var(--accent); color:var(--ink); line-height:1.5; }
  .compact-note { font-size:12px; color:var(--muted); line-height:1.5; }
  .workbench-only[hidden] { display:none; }
  .tool-icon { width:17px; height:17px; flex:none; vertical-align:middle; }
  button:has(.tool-icon), summary:has(.tool-icon) { display:inline-flex; align-items:center; justify-content:center; gap:7px; }
  .shortcut { font-size:11px; font-family:inherit; border:1px solid var(--border); border-radius:3px; padding:1px 4px; color:var(--muted); margin-left:3px; }
  .toolbar .picker-group { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-right:auto; }
  .picker-group label { display:grid; gap:3px; min-width:90px; color:var(--muted); font-size:11px; }
  .picker-group select { max-width:220px; font-size:12px; }
  .toolbar .primary { margin-left:0; }
  .toolbar-actions { display:flex; align-items:center; gap:6px; }
  .toolbar-actions > .tool-divider { width:1px; height:24px; background:var(--border); margin:0 3px; }
  .reference-bar { display:flex; align-items:center; gap:10px; padding:8px 14px; background:var(--surface); border-bottom:1px solid var(--border); font-size:12px; flex-wrap:wrap; }
  .reference-bar > span { flex:1; min-width:150px; }
  .reference-bar small { display:block; color:var(--muted); margin-top:3px; }
  .workspace { min-height:0; }
  .inspect-hint { position:absolute; z-index:4; top:52px; left:12px; padding:7px 10px; border-radius:3px; background:var(--ink); color:var(--paper); pointer-events:none; font-size:12px; }
  .stage[data-frame="true"] { background:#e6ddcf; }
  .stage[data-frame="true"] .pane-left { position:absolute; left:50%; top:50%; right:auto; bottom:auto; width:var(--frame-width); height:var(--frame-height); transform:translate(-50%,-50%) scale(var(--frame-scale,1)); box-shadow:0 0 0 1px #756457; transform-origin:center; }
  .stage[data-frame="true"] .pane-label { display:none; }
  .frame-note { position:absolute; z-index:4; bottom:10px; left:10px; right:10px; background:var(--paper); padding:8px 10px; font-size:12px; border:1px solid var(--border); pointer-events:none; }
  .frame-option { display:flex !important; align-items:center; gap:8px !important; }
  .frame-option input { min-height:0; }
  .review-tabs { display:flex; gap:4px; margin-bottom:20px; border-bottom:1px solid var(--border); padding-bottom:8px; }
  .review-tabs button { border-color:transparent; }
  .review-tabs button[aria-pressed="true"] { border-color:var(--ink); background:var(--ink); color:var(--paper); }
  .review-intro { margin:0 0 16px; max-width:680px; line-height:1.6; color:var(--muted); }
  .review-controls label > small { color:var(--muted); }
  .review-source { color:var(--ink); font-weight:550; }
  .review-display { display:flex; align-items:center; gap:8px; margin:12px 0; flex-wrap:wrap; }
  .review-display select { min-width:160px; }
  .capture-card { background:var(--paper); }
  .capture-card > button { width:100%; border:0; padding:0; text-align:left; background:transparent; }
  .capture-card > .capture-reference { width:calc(100% - 20px); margin:0 10px 10px; padding:6px; border:1px solid var(--border); text-align:center; }
  .capture-card[data-reference="true"] { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent); }
  .review-images img { max-height:65vh; }
  .review-panel .capture-swipe { width:min(100%,calc(max(240px,100vh - 340px) * var(--capture-aspect,1.6))); margin:12px auto; }
  .review-panel .panel-heading { flex-wrap:wrap; border-bottom:1px solid var(--border); padding-bottom:8px; }
  .review-panel .panel-heading .review-tabs { flex:1; border:0; padding:0; margin:0; }
  .review-panel .review-controls { margin:8px 0; }
  .review-summary-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .review-summary-row .review-result { flex:1; padding:8px; margin:8px 0; min-width:180px; font-size:12px; }
  .review-summary-row .review-display { margin:8px 0; }
  .review-panel:has(#wb-review-result:not([hidden])) #wb-review-help, .review-panel:has(#wb-review-result:not([hidden])) #wb-pin-reference { display:none; }
  body:has(#wb-review:not([hidden])) > .reference-bar, body:has(.stage:not([data-mode="single"])) > .reference-bar { display:none; }
  .review-intro { font-size:12px; margin-bottom:8px; }
  .feature-summary h4 { font-size:13px; margin:20px 0 8px; }
  .property-list { grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; font-size:13px; }
  .property-list dd { display:flex; align-items:center; justify-content:end; gap:7px; }
  .color-swatch { width:16px; height:16px; border:1px solid #75645766; border-radius:3px; display:inline-block; }
  .inspector .feature-picker { font-size:12px; }
  .inspector .selection-context { margin:12px 0 0; width:100%; }
  .inspector .zoom-details { margin-top:20px; }
  .onboarding ol { padding-left:20px; color:var(--muted); line-height:1.6; margin:12px 0 16px; }
  .onboarding li + li { margin-top:7px; }
  .brandbar details { margin-left:auto; max-width:55%; font-size:12px; }
  .brandbar summary { list-style:none; color:#e0d5c4; overflow-wrap:anywhere; }
  .brandbar .project-path { position:absolute; right:14px; top:48px; padding:12px; background:var(--paper); color:var(--ink); border:1px solid var(--border); z-index:40; max-width:90vw; overflow-wrap:anywhere; }
  @media (max-width:760px) {
    .brandbar { padding:10px 12px; }
    .toolbar { gap:6px; padding:7px 10px; }
    .toolbar-group { flex:0 1 auto; }
    .toolbar .view-picker { flex:1 1 100%; max-width:none; }
    .workspace:has(.inspector:not([hidden])) { grid-template-rows:minmax(0,1fr) minmax(0,1fr); }
    .inspector { position:relative; grid-row:2; width:100%; max-width:none; max-height:none; inset:auto; border-left:0; border-top:1px solid var(--border); padding:16px; box-shadow:0 -5px 20px #30251f20; }
    .toolbar .primary { margin-left:auto; }
    .onboarding { left:12px; right:12px; bottom:22px; max-width:330px; }
    .review-panel { padding:12px; }
    .review-images { grid-template-columns:1fr; }
    .statusbar { flex-wrap:wrap; gap:4px 12px; }
    .statusbar .feedback { flex:1 1 100%; text-align:left; margin-left:0; }
    .export-menu { margin-left:auto; }
    .export-menu > div { width:min(280px,calc(100vw - 24px)); }
    .toolbar .picker-group { width:100%; gap:6px; }
    .picker-group label { flex:1; min-width:70px; }
    .picker-group select { width:100%; max-width:none; }
    .toolbar-actions { width:100%; flex-wrap:wrap; }
    .toolbar-actions button { padding-inline:8px; }
    .toolbar-actions .primary { margin-left:auto; }
    .toolbar-actions .export-menu { margin-left:0; }
    .shortcut { display:none; }
    .reference-bar { padding:8px 10px; }
    .reference-bar > button { flex:1; }
    .inspect-hint { max-width:calc(100% - 85px); font-size:11px; }
  }
  @media (pointer:coarse) { button, select, input, summary { min-height:44px; } }
`;

export const workbenchPanels = `
  <section class="onboarding workbench-only" id="wb-welcome" aria-label="Getting started" hidden>
    <h2>Your map, one change at a time.</h2>
    <ol><li><strong>Inspect</strong> an element to find its styling.</li><li><strong>Capture</strong> a reference before editing.</li><li>Edit in your editor or with your coding agent. The map updates here; <strong>compare</strong> when ready.</li></ol>
    <div class="actions"><button id="wb-start" class="primary">Inspect the map</button><button id="wb-dismiss">Got it</button></div>
  </section>
  <div id="wb-notice" class="notice" role="status" hidden></div>
  <section class="drawer" id="wb-history" aria-labelledby="wb-history-title" hidden>
    <div class="panel-heading"><h2 id="wb-history-title">Captures</h2><button id="wb-history-close" aria-label="Close capture history">Close</button></div>
    <p class="compact-note" id="wb-history-note">Saved locally in this project. Select a capture to review it.</p>
    <div id="wb-captures" class="capture-list"></div><button id="wb-more" hidden>Load more captures</button>
  </section>
  <section class="review-panel" id="wb-review" aria-labelledby="wb-review-title" hidden>
    <div class="panel-heading"><h2 id="wb-review-title">Compare</h2><div class="review-tabs" role="group" aria-label="What to compare"><button id="wb-saved-tab" aria-pressed="true">Review saved changes</button><button id="wb-live-tab" aria-pressed="false">Compare live maps</button></div><button id="wb-review-close">Back to map</button></div>
    <section id="wb-live-picker" hidden>
      <p class="review-intro">Explore two maps or themes with a shared camera. Both views update when their configuration changes.</p>
      <div class="review-controls"><label>Reference map or theme<select id="wb-reference"></select></label><button id="wb-add-reference">Open live comparison</button></div>
    </section>
    <section id="wb-saved-review">
    <p class="review-intro" id="wb-review-help">Choose two saved captures. Each preserves the map at capture time. Use a reference to keep the same camera and frame for your next change.</p>
    <div class="review-controls"><label><span class="review-source">Reference · saved capture</span><select id="wb-before" aria-label="Reference capture"></select></label><label><span class="review-source">Result · saved capture</span><select id="wb-after" aria-label="Result capture"></select></label><button id="wb-run-compare" class="primary">Compare captures</button></div>
    <button id="wb-pin-reference">${workbenchIcon('pin')}Use selected reference for next capture</button>
    <button id="wb-first-reference">${workbenchIcon('capture')}Capture a reference</button>
    <div class="review-summary-row"><div id="wb-review-result" class="review-result" role="status" hidden></div>
    <div class="review-display" id="wb-saved-display" hidden><label>View <select id="wb-saved-mode"><option value="split">Slider</option><option value="side-by-side">Side by side</option></select></label></div></div>
    <label class="swipe-control" id="wb-swipe-control" hidden>Reference<input id="wb-swipe-position" aria-label="Capture comparison position" type="range" min="0" max="100" value="50">Result</label>
    <div class="capture-swipe" id="wb-swipe" hidden><img id="wb-swipe-before" alt="Before capture"><img id="wb-swipe-after" alt="After capture"></div>
    <div class="review-images" id="wb-review-images"><figure><img id="wb-before-image" alt="Before capture" hidden><figcaption id="wb-before-caption"></figcaption></figure><figure><img id="wb-after-image" alt="After capture" hidden><figcaption id="wb-after-caption"></figcaption></figure></div>
    <details class="review-notes" id="wb-review-notes" hidden><summary>Capture notes</summary><p id="wb-review-warnings"></p></details>
    <details id="wb-diff-section" hidden><summary>Pixel difference</summary><img id="wb-diff" class="review-diff" alt="Contextual pixel difference"></details>
    <details id="wb-review-json-section" hidden><summary>Comparison data</summary><pre id="wb-review-json"></pre></details>
    </section>
  </section>
`;
