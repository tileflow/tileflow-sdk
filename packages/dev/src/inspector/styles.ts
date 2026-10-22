import {cardStyles} from './card-styles';
import {inspectorStyles as paletteStyles} from './inspector-styles';

/** Chrome-like tool chrome; the map retains its independently authored appearance. */
const legacyStyles = `
  body.inspector-ready { color-scheme:light dark; --paper:light-dark(#fff,#202124); --surface:light-dark(#f1f3f4,#292a2d); --ink:light-dark(#202124,#e8eaed); --muted:light-dark(#62676e,#9aa0a6); --border:light-dark(#dadce0,#3c4043); --accent:light-dark(#1a73e8,#8ab4f8); --inspector-selected:light-dark(#e8f0fe,#394457); --inspector-string:light-dark(#a31515,#e6b98b); --inspector-number:light-dark(#1a1aa6,#a8c7fa); font:12px/1.45 Arial,system-ui,sans-serif; background:var(--paper); }
  .inspector-ready button,.inspector-ready input,.inspector-ready select,.inspector-ready summary { min-height:24px; border-radius:2px; font:inherit; }
  .inspector-ready button { padding:3px 8px; background:var(--paper); color:var(--ink); }
  .inspector-ready button:hover { background:var(--surface); border-color:var(--border); }
  .inspector-ready button:focus-visible,.inspector-ready input:focus-visible,.inspector-ready select:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .inspector-ready button[aria-pressed=true] { color:var(--accent); background:var(--inspector-selected); }
  .inspector-ready .tool-icon { width:14px; height:14px; }
  .inspector-ready .workspace { display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(180px,1fr) var(--inspector-height,340px); flex:1; min-height:0; }
  .inspector-ready .workspace[data-dock=right] { grid-template-columns:minmax(200px,1fr) max(640px,var(--inspector-width,760px)); grid-template-rows:minmax(0,1fr); }
  .inspector-ready .workspace[data-dock=left] { grid-template-columns:max(640px,var(--inspector-width,760px)) minmax(200px,1fr); grid-template-rows:minmax(0,1fr); }
  .inspector-ready .workspace[data-dock=left] > .stage { grid-column:2; grid-row:1; }
  .inspector-ready .workspace[data-dock=left] > .inspector-shell { grid-column:1; grid-row:1; border-right:1px solid var(--border); }
  .inspector-ready .workspace[data-collapsed=true] { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); }
  .inspector-ready .workspace[data-collapsed=true] > .inspector-shell { display:none; }
  .inspector-ready .workspace > .inspector { display:none !important; }
  .inspector-ready .inspect-hint { top:8px; font-size:11px; padding:4px 7px; background:var(--paper); color:var(--ink); border:1px solid var(--accent); }
  #inspector-reopen { display:none; position:absolute; top:8px; left:8px; z-index:10; box-shadow:0 1px 4px #0002; }
  .workspace[data-collapsed=true] > #inspector-reopen { display:block; }
  .inspector-ready .workspace[data-collapsed=true] > .stage { grid-column:1; grid-row:1; }
  .inspector-shell { container-type:inline-size; display:flex; flex-direction:column; min-width:0; min-height:0; overflow:visible; position:relative; background:var(--paper); border-top:1px solid var(--border); color:var(--ink); }
  .inspector-head { min-height:40px; display:flex; align-items:center; border-bottom:1px solid var(--border); background:var(--surface); padding:0 3px; position:relative; flex:none; }
  .inspector-head-main { display:flex; align-items:center; gap:12px; flex:1; min-width:0; align-self:stretch; }
  .inspector-tabs { display:flex; min-width:0; overflow-x:auto; scrollbar-width:none; flex:0 1 auto; align-self:stretch; }
  .inspector-tabs button { border:0; border-bottom:2px solid transparent; background:transparent; border-radius:0; white-space:nowrap; padding:8px 10px; min-height:38px; }
  .inspector-tabs button[aria-selected=true] { color:var(--accent); border-bottom-color:var(--accent); background:var(--paper); }
  .inspector-head .inspector-icon,.inspector-tools .inspector-icon { display:inline-flex; align-items:center; justify-content:center; border:0; background:transparent; padding:3px; width:26px; height:26px; flex:none; }
  .inspector-head .inspector-icon:disabled { opacity:.35; cursor:default; }
  .inspector-icon svg { width:16px; height:16px; pointer-events:none; }
  .inspector-divider { height:16px; border-left:1px solid var(--border); margin:0 4px; }
  .inspector-camera { display:flex; align-items:center; flex-wrap:nowrap; gap:8px; min-width:0; flex:none; border:0; border-left:1px solid var(--border); margin:5px 0; padding:0 0 0 12px; overflow-x:auto; scrollbar-width:thin; }
  .inspector-camera-field { display:flex; align-items:center; gap:4px; min-width:0; flex:none; }
  .inspector-camera-field > label { color:var(--muted); font-size:11px; line-height:1; }
  .inspector-stepper { display:flex; align-items:stretch; height:26px; border:1px solid var(--border); border-radius:4px; overflow:hidden; background:var(--paper); }
  .inspector-stepper input[type=number] { appearance:textfield; -moz-appearance:textfield; width:54px; min-width:0; min-height:0; padding:2px 0; border:0; border-radius:0; background:transparent; color:var(--ink); text-align:center; font-variant-numeric:tabular-nums; }
  .inspector-stepper input::-webkit-inner-spin-button,.inspector-stepper input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
  .inspector-stepper button { width:24px; min-height:0; padding:0; border:0; border-radius:0; background:transparent; font-size:15px; line-height:1; }
  .inspector-stepper button:disabled { color:var(--muted); opacity:.4; cursor:default; }
  .inspector-camera:disabled { opacity:.5; }
  .inspector-camera-reset { flex:none; height:26px; }
  .inspector-menu { position:absolute; z-index:40; right:5px; top:40px; padding:8px; background:var(--paper); color:var(--ink); border:1px solid var(--border); box-shadow:0 4px 16px #0003; min-width:190px; border-radius:4px; }
  :is([data-dock=left],[data-dock=right]) .inspector-head { flex-wrap:wrap; }
  :is([data-dock=left],[data-dock=right]) .inspector-head > .inspector-icon { margin-block:6px; }
  :is([data-dock=left],[data-dock=right]) .inspector-head-main { display:contents; }
  :is([data-dock=left],[data-dock=right]) .inspector-tabs { flex:1; }
  :is([data-dock=left],[data-dock=right]) .inspector-camera-field { flex:1 0 96px; }
  :is([data-dock=left],[data-dock=right]) .inspector-stepper { flex:1; min-width:0; }
  :is([data-dock=left],[data-dock=right]) .inspector-stepper input[type=number] { flex:1; width:0; }
  :is([data-dock=left],[data-dock=right]) .inspector-stepper button { flex:none; width:22px; }
  :is([data-dock=left],[data-dock=right]) .inspector-menu { top:38px; }
  @container(max-width:1050px) {
    .inspector-head { flex-wrap:wrap; }
    .inspector-head > .inspector-icon { margin-block:6px; }
    .inspector-head-main { display:contents; }
    .inspector-tabs { flex:1; }
    .inspector-camera-field { flex:1 0 96px; }
    .inspector-stepper { flex:1; min-width:0; }
    .inspector-stepper input[type=number] { flex:1; width:0; }
    .inspector-stepper button { flex:none; width:22px; }
    .inspector-menu { top:38px; }
  }
  .inspector-menu-label { color:var(--muted); margin:2px 0 6px; }
  .inspector-dock-options { display:flex; gap:4px; }
  .inspector-dock-options button { padding:6px; display:flex; }
  .inspector-dock-options svg { width:24px; height:20px; }
  .inspector-resize { position:absolute; z-index:5; height:6px; left:0; right:0; top:-4px; cursor:ns-resize; touch-action:none; }
  [data-dock=right] > .inspector-shell > .inspector-resize { top:0; bottom:0; left:-4px; width:6px; height:auto; right:auto; cursor:ew-resize; }
  [data-dock=left] > .inspector-shell > .inspector-resize { top:0; bottom:0; right:-4px; width:6px; height:auto; left:auto; cursor:ew-resize; }
  .inspector-resize-shield { position:absolute; inset:0; z-index:30; background:transparent; }
  .inspector-body { flex:1; display:flex; flex-direction:column; min-height:0; overflow:hidden; }
  .inspector-panel { flex:1; min-height:0; min-width:0; display:flex; flex-direction:column; overflow:hidden; }
  .inspector-tools { min-height:29px; display:flex; flex-wrap:wrap; align-items:center; gap:5px; border-bottom:1px solid var(--border); padding:3px 6px; flex:none; }
  .inspector-tools input[type=search] { width:160px; flex:1; min-width:75px; border:1px solid var(--border); background:var(--paper); color:var(--ink); padding:2px 6px; }
  .inspector-tools label { display:flex; align-items:center; gap:4px; white-space:nowrap; color:var(--muted); }
  .inspector-tools select { max-width:160px; padding:2px; }
  .inspector-tools input[type=checkbox] { min-height:0; margin:0; accent-color:var(--accent); }
  .inspector-tools button { border-color:transparent; background:transparent; }
  .inspector-footer { min-height:23px; padding:3px 8px; border-top:1px solid var(--border); color:var(--muted); font-size:11px; flex:none; display:flex; gap:12px; }
  .inspector-scroll { flex:1; overflow:auto; min-height:0; min-width:0; }
  .inspector-empty { color:var(--muted); padding:22px; text-align:center; margin:auto; max-width:420px; }
  .inspector-empty strong { color:var(--ink); display:block; margin-bottom:6px; font-weight:400; }
  .inspector-inspect-grid { display:grid; grid-template-columns:minmax(220px,1fr) minmax(300px,42%); flex:1; min-height:0; }
  .inspector-tree-column { display:flex; flex-direction:column; min-height:0; border-right:1px solid var(--border); }
  .inspector-tree { flex:1; min-height:0; overflow:auto; font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace; padding:5px 0; }
  .inspector-tree-row { display:flex; width:100%; gap:6px; align-items:center; min-height:23px; padding:2px 8px; white-space:nowrap; border:0 !important; border-radius:0 !important; text-align:left; background:transparent !important; font:inherit !important; }
  .inspector-tree-row[aria-selected=true] { background:var(--inspector-selected) !important; }
  .inspector-tree-row:hover { background:var(--surface) !important; }
  .inspector-tree-row .inspector-token { color:var(--inspector-number); }
  .inspector-tree-row .inspector-attr { color:var(--inspector-string); }
  .inspector-tree-row .inspector-dim { color:var(--muted); }
  .inspector-tree-row .inspector-truncate { overflow:hidden; text-overflow:ellipsis; }
  .inspector-details { min-width:0; min-height:0; display:flex; flex-direction:column; }
  .inspector-subtabs { display:flex; gap:2px; border-bottom:1px solid var(--border); flex:none; overflow-x:auto; }
  .inspector-subtabs button { border:0; border-bottom:2px solid transparent; border-radius:0; padding:4px 8px; white-space:nowrap; }
  .inspector-subtabs button[aria-selected=true] { border-bottom-color:var(--accent); color:var(--accent); }
  .inspector-rule { border-bottom:1px solid var(--border); padding:7px 9px; font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace; }
  .inspector-rule-title { display:flex; justify-content:space-between; gap:8px; color:var(--ink); overflow-wrap:anywhere; margin-bottom:4px; }
  .inspector-rule-origin { color:var(--muted); font:11px/1.6 Arial,sans-serif; text-align:right; }
  .inspector-property { display:flex; align-items:center; gap:4px; padding:1px 0 1px 14px; min-height:24px; }
  .inspector-property-name { color:light-dark(#881391,#c58af9); flex:none; }
  .inspector-property input[type=text],.inspector-property input[type=number],.inspector-property select { border:1px solid transparent; background:transparent; min-width:30px; flex:1; width:100%; padding:0 2px; color:var(--inspector-string); border-radius:0; font:inherit; min-height:22px; }
  .inspector-property input:focus,.inspector-property input:hover { border-color:var(--border); }
  .inspector-property input[type=color] { width:14px; height:14px; padding:0; min-height:0; border:0; flex:none; background:transparent; cursor:pointer; }
  .inspector-property input[type=color]::-webkit-color-swatch-wrapper { padding:0; }
  .inspector-property input[type=color]::-webkit-color-swatch { border:1px solid var(--border); }
  .inspector-property .inspector-revert { border:0; padding:0 3px; min-height:18px; color:var(--muted); background:transparent; }
  .inspector-property[data-modified=true] { background:color-mix(in srgb,var(--accent) 8%,transparent); }
  .inspector-expression { display:block; padding-left:14px; color:var(--muted); white-space:pre-wrap; overflow-wrap:anywhere; font-size:11px; }
  .inspector-table { border-collapse:collapse; width:100%; font-size:11px; text-align:left; }
  .inspector-table th { position:sticky; top:0; z-index:1; background:var(--surface); font-weight:400; border-bottom:1px solid var(--border); border-right:1px solid var(--border); padding:3px 7px; white-space:nowrap; }
  .inspector-table th button { font:inherit; border:0; padding:0; min-height:18px; background:transparent; }
  .inspector-table td { padding:3px 7px; border-bottom:1px solid color-mix(in srgb,var(--border) 45%,transparent); max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; height:24px; }
  .inspector-table tbody tr:nth-child(even) { background:color-mix(in srgb,var(--surface) 55%,transparent); }
  .inspector-table tbody tr[aria-selected=true] { background:var(--inspector-selected); }
  .inspector-table tbody tr:hover { background:var(--surface); }
  .inspector-table .inspector-cell-button { text-align:left; border:0; background:transparent; min-height:18px; padding:0; color:inherit; max-width:100%; overflow:hidden; text-overflow:ellipsis; font:inherit; }
  .inspector-table .inspector-number { font-variant-numeric:tabular-nums; text-align:right; }
  .inspector-table .inspector-error { color:light-dark(#b3261e,#f2b8b5); }
  .inspector-network-body { display:flex; flex:1; min-height:0; min-width:0; }
  .inspector-network-body > .inspector-scroll { flex:1; min-width:0; }
  .inspector-network-body[data-selected=true] > .inspector-scroll { flex:1 1 55%; }
  .inspector-network-detail { display:flex; flex-direction:column; flex:1 1 45%; min-width:290px; min-height:0; border-left:1px solid var(--border); background:var(--paper); }
  .inspector-network-detail[hidden] { display:none; }
  .inspector-tile-row { cursor:pointer; }
  .inspector-tile-heading { flex:none; justify-content:space-between; }
  .inspector-tile-heading strong { font-size:12px; font-weight:500; }
  .inspector-tile-heading button { border:0; font-size:18px; }
  .inspector-tile-content { min-height:0; }
  .inspector-tile-content select { width:100%; min-width:0; background:var(--paper); color:var(--ink); border:1px solid var(--border); padding:4px; }
  .inspector-tile-paging { justify-content:space-between; }
  .inspector-tile-feature { border-bottom:1px solid var(--border); padding:5px 8px; }
  .inspector-tile-feature summary { cursor:pointer; overflow-wrap:anywhere; font-size:11px; }
  .inspector-tile-feature details { padding-left:12px; }
  .inspector-tile-feature pre { white-space:pre-wrap; overflow-wrap:anywhere; font:11px/1.6 ui-monospace,monospace; color:var(--inspector-string); margin:6px 0; }
  .inspector-kv { display:grid; grid-template-columns:minmax(100px,auto) minmax(0,1fr); gap:5px 12px; font:12px/1.5 ui-monospace,monospace; padding:8px; margin:0; }
  .inspector-kv dt { color:var(--muted); overflow-wrap:anywhere; }.inspector-kv dd { margin:0; overflow-wrap:anywhere; }
  .inspector-note { color:var(--muted); font-size:11px; padding:6px 8px; margin:0; }
  .inspector-status-message { color:var(--accent); padding:4px 8px; border-top:1px solid var(--border); font-size:11px; }
  .inspector-shell .notice { position:static; padding:5px 9px; border:0; font:11px/1.5 ui-monospace,monospace; box-shadow:none; color:light-dark(#b3261e,#f2b8b5); }
  .inspector-scene-content { display:flex; flex-direction:column; flex:1; min-height:0; min-width:0; width:100%; max-width:1000px; align-self:flex-start; }
  .inspector-shell .map-controls { flex:1; width:100%; max-width:none; padding:0 16px 16px; border:0; overflow:auto; background:var(--paper); }
  .inspector-shell .controls-grid,.inspector-shell #controls-modules { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 24px; align-items:start; }
  .inspector-shell .controls-grid { border-bottom:1px solid var(--border); padding-bottom:8px; }
  .inspector-shell .controls-selection,.inspector-shell .controls-runtime { border:0; padding-bottom:0; }
  .inspector-shell .map-controls .control-field,.inspector-shell .control-module-header label { display:grid; grid-template-columns:min(36%,160px) minmax(0,1fr); align-items:center; gap:12px; min-height:28px; }
  .inspector-shell .map-controls .control-field > select,.inspector-shell .map-controls .control-field > input[type=number] { justify-self:start; width:min(200px,100%); max-width:100%; }
  .inspector-shell .map-controls input[type=checkbox] { appearance:none; -webkit-appearance:none; position:relative; justify-self:start; flex:none; width:34px; height:20px; min-height:20px; margin:0; padding:0; border:1px solid light-dark(#9aa0a6,#7c838d); border-radius:999px; background:light-dark(#e3e7ed,#444950); cursor:pointer; transition:background-color 120ms ease,border-color 120ms ease; }
  .inspector-shell .map-controls input[type=checkbox]::before { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:light-dark(#fff,#c4c8cf); box-shadow:0 1px 2px #0003; transition:transform 120ms ease,background-color 120ms ease; }
  .inspector-shell .map-controls input[type=checkbox]:checked { background:var(--accent); border-color:var(--accent); }
  .inspector-shell .map-controls input[type=checkbox]:checked::before { transform:translateX(14px); background:light-dark(#fff,#202124); }
  .inspector-shell .map-controls input[type=checkbox]:hover:not(:disabled) { box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent); }
  .inspector-shell .map-controls input[type=checkbox]:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  .inspector-shell .map-controls input[type=checkbox]:disabled { cursor:not-allowed; }
  .inspector-shell .map-controls .control-field:has(input[type=checkbox]:not(:disabled)) { cursor:pointer; }
  .inspector-shell .controls-heading button { min-width:60px; }
  .inspector-shell .controls-segments button { padding:4px 10px; border-radius:0; }
  @media (prefers-reduced-motion:reduce) { .inspector-shell .map-controls input[type=checkbox],.inspector-shell .map-controls input[type=checkbox]::before { transition:none; } }
  .inspector-shell .control-module { border:0; border-bottom:1px solid var(--border); border-radius:0; background:var(--paper); margin:0; }
  .inspector-shell .control-module-header { padding:5px 0; }.inspector-shell .control-module-header label { font-size:12px; font-weight:400; }
  .inspector-shell .control-module fieldset { min-width:0; padding:0 0 8px 16px; }
  .inspector-shell .controls-section-title { margin:10px 0 4px; font-size:11px; letter-spacing:0; text-transform:none; }
  .inspector-shell .control-field { margin:5px 0; }
  @container(max-width:680px) { .inspector-shell .controls-grid,.inspector-shell #controls-modules { grid-template-columns:minmax(0,1fr); }.inspector-shell .map-controls .control-field,.inspector-shell .control-module-header label { grid-template-columns:min(36%,160px) minmax(0,1fr); }.inspector-shell .controls-segments button { padding-inline:8px; } }
  .inspector-shell .controls-code { background:var(--surface); }.inspector-shell .controls-selection .control-field select { max-width:100%; }
  .inspector-shell .panel-heading h2 { font:12px Arial,sans-serif; }.inspector-shell .review-tabs { margin:0; padding:0; }
  .inspector-assets-content { scrollbar-gutter:stable; }
  .inspector-font-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr)); max-width:1100px; }
  .inspector-font-card { min-width:0; margin:0; padding:14px 12px; border-bottom:1px solid var(--border); }
  .inspector-font-card figcaption { margin-bottom:8px; font:12px/1.5 ui-monospace,monospace; }
  .inspector-font-sample { min-height:94px; overflow-x:auto; border:1px solid var(--border); border-radius:3px; background:#fff; color:#303b4b; }
  .inspector-font-preview { display:block; }
  .inspector-font-loading { display:block; padding:15px 10px; font-size:11px; color:#62676e; }
  .inspector-sprite-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:1px; padding:1px; background:var(--border); }
  .inspector-sprite-card { margin:0; min-width:0; padding:10px 8px 8px; background:var(--paper); text-align:center; }
  .inspector-sprite-card:hover { background:var(--inspector-selected); }
  .inspector-sprite-preview { height:60px; display:flex; align-items:center; justify-content:center; border:1px solid #dadce0; border-radius:3px; background:repeating-conic-gradient(#e8eaed 0% 25%,#fff 0% 50%) 0 0 / 12px 12px; color:#62676e; }
  .inspector-sprite-card figcaption { margin-top:7px; font:11px/1.4 ui-monospace,monospace; overflow-wrap:anywhere; }
  .inspector-sprite-size { display:block; min-height:15px; margin-top:3px; color:var(--muted); font-size:10px; }
  .inspector-geometry-json { width:100%; min-height:100px; resize:vertical; background:var(--paper); color:var(--ink); border:1px solid var(--border); font:11px/1.5 ui-monospace,monospace; padding:6px; }
  .inspector-vertex { position:absolute; width:10px; height:10px; border:2px solid #1a73e8; background:#fff; transform:translate(-50%,-50%); pointer-events:auto; padding:0; min-height:0; border-radius:1px; cursor:move; touch-action:none; }
  .inspector-geometry-handles { position:absolute; inset:0; pointer-events:none; z-index:5; overflow:hidden; }
  .inspector-performance { padding:10px; }.inspector-performance svg { width:100%; height:90px; display:block; }.inspector-performance dl { max-width:600px; }
  .inspector-overdraw-help { max-width:640px; margin:10px 10px 0; padding:10px 12px; border:1px solid var(--border); border-left:3px solid var(--accent); border-radius:4px; background:var(--surface); }
  .inspector-overdraw-help[hidden] { display:none; }
  .inspector-overdraw-help strong { font-size:12px; }.inspector-overdraw-help p { margin:5px 0 0; line-height:1.5; }
  .inspector-overdraw-legend { display:flex; flex-wrap:wrap; gap:6px 20px; margin:10px 0 8px; }
  .inspector-overdraw-key { display:inline-flex; align-items:center; gap:6px; font:11px/1.4 ui-monospace,monospace; }
  .inspector-overdraw-swatch { width:24px; height:10px; border:1px solid #0002; border-radius:2px; }
  .inspector-overdraw-caption { color:var(--muted); font-size:11px; }
  .inspector-badge { background:var(--inspector-selected); color:var(--accent); border-radius:7px; padding:0 5px; margin-left:3px; font:10px/1.5 Arial,sans-serif; }
  [data-dock=left] .inspector-inspect-grid,[data-dock=right] .inspector-inspect-grid { display:flex; flex-direction:column; }
  [data-dock=left] .inspector-tree-column,[data-dock=right] .inspector-tree-column { flex:0 0 32%; border-right:0; border-bottom:1px solid var(--border); }
  [data-dock=left] .inspector-details,[data-dock=right] .inspector-details { flex:1; }
  .inspector-zoom { padding:8px; }.inspector-zoom > select { width:100%; margin-bottom:8px; }
  @container(max-width:680px) { .inspector-inspect-grid { display:flex;flex-direction:column; }.inspector-tree-column { flex:0 0 32%;border-right:0;border-bottom:1px solid var(--border); }.inspector-details { flex:1; } }
`;

export const inspectorStyles = legacyStyles + paletteStyles + cardStyles;
