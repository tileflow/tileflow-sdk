/** Inspector palette and compact Inspector density; never changes map styling. */
export const inspectorStyles = `
body.inspector-ready {
  --paper:#FFFFFF; --surface:#F5F5F5; --ink:#171717; --muted:#666666; --faint:#8C8C8C;
  --border:#E5E5E5; --border-strong:#C8C8C8; --accent:#404040; --inspector-selected:#EBEBEB;
  --hover:#EEEEEE; --accent-soft:#E8E8E8; --ok:#2F704B; --ok-soft:#E3EBDB; --warn:#815D21; --warn-soft:#F3E6CF;
  --danger:#B13C34; --inspector-string:var(--ink); --inspector-number:var(--accent); --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ui:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  --inspector-control-height:22px; --inspector-row-height:22px; --inspector-nav-height:27px;
  --inspector-header-height:44px; --inspector-camera-control-height:30px;
  color-scheme:light; font:12px/1.35 var(--ui); -webkit-font-smoothing:antialiased;
}
body.inspector-ready[data-inspector-theme=dark] {
  --paper:#171717; --surface:#111111; --ink:#F5F5F5; --muted:#B3B3B3; --faint:#858585; --border:#333333; --border-strong:#525252;
  --accent:#D4D4D4; --inspector-selected:#303030; --hover:#262626; --accent-soft:#303030; --ok:#91B887; --ok-soft:#24301F; --warn:#E2B36F; --warn-soft:#3A2F20; --danger:#F1746B; color-scheme:dark;
}
@media(prefers-color-scheme:dark) { body.inspector-ready[data-inspector-theme=system] {
  --paper:#171717; --surface:#111111; --ink:#F5F5F5; --muted:#B3B3B3; --faint:#858585; --border:#333333; --border-strong:#525252;
  --accent:#D4D4D4; --inspector-selected:#303030; --hover:#262626; --accent-soft:#303030; --ok:#91B887; --ok-soft:#24301F; --warn:#E2B36F; --warn-soft:#3A2F20; --danger:#F1746B; color-scheme:dark;
}}
.inspector-ready button,.inspector-ready input,.inspector-ready select { font:inherit; }
.inspector-ready button { border:1px solid var(--border); border-radius:6px; min-height:28px; padding:4px 10px; cursor:pointer; }
.inspector-ready button:disabled { cursor:default; opacity:.45; }
.inspector-ready button:hover:not(:disabled) { background:var(--hover); }
.inspector-ready input[type=range] { accent-color:var(--accent); }
.inspector-ready code,.inspector-ready pre { font-family:var(--mono); }
.inspector-ready .inspector-head { height:40px; min-height:40px; flex-wrap:nowrap; gap:2px; padding:0 8px; background:var(--paper); }
.inspector-ready .inspector-head-main { display:flex; align-items:center; flex:1; min-width:0; }
.inspector-ready .inspector-tabs { flex:1; align-items:center; gap:2px; }
.inspector-ready .inspector-tabs button { border:0; border-radius:6px; min-height:28px; padding:5px 10px; color:var(--muted); background:transparent; }
.inspector-ready .inspector-tabs button[aria-selected=true] { color:var(--ink); background:var(--surface); }
.inspector-ready .inspector-head > .inspector-icon { width:28px; height:28px; margin:0; }
.inspector-ready .inspector-icon[aria-pressed=true] { background:var(--accent-soft); color:var(--accent); }
.inspector-ready .inspector-camera { display:flex; align-items:center; flex:0 0 auto; flex-wrap:wrap; gap:6px; margin:0; padding:8px 12px; border:0; border-bottom:1px solid var(--border); background:var(--paper); overflow:visible; }
.inspector-ready .inspector-camera-field { display:flex; flex:0 0 auto; gap:0; height:30px; border:1px solid var(--border); border-radius:6px; background:var(--surface); overflow:hidden; }
.inspector-ready .inspector-camera-field > span:first-child { padding:0 4px 0 9px; color:var(--faint); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
.inspector-ready .inspector-camera-field input[type=number] { width:58px; min-height:0; padding:0 5px; border:0; background:transparent; font:12px var(--mono); appearance:textfield; color:var(--ink); }
.inspector-ready .inspector-camera-field input::-webkit-inner-spin-button { appearance:none; }
.inspector-ready .inspector-camera-field input[type=range] { width:110px; padding:0; margin:0 10px 0 2px; min-height:0; }
.inspector-ready .inspector-unit { padding-right:9px; color:var(--faint); }
.inspector-ready .inspector-copy-agent { margin-left:auto; background:var(--ink); color:var(--paper); border-color:var(--ink); font-weight:500; }
.inspector-ready .inspector-copy-agent:hover { background:var(--ink); opacity:.88; }
.inspector-ready .inspector-menu { top:38px; right:8px; width:236px; padding:10px; border-radius:10px; box-shadow:0 8px 28px #0002; }
.inspector-ready .inspector-dock-options { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:8px; }
.inspector-ready .inspector-dock-options button { width:auto; height:34px; border:1px solid var(--border); justify-content:center; }
.inspector-ready .inspector-menu-label { font-size:11px; }
.inspector-ready .inspector-segments,.inspector-ready .inspector-layer-modes,.inspector-ready .controls-segments { display:inline-flex; padding:2px; background:var(--surface); border:1px solid var(--border); border-radius:6px; gap:2px; }
.inspector-ready .inspector-segments button,.inspector-ready .inspector-layer-modes button,.inspector-ready .controls-segments button { min-height:23px; border:0; border-radius:4px; padding:3px 9px; font-size:12px; background:transparent; color:var(--muted); }
.inspector-ready .inspector-segments button[aria-pressed=true],.inspector-ready .inspector-layer-modes button[aria-pressed=true],.inspector-ready .controls-segments button[aria-checked=true] { color:var(--ink); background:var(--paper); box-shadow:0 1px 2px #0001; }
.inspector-ready .inspector-menu .inspector-segments { display:flex; }.inspector-ready .inspector-menu .inspector-segments button { flex:1; }
.inspector-ready .inspector-tools { padding:10px 12px; gap:8px; background:var(--paper); }
.inspector-ready .inspector-tools input[type=search] { height:30px; padding:0 9px; background:var(--surface); border-radius:6px; width:auto; }
.inspector-ready .inspector-subtabs { padding:0 20px; gap:18px; }
.inspector-ready .inspector-subtabs button { background:transparent; border:0; border-radius:0; border-bottom:2px solid transparent; padding:8px 0 9px; color:var(--muted); min-height:36px; }
.inspector-ready .inspector-subtabs button[aria-selected=true] { color:var(--ink); border-bottom-color:var(--ink); }
.inspector-ready input[role=switch] { appearance:none; width:26px!important; height:15px!important; min-height:0; flex:none; border:0; border-radius:8px; background:var(--faint); position:relative; padding:0; margin:0; cursor:pointer; }
.inspector-ready input[role=switch]::before { content:''; position:absolute; width:11px; height:11px; left:2px; top:2px; border-radius:50%; background:#fff; transition:transform .15s; }
.inspector-ready input[role=switch]:checked { background:var(--accent); }
.inspector-ready input[role=switch]:checked::before { transform:translateX(11px); }
.inspector-ready .inspector-layer-split { display:grid; grid-template-columns:minmax(0,min(38%,360px)) minmax(0,1fr); }
.inspector-ready .inspector-layer-sidebar { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border-right:1px solid var(--border); }
.inspector-ready .inspector-layer-list { flex:1; border:0; }.inspector-ready .inspector-layer-tools { flex-direction:column; align-items:stretch; }
.inspector-ready .inspector-layer-tools-row { display:flex; align-items:center; gap:8px; }.inspector-ready .inspector-layer-total { margin-left:auto; font:11px var(--mono); }
.inspector-ready .inspector-layer-visible { font-size:12px; }.inspector-ready .inspector-layer-group-title { height:32px; font-size:11px; padding:0 12px 0 8px!important; }
.inspector-ready .inspector-layer-group-title strong { text-transform:uppercase; letter-spacing:.05em; }
.inspector-ready .inspector-layer-row { display:grid; grid-template-columns:20px 18px minmax(0,1fr) 64px; height:30px; padding:0 12px 0 6px; gap:8px; border-left:2px solid transparent; }
.inspector-ready .inspector-layer-row[aria-pressed=true] { background:var(--inspector-selected); border-left-color:var(--accent); color:var(--ink); }
.inspector-ready .inspector-layer-glyph { color:var(--muted); font-size:15px; }.inspector-ready .inspector-layer-label { font-size:12px; }
.inspector-ready .inspector-layer-prefix { color:var(--faint); }.inspector-ready .inspector-layer-name { font-weight:500; }
.inspector-ready .inspector-eye { padding:0; border:0; width:20px; height:20px; min-height:20px; color:var(--faint); background:transparent; display:grid; place-items:center; opacity:0; }
.inspector-ready .inspector-eye svg { width:14px; height:14px; }
.inspector-ready :is(.inspector-layer-row,.inspector-layer-group-title):hover .inspector-eye,.inspector-ready .inspector-eye:focus-visible,.inspector-ready .inspector-eye[aria-pressed=true] { opacity:1; }
.inspector-zrange { position:relative; display:block; width:64px; height:14px; }.inspector-zrange::before { content:''; position:absolute; inset:6px 0; height:2px; background:var(--border); }
.inspector-zrange i { position:absolute; top:5px; height:4px; border-radius:2px; background:var(--accent); opacity:.65; }.inspector-zrange em { position:absolute; top:1px; height:12px; width:1px; background:var(--accent); }
.inspector-ready .inspector-layer-heading { padding:14px 20px 6px; align-items:flex-start; border:0; }
.inspector-ready .inspector-layer-title strong { font-size:16px; font-weight:600; }.inspector-ready .inspector-layer-title > code { font-size:10px; color:var(--faint); }
.inspector-layer-status { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); margin-top:6px; }.inspector-layer-status[data-state=Enabled] { color:var(--ok); }.inspector-layer-status[data-state="Outside zoom"] { color:var(--warn); }
.inspector-ready .inspector-layer-rules { font-size:12px; }.inspector-ready .inspector-layer-rules th { padding:8px 20px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
.inspector-ready .inspector-layer-rules th:first-child { width:42%; }.inspector-ready .inspector-layer-rules td { padding:8px 20px; vertical-align:middle; min-height:44px; }
.inspector-ready .inspector-layer-rules code { font:12px/1.5 var(--mono); }.inspector-ready .inspector-layer-rule-name { color:var(--ink); }.inspector-ready .inspector-layer-dependency { color:var(--accent); font:10px var(--mono); }
.inspector-ready .inspector-layer-rule-editor { gap:9px; flex-wrap:wrap; }.inspector-ready .inspector-layer-rule-editor input:not([type=color]):not([type=checkbox]):not([type=range]),.inspector-ready .inspector-layer-rule-editor select { min-height:26px; border:1px solid var(--border); font:12px var(--mono); border-radius:6px; }
.inspector-ready .inspector-layer-rule-editor input[type=color] { width:22px; height:22px; }
.inspector-ready .inspector-layer-rule-editor input[type=range] { width:110px; min-width:70px; padding:0; flex:0 1 110px; }
.inspector-rule-toggle { display:flex; align-items:center; gap:10px; }.inspector-rule-toggle input { width:14px; height:14px; min-height:0; margin:0; accent-color:var(--accent); }
.inspector-rule-choices { display:inline-flex; flex-wrap:wrap; border:1px solid var(--border); border-radius:6px; overflow:hidden; }.inspector-ready .inspector-rule-choices button { min-height:26px; border:0; border-radius:0; font:11px var(--mono); padding:3px 8px; }
.inspector-rule-spark { display:flex; align-items:center; gap:10px; color:var(--accent); font:11px var(--mono); margin-bottom:5px; }.inspector-rule-spark svg { width:130px; height:26px; overflow:visible; }
.inspector-filter-chips { display:flex; flex-wrap:wrap; gap:6px; margin-block:10px; }.inspector-filter-chip { padding:4px 9px; background:var(--surface); border:1px solid var(--border); border-radius:13px; font:11px var(--mono); }
.inspector-ready .inspector-layer-section,.inspector-ready .inspector-layer-origin { padding:12px 20px; }.inspector-ready .inspector-layer-section h4 { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.inspector-ready .inspector-layer-evidence { padding:0; }.inspector-ready .inspector-layer-evidence-row { padding:12px 20px; font-size:12px; grid-template-columns:20px 130px 1fr; }
.inspector-ready .inspector-layer-evidence-row[data-state=pass] .inspector-layer-indicator { color:var(--ok); }.inspector-ready .inspector-layer-evidence-row[data-state=warn] .inspector-layer-indicator { color:var(--warn); }
.inspector-ready .inspector-layer-json { font:11px/1.6 var(--mono); color:var(--ink); }
.inspector-ready .inspector-table { font:12px var(--mono); }.inspector-ready .inspector-table th { padding:8px 12px; font:11px Inter,system-ui,sans-serif; text-transform:uppercase; border-right:0; }.inspector-ready .inspector-table td { height:32px; padding:6px 12px; }.inspector-ready .inspector-table tbody tr:nth-child(even) { background:transparent; }
.inspector-ready .inspector-network-body { display:grid; grid-template-columns:minmax(0,min(38%,360px)) minmax(0,1fr); }.inspector-tiles-sidebar { display:flex; flex-direction:column; min-width:0; min-height:0; overflow:hidden; border-right:1px solid var(--border); }.inspector-ready .inspector-network-detail { border:0; min-width:0; }
.inspector-ready .inspector-tile-heading { padding:14px 20px 8px; }.inspector-tile-heading strong { font:15px var(--mono); }.inspector-tile-status { padding:0 20px 10px; color:var(--muted); font-size:12px; }
.inspector-tile-grid { display:grid; gap:3px; padding:12px; }.inspector-ready .inspector-tile-cell { aspect-ratio:1; padding:0; font:10px var(--mono); min-width:0; min-height:20px; border-radius:4px; background:color-mix(in srgb,var(--accent) var(--weight,10%),var(--paper)); }
.inspector-ready .inspector-tile-cell[aria-pressed=true] { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); }.inspector-tile-grid-title { margin:10px 12px 0; color:var(--muted); font-size:11px; }
.inspector-tile-chip-list { display:flex; gap:6px; flex-wrap:wrap; padding:10px 20px; border-bottom:1px solid var(--border); }.inspector-ready .inspector-tile-chip { font:11px var(--mono); border-radius:13px; }
.inspector-asset-layout { display:grid; grid-template-columns:minmax(0,1fr) 300px; min-height:0; flex:1; }.inspector-asset-main { min-width:0; overflow:auto; padding:12px; }.inspector-asset-aside { overflow:auto; border-left:1px solid var(--border); }.inspector-asset-aside h3 { font:500 15px var(--mono); margin:16px 20px; }.inspector-asset-variants { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--border); }.inspector-asset-variant { padding:20px 10px; display:flex; flex-direction:column; align-items:center; gap:10px; background:var(--surface); font:10px var(--mono); overflow-wrap:anywhere; }.inspector-asset-variant[data-night=true] { background:#262626; color:#f5f5f5; }
.inspector-ready .inspector-sprite-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(104px,1fr)); gap:4px; }.inspector-ready .inspector-sprite-card { border:1px solid transparent; border-radius:8px; background:transparent; padding:16px 6px 10px; cursor:pointer; }.inspector-sprite-card[aria-pressed=true] { background:var(--inspector-selected)!important; border-color:var(--accent)!important; }
.inspector-debug-overlay { display:grid; grid-template-columns:84px 1fr auto; align-items:center; gap:16px; padding:10px 20px; border-bottom:1px solid var(--border); cursor:pointer; }.inspector-debug-overlay:hover { background:var(--hover); }.inspector-debug-overlay small { display:block; color:var(--muted); font-size:12px; }.inspector-debug-preview { width:84px; height:58px; border-radius:6px; overflow:hidden; }.inspector-debug-preview svg { width:100%; height:100%; }
.inspector-section-heading { background:var(--surface); padding:8px 20px; font-size:11px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; border-bottom:1px solid var(--border); }
.inspector-ready .inspector-overdraw-help { margin:0; border:0; border-bottom:1px solid var(--border); border-radius:0; padding:12px 20px 12px 120px; background:var(--surface); }.inspector-debug-scale { display:flex; align-items:center; gap:12px; padding:16px 20px; flex-wrap:wrap; }.inspector-debug-scale input[type=number] { width:64px; }
.inspector-ready .map-controls { padding:0!important; background:var(--paper); }.inspector-ready .controls-heading { display:none; }.inspector-ready .controls-grid { display:block; }.inspector-ready .controls-selection,.inspector-ready .controls-runtime { border:0; padding:0; }
.inspector-ready .controls-section-title { margin:0; padding:8px 20px; background:var(--surface); border-bottom:1px solid var(--border); font-size:11px; letter-spacing:.05em; }.inspector-ready .control-field { display:grid; grid-template-columns:200px 1fr; align-items:center; margin:0; padding:10px 20px; border-bottom:1px solid var(--border); gap:16px; font-size:13px; }.inspector-ready .control-field select { max-width:100%; width:max-content; min-width:132px; }
.inspector-ready #controls-modules { display:block; }.inspector-ready .control-module { border:0; border-bottom:1px solid var(--border); border-radius:0; margin:0; background:var(--paper); }.inspector-ready .control-module-header { padding:10px 20px; }.inspector-ready .control-module-header label { justify-content:flex-start; font-size:13px; font-weight:500; }.inspector-ready .control-module-header input { order:-1; margin-right:12px; }.inspector-ready .control-module fieldset { padding:0; background:var(--surface); }.inspector-ready .control-module .control-field { padding-left:58px; border:0; }.inspector-ready .inspector-scene-content { max-width:1000px; width:100%; }.inspector-palettes { display:flex; gap:8px; flex-wrap:wrap; }.inspector-ready .inspector-palette { display:flex; align-items:center; gap:8px; padding:5px 10px 5px 5px; }.inspector-palette-swatches { display:grid; grid-template-columns:repeat(2,11px); grid-template-rows:repeat(2,11px); overflow:hidden; border-radius:4px; }
@container(max-width:760px) {
 .inspector-ready .inspector-layer-title { flex-basis:180px; }.inspector-ready .inspector-camera-field input[type=range] { width:80px; }
 .inspector-ready .inspector-layer-rules th:first-child { width:45%; }.inspector-ready .inspector-layer-rules td { padding:8px 12px; }
 .inspector-asset-layout { grid-template-columns:1fr; }.inspector-asset-aside { border:0; border-top:1px solid var(--border); }
 .inspector-ready .control-field { grid-template-columns:160px 1fr; }.inspector-ready .control-module .control-field { padding-left:30px; }
}
@media(prefers-reduced-motion:reduce) { .inspector-ready * { scroll-behavior:auto!important; transition:none!important; animation:none!important; } }

.inspector-palettes{display:flex;gap:8px;flex-wrap:wrap}.inspector-ready .inspector-palettes button{display:flex;flex-direction:column;gap:7px;padding:10px 14px;min-width:110px;background:var(--paper);text-align:left;text-transform:capitalize}.inspector-ready .inspector-palettes button[aria-checked=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.inspector-palette-swatches{display:flex;height:26px;width:100%;overflow:hidden;border-radius:4px}.inspector-palette-swatches i{flex:1;min-width:20px}.inspector-ready .inspector-palette-field{align-items:flex-start;flex-direction:column}.inspector-model-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}.inspector-ready .inspector-model-card{display:flex;flex-direction:column;align-items:center;padding:0;overflow:hidden;border-radius:10px}.inspector-model-card canvas{background:linear-gradient(var(--surface),var(--paper));max-width:100%;height:auto!important}.inspector-model-card strong{font:500 12px var(--mono);padding:9px 12px 2px;overflow-wrap:anywhere}.inspector-model-card small{font-size:11px;color:var(--muted);padding:0 12px 9px}.inspector-model-card[aria-pressed=true]{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.inspector-asset-aside>canvas{display:block;margin:auto;max-width:100%;touch-action:none;cursor:grab}.inspector-font-ranges{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.inspector-font-ranges small{color:var(--muted);font-size:11px}

.inspector-debug-specimen{display:flex;align-items:center;gap:18px;min-height:70px;padding:12px 20px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.inspector-rule-font-preview{overflow:hidden;max-width:100%}.inspector-rule-font-preview canvas{max-width:100%;height:auto!important}
/* Keep the new shell independent of the legacy in-header camera and toolbar breakpoints. */
.inspector-ready .inspector-shell>.inspector-camera{order:0;flex:0 0 auto;margin:0;border-top:0;background:var(--paper);padding:8px 12px}
.inspector-ready .inspector-shell>.inspector-head{flex-wrap:nowrap}.inspector-ready .inspector-shell .inspector-head-main{display:flex;gap:2px}
.inspector-ready .inspector-shell .inspector-layer-tools input[type=search]{order:0;flex:0 0 auto;width:100%;height:30px}
.inspector-ready .inspector-shell .inspector-layer-tools{flex-wrap:nowrap}.inspector-ready .inspector-shell .inspector-layer-tools-row{flex:none;min-height:28px}
.inspector-ready .inspector-shell .inspector-layer-row{display:grid;grid-template-columns:20px 18px minmax(0,1fr) 64px;height:30px;min-height:30px;padding:0 12px 0 6px;gap:8px}
.inspector-ready .inspector-shell .inspector-layer-label{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.inspector-ready .inspector-shell .inspector-layer-heading{flex:none}.inspector-ready .inspector-shell .inspector-layer-title{flex:1 1 180px}
.inspector-ready .inspector-shell .inspector-layer-sidebar .inspector-layer-list{flex:1;min-height:0}.inspector-ready .inspector-shell .map-controls .control-field{display:grid;grid-template-columns:160px minmax(0,1fr);padding:12px 20px;margin:0}
.inspector-ready .inspector-shell .control-module-header label{display:flex;gap:12px}.inspector-ready .inspector-shell .map-controls input[role=switch]{width:26px!important;height:15px!important;min-height:0;border:0;background:var(--faint)}.inspector-ready .inspector-shell .map-controls input[role=switch]:checked{background:var(--accent)}.inspector-ready .inspector-shell .map-controls input[role=switch]::before{width:11px;height:11px;top:2px;left:2px;background:white}.inspector-ready .inspector-shell .map-controls input[role=switch]:checked::before{transform:translateX(11px)}
@container(max-width:760px){.inspector-ready .inspector-shell .inspector-layer-tools{padding:8px 12px}.inspector-ready .inspector-shell .inspector-tabs button{padding-inline:7px}.inspector-ready .inspector-shell .inspector-head{padding-inline:4px}.inspector-ready .inspector-shell .inspector-camera-field{flex:0 0 auto}}

/* Shared density also wins over panel styles injected after the shell stylesheet. */
.inspector-ready .inspector-shell { font:12px/1.35 var(--ui); }
.inspector-ready .inspector-shell :is(button,input,select,summary) { min-height:var(--inspector-control-height); }
.inspector-ready .inspector-shell button { padding:2px 6px; border-radius:3px; }
.inspector-ready .inspector-shell :is(input[type=checkbox],input[type=radio],input[type=range],input[type=color]) { min-height:0; }
.inspector-ready .inspector-shell .inspector-head { height:var(--inspector-header-height); min-height:var(--inspector-header-height); padding:0 4px; }
.inspector-ready .inspector-shell .inspector-tabs { gap:0; }
.inspector-ready .inspector-shell .inspector-tabs button { height:34px; min-height:34px; padding:0 8px; border-radius:4px; }
.inspector-ready .inspector-shell .inspector-head .inspector-icon { width:30px; height:30px; min-height:30px; padding:5px; margin-block:0; }
.inspector-ready .inspector-shell > .inspector-camera { min-height:48px; padding:8px; gap:6px; }
.inspector-ready .inspector-shell .inspector-camera-field { height:var(--inspector-camera-control-height); border-radius:5px; }
.inspector-ready .inspector-shell .inspector-camera-field > span:first-child { padding-left:6px; }
.inspector-ready .inspector-shell .inspector-camera-field input[type=number] { width:48px; min-height:0; padding:0 3px; font-size:12px; }
.inspector-ready .inspector-shell .inspector-camera-field input[type=range] { width:88px; margin:0 6px 0 2px; }
.inspector-ready .inspector-shell .inspector-unit { padding-right:6px; }
.inspector-ready .inspector-shell .inspector-camera-reset { display:inline-flex; align-items:center; justify-content:center; flex:none; width:26px; height:100%; min-height:0; padding:4px; border:0; border-left:1px solid var(--border); border-radius:0; background:transparent; }
.inspector-ready .inspector-shell .inspector-camera-reset:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.inspector-ready .inspector-shell .inspector-copy-agent { min-height:var(--inspector-camera-control-height); padding:4px 10px; font-size:12px; white-space:nowrap; }
.inspector-ready .inspector-shell .inspector-menu { top:var(--inspector-header-height); right:4px; width:216px; padding:6px; border-radius:4px; }
.inspector-ready .inspector-shell .inspector-dock-options { gap:4px; margin-bottom:6px; }
.inspector-ready .inspector-shell .inspector-dock-options button { height:26px; padding:2px; }
.inspector-ready .inspector-shell :is(.inspector-segments,.inspector-layer-modes,.controls-segments) { padding:1px; gap:1px; border-radius:3px; }
.inspector-ready .inspector-shell :is(.inspector-segments,.inspector-layer-modes,.controls-segments) button { min-height:20px; padding:1px 6px; border-radius:2px; }
.inspector-ready .inspector-shell .inspector-tools { min-height:28px; padding:3px 8px; gap:4px; }
.inspector-ready .inspector-shell .inspector-tools input[type=search] { height:var(--inspector-control-height); padding:0 6px; border-radius:3px; }
.inspector-ready .inspector-shell .inspector-layer-tools-row { min-width:0; min-height:var(--inspector-control-height); gap:6px; flex-wrap:wrap; }
.inspector-ready .inspector-shell .inspector-layer-modes { max-width:100%; overflow-x:auto; }
.inspector-ready .inspector-shell .inspector-subtabs { padding:0 8px; gap:12px; }
.inspector-ready .inspector-shell .inspector-subtabs button { min-height:var(--inspector-nav-height); padding:3px 0; border-radius:0; }
.inspector-ready .inspector-shell .inspector-footer { min-height:20px; padding:2px 8px; gap:8px; }
.inspector-ready .inspector-shell .inspector-section-heading { padding:4px 10px; }
.inspector-ready .inspector-shell .inspector-kv { gap:3px 8px; padding:6px 8px; font:11px/1.4 var(--mono); }
.inspector-ready .inspector-shell .inspector-layer-group-title { height:var(--inspector-row-height); min-height:var(--inspector-row-height); padding:0 8px 0 6px!important; }
.inspector-ready .inspector-shell .inspector-layer-row { grid-template-columns:18px 16px minmax(0,1fr) 52px; height:var(--inspector-row-height); min-height:var(--inspector-row-height); padding:0 8px 0 4px; gap:4px; border-radius:0; }
.inspector-ready .inspector-shell .inspector-layer-glyph { font-size:13px; }
.inspector-ready .inspector-shell .inspector-eye { min-height:18px; width:18px; height:18px; padding:0; }
.inspector-ready .inspector-shell .inspector-zrange { width:52px; }
.inspector-ready .inspector-shell .inspector-layer-heading { padding:8px 10px 4px; }
.inspector-ready .inspector-shell .inspector-layer-title strong { font-size:13px; }
.inspector-ready .inspector-shell .inspector-layer-status { margin-top:3px; gap:6px; font-size:11px; }
.inspector-ready .inspector-shell .inspector-layer-rules th { padding:4px 10px; }
.inspector-ready .inspector-shell .inspector-layer-rules td { padding:3px 10px; min-height:24px; }
.inspector-ready .inspector-shell .inspector-layer-rules code { font:11px/1.4 var(--mono); }
.inspector-ready .inspector-shell .inspector-layer-rule-editor { gap:5px; }
.inspector-ready .inspector-shell .inspector-layer-rule-editor :is(input:not([type=color]):not([type=checkbox]):not([type=range]),select) { min-height:20px; font:11px/1.4 var(--mono); border-radius:3px; }
.inspector-ready .inspector-shell .inspector-layer-rule-editor input[type=color] { width:18px; height:20px; }
.inspector-ready .inspector-shell .inspector-layer-rule-editor input[type=range] { width:88px; min-width:60px; flex-basis:88px; }
.inspector-ready .inspector-shell .inspector-rule-toggle { gap:6px; }
.inspector-ready .inspector-shell .inspector-rule-choices { border-radius:3px; }
.inspector-ready .inspector-shell .inspector-rule-choices button { min-height:20px; padding:1px 5px; border-radius:0; }
.inspector-ready .inspector-shell .inspector-rule-spark { gap:6px; margin-bottom:3px; }
.inspector-ready .inspector-shell .inspector-rule-spark svg { width:100px; height:22px; }
.inspector-ready .inspector-shell .inspector-filter-chips { gap:4px; margin-block:6px; }
.inspector-ready .inspector-shell .inspector-filter-chip { padding:2px 6px; }
.inspector-ready .inspector-shell :is(.inspector-layer-section,.inspector-layer-origin) { padding:6px 10px; }
.inspector-ready .inspector-shell .inspector-layer-evidence-row { padding:6px 10px; grid-template-columns:16px 110px minmax(0,1fr); }
.inspector-ready .inspector-shell .inspector-table { font:11px/1.4 var(--mono); }
.inspector-ready .inspector-shell .inspector-table th { padding:4px 8px; font:11px var(--ui); }
.inspector-ready .inspector-shell .inspector-table td { height:var(--inspector-row-height); padding:2px 8px; }
.inspector-ready .inspector-shell .inspector-tile-heading { padding:8px 10px 4px; }
.inspector-ready .inspector-shell .inspector-tile-heading strong { font-size:13px; }
.inspector-ready .inspector-shell .inspector-tile-status { padding:0 10px 6px; }
.inspector-ready .inspector-shell .inspector-tile-grid { padding:8px; gap:2px; }
.inspector-ready .inspector-shell .inspector-tile-cell { padding:0; min-height:20px; }
.inspector-ready .inspector-shell .inspector-tile-grid-title { margin:6px 8px 0; }
.inspector-ready .inspector-shell .inspector-tile-chip-list { padding:5px 10px; gap:4px; }
.inspector-ready .inspector-shell .inspector-asset-main { padding:8px; }
.inspector-ready .inspector-shell .inspector-asset-aside h3 { font-size:13px; margin:8px 10px; }
.inspector-ready .inspector-shell .inspector-asset-variant { padding:10px 6px; gap:6px; }
.inspector-ready .inspector-shell .inspector-sprite-grid { grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); }
.inspector-ready .inspector-shell .inspector-sprite-card { padding:6px 4px; border-radius:4px; }
.inspector-ready .inspector-shell .inspector-sprite-preview { height:44px; }
.inspector-ready .inspector-shell .inspector-sprite-card figcaption { margin-top:4px; }
.inspector-ready .inspector-shell .inspector-font-card { padding:8px; }
.inspector-ready .inspector-shell .inspector-font-card figcaption { margin-bottom:5px; font:11px/1.4 var(--mono); }
.inspector-ready .inspector-shell .inspector-font-loading { padding:8px; }
.inspector-ready .inspector-shell .inspector-model-grid { grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:6px; }
.inspector-ready .inspector-shell .inspector-model-card { padding:0; border-radius:4px; }
.inspector-ready .inspector-shell .inspector-model-card strong { padding:5px 8px 2px; }
.inspector-ready .inspector-shell .inspector-model-card small { padding:0 8px 5px; }
.inspector-ready .inspector-shell .inspector-debug-overlay { grid-template-columns:60px 1fr auto; gap:8px; padding:6px 10px; }
.inspector-ready .inspector-shell .inspector-debug-preview { width:60px; height:40px; border-radius:3px; }
.inspector-ready .inspector-shell .inspector-overdraw-help { padding:6px 10px 6px 78px; }
.inspector-ready .inspector-shell .inspector-debug-scale { gap:8px; padding:8px 10px; }
.inspector-ready .inspector-shell .inspector-debug-specimen { gap:10px; min-height:52px; padding:6px 10px; border-radius:4px; }
.inspector-ready .inspector-shell .controls-section-title { padding:4px 10px; }
.inspector-ready .inspector-shell .map-controls .control-field { grid-template-columns:140px minmax(0,1fr); padding:6px 10px; gap:8px; font-size:12px; }
.inspector-ready .inspector-shell .control-module-header { padding:6px 10px; }
.inspector-ready .inspector-shell .control-module-header label { font-size:12px; gap:6px; }
.inspector-ready .inspector-shell .control-module-header input { margin-right:6px; }
.inspector-ready .inspector-shell .control-module .control-field { padding-left:38px; }
.inspector-ready .inspector-shell .map-controls .control-field.inspector-palette-field { grid-template-columns:70px minmax(0,1fr); align-items:center; }
.inspector-ready .inspector-shell .inspector-palettes { gap:4px; align-items:center; }
.inspector-ready .inspector-shell .inspector-palettes button { flex-direction:row; align-items:center; gap:5px; padding:2px 6px; min-width:0; height:var(--inspector-control-height); font-size:11px; white-space:nowrap; }
.inspector-ready .inspector-shell .inspector-palette-swatches { width:24px; height:10px; flex:none; border-radius:2px; }
.inspector-ready .inspector-shell .inspector-palette-swatches i { min-width:0; }
@container(max-width:480px) {
 .inspector-ready .inspector-shell .map-controls .control-field { grid-template-columns:110px minmax(0,1fr); }
 .inspector-ready .inspector-shell .control-module .control-field { padding-left:24px; }
 .inspector-ready .inspector-shell .inspector-camera-field input[type=range] { width:48px; }
}
`;
