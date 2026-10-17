/** Inspector palette and compact DevTools density; never changes map styling. */
export const inspectorStyles = `
body.devtools-ready {
  --paper:#F8F6F2; --surface:#F0EDE7; --ink:#30251F; --muted:#635449; --faint:#A0907F;
  --border:#E1DCD3; --border-strong:#C7BFB3; --accent:#38668B; --dt-selected:#E6ECF2;
  --hover:#E9E5DE; --accent-soft:#DFE8F0; --ok:#2F704B; --ok-soft:#E3EBDB; --warn:#815D21; --warn-soft:#F3E6CF;
  --danger:#B13C34; --dt-string:var(--ink); --dt-number:var(--accent); --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ui:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  --dt-control-height:22px; --dt-row-height:22px; --dt-nav-height:27px;
  color-scheme:light; font:12px/1.35 var(--ui); -webkit-font-smoothing:antialiased;
}
body.devtools-ready[data-inspector-theme=dark] {
  --paper:#1D1816; --surface:#171311; --ink:#F5EDD9; --muted:#C3B7A9; --faint:#857869; --border:#40352F; --border-strong:#5A4B43;
  --accent:#83ADD1; --dt-selected:#22303B; --hover:#2E2622; --accent-soft:#223039; --ok:#91B887; --ok-soft:#24301F; --warn:#E2B36F; --warn-soft:#3A2F20; --danger:#F1746B; color-scheme:dark;
}
@media(prefers-color-scheme:dark) { body.devtools-ready[data-inspector-theme=system] {
  --paper:#1D1816; --surface:#171311; --ink:#F5EDD9; --muted:#C3B7A9; --faint:#857869; --border:#40352F; --border-strong:#5A4B43;
  --accent:#83ADD1; --dt-selected:#22303B; --hover:#2E2622; --accent-soft:#223039; --ok:#91B887; --ok-soft:#24301F; --warn:#E2B36F; --warn-soft:#3A2F20; --danger:#F1746B; color-scheme:dark;
}}
.devtools-ready button,.devtools-ready input,.devtools-ready select { font:inherit; }
.devtools-ready button { border:1px solid var(--border); border-radius:6px; min-height:28px; padding:4px 10px; cursor:pointer; }
.devtools-ready button:disabled { cursor:default; opacity:.45; }
.devtools-ready button:hover:not(:disabled) { background:var(--hover); }
.devtools-ready input[type=range] { accent-color:var(--accent); }
.devtools-ready code,.devtools-ready pre { font-family:var(--mono); }
.devtools-ready .dt-head { height:40px; min-height:40px; flex-wrap:nowrap; gap:2px; padding:0 8px; background:var(--paper); }
.devtools-ready .dt-head-main { display:flex; align-items:center; flex:1; min-width:0; }
.devtools-ready .dt-tabs { flex:1; align-items:center; gap:2px; }
.devtools-ready .dt-tabs button { border:0; border-radius:6px; min-height:28px; padding:5px 10px; color:var(--muted); background:transparent; }
.devtools-ready .dt-tabs button[aria-selected=true] { color:var(--ink); background:var(--surface); }
.devtools-ready .dt-head > .dt-icon { width:28px; height:28px; margin:0; }
.devtools-ready .dt-icon[aria-pressed=true] { background:var(--accent-soft); color:var(--accent); }
.devtools-ready .dt-camera { display:flex; align-items:center; flex:0 0 auto; flex-wrap:wrap; gap:6px; margin:0; padding:8px 12px; border:0; border-bottom:1px solid var(--border); background:var(--paper); overflow:visible; }
.devtools-ready .dt-camera-field { display:flex; flex:0 0 auto; gap:0; height:30px; border:1px solid var(--border); border-radius:6px; background:var(--surface); overflow:hidden; }
.devtools-ready .dt-camera-field > span:first-child { padding:0 4px 0 9px; color:var(--faint); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
.devtools-ready .dt-camera-field input[type=number] { width:58px; min-height:0; padding:0 5px; border:0; background:transparent; font:12px var(--mono); appearance:textfield; color:var(--ink); }
.devtools-ready .dt-camera-field input::-webkit-inner-spin-button { appearance:none; }
.devtools-ready .dt-camera-field input[type=range] { width:110px; padding:0; margin:0 10px 0 2px; min-height:0; }
.devtools-ready .dt-unit { padding-right:9px; color:var(--faint); }
.devtools-ready .dt-copy-agent { margin-left:auto; background:var(--ink); color:var(--paper); border-color:var(--ink); font-weight:500; }
.devtools-ready .dt-copy-agent:hover { background:var(--ink); opacity:.88; }
.devtools-ready .dt-menu { top:38px; right:8px; width:236px; padding:10px; border-radius:10px; box-shadow:0 8px 28px #0002; }
.devtools-ready .dt-dock-options { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:8px; }
.devtools-ready .dt-dock-options button { width:auto; height:34px; border:1px solid var(--border); justify-content:center; }
.devtools-ready .dt-menu-label { font-size:11px; }
.devtools-ready .dt-segments,.devtools-ready .dt-layer-modes,.devtools-ready .controls-segments { display:inline-flex; padding:2px; background:var(--surface); border:1px solid var(--border); border-radius:6px; gap:2px; }
.devtools-ready .dt-segments button,.devtools-ready .dt-layer-modes button,.devtools-ready .controls-segments button { min-height:23px; border:0; border-radius:4px; padding:3px 9px; font-size:12px; background:transparent; color:var(--muted); }
.devtools-ready .dt-segments button[aria-pressed=true],.devtools-ready .dt-layer-modes button[aria-pressed=true],.devtools-ready .controls-segments button[aria-checked=true] { color:var(--ink); background:var(--paper); box-shadow:0 1px 2px #0001; }
.devtools-ready .dt-menu .dt-segments { display:flex; }.devtools-ready .dt-menu .dt-segments button { flex:1; }
.devtools-ready .dt-tools { padding:10px 12px; gap:8px; background:var(--paper); }
.devtools-ready .dt-tools input[type=search] { height:30px; padding:0 9px; background:var(--surface); border-radius:6px; width:auto; }
.devtools-ready .dt-subtabs { padding:0 20px; gap:18px; }
.devtools-ready .dt-subtabs button { background:transparent; border:0; border-radius:0; border-bottom:2px solid transparent; padding:8px 0 9px; color:var(--muted); min-height:36px; }
.devtools-ready .dt-subtabs button[aria-selected=true] { color:var(--ink); border-bottom-color:var(--ink); }
.devtools-ready input[role=switch] { appearance:none; width:26px!important; height:15px!important; min-height:0; flex:none; border:0; border-radius:8px; background:var(--faint); position:relative; padding:0; margin:0; cursor:pointer; }
.devtools-ready input[role=switch]::before { content:''; position:absolute; width:11px; height:11px; left:2px; top:2px; border-radius:50%; background:#fff; transition:transform .15s; }
.devtools-ready input[role=switch]:checked { background:var(--accent); }
.devtools-ready input[role=switch]:checked::before { transform:translateX(11px); }
.devtools-ready .dt-layer-split { display:grid; grid-template-columns:minmax(0,min(38%,360px)) minmax(0,1fr); }
.devtools-ready .dt-layer-sidebar { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border-right:1px solid var(--border); }
.devtools-ready .dt-layer-list { flex:1; border:0; }.devtools-ready .dt-layer-tools { flex-direction:column; align-items:stretch; }
.devtools-ready .dt-layer-tools-row { display:flex; align-items:center; gap:8px; }.devtools-ready .dt-layer-total { margin-left:auto; font:11px var(--mono); }
.devtools-ready .dt-layer-visible { font-size:12px; }.devtools-ready .dt-layer-group-title { height:32px; font-size:11px; padding:0 12px 0 8px!important; }
.devtools-ready .dt-layer-group-title strong { text-transform:uppercase; letter-spacing:.05em; }
.devtools-ready .dt-layer-row { display:grid; grid-template-columns:20px 18px minmax(0,1fr) 64px; height:30px; padding:0 12px 0 6px; gap:8px; border-left:2px solid transparent; }
.devtools-ready .dt-layer-row[aria-pressed=true] { background:var(--dt-selected); border-left-color:var(--accent); color:var(--ink); }
.devtools-ready .dt-layer-glyph { color:var(--muted); font-size:15px; }.devtools-ready .dt-layer-label { font-size:12px; }
.devtools-ready .dt-layer-prefix { color:var(--faint); }.devtools-ready .dt-layer-name { font-weight:500; }
.devtools-ready .dt-eye { padding:0; border:0; width:20px; height:20px; min-height:20px; color:var(--faint); background:transparent; display:grid; place-items:center; opacity:0; }
.devtools-ready .dt-eye svg { width:14px; height:14px; }
.devtools-ready :is(.dt-layer-row,.dt-layer-group-title):hover .dt-eye,.devtools-ready .dt-eye:focus-visible,.devtools-ready .dt-eye[aria-pressed=true] { opacity:1; }
.dt-zrange { position:relative; display:block; width:64px; height:14px; }.dt-zrange::before { content:''; position:absolute; inset:6px 0; height:2px; background:var(--border); }
.dt-zrange i { position:absolute; top:5px; height:4px; border-radius:2px; background:var(--accent); opacity:.65; }.dt-zrange em { position:absolute; top:1px; height:12px; width:1px; background:var(--accent); }
.devtools-ready .dt-layer-heading { padding:14px 20px 6px; align-items:flex-start; border:0; }
.devtools-ready .dt-layer-title strong { font-size:16px; font-weight:600; }.devtools-ready .dt-layer-title > code { font-size:10px; color:var(--faint); }
.dt-layer-status { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); margin-top:6px; }.dt-layer-status[data-state=Enabled] { color:var(--ok); }.dt-layer-status[data-state="Outside zoom"] { color:var(--warn); }
.devtools-ready .dt-layer-rules { font-size:12px; }.devtools-ready .dt-layer-rules th { padding:8px 20px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
.devtools-ready .dt-layer-rules th:first-child { width:42%; }.devtools-ready .dt-layer-rules td { padding:8px 20px; vertical-align:middle; min-height:44px; }
.devtools-ready .dt-layer-rules code { font:12px/1.5 var(--mono); }.devtools-ready .dt-layer-rule-name { color:var(--ink); }.devtools-ready .dt-layer-dependency { color:var(--accent); font:10px var(--mono); }
.devtools-ready .dt-layer-rule-editor { gap:9px; flex-wrap:wrap; }.devtools-ready .dt-layer-rule-editor input:not([type=color]):not([type=checkbox]):not([type=range]),.devtools-ready .dt-layer-rule-editor select { min-height:26px; border:1px solid var(--border); font:12px var(--mono); border-radius:6px; }
.devtools-ready .dt-layer-rule-editor input[type=color] { width:22px; height:22px; }
.devtools-ready .dt-layer-rule-editor input[type=range] { width:110px; min-width:70px; padding:0; flex:0 1 110px; }
.dt-rule-toggle { display:flex; align-items:center; gap:10px; }.dt-rule-toggle input { width:14px; height:14px; min-height:0; margin:0; accent-color:var(--accent); }
.dt-rule-choices { display:inline-flex; flex-wrap:wrap; border:1px solid var(--border); border-radius:6px; overflow:hidden; }.devtools-ready .dt-rule-choices button { min-height:26px; border:0; border-radius:0; font:11px var(--mono); padding:3px 8px; }
.dt-rule-spark { display:flex; align-items:center; gap:10px; color:var(--accent); font:11px var(--mono); margin-bottom:5px; }.dt-rule-spark svg { width:130px; height:26px; overflow:visible; }
.dt-filter-chips { display:flex; flex-wrap:wrap; gap:6px; margin-block:10px; }.dt-filter-chip { padding:4px 9px; background:var(--surface); border:1px solid var(--border); border-radius:13px; font:11px var(--mono); }
.devtools-ready .dt-layer-section,.devtools-ready .dt-layer-origin { padding:12px 20px; }.devtools-ready .dt-layer-section h4 { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.devtools-ready .dt-layer-evidence { padding:0; }.devtools-ready .dt-layer-evidence-row { padding:12px 20px; font-size:12px; grid-template-columns:20px 130px 1fr; }
.devtools-ready .dt-layer-evidence-row[data-state=pass] .dt-layer-indicator { color:var(--ok); }.devtools-ready .dt-layer-evidence-row[data-state=warn] .dt-layer-indicator { color:var(--warn); }
.devtools-ready .dt-layer-json { font:11px/1.6 var(--mono); color:var(--ink); }
.devtools-ready .dt-table { font:12px var(--mono); }.devtools-ready .dt-table th { padding:8px 12px; font:11px Inter,system-ui,sans-serif; text-transform:uppercase; border-right:0; }.devtools-ready .dt-table td { height:32px; padding:6px 12px; }.devtools-ready .dt-table tbody tr:nth-child(even) { background:transparent; }
.devtools-ready .dt-network-body { display:grid; grid-template-columns:minmax(0,min(38%,360px)) minmax(0,1fr); }.dt-tiles-sidebar { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border-right:1px solid var(--border); }.devtools-ready .dt-network-detail { border:0; min-width:0; }
.devtools-ready .dt-tile-heading { padding:14px 20px 8px; }.dt-tile-heading strong { font:15px var(--mono); }.dt-tile-status { padding:0 20px 10px; color:var(--muted); font-size:12px; }
.dt-tile-grid { display:grid; gap:3px; padding:12px; }.devtools-ready .dt-tile-cell { aspect-ratio:1; padding:0; font:10px var(--mono); min-width:0; min-height:20px; border-radius:4px; background:color-mix(in srgb,var(--accent) var(--weight,10%),var(--paper)); }
.devtools-ready .dt-tile-cell[aria-pressed=true] { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); }.dt-tile-grid-title { margin:10px 12px 0; color:var(--muted); font-size:11px; }
.dt-tile-chip-list { display:flex; gap:6px; flex-wrap:wrap; padding:10px 20px; border-bottom:1px solid var(--border); }.devtools-ready .dt-tile-chip { font:11px var(--mono); border-radius:13px; }
.dt-asset-layout { display:grid; grid-template-columns:minmax(0,1fr) 300px; min-height:0; flex:1; }.dt-asset-main { min-width:0; overflow:auto; padding:12px; }.dt-asset-aside { overflow:auto; border-left:1px solid var(--border); }.dt-asset-aside h3 { font:500 15px var(--mono); margin:16px 20px; }.dt-asset-variants { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--border); }.dt-asset-variant { padding:20px 10px; display:flex; flex-direction:column; align-items:center; gap:10px; background:var(--surface); font:10px var(--mono); overflow-wrap:anywhere; }.dt-asset-variant[data-night=true] { background:#2e2622; color:#f5edd9; }
.devtools-ready .dt-sprite-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(104px,1fr)); gap:4px; }.devtools-ready .dt-sprite-card { border:1px solid transparent; border-radius:8px; background:transparent; padding:16px 6px 10px; cursor:pointer; }.dt-sprite-card[aria-pressed=true] { background:var(--dt-selected)!important; border-color:var(--accent)!important; }
.dt-debug-overlay { display:grid; grid-template-columns:84px 1fr auto; align-items:center; gap:16px; padding:10px 20px; border-bottom:1px solid var(--border); cursor:pointer; }.dt-debug-overlay:hover { background:var(--hover); }.dt-debug-overlay small { display:block; color:var(--muted); font-size:12px; }.dt-debug-preview { width:84px; height:58px; border-radius:6px; overflow:hidden; }.dt-debug-preview svg { width:100%; height:100%; }
.dt-section-heading { background:var(--surface); padding:8px 20px; font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; border-bottom:1px solid var(--border); }
.devtools-ready .dt-overdraw-help { margin:0; border:0; border-bottom:1px solid var(--border); border-radius:0; padding:12px 20px 12px 120px; background:var(--surface); }.dt-debug-scale { display:flex; align-items:center; gap:12px; padding:16px 20px; flex-wrap:wrap; }.dt-debug-scale input[type=number] { width:64px; }
.devtools-ready .map-controls { padding:0!important; background:var(--paper); }.devtools-ready .controls-heading { display:none; }.devtools-ready .controls-grid { display:block; }.devtools-ready .controls-selection,.devtools-ready .controls-runtime { border:0; padding:0; }
.devtools-ready .controls-section-title { margin:0; padding:8px 20px; background:var(--surface); border-bottom:1px solid var(--border); font-size:11px; letter-spacing:.05em; }.devtools-ready .control-field { display:grid; grid-template-columns:200px 1fr; align-items:center; margin:0; padding:10px 20px; border-bottom:1px solid var(--border); gap:16px; font-size:13px; }.devtools-ready .control-field select { max-width:100%; width:max-content; min-width:132px; }
.devtools-ready #controls-modules { display:block; }.devtools-ready .control-module { border:0; border-bottom:1px solid var(--border); border-radius:0; margin:0; background:var(--paper); }.devtools-ready .control-module-header { padding:10px 20px; }.devtools-ready .control-module-header label { justify-content:flex-start; font-size:13px; font-weight:500; }.devtools-ready .control-module-header input { order:-1; margin-right:12px; }.devtools-ready .control-module fieldset { padding:0; background:var(--surface); }.devtools-ready .control-module .control-field { padding-left:58px; border:0; }.devtools-ready .dt-scene-content { max-width:1000px; width:100%; }.dt-palettes { display:flex; gap:8px; flex-wrap:wrap; }.devtools-ready .dt-palette { display:flex; align-items:center; gap:8px; padding:5px 10px 5px 5px; }.dt-palette-swatches { display:grid; grid-template-columns:repeat(2,11px); grid-template-rows:repeat(2,11px); overflow:hidden; border-radius:4px; }
@container(max-width:760px) {
 .devtools-ready .dt-layer-title { flex-basis:180px; }.devtools-ready .dt-camera-field input[type=range] { width:80px; }
 .devtools-ready .dt-layer-rules th:first-child { width:45%; }.devtools-ready .dt-layer-rules td { padding:8px 12px; }
 .dt-asset-layout { grid-template-columns:1fr; }.dt-asset-aside { border:0; border-top:1px solid var(--border); }
 .devtools-ready .control-field { grid-template-columns:160px 1fr; }.devtools-ready .control-module .control-field { padding-left:30px; }
}
@media(prefers-reduced-motion:reduce) { .devtools-ready * { scroll-behavior:auto!important; transition:none!important; animation:none!important; } }

.dt-palettes{display:flex;gap:8px;flex-wrap:wrap}.devtools-ready .dt-palettes button{display:flex;flex-direction:column;gap:7px;padding:10px 14px;min-width:110px;background:var(--paper);text-align:left;text-transform:capitalize}.devtools-ready .dt-palettes button[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.dt-palette-swatches{display:flex;height:26px;width:100%;overflow:hidden;border-radius:4px}.dt-palette-swatches i{flex:1;min-width:20px}.devtools-ready .dt-palette-field{align-items:flex-start;flex-direction:column}.dt-model-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.devtools-ready .dt-model-card{display:flex;flex-direction:column;align-items:center;padding:0;overflow:hidden;border-radius:10px}.dt-model-card canvas{background:linear-gradient(var(--surface),var(--paper));max-width:100%;height:auto!important}.dt-model-card strong{font:500 12px var(--mono);padding:9px 12px 2px;overflow-wrap:anywhere}.dt-model-card small{font-size:11px;color:var(--muted);padding:0 12px 9px}.dt-model-card[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.dt-asset-aside>canvas{display:block;margin:auto;max-width:100%;touch-action:none;cursor:grab}.dt-font-ranges{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.dt-font-ranges small{color:var(--muted);font-size:11px}

.dt-debug-specimen{display:flex;align-items:center;gap:18px;min-height:70px;padding:12px 20px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.dt-rule-font-preview{overflow:hidden;max-width:100%}.dt-rule-font-preview canvas{max-width:100%;height:auto!important}
/* Keep the new shell independent of the legacy in-header camera and toolbar breakpoints. */
.devtools-ready .dt-shell>.dt-camera{order:0;flex:0 0 auto;margin:0;border-top:0;background:var(--paper);padding:8px 12px}
.devtools-ready .dt-shell>.dt-head{flex-wrap:nowrap}.devtools-ready .dt-shell .dt-head-main{display:flex;gap:2px}
.devtools-ready .dt-shell .dt-layer-tools input[type=search]{order:0;flex:0 0 auto;width:100%;height:30px}
.devtools-ready .dt-shell .dt-layer-tools{flex-wrap:nowrap}.devtools-ready .dt-shell .dt-layer-tools-row{flex:none;min-height:28px}
.devtools-ready .dt-shell .dt-layer-row{display:grid;grid-template-columns:20px 18px minmax(0,1fr) 64px;height:30px;min-height:30px;padding:0 12px 0 6px;gap:8px}
.devtools-ready .dt-shell .dt-layer-label{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.devtools-ready .dt-shell .dt-layer-heading{flex:none}.devtools-ready .dt-shell .dt-layer-title{flex:1 1 180px}
.devtools-ready .dt-shell .dt-layer-sidebar .dt-layer-list{flex:1;min-height:0}.devtools-ready .dt-shell .map-controls .control-field{display:grid;grid-template-columns:160px minmax(0,1fr);padding:12px 20px;margin:0}
.devtools-ready .dt-shell .control-module-header label{display:flex;gap:12px}.devtools-ready .dt-shell .map-controls input[role=switch]{width:26px!important;height:15px!important;min-height:0;border:0;background:var(--faint)}.devtools-ready .dt-shell .map-controls input[role=switch]:checked{background:var(--accent)}.devtools-ready .dt-shell .map-controls input[role=switch]::before{width:11px;height:11px;top:2px;left:2px;background:white}.devtools-ready .dt-shell .map-controls input[role=switch]:checked::before{transform:translateX(11px)}
@container(max-width:760px){.devtools-ready .dt-shell .dt-layer-tools{padding:8px 12px}.devtools-ready .dt-shell .dt-tabs button{padding-inline:7px}.devtools-ready .dt-shell .dt-head{padding-inline:4px}.devtools-ready .dt-shell .dt-camera-field{flex:0 0 auto}}

/* Shared density also wins over panel styles injected after the shell stylesheet. */
.devtools-ready .dt-shell { font:12px/1.35 var(--ui); }
.devtools-ready .dt-shell :is(button,input,select,summary) { min-height:var(--dt-control-height); }
.devtools-ready .dt-shell button { padding:2px 6px; border-radius:3px; }
.devtools-ready .dt-shell :is(input[type=checkbox],input[type=radio],input[type=range],input[type=color]) { min-height:0; }
.devtools-ready .dt-shell .dt-head { height:var(--dt-nav-height); min-height:var(--dt-nav-height); padding:0 4px; }
.devtools-ready .dt-shell .dt-tabs { gap:0; }
.devtools-ready .dt-shell .dt-tabs button { height:26px; min-height:26px; padding:0 8px; border-radius:2px; }
.devtools-ready .dt-shell .dt-head .dt-icon { width:24px; height:24px; min-height:24px; padding:3px; margin-block:0; }
.devtools-ready .dt-shell > .dt-camera { padding:4px 8px; gap:4px; }
.devtools-ready .dt-shell .dt-camera-field { height:var(--dt-control-height); border-radius:3px; }
.devtools-ready .dt-shell .dt-camera-field > span:first-child { padding-left:6px; }
.devtools-ready .dt-shell .dt-camera-field input[type=number] { width:48px; min-height:0; padding:0 3px; font-size:11px; }
.devtools-ready .dt-shell .dt-camera-field input[type=range] { width:88px; margin:0 6px 0 2px; }
.devtools-ready .dt-shell .dt-unit { padding-right:6px; }
.devtools-ready .dt-shell .dt-camera-reset { display:inline-flex; align-items:center; justify-content:center; width:24px; height:var(--dt-control-height); padding:2px; }
.devtools-ready .dt-shell .dt-copy-agent { font-size:11px; white-space:nowrap; }
.devtools-ready .dt-shell .dt-menu { top:var(--dt-nav-height); right:4px; width:216px; padding:6px; border-radius:4px; }
.devtools-ready .dt-shell .dt-dock-options { gap:4px; margin-bottom:6px; }
.devtools-ready .dt-shell .dt-dock-options button { height:26px; padding:2px; }
.devtools-ready .dt-shell :is(.dt-segments,.dt-layer-modes,.controls-segments) { padding:1px; gap:1px; border-radius:3px; }
.devtools-ready .dt-shell :is(.dt-segments,.dt-layer-modes,.controls-segments) button { min-height:20px; padding:1px 6px; border-radius:2px; }
.devtools-ready .dt-shell .dt-tools { min-height:28px; padding:3px 8px; gap:4px; }
.devtools-ready .dt-shell .dt-tools input[type=search] { height:var(--dt-control-height); padding:0 6px; border-radius:3px; }
.devtools-ready .dt-shell .dt-layer-tools-row { min-width:0; min-height:var(--dt-control-height); gap:6px; flex-wrap:wrap; }
.devtools-ready .dt-shell .dt-layer-modes { max-width:100%; overflow-x:auto; }
.devtools-ready .dt-shell .dt-subtabs { padding:0 8px; gap:12px; }
.devtools-ready .dt-shell .dt-subtabs button { min-height:var(--dt-nav-height); padding:3px 0; border-radius:0; }
.devtools-ready .dt-shell .dt-footer { min-height:20px; padding:2px 8px; gap:8px; }
.devtools-ready .dt-shell .dt-section-heading { padding:4px 10px; }
.devtools-ready .dt-shell .dt-kv { gap:3px 8px; padding:6px 8px; font:11px/1.4 var(--mono); }
.devtools-ready .dt-shell .dt-layer-group-title { height:var(--dt-row-height); min-height:var(--dt-row-height); padding:0 8px 0 6px!important; }
.devtools-ready .dt-shell .dt-layer-row { grid-template-columns:18px 16px minmax(0,1fr) 52px; height:var(--dt-row-height); min-height:var(--dt-row-height); padding:0 8px 0 4px; gap:4px; border-radius:0; }
.devtools-ready .dt-shell .dt-layer-glyph { font-size:13px; }
.devtools-ready .dt-shell .dt-eye { min-height:18px; width:18px; height:18px; padding:0; }
.devtools-ready .dt-shell .dt-zrange { width:52px; }
.devtools-ready .dt-shell .dt-layer-heading { padding:8px 10px 4px; }
.devtools-ready .dt-shell .dt-layer-title strong { font-size:13px; }
.devtools-ready .dt-shell .dt-layer-status { margin-top:3px; gap:6px; font-size:11px; }
.devtools-ready .dt-shell .dt-layer-rules th { padding:4px 10px; }
.devtools-ready .dt-shell .dt-layer-rules td { padding:3px 10px; min-height:24px; }
.devtools-ready .dt-shell .dt-layer-rules code { font:11px/1.4 var(--mono); }
.devtools-ready .dt-shell .dt-layer-rule-editor { gap:5px; }
.devtools-ready .dt-shell .dt-layer-rule-editor :is(input:not([type=color]):not([type=checkbox]):not([type=range]),select) { min-height:20px; font:11px/1.4 var(--mono); border-radius:3px; }
.devtools-ready .dt-shell .dt-layer-rule-editor input[type=color] { width:18px; height:20px; }
.devtools-ready .dt-shell .dt-layer-rule-editor input[type=range] { width:88px; min-width:60px; flex-basis:88px; }
.devtools-ready .dt-shell .dt-rule-toggle { gap:6px; }
.devtools-ready .dt-shell .dt-rule-choices { border-radius:3px; }
.devtools-ready .dt-shell .dt-rule-choices button { min-height:20px; padding:1px 5px; border-radius:0; }
.devtools-ready .dt-shell .dt-rule-spark { gap:6px; margin-bottom:3px; }
.devtools-ready .dt-shell .dt-rule-spark svg { width:100px; height:22px; }
.devtools-ready .dt-shell .dt-filter-chips { gap:4px; margin-block:6px; }
.devtools-ready .dt-shell .dt-filter-chip { padding:2px 6px; }
.devtools-ready .dt-shell :is(.dt-layer-section,.dt-layer-origin) { padding:6px 10px; }
.devtools-ready .dt-shell .dt-layer-evidence-row { padding:6px 10px; grid-template-columns:16px 110px minmax(0,1fr); }
.devtools-ready .dt-shell .dt-table { font:11px/1.4 var(--mono); }
.devtools-ready .dt-shell .dt-table th { padding:4px 8px; font:11px var(--ui); }
.devtools-ready .dt-shell .dt-table td { height:var(--dt-row-height); padding:2px 8px; }
.devtools-ready .dt-shell .dt-tile-heading { padding:8px 10px 4px; }
.devtools-ready .dt-shell .dt-tile-heading strong { font-size:13px; }
.devtools-ready .dt-shell .dt-tile-status { padding:0 10px 6px; }
.devtools-ready .dt-shell .dt-tile-grid { padding:8px; gap:2px; }
.devtools-ready .dt-shell .dt-tile-cell { padding:0; min-height:20px; }
.devtools-ready .dt-shell .dt-tile-grid-title { margin:6px 8px 0; }
.devtools-ready .dt-shell .dt-tile-chip-list { padding:5px 10px; gap:4px; }
.devtools-ready .dt-shell .dt-asset-main { padding:8px; }
.devtools-ready .dt-shell .dt-asset-aside h3 { font-size:13px; margin:8px 10px; }
.devtools-ready .dt-shell .dt-asset-variant { padding:10px 6px; gap:6px; }
.devtools-ready .dt-shell .dt-sprite-grid { grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); }
.devtools-ready .dt-shell .dt-sprite-card { padding:6px 4px; border-radius:4px; }
.devtools-ready .dt-shell .dt-sprite-preview { height:44px; }
.devtools-ready .dt-shell .dt-sprite-card figcaption { margin-top:4px; }
.devtools-ready .dt-shell .dt-font-card { padding:8px; }
.devtools-ready .dt-shell .dt-font-card figcaption { margin-bottom:5px; font:11px/1.4 var(--mono); }
.devtools-ready .dt-shell .dt-font-loading { padding:8px; }
.devtools-ready .dt-shell .dt-model-grid { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:6px; }
.devtools-ready .dt-shell .dt-model-card { padding:0; border-radius:4px; }
.devtools-ready .dt-shell .dt-model-card strong { padding:5px 8px 2px; }
.devtools-ready .dt-shell .dt-model-card small { padding:0 8px 5px; }
.devtools-ready .dt-shell .dt-debug-overlay { grid-template-columns:60px 1fr auto; gap:8px; padding:6px 10px; }
.devtools-ready .dt-shell .dt-debug-preview { width:60px; height:40px; border-radius:3px; }
.devtools-ready .dt-shell .dt-overdraw-help { padding:6px 10px 6px 78px; }
.devtools-ready .dt-shell .dt-debug-scale { gap:8px; padding:8px 10px; }
.devtools-ready .dt-shell .dt-debug-specimen { gap:10px; min-height:52px; padding:6px 10px; border-radius:4px; }
.devtools-ready .dt-shell .controls-section-title { padding:4px 10px; }
.devtools-ready .dt-shell .map-controls .control-field { grid-template-columns:140px minmax(0,1fr); padding:6px 10px; gap:8px; font-size:12px; }
.devtools-ready .dt-shell .control-module-header { padding:6px 10px; }
.devtools-ready .dt-shell .control-module-header label { font-size:12px; gap:6px; }
.devtools-ready .dt-shell .control-module-header input { margin-right:6px; }
.devtools-ready .dt-shell .control-module summary { padding:0 10px 4px; }
.devtools-ready .dt-shell .control-module .control-field { padding-left:38px; }
.devtools-ready .dt-shell .map-controls .control-field.dt-palette-field { grid-template-columns:70px minmax(0,1fr); align-items:center; }
.devtools-ready .dt-shell .dt-palettes { gap:4px; align-items:center; }
.devtools-ready .dt-shell .dt-palettes button { flex-direction:row; align-items:center; gap:5px; padding:2px 6px; min-width:0; height:var(--dt-control-height); font-size:11px; white-space:nowrap; }
.devtools-ready .dt-shell .dt-palette-swatches { width:24px; height:10px; flex:none; border-radius:2px; }
.devtools-ready .dt-shell .dt-palette-swatches i { min-width:0; }
.devtools-ready .dt-shell .beacon-content { font:12px/1.4 var(--ui); }
.devtools-ready .dt-shell .beacon-hero { max-width:560px; padding:20px 16px; gap:8px; }
.devtools-ready .dt-shell .beacon-logo { width:88px; height:88px; }
.devtools-ready .dt-shell .beacon-logo svg { width:72px; height:72px; }
.devtools-ready .dt-shell .beacon-hero h1 { font-size:18px; }
.devtools-ready .dt-shell .beacon-lead { font-size:12px; line-height:1.4; }
.devtools-ready .dt-shell .beacon-scope { margin-top:6px; border-radius:4px; }
.devtools-ready .dt-shell .beacon-scope > div { padding:6px 8px; }
.devtools-ready .dt-shell .beacon-actions { gap:6px; margin-top:6px; }
.devtools-ready .dt-shell .beacon-run { height:26px; padding:0 12px; font-size:12px; }
.devtools-ready .dt-shell .beacon-report-title { gap:8px; padding:8px 10px; }
.devtools-ready .dt-shell .beacon-report-title h2 { font-size:13px; }
.devtools-ready .dt-shell .beacon-score { gap:5px; padding:10px 4px 8px; border-radius:0; }
.devtools-ready .dt-shell .beacon-gauge { max-width:48px; max-height:48px; }
.devtools-ready .dt-shell .beacon-report-title .beacon-gauge { max-width:56px; max-height:56px; }
.devtools-ready .dt-shell .beacon-gauge::before { inset:3px; }
.devtools-ready .dt-shell .beacon-gauge b { font-size:14px; }
.devtools-ready .dt-shell .beacon-diagnostic { width:48px; height:48px; border-radius:4px; font-size:11px; }
.devtools-ready .dt-shell .beacon-legend { padding:6px 8px; }
.devtools-ready .dt-shell .beacon-check > summary { grid-template-columns:16px minmax(100px,1fr) minmax(80px,45%); min-height:28px; padding:4px 10px; gap:6px; }
.devtools-ready .dt-shell .beacon-indicator { width:16px; height:16px; }
.devtools-ready .dt-shell .beacon-check-detail { padding:0 10px 8px 32px; gap:6px; }
.devtools-ready .dt-shell .beacon-check-detail p { font-size:12px; }
.devtools-ready .dt-shell .beacon-check-detail .dt-kv { padding:4px 0; }
.devtools-ready .dt-shell .beacon-tour { padding:6px 10px; }
.devtools-ready .dt-shell .beacon-tour p { margin:5px 0; }
.devtools-ready .dt-shell .beacon-method { padding:10px; }
@container(max-width:480px) {
 .devtools-ready .dt-shell .map-controls .control-field { grid-template-columns:110px minmax(0,1fr); }
 .devtools-ready .dt-shell .control-module .control-field { padding-left:24px; }
 .devtools-ready .dt-shell .dt-camera-field input[type=range] { width:48px; }
}
`;
