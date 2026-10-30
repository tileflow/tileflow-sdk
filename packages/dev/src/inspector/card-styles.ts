/** Shared content surfaces; navigation and map behavior stay with their owning panels. */
export const cardStyles = `
.inspector-ready .inspector-shell {
  --inspector-page:color-mix(in srgb,var(--surface) 80%,var(--border));
  --inspector-card-heading:color-mix(in srgb,var(--paper) 55%,var(--surface));
  --inspector-content-gap:12px;
}
.inspector-ready .inspector-shell :is(.inspector-card-page,.inspector-layer-content,.inspector-tile-content,.inspector-diagnostics-list) {
  padding:14px; background:var(--inspector-page);
}
.inspector-ready .inspector-shell :is(.inspector-card,.inspector-layer-evidence,.inspector-layer-neighbors,.inspector-layer-section,.inspector-layer-origin,.inspector-layer-samples,.inspector-tile-content > .inspector-kv,.inspector-tile-feature,.inspector-diagnostic,.inspector-diagnostics-empty) {
  min-width:0; margin:0 0 var(--inspector-content-gap); border:1px solid var(--border); border-radius:10px; background:var(--paper);
}
.inspector-ready .inspector-shell .inspector-card { padding:0; overflow:hidden; }
.inspector-ready .inspector-shell :is(.inspector-card-page,.inspector-layer-content,.inspector-tile-content,.inspector-diagnostics-list) > :last-child { margin-bottom:0; }
.inspector-ready .inspector-shell :is(.inspector-card > .inspector-section-heading,.inspector-card > .controls-section-title,.inspector-layer-neighbors > strong) {
  display:block; margin:0; padding:10px 14px; border:0; border-bottom:1px solid var(--border); background:var(--inspector-card-heading);
  color:var(--ink); font:600 12px/1.4 var(--ui); letter-spacing:0; text-transform:none;
}
.inspector-ready .inspector-shell .inspector-card-table { overflow:auto; }
.inspector-ready .inspector-shell .inspector-card-table :is(.inspector-table,.inspector-layer-rules) { margin:0; }
.inspector-ready .inspector-shell .inspector-card-table th { background:var(--inspector-card-heading); padding:9px 14px; text-transform:none; letter-spacing:0; }
.inspector-ready .inspector-shell .inspector-card-table td { padding:9px 14px; height:36px; border-bottom-color:var(--border); }
.inspector-ready .inspector-shell :is(.inspector-card-table,.inspector-layer-samples) tr:last-child td { border-bottom:0; }
.inspector-ready .inspector-shell .inspector-subtabs { padding-inline:14px; background:var(--paper); }

/* Map: each existing section is one card, with the enabled module fields kept inline. */
.inspector-ready .inspector-shell .inspector-scene-content { max-width:none; background:var(--inspector-page); }
.inspector-ready .inspector-shell .map-controls { padding:14px!important; background:var(--inspector-page); }
.inspector-ready .inspector-shell .controls-grid { display:block; border:0; padding:0; }
.inspector-ready .inspector-shell :is(.controls-selection,.controls-runtime) { border:1px solid var(--border); padding:0; }
.inspector-ready .inspector-shell .controls-selection[hidden] { display:none; }
.inspector-ready .inspector-shell .controls-section-title { margin:0; }
.inspector-ready .inspector-shell .map-controls .control-field {
  grid-template-columns:minmax(120px,180px) minmax(0,1fr); min-height:44px; padding:9px 18px; gap:16px;
}
.inspector-ready .inspector-shell .map-controls .control-field.inspector-palette-field { grid-template-columns:minmax(120px,180px) minmax(0,1fr); }
.inspector-ready .inspector-shell :is(.controls-selection,.controls-runtime) > .control-field:last-child { border-bottom:0; }
.inspector-ready .inspector-shell .control-module { background:transparent; }
.inspector-ready .inspector-shell .control-module:last-child { border-bottom:0; }
.inspector-ready .inspector-shell .control-module-header { min-height:44px; padding:10px 18px; }
.inspector-ready .inspector-shell .control-module-header label { gap:10px; }
.inspector-ready .inspector-shell .control-module-header input { margin-right:0; }
.inspector-ready .inspector-shell .control-module fieldset { padding:0; border-top:1px solid var(--border); background:color-mix(in srgb,var(--paper) 65%,var(--surface)); }
.inspector-ready .inspector-shell .control-module .control-field { padding-left:54px; border-bottom:1px solid var(--border); }
.inspector-ready .inspector-shell .control-module .control-field:last-child { border-bottom:0; }
.inspector-ready .inspector-shell .map-controls :is(select,input[type=number]) { border-radius:5px; }
.inspector-ready .inspector-shell :is(.controls-segments,.inspector-palettes button) { border-radius:5px; }
.inspector-ready .inspector-shell .inspector-palettes { gap:6px; flex-wrap:wrap; }
.inspector-ready .inspector-shell .inspector-palettes button { height:auto; min-height:30px; padding:4px 8px; }

/* Layers: preserve the list and tabs, frame each detail block as a card. */
.inspector-ready .inspector-shell .inspector-layer-content { container-type:inline-size; }
.inspector-ready .inspector-shell :is(.inspector-layer-evidence,.inspector-layer-neighbors) { padding:0; overflow:hidden; }
.inspector-ready .inspector-shell .inspector-layer-evidence-row { padding:10px 14px; grid-template-columns:16px 110px minmax(0,1fr); }
.inspector-ready .inspector-shell .inspector-layer-evidence-row:last-child { border-bottom:0; }
.inspector-ready .inspector-shell .inspector-layer-neighbors > div { margin:0; padding:9px 14px; border-bottom:1px solid var(--border); }
.inspector-ready .inspector-shell .inspector-layer-neighbors > div:last-child { border-bottom:0; }
.inspector-ready .inspector-shell :is(.inspector-layer-section,.inspector-layer-origin) { padding:12px 14px; }
.inspector-ready .inspector-shell .inspector-layer-section h4 { color:var(--ink); font:600 12px/1.4 var(--ui); text-transform:none; letter-spacing:0; }
.inspector-ready .inspector-shell .inspector-layer-content > .inspector-tools { margin-bottom:12px; padding:0 0 8px; border:0; background:transparent; }
.inspector-ready .inspector-shell .inspector-layer-content > .inspector-note { padding:0 2px 12px; }
.inspector-ready .inspector-shell .inspector-layer-samples { max-height:240px; }
.inspector-ready .inspector-shell .inspector-layer-samples td { padding:8px 12px; }
.inspector-ready .inspector-shell .inspector-layer-group-title { height:30px; min-height:30px; background:var(--inspector-card-heading)!important; }
.inspector-ready .inspector-shell .inspector-layer-group-title strong { text-transform:capitalize; letter-spacing:0; }
.inspector-ready .inspector-shell .inspector-layer-row { grid-template-columns:18px 26px minmax(0,1fr) 52px; height:36px; min-height:36px; gap:6px; }
.inspector-ready .inspector-shell .inspector-layer-glyph { display:grid; place-items:center; width:26px; height:26px; border:1px solid var(--border); border-radius:6px; background:var(--surface); }
@container(max-width:400px) {
  .inspector-ready .inspector-shell .inspector-layer-evidence-row { grid-template-columns:16px minmax(0,1fr); gap:4px 8px; }
  .inspector-ready .inspector-shell .inspector-layer-evidence-row > :last-child { grid-column:2; }
}

/* Tiles: keep whole tables together and allow long layer names to wrap. */
.inspector-ready .inspector-shell .inspector-tile-content > .inspector-note { padding:0 2px 10px; }
.inspector-ready .inspector-shell .inspector-tile-content .inspector-table td { vertical-align:top; white-space:normal; overflow-wrap:anywhere; }
.inspector-ready .inspector-shell .inspector-tile-content .inspector-tile-chip { display:inline-block; margin:2px 4px 2px 0; max-width:100%; white-space:normal; overflow-wrap:anywhere; text-align:left; border-radius:4px; font-size:10px; }
.inspector-ready .inspector-shell .inspector-tile-content > .inspector-kv { padding:0; gap:0; overflow:hidden; grid-template-columns:minmax(100px,35%) minmax(0,1fr); }
.inspector-ready .inspector-shell .inspector-tile-content > .inspector-kv > * { padding:10px 14px; border-bottom:1px solid var(--border); }
.inspector-ready .inspector-shell .inspector-tile-content > .inspector-kv > :nth-last-child(-n+2) { border-bottom:0; }
.inspector-ready .inspector-shell .inspector-tile-feature { padding:10px 14px; }
.inspector-ready .inspector-shell .inspector-tile-content > :is(.inspector-tile-chip-list,.inspector-tile-paging) { padding:0 0 10px; margin-bottom:10px; background:transparent; }

/* Debug: overlay controls and resolution controls retain their existing actions. */
.inspector-ready .inspector-shell .inspector-card > .inspector-debug-overlay { grid-template-columns:76px minmax(0,1fr) auto; padding:10px 18px; gap:14px; }
.inspector-ready .inspector-shell .inspector-debug-overlay:last-child { border-bottom:0; }
.inspector-ready .inspector-shell .inspector-debug-preview { width:76px; height:50px; border-radius:6px; }
.inspector-ready .inspector-shell .inspector-debug-overlay strong { font-weight:500; }
.inspector-ready .inspector-shell .inspector-debug-overlay small { margin-top:3px; font-size:11px; }
.inspector-ready .inspector-shell .inspector-overdraw-help { max-width:none; padding:10px 18px 12px 108px; }
.inspector-ready .inspector-shell .inspector-debug-scale { padding:12px 18px; gap:12px; }
.inspector-ready .inspector-shell .inspector-debug-scale > span:first-child { flex:0 0 180px; }
.inspector-ready .inspector-shell .inspector-debug-scale > input[type=range] { width:108px; min-width:60px; }
.inspector-ready .inspector-shell .inspector-debug-scale > .inspector-debug-specimen { flex:1; min-width:160px; }
.inspector-ready .inspector-shell .inspector-card > .inspector-note { padding:0 18px 12px; }
.inspector-ready .inspector-shell .inspector-debug-scale:last-child { border-top:1px solid var(--border); }

/* Assets and findings use the same spacing and surfaces as the other pages. */
.inspector-ready .inspector-shell .inspector-assets-content { background:var(--inspector-page); }
.inspector-ready .inspector-shell .inspector-asset-main { padding:14px; }
.inspector-ready .inspector-shell :is(.inspector-sprite-grid,.inspector-model-grid,.inspector-font-list) { gap:10px; background:transparent; }
.inspector-ready .inspector-shell :is(.inspector-sprite-card,.inspector-model-card,.inspector-font-card) { border:1px solid var(--border); border-radius:8px; background:var(--paper); overflow:hidden; }
.inspector-ready .inspector-shell .inspector-sprite-card { padding:10px 8px; }
.inspector-ready .inspector-shell .inspector-font-list { padding:14px; max-width:none; }
.inspector-ready .inspector-shell .inspector-font-card { padding:12px; }
.inspector-ready .inspector-shell .inspector-asset-aside { margin:14px 14px 14px 0; border:1px solid var(--border); border-radius:10px; background:var(--paper); }
.inspector-ready .inspector-shell .inspector-asset-aside h3 { margin:0; padding:12px 14px; background:var(--inspector-card-heading); border-bottom:1px solid var(--border); }
.inspector-ready .inspector-shell .inspector-diagnostic { overflow:hidden; }
.inspector-ready .inspector-shell .inspector-diagnostic > summary { padding:12px 14px; }
.inspector-ready .inspector-shell .inspector-diagnostic[open] > summary { background:var(--inspector-card-heading); border-bottom:1px solid var(--border); }
.inspector-ready .inspector-shell .inspector-diagnostic-detail { padding:12px 14px 14px 39px; }
.inspector-ready .inspector-shell .inspector-diagnostics-empty { padding:20px; max-width:none; }

@container(max-width:760px) {
  .inspector-ready .inspector-shell .inspector-asset-aside { margin:0 14px 14px; }
}
@container(max-width:480px) {
  .inspector-ready .inspector-shell :is(.inspector-card-page,.inspector-layer-content,.inspector-tile-content,.inspector-diagnostics-list,.inspector-asset-main,.inspector-font-list) { padding:10px; }
  .inspector-ready .inspector-shell .map-controls { padding:10px!important; }
  .inspector-ready .inspector-shell .map-controls :is(.control-field,.control-field.inspector-palette-field) { grid-template-columns:110px minmax(0,1fr); gap:10px; padding-inline:12px; }
  .inspector-ready .inspector-shell .control-module .control-field { padding-left:24px; }
  .inspector-ready .inspector-shell .inspector-debug-scale > span:first-child { flex-basis:100%; }
  .inspector-ready .inspector-shell .inspector-card > .inspector-debug-overlay { grid-template-columns:60px minmax(0,1fr) auto; padding:10px 12px; gap:10px; }
  .inspector-ready .inspector-shell .inspector-debug-preview { width:60px; height:40px; }
  .inspector-ready .inspector-shell .inspector-overdraw-help { padding-left:12px; }
}
`;
