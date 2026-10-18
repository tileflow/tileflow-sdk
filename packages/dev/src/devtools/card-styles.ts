/** Shared content surfaces; navigation and map behavior stay with their owning panels. */
export const cardStyles = `
.devtools-ready .dt-shell {
  --dt-page:color-mix(in srgb,var(--surface) 80%,var(--border));
  --dt-card-heading:color-mix(in srgb,var(--paper) 55%,var(--surface));
  --dt-content-gap:12px;
}
.devtools-ready .dt-shell :is(.dt-card-page,.dt-layer-content,.dt-tile-content,.dt-diagnostics-list) {
  padding:14px; background:var(--dt-page);
}
.devtools-ready .dt-shell :is(.dt-card,.dt-layer-evidence,.dt-layer-neighbors,.dt-layer-section,.dt-layer-origin,.dt-layer-samples,.dt-tile-content > .dt-kv,.dt-tile-feature,.dt-diagnostic,.dt-diagnostics-empty) {
  min-width:0; margin:0 0 var(--dt-content-gap); border:1px solid var(--border); border-radius:10px; background:var(--paper);
}
.devtools-ready .dt-shell .dt-card { padding:0; overflow:hidden; }
.devtools-ready .dt-shell :is(.dt-card-page,.dt-layer-content,.dt-tile-content,.dt-diagnostics-list) > :last-child { margin-bottom:0; }
.devtools-ready .dt-shell :is(.dt-card > .dt-section-heading,.dt-card > .controls-section-title,.dt-layer-neighbors > strong) {
  display:block; margin:0; padding:10px 14px; border:0; border-bottom:1px solid var(--border); background:var(--dt-card-heading);
  color:var(--ink); font:600 12px/1.4 var(--ui); letter-spacing:0; text-transform:none;
}
.devtools-ready .dt-shell .dt-card-table { overflow:auto; }
.devtools-ready .dt-shell .dt-card-table :is(.dt-table,.dt-layer-rules) { margin:0; }
.devtools-ready .dt-shell .dt-card-table th { background:var(--dt-card-heading); padding:9px 14px; text-transform:none; letter-spacing:0; }
.devtools-ready .dt-shell .dt-card-table td { padding:9px 14px; height:36px; border-bottom-color:var(--border); }
.devtools-ready .dt-shell :is(.dt-card-table,.dt-layer-samples) tr:last-child td { border-bottom:0; }
.devtools-ready .dt-shell .dt-subtabs { padding-inline:14px; background:var(--paper); }

/* Map: each existing section is one card, with the enabled module fields kept inline. */
.devtools-ready .dt-shell .dt-scene-content { max-width:none; background:var(--dt-page); }
.devtools-ready .dt-shell .map-controls { padding:14px!important; background:var(--dt-page); }
.devtools-ready .dt-shell .controls-grid { display:block; border:0; padding:0; }
.devtools-ready .dt-shell :is(.controls-selection,.controls-runtime) { border:1px solid var(--border); padding:0; }
.devtools-ready .dt-shell .controls-selection[hidden] { display:none; }
.devtools-ready .dt-shell .controls-section-title { margin:0; }
.devtools-ready .dt-shell .map-controls .control-field {
  grid-template-columns:minmax(120px,180px) minmax(0,1fr); min-height:44px; padding:9px 18px; gap:16px;
}
.devtools-ready .dt-shell .map-controls .control-field.dt-palette-field { grid-template-columns:minmax(120px,180px) minmax(0,1fr); }
.devtools-ready .dt-shell :is(.controls-selection,.controls-runtime) > .control-field:last-child { border-bottom:0; }
.devtools-ready .dt-shell .control-module { background:transparent; }
.devtools-ready .dt-shell .control-module:last-child { border-bottom:0; }
.devtools-ready .dt-shell .control-module-header { min-height:44px; padding:10px 18px; }
.devtools-ready .dt-shell .control-module-header label { gap:10px; }
.devtools-ready .dt-shell .control-module-header input { margin-right:0; }
.devtools-ready .dt-shell .control-module fieldset { padding:0; border-top:1px solid var(--border); background:color-mix(in srgb,var(--paper) 65%,var(--surface)); }
.devtools-ready .dt-shell .control-module .control-field { padding-left:54px; border-bottom:1px solid var(--border); }
.devtools-ready .dt-shell .control-module .control-field:last-child { border-bottom:0; }
.devtools-ready .dt-shell .map-controls :is(select,input[type=number]) { border-radius:5px; }
.devtools-ready .dt-shell :is(.controls-segments,.dt-palettes button) { border-radius:5px; }
.devtools-ready .dt-shell .dt-palettes { gap:6px; flex-wrap:wrap; }
.devtools-ready .dt-shell .dt-palettes button { height:auto; min-height:30px; padding:4px 8px; }

/* Layers: preserve the list and tabs, frame each detail block as a card. */
.devtools-ready .dt-shell .dt-layer-content { container-type:inline-size; }
.devtools-ready .dt-shell :is(.dt-layer-evidence,.dt-layer-neighbors) { padding:0; overflow:hidden; }
.devtools-ready .dt-shell .dt-layer-evidence-row { padding:10px 14px; grid-template-columns:16px 110px minmax(0,1fr); }
.devtools-ready .dt-shell .dt-layer-evidence-row:last-child { border-bottom:0; }
.devtools-ready .dt-shell .dt-layer-neighbors > div { margin:0; padding:9px 14px; border-bottom:1px solid var(--border); }
.devtools-ready .dt-shell .dt-layer-neighbors > div:last-child { border-bottom:0; }
.devtools-ready .dt-shell :is(.dt-layer-section,.dt-layer-origin) { padding:12px 14px; }
.devtools-ready .dt-shell .dt-layer-section h4 { color:var(--ink); font:600 12px/1.4 var(--ui); text-transform:none; letter-spacing:0; }
.devtools-ready .dt-shell .dt-layer-content > .dt-tools { margin-bottom:12px; padding:0 0 8px; border:0; background:transparent; }
.devtools-ready .dt-shell .dt-layer-content > .dt-note { padding:0 2px 12px; }
.devtools-ready .dt-shell .dt-layer-samples { max-height:240px; }
.devtools-ready .dt-shell .dt-layer-samples td { padding:8px 12px; }
.devtools-ready .dt-shell .dt-layer-group-title { height:30px; min-height:30px; background:var(--dt-card-heading)!important; }
.devtools-ready .dt-shell .dt-layer-group-title strong { text-transform:capitalize; letter-spacing:0; }
.devtools-ready .dt-shell .dt-layer-row { grid-template-columns:18px 26px minmax(0,1fr) 52px; height:36px; min-height:36px; gap:6px; }
.devtools-ready .dt-shell .dt-layer-glyph { display:grid; place-items:center; width:26px; height:26px; border:1px solid var(--border); border-radius:6px; background:var(--surface); }
@container(max-width:400px) {
  .devtools-ready .dt-shell .dt-layer-evidence-row { grid-template-columns:16px minmax(0,1fr); gap:4px 8px; }
  .devtools-ready .dt-shell .dt-layer-evidence-row > :last-child { grid-column:2; }
}

/* Tiles: keep whole tables together and allow long layer names to wrap. */
.devtools-ready .dt-shell .dt-tile-content > .dt-note { padding:0 2px 10px; }
.devtools-ready .dt-shell .dt-tile-content .dt-table td { vertical-align:top; white-space:normal; overflow-wrap:anywhere; }
.devtools-ready .dt-shell .dt-tile-content .dt-tile-chip { display:inline-block; margin:2px 4px 2px 0; max-width:100%; white-space:normal; overflow-wrap:anywhere; text-align:left; border-radius:4px; font-size:10px; }
.devtools-ready .dt-shell .dt-tile-content > .dt-kv { padding:0; gap:0; overflow:hidden; grid-template-columns:minmax(100px,35%) minmax(0,1fr); }
.devtools-ready .dt-shell .dt-tile-content > .dt-kv > * { padding:10px 14px; border-bottom:1px solid var(--border); }
.devtools-ready .dt-shell .dt-tile-content > .dt-kv > :nth-last-child(-n+2) { border-bottom:0; }
.devtools-ready .dt-shell .dt-tile-feature { padding:10px 14px; }
.devtools-ready .dt-shell .dt-tile-content > :is(.dt-tile-chip-list,.dt-tile-paging) { padding:0 0 10px; margin-bottom:10px; background:transparent; }

/* Debug: overlay controls and resolution controls retain their existing actions. */
.devtools-ready .dt-shell .dt-card > .dt-debug-overlay { grid-template-columns:76px minmax(0,1fr) auto; padding:10px 18px; gap:14px; }
.devtools-ready .dt-shell .dt-debug-overlay:last-child { border-bottom:0; }
.devtools-ready .dt-shell .dt-debug-preview { width:76px; height:50px; border-radius:6px; }
.devtools-ready .dt-shell .dt-debug-overlay strong { font-weight:500; }
.devtools-ready .dt-shell .dt-debug-overlay small { margin-top:3px; font-size:11px; }
.devtools-ready .dt-shell .dt-overdraw-help { max-width:none; padding:10px 18px 12px 108px; }
.devtools-ready .dt-shell .dt-debug-scale { padding:12px 18px; gap:12px; }
.devtools-ready .dt-shell .dt-debug-scale > span:first-child { flex:0 0 180px; }
.devtools-ready .dt-shell .dt-debug-scale > input[type=range] { width:108px; min-width:60px; }
.devtools-ready .dt-shell .dt-debug-scale > .dt-debug-specimen { flex:1; min-width:160px; }
.devtools-ready .dt-shell .dt-card > .dt-note { padding:0 18px 12px; }
.devtools-ready .dt-shell .dt-debug-scale:last-child { border-top:1px solid var(--border); }

/* Assets and findings use the same spacing and surfaces as the other pages. */
.devtools-ready .dt-shell .dt-assets-content { background:var(--dt-page); }
.devtools-ready .dt-shell .dt-asset-main { padding:14px; }
.devtools-ready .dt-shell :is(.dt-sprite-grid,.dt-model-grid,.dt-font-list) { gap:10px; background:transparent; }
.devtools-ready .dt-shell :is(.dt-sprite-card,.dt-model-card,.dt-font-card) { border:1px solid var(--border); border-radius:8px; background:var(--paper); overflow:hidden; }
.devtools-ready .dt-shell .dt-sprite-card { padding:10px 8px; }
.devtools-ready .dt-shell .dt-font-list { padding:14px; max-width:none; }
.devtools-ready .dt-shell .dt-font-card { padding:12px; }
.devtools-ready .dt-shell .dt-asset-aside { margin:14px 14px 14px 0; border:1px solid var(--border); border-radius:10px; background:var(--paper); }
.devtools-ready .dt-shell .dt-asset-aside h3 { margin:0; padding:12px 14px; background:var(--dt-card-heading); border-bottom:1px solid var(--border); }
.devtools-ready .dt-shell .dt-diagnostic { overflow:hidden; }
.devtools-ready .dt-shell .dt-diagnostic > summary { padding:12px 14px; }
.devtools-ready .dt-shell .dt-diagnostic[open] > summary { background:var(--dt-card-heading); border-bottom:1px solid var(--border); }
.devtools-ready .dt-shell .dt-diagnostic-detail { padding:12px 14px 14px 39px; }
.devtools-ready .dt-shell .dt-diagnostics-empty { padding:20px; max-width:none; }

@container(max-width:760px) {
  .devtools-ready .dt-shell .dt-asset-aside { margin:0 14px 14px; }
}
@container(max-width:480px) {
  .devtools-ready .dt-shell :is(.dt-card-page,.dt-layer-content,.dt-tile-content,.dt-diagnostics-list,.dt-asset-main,.dt-font-list) { padding:10px; }
  .devtools-ready .dt-shell .map-controls { padding:10px!important; }
  .devtools-ready .dt-shell .map-controls :is(.control-field,.control-field.dt-palette-field) { grid-template-columns:110px minmax(0,1fr); gap:10px; padding-inline:12px; }
  .devtools-ready .dt-shell .control-module .control-field { padding-left:24px; }
  .devtools-ready .dt-shell .dt-debug-scale > span:first-child { flex-basis:100%; }
  .devtools-ready .dt-shell .dt-card > .dt-debug-overlay { grid-template-columns:60px minmax(0,1fr) auto; padding:10px 12px; gap:10px; }
  .devtools-ready .dt-shell .dt-debug-preview { width:60px; height:40px; }
  .devtools-ready .dt-shell .dt-overdraw-help { padding-left:12px; }
}
`;
