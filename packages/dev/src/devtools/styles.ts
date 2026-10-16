import {inspectorStyles} from './inspector-styles';

/** Chrome-like tool chrome; the map retains its independently authored appearance. */
const legacyStyles = `
  body.devtools-ready { color-scheme:light dark; --paper:light-dark(#fff,#202124); --surface:light-dark(#f1f3f4,#292a2d); --ink:light-dark(#202124,#e8eaed); --muted:light-dark(#62676e,#9aa0a6); --border:light-dark(#dadce0,#3c4043); --accent:light-dark(#1a73e8,#8ab4f8); --dt-selected:light-dark(#e8f0fe,#394457); --dt-string:light-dark(#a31515,#e6b98b); --dt-number:light-dark(#1a1aa6,#a8c7fa); font:12px/1.45 Arial,system-ui,sans-serif; background:var(--paper); }
  .devtools-ready button,.devtools-ready input,.devtools-ready select,.devtools-ready summary { min-height:24px; border-radius:2px; font:inherit; }
  .devtools-ready button { padding:3px 8px; background:var(--paper); color:var(--ink); }
  .devtools-ready button:hover { background:var(--surface); border-color:var(--border); }
  .devtools-ready button:focus-visible,.devtools-ready input:focus-visible,.devtools-ready select:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .devtools-ready button[aria-pressed=true] { color:var(--accent); background:var(--dt-selected); }
  .devtools-ready .tool-icon { width:14px; height:14px; }
  .devtools-ready .workspace { display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(180px,1fr) var(--dt-height,340px); flex:1; min-height:0; }
  .devtools-ready .workspace[data-dock=right] { grid-template-columns:minmax(200px,1fr) var(--dt-width,460px); grid-template-rows:minmax(0,1fr); }
  .devtools-ready .workspace[data-dock=left] { grid-template-columns:var(--dt-width,460px) minmax(200px,1fr); grid-template-rows:minmax(0,1fr); }
  .devtools-ready .workspace[data-dock=left] > .stage { grid-column:2; grid-row:1; }
  .devtools-ready .workspace[data-dock=left] > .dt-shell { grid-column:1; grid-row:1; border-right:1px solid var(--border); }
  .devtools-ready .workspace[data-collapsed=true] { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); }
  .devtools-ready .workspace[data-collapsed=true] > .dt-shell { display:none; }
  .devtools-ready .workspace > .inspector { display:none !important; }
  .devtools-ready .inspect-hint { top:8px; font-size:11px; padding:4px 7px; background:var(--paper); color:var(--ink); border:1px solid var(--accent); }
  #dt-reopen { display:none; position:absolute; top:8px; left:8px; z-index:10; box-shadow:0 1px 4px #0002; }
  .workspace[data-collapsed=true] > #dt-reopen { display:block; }
  .devtools-ready .workspace[data-collapsed=true] > .stage { grid-column:1; grid-row:1; }
  .dt-shell { container-type:inline-size; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:visible; position:relative; background:var(--paper); border-top:1px solid var(--border); color:var(--ink); }
  .dt-head { min-height:40px; display:flex; align-items:center; border-bottom:1px solid var(--border); background:var(--surface); padding:0 3px; position:relative; flex:none; }
  .dt-head-main { display:flex; align-items:center; gap:12px; flex:1; min-width:0; align-self:stretch; }
  .dt-tabs { display:flex; min-width:0; overflow-x:auto; scrollbar-width:none; flex:0 1 auto; align-self:stretch; }
  .dt-tabs button { border:0; border-bottom:2px solid transparent; background:transparent; border-radius:0; white-space:nowrap; padding:8px 10px; min-height:38px; }
  .dt-tabs button[aria-selected=true] { color:var(--accent); border-bottom-color:var(--accent); background:var(--paper); }
  .dt-head .dt-icon,.dt-tools .dt-icon { display:inline-flex; align-items:center; justify-content:center; border:0; background:transparent; padding:3px; width:26px; height:26px; flex:none; }
  .dt-head .dt-icon:disabled { opacity:.35; cursor:default; }
  .dt-icon svg { width:16px; height:16px; pointer-events:none; }
  .dt-divider { height:16px; border-left:1px solid var(--border); margin:0 4px; }
  .dt-camera { display:flex; align-items:center; flex-wrap:nowrap; gap:8px; min-width:0; flex:none; border:0; border-left:1px solid var(--border); margin:5px 0; padding:0 0 0 12px; overflow-x:auto; scrollbar-width:thin; }
  .dt-camera-field { display:flex; align-items:center; gap:4px; min-width:0; flex:none; }
  .dt-camera-field > label { color:var(--muted); font-size:11px; line-height:1; }
  .dt-stepper { display:flex; align-items:stretch; height:26px; border:1px solid var(--border); border-radius:4px; overflow:hidden; background:var(--paper); }
  .dt-stepper input[type=number] { appearance:textfield; -moz-appearance:textfield; width:54px; min-width:0; min-height:0; padding:2px 0; border:0; border-radius:0; background:transparent; color:var(--ink); text-align:center; font-variant-numeric:tabular-nums; }
  .dt-stepper input::-webkit-inner-spin-button,.dt-stepper input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
  .dt-stepper button { width:24px; min-height:0; padding:0; border:0; border-radius:0; background:transparent; font-size:15px; line-height:1; }
  .dt-stepper button:disabled { color:var(--muted); opacity:.4; cursor:default; }
  .dt-camera:disabled { opacity:.5; }
  .dt-camera-reset { flex:none; height:26px; }
  .dt-menu { position:absolute; z-index:40; right:5px; top:40px; padding:8px; background:var(--paper); color:var(--ink); border:1px solid var(--border); box-shadow:0 4px 16px #0003; min-width:190px; border-radius:4px; }
  :is([data-dock=left],[data-dock=right]) .dt-head { flex-wrap:wrap; }
  :is([data-dock=left],[data-dock=right]) .dt-head > .dt-icon { margin-block:6px; }
  :is([data-dock=left],[data-dock=right]) .dt-head-main { display:contents; }
  :is([data-dock=left],[data-dock=right]) .dt-tabs { flex:1; }
  :is([data-dock=left],[data-dock=right]) .dt-camera-field { flex:1 0 96px; }
  :is([data-dock=left],[data-dock=right]) .dt-stepper { flex:1; min-width:0; }
  :is([data-dock=left],[data-dock=right]) .dt-stepper input[type=number] { flex:1; width:0; }
  :is([data-dock=left],[data-dock=right]) .dt-stepper button { flex:none; width:22px; }
  :is([data-dock=left],[data-dock=right]) .dt-menu { top:38px; }
  @container(max-width:1050px) {
    .dt-head { flex-wrap:wrap; }
    .dt-head > .dt-icon { margin-block:6px; }
    .dt-head-main { display:contents; }
    .dt-tabs { flex:1; }
    .dt-camera-field { flex:1 0 96px; }
    .dt-stepper { flex:1; min-width:0; }
    .dt-stepper input[type=number] { flex:1; width:0; }
    .dt-stepper button { flex:none; width:22px; }
    .dt-menu { top:38px; }
  }
  .dt-menu-label { color:var(--muted); margin:2px 0 6px; }
  .dt-dock-options { display:flex; gap:4px; }
  .dt-dock-options button { padding:6px; display:flex; }
  .dt-dock-options svg { width:24px; height:20px; }
  .dt-resize { position:absolute; z-index:5; height:6px; left:0; right:0; top:-4px; cursor:ns-resize; touch-action:none; }
  [data-dock=right] > .dt-shell > .dt-resize { top:0; bottom:0; left:-4px; width:6px; height:auto; right:auto; cursor:ew-resize; }
  [data-dock=left] > .dt-shell > .dt-resize { top:0; bottom:0; right:-4px; width:6px; height:auto; left:auto; cursor:ew-resize; }
  .dt-resize-shield { position:absolute; inset:0; z-index:30; background:transparent; }
  .dt-body { flex:1; display:flex; flex-direction:column; min-height:0; overflow:hidden; }
  .dt-panel { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
  .dt-tools { min-height:29px; display:flex; flex-wrap:wrap; align-items:center; gap:5px; border-bottom:1px solid var(--border); padding:3px 6px; flex:none; }
  .dt-tools input[type=search] { width:160px; flex:1; min-width:75px; border:1px solid var(--border); background:var(--paper); color:var(--ink); padding:2px 6px; }
  .dt-tools label { display:flex; align-items:center; gap:4px; white-space:nowrap; color:var(--muted); }
  .dt-tools select { max-width:160px; padding:2px; }
  .dt-tools input[type=checkbox] { min-height:0; margin:0; accent-color:var(--accent); }
  .dt-tools button { border-color:transparent; background:transparent; }
  .dt-footer { min-height:23px; padding:3px 8px; border-top:1px solid var(--border); color:var(--muted); font-size:11px; flex:none; display:flex; gap:12px; }
  .dt-scroll { flex:1; overflow:auto; min-height:0; min-width:0; }
  .dt-empty { color:var(--muted); padding:22px; text-align:center; margin:auto; max-width:420px; }
  .dt-empty strong { color:var(--ink); display:block; margin-bottom:6px; font-weight:400; }
  .dt-inspect-grid { display:grid; grid-template-columns:minmax(220px,1fr) minmax(300px,42%); flex:1; min-height:0; }
  .dt-tree-column { display:flex; flex-direction:column; min-height:0; border-right:1px solid var(--border); }
  .dt-tree { flex:1; min-height:0; overflow:auto; font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace; padding:5px 0; }
  .dt-tree-row { display:flex; width:100%; gap:6px; align-items:center; min-height:23px; padding:2px 8px; white-space:nowrap; border:0 !important; border-radius:0 !important; text-align:left; background:transparent !important; font:inherit !important; }
  .dt-tree-row[aria-selected=true] { background:var(--dt-selected) !important; }
  .dt-tree-row:hover { background:var(--surface) !important; }
  .dt-tree-row .dt-token { color:var(--dt-number); }
  .dt-tree-row .dt-attr { color:var(--dt-string); }
  .dt-tree-row .dt-dim { color:var(--muted); }
  .dt-tree-row .dt-truncate { overflow:hidden; text-overflow:ellipsis; }
  .dt-details { min-width:0; min-height:0; display:flex; flex-direction:column; }
  .dt-subtabs { display:flex; gap:2px; border-bottom:1px solid var(--border); flex:none; overflow-x:auto; }
  .dt-subtabs button { border:0; border-bottom:2px solid transparent; border-radius:0; padding:4px 8px; white-space:nowrap; }
  .dt-subtabs button[aria-selected=true] { border-bottom-color:var(--accent); color:var(--accent); }
  .dt-rule { border-bottom:1px solid var(--border); padding:7px 9px; font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace; }
  .dt-rule-title { display:flex; justify-content:space-between; gap:8px; color:var(--ink); overflow-wrap:anywhere; margin-bottom:4px; }
  .dt-rule-origin { color:var(--muted); font:11px/1.6 Arial,sans-serif; text-align:right; }
  .dt-property { display:flex; align-items:center; gap:4px; padding:1px 0 1px 14px; min-height:24px; }
  .dt-property-name { color:light-dark(#881391,#c58af9); flex:none; }
  .dt-property input[type=text],.dt-property input[type=number],.dt-property select { border:1px solid transparent; background:transparent; min-width:30px; flex:1; width:100%; padding:0 2px; color:var(--dt-string); border-radius:0; font:inherit; min-height:22px; }
  .dt-property input:focus,.dt-property input:hover { border-color:var(--border); }
  .dt-property input[type=color] { width:14px; height:14px; padding:0; min-height:0; border:0; flex:none; background:transparent; cursor:pointer; }
  .dt-property input[type=color]::-webkit-color-swatch-wrapper { padding:0; }
  .dt-property input[type=color]::-webkit-color-swatch { border:1px solid var(--border); }
  .dt-property .dt-revert { border:0; padding:0 3px; min-height:18px; color:var(--muted); background:transparent; }
  .dt-property[data-modified=true] { background:color-mix(in srgb,var(--accent) 8%,transparent); }
  .dt-expression { display:block; padding-left:14px; color:var(--muted); white-space:pre-wrap; overflow-wrap:anywhere; font-size:11px; }
  .dt-table { border-collapse:collapse; width:100%; font-size:11px; text-align:left; }
  .dt-table th { position:sticky; top:0; z-index:1; background:var(--surface); font-weight:400; border-bottom:1px solid var(--border); border-right:1px solid var(--border); padding:3px 7px; white-space:nowrap; }
  .dt-table th button { font:inherit; border:0; padding:0; min-height:18px; background:transparent; }
  .dt-table td { padding:3px 7px; border-bottom:1px solid color-mix(in srgb,var(--border) 45%,transparent); max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; height:24px; }
  .dt-table tbody tr:nth-child(even) { background:color-mix(in srgb,var(--surface) 55%,transparent); }
  .dt-table tbody tr[aria-selected=true] { background:var(--dt-selected); }
  .dt-table tbody tr:hover { background:var(--surface); }
  .dt-table .dt-cell-button { text-align:left; border:0; background:transparent; min-height:18px; padding:0; color:inherit; max-width:100%; overflow:hidden; text-overflow:ellipsis; font:inherit; }
  .dt-table .dt-number { font-variant-numeric:tabular-nums; text-align:right; }
  .dt-table .dt-error { color:light-dark(#b3261e,#f2b8b5); }
  .dt-network-body { display:flex; flex:1; min-height:0; min-width:0; }
  .dt-network-body > .dt-scroll { flex:1; min-width:0; }
  .dt-network-body[data-selected=true] > .dt-scroll { flex:1 1 55%; }
  .dt-network-detail { display:flex; flex-direction:column; flex:1 1 45%; min-width:290px; min-height:0; border-left:1px solid var(--border); background:var(--paper); }
  .dt-network-detail[hidden] { display:none; }
  .dt-tile-row { cursor:pointer; }
  .dt-tile-heading { flex:none; justify-content:space-between; }
  .dt-tile-heading strong { font-size:12px; font-weight:500; }
  .dt-tile-heading button { border:0; font-size:18px; }
  .dt-tile-content { min-height:0; }
  .dt-tile-content select { width:100%; min-width:0; background:var(--paper); color:var(--ink); border:1px solid var(--border); padding:4px; }
  .dt-tile-paging { justify-content:space-between; }
  .dt-tile-feature { border-bottom:1px solid var(--border); padding:5px 8px; }
  .dt-tile-feature summary { cursor:pointer; overflow-wrap:anywhere; font-size:11px; }
  .dt-tile-feature details { padding-left:12px; }
  .dt-tile-feature pre { white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.6 ui-monospace,monospace; color:var(--dt-string); margin:6px 0; }
  :is([data-dock=left],[data-dock=right]) .dt-network-body { flex-direction:column; }
  :is([data-dock=left],[data-dock=right]) .dt-network-body[data-selected=true] > .dt-scroll { flex:0 0 35%; }
  :is([data-dock=left],[data-dock=right]) .dt-network-detail { flex:1; min-width:0; border-left:0; border-top:1px solid var(--border); }
  @container(max-width:680px) {
    .dt-network-body { flex-direction:column; }
    .dt-network-body[data-selected=true] > .dt-scroll { flex:0 0 35%; }
    .dt-network-detail { flex:1; min-width:0; border-left:0; border-top:1px solid var(--border); }
  }
  .dt-kv { display:grid; grid-template-columns:minmax(100px,auto) minmax(0,1fr); gap:5px 12px; font:12px/1.5 ui-monospace,monospace; padding:8px; margin:0; }
  .dt-kv dt { color:var(--muted); overflow-wrap:anywhere; }.dt-kv dd { margin:0; overflow-wrap:anywhere; }
  .dt-note { color:var(--muted); font-size:11px; padding:6px 8px; margin:0; }
  .dt-status-message { color:var(--accent); padding:4px 8px; border-top:1px solid var(--border); font-size:11px; }
  .dt-shell .notice { position:static; padding:5px 9px; border:0; font:11px/1.5 ui-monospace,monospace; box-shadow:none; color:light-dark(#b3261e,#f2b8b5); }
  .dt-scene-content { display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; width:100%; max-width:1000px; align-self:flex-start; }
  .dt-shell .map-controls { flex:1; width:100%; max-width:none; padding:0 16px 16px; border:0; overflow:auto; background:var(--paper); }
  .dt-shell .controls-grid,.dt-shell #controls-modules { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 24px; align-items:start; }
  .dt-shell .controls-grid { border-bottom:1px solid var(--border); padding-bottom:8px; }
  .dt-shell .controls-selection,.dt-shell .controls-runtime { border:0; padding-bottom:0; }
  .dt-shell .map-controls .control-field,.dt-shell .control-module-header label { display:grid; grid-template-columns:min(36%,160px) minmax(0,1fr); align-items:center; gap:12px; min-height:28px; }
  .dt-shell .map-controls .control-field > select,.dt-shell .map-controls .control-field > input[type=number] { justify-self:start; width:min(200px,100%); max-width:100%; }
  .dt-shell .map-controls input[type=checkbox] { appearance:none; -webkit-appearance:none; position:relative; justify-self:start; flex:none; width:34px; height:20px; min-height:20px; margin:0; padding:0; border:1px solid light-dark(#9aa0a6,#7c838d); border-radius:999px; background:light-dark(#e3e7ed,#444950); cursor:pointer; transition:background-color 120ms ease,border-color 120ms ease; }
  .dt-shell .map-controls input[type=checkbox]::before { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:light-dark(#fff,#c4c8cf); box-shadow:0 1px 2px #0003; transition:transform 120ms ease,background-color 120ms ease; }
  .dt-shell .map-controls input[type=checkbox]:checked { background:var(--accent); border-color:var(--accent); }
  .dt-shell .map-controls input[type=checkbox]:checked::before { transform:translateX(14px); background:light-dark(#fff,#202124); }
  .dt-shell .map-controls input[type=checkbox]:hover:not(:disabled) { box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent); }
  .dt-shell .map-controls input[type=checkbox]:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  .dt-shell .map-controls input[type=checkbox]:disabled { cursor:not-allowed; }
  .dt-shell .map-controls .control-field:has(input[type=checkbox]:not(:disabled)) { cursor:pointer; }
  .dt-shell .controls-heading button { min-width:60px; }
  .dt-shell .controls-segments button { padding:4px 10px; border-radius:0; }
  @media (prefers-reduced-motion:reduce) { .dt-shell .map-controls input[type=checkbox],.dt-shell .map-controls input[type=checkbox]::before { transition:none; } }
  .dt-shell .control-module { border:0; border-bottom:1px solid var(--border); border-radius:0; background:var(--paper); margin:0; }
  .dt-shell .control-module-header { padding:5px 0; }.dt-shell .control-module-header label { font-size:12px; font-weight:400; }
  .dt-shell .control-module fieldset { min-width:0; padding:0 0 8px 16px; }.dt-shell .control-module summary { padding:2px 0 5px; }
  .dt-shell .controls-section-title { margin:10px 0 4px; font-size:11px; letter-spacing:0; text-transform:none; }
  .dt-shell .control-field { margin:5px 0; }
  @container(max-width:680px) { .dt-shell .controls-grid,.dt-shell #controls-modules { grid-template-columns:minmax(0,1fr); }.dt-shell .map-controls .control-field,.dt-shell .control-module-header label { grid-template-columns:min(36%,160px) minmax(0,1fr); }.dt-shell .controls-segments button { padding-inline:8px; } }
  .dt-shell .controls-code { background:var(--surface); }.dt-shell .controls-selection .control-field select { max-width:100%; }
  .dt-shell .panel-heading h2 { font:12px Arial,sans-serif; }.dt-shell .review-tabs { margin:0; padding:0; }
  .dt-assets-content { scrollbar-gutter:stable; }
  .dt-font-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr)); max-width:1100px; }
  .dt-font-card { min-width:0; margin:0; padding:14px 12px; border-bottom:1px solid var(--border); }
  .dt-font-card figcaption { margin-bottom:8px; font:12px/1.5 ui-monospace,monospace; }
  .dt-font-sample { min-height:94px; overflow-x:auto; border:1px solid var(--border); border-radius:3px; background:#fff; color:#303b4b; }
  .dt-font-preview { display:block; }
  .dt-font-loading { display:block; padding:15px 10px; font-size:11px; color:#62676e; }
  .dt-sprite-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:1px; padding:1px; background:var(--border); }
  .dt-sprite-card { margin:0; min-width:0; padding:10px 8px 8px; background:var(--paper); text-align:center; }
  .dt-sprite-card:hover { background:var(--dt-selected); }
  .dt-sprite-preview { height:60px; display:flex; align-items:center; justify-content:center; border:1px solid #dadce0; border-radius:3px; background:repeating-conic-gradient(#e8eaed 0% 25%,#fff 0% 50%) 0 0 / 12px 12px; color:#62676e; }
  .dt-sprite-card figcaption { margin-top:7px; font:11px/1.4 ui-monospace,monospace; overflow-wrap:anywhere; }
  .dt-sprite-size { display:block; min-height:15px; margin-top:3px; color:var(--muted); font-size:10px; }
  .dt-geometry-json { width:100%; min-height:100px; resize:vertical; background:var(--paper); color:var(--ink); border:1px solid var(--border); font:11px/1.5 ui-monospace,monospace; padding:6px; }
  .dt-vertex { position:absolute; width:10px; height:10px; border:2px solid #1a73e8; background:#fff; transform:translate(-50%,-50%); pointer-events:auto; padding:0; min-height:0; border-radius:1px; cursor:move; touch-action:none; }
  .dt-geometry-handles { position:absolute; inset:0; pointer-events:none; z-index:5; overflow:hidden; }
  .dt-performance { padding:10px; }.dt-performance svg { width:100%; height:90px; display:block; }.dt-performance dl { max-width:600px; }
  .dt-overdraw-help { max-width:640px; margin:10px 10px 0; padding:10px 12px; border:1px solid var(--border); border-left:3px solid var(--accent); border-radius:4px; background:var(--surface); }
  .dt-overdraw-help[hidden] { display:none; }
  .dt-overdraw-help strong { font-size:12px; }.dt-overdraw-help p { margin:5px 0 0; line-height:1.5; }
  .dt-overdraw-legend { display:flex; flex-wrap:wrap; gap:6px 20px; margin:10px 0 8px; }
  .dt-overdraw-key { display:inline-flex; align-items:center; gap:6px; font:11px/1.4 ui-monospace,monospace; }
  .dt-overdraw-swatch { width:24px; height:10px; border:1px solid #0002; border-radius:2px; }
  .dt-overdraw-caption { color:var(--muted); font-size:11px; }
  .dt-badge { background:var(--dt-selected); color:var(--accent); border-radius:7px; padding:0 5px; margin-left:3px; font:10px/1.5 Arial,sans-serif; }
  [data-dock=left] .dt-inspect-grid,[data-dock=right] .dt-inspect-grid { display:flex; flex-direction:column; }
  [data-dock=left] .dt-tree-column,[data-dock=right] .dt-tree-column { flex:0 0 32%; border-right:0; border-bottom:1px solid var(--border); }
  [data-dock=left] .dt-details,[data-dock=right] .dt-details { flex:1; }
  .dt-zoom { padding:8px; }.dt-zoom > select { width:100%; margin-bottom:8px; }
  @container(max-width:680px) { .dt-inspect-grid { display:flex;flex-direction:column; }.dt-tree-column { flex:0 0 32%;border-right:0;border-bottom:1px solid var(--border); }.dt-details { flex:1; } }
`;

export const devtoolsStyles = legacyStyles + inspectorStyles;
