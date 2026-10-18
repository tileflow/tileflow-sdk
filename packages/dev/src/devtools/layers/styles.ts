export const layersStyles = `
.dt-layer-tools { gap:8px; padding:5px 8px; background:var(--surface); }
.dt-layer-modes { display:flex; flex:none; border:1px solid var(--border); border-radius:3px; overflow:hidden; }
.dt-layer-modes button { border:0; border-radius:0; padding:3px 9px; white-space:nowrap; }
.dt-layer-modes button + button { border-left:1px solid var(--border); }
.dt-layer-visible { flex:none; cursor:pointer; }
.dt-layer-visible input { width:13px; height:13px; cursor:pointer; }
.dt-layer-total { color:var(--muted); font:11px ui-monospace,monospace; white-space:nowrap; }
.devtools-ready .dt-layer-copy { border:1px solid var(--accent); color:var(--accent); background:var(--paper); white-space:nowrap; }
.dt-layer-split { display:grid; grid-template-columns:minmax(270px,34%) minmax(0,1fr); flex:1; min-height:0; }
.dt-layer-list { min-height:0; overflow:auto; border-right:1px solid var(--border); padding-bottom:10px; }
.dt-layer-group-title { display:flex; align-items:center; gap:7px; width:100%; border:0; border-bottom:1px solid var(--border); background:var(--surface) !important; border-radius:0 !important; padding:5px 9px !important; text-align:left; position:sticky; top:0; z-index:1; }
.dt-layer-group-title strong { font-size:11px; text-transform:capitalize; font-weight:600; }
.dt-layer-count { color:var(--muted); margin-left:auto; font-size:10px; }
.devtools-ready .dt-layer-row { display:flex; align-items:center; gap:8px; width:100%; padding:5px 9px 5px 18px; text-align:left; border:0; border-left:2px solid transparent; border-radius:0; min-height:29px; }
.dt-layer-row[aria-pressed=true] { border-left-color:var(--accent); }
.dt-layer-glyph { width:17px; flex:none; font:16px ui-monospace,monospace; text-align:center; color:var(--muted); }
.dt-layer-color { text-shadow:0 0 1px #777; }
.dt-layer-label { display:flex; flex-direction:column; min-width:0; flex:1; }
.dt-layer-label > * { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dt-layer-state { color:var(--muted); font-size:10px; white-space:nowrap; }
.dt-layer-state[data-state=Hidden],.dt-layer-state[data-state="Outside zoom"] { color:light-dark(#93620b,#e9bd67); }
.dt-layer-state[data-state=Runtime] { color:light-dark(#7c3dc6,#c9a4f4); }
.dt-layer-detail { display:flex; flex-direction:column; min-width:0; min-height:0; }
.dt-layer-heading { padding:8px 12px 6px; border-bottom:1px solid var(--border); display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.dt-layer-title { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 0 200px; }
.dt-layer-title strong { font-size:13px; font-weight:500; overflow-wrap:anywhere; }
.dt-layer-title code { font:10px ui-monospace,monospace; overflow-wrap:anywhere; color:var(--muted); }
.dt-layer-content { padding:0; }
.dt-layer-evidence { padding:5px 12px; }
.dt-layer-evidence-row { display:grid; grid-template-columns:16px 115px minmax(0,1fr); gap:8px; padding:7px 0; border-bottom:1px solid var(--border); font-size:11px; align-items:baseline; }
.dt-layer-evidence-row strong { font-weight:500; }
.dt-layer-evidence-row > :last-child { overflow-wrap:anywhere; }
.dt-layer-indicator { font:13px ui-monospace,monospace; color:var(--muted); }
.dt-layer-evidence-row[data-state=pass] .dt-layer-indicator { color:light-dark(#188038,#81c995); }
.dt-layer-evidence-row[data-state=warn] .dt-layer-indicator { color:light-dark(#a15c00,#fdd663); }
.dt-layer-muted,.dt-layer-dependency { color:var(--muted); font-size:11px; }
.dt-layer-neighbors { margin:7px 12px 12px; }
.dt-layer-neighbors > strong { font-weight:500; font-size:11px; }
.dt-layer-neighbors > div { display:flex; align-items:baseline; gap:8px; padding-top:3px; }
.dt-layer-neighbors > div > span:first-child { width:55px; flex:none; }
.devtools-ready .dt-layer-link { border:0; padding:2px 0; background:transparent; color:var(--accent); font-size:11px; text-align:left; overflow-wrap:anywhere; }
.dt-layer-rules { width:100%; border-collapse:collapse; table-layout:fixed; font-size:11px; }
.dt-layer-rules th { text-align:left; background:var(--surface); color:var(--muted); font-weight:500; padding:5px 12px; border-bottom:1px solid var(--border); }
.dt-layer-rules th:first-child { width:57%; }
.dt-layer-rules td { padding:5px 12px; border-bottom:1px solid var(--border); vertical-align:top; overflow-wrap:anywhere; }
.dt-layer-rules code { font:11px/1.6 ui-monospace,monospace; }
.dt-layer-rule-name { color:light-dark(#881391,#c58af9); }
.dt-layer-dependency { display:block; font-size:10px; }
.dt-layer-rule-editor { display:flex; align-items:center; gap:5px; min-width:0; }
.dt-layer-rule-editor input:not([type=color]):not([type=checkbox]),.dt-layer-rule-editor select { width:100%; min-width:0; flex:1; padding:2px 4px; border:1px solid transparent; border-radius:2px; background:transparent; color:var(--ink); font:11px/1.6 ui-monospace,monospace; }
.dt-layer-rule-editor input[type=checkbox] { flex:none; width:13px; height:13px; margin:0 2px 0 0; accent-color:var(--accent); cursor:pointer; }
.dt-layer-rule-editor input[type=checkbox]:disabled { cursor:default; }
.dt-layer-rule-editor input:hover,.dt-layer-rule-editor select:hover { border-color:var(--border); }
.dt-layer-rule-editor input:focus,.dt-layer-rule-editor select:focus { border-color:var(--accent); outline:1px solid var(--accent); background:var(--paper); }
.dt-layer-rule-editor input[type=color] { flex:none; width:16px; height:20px; padding:0; border:0; background:transparent; cursor:pointer; }
.dt-layer-rule-editor input[type=color]::-webkit-color-swatch-wrapper { padding:3px 0; }
.dt-layer-rule-editor input[type=color]::-webkit-color-swatch { border:1px solid #8888; border-radius:2px; }
.dt-layer-rule-editor .dt-layer-rule-reset { flex:none; padding:1px 4px; border:0; color:var(--accent); background:transparent; }
.dt-layer-rule-reset:disabled { visibility:hidden; }
.dt-layer-rules tr[data-modified=true] > td:first-child { box-shadow:inset 2px 0 var(--accent); }
.dt-layer-rules tr[data-disabled=true] .dt-layer-rule-name,.dt-layer-rules tr[data-disabled=true] input:not([type=checkbox]):not([type=color]),.dt-layer-rules tr[data-disabled=true] select { color:var(--muted); text-decoration:line-through; }
.dt-layer-rules tr[data-disabled=true] input[type=color] { opacity:.45; cursor:default; }
.dt-layer-rule-error { display:block; padding-top:4px; color:light-dark(#b3261e,#f28b82); font-size:10px; }
.dt-layer-rule-error[hidden] { display:none; }
.dt-layer-rules tr[data-selected=true] { background:var(--dt-selected); }
.dt-layer-content [data-diagnostic-target=true] { background:var(--dt-selected); outline:1px solid var(--accent); outline-offset:-1px; }
.dt-layer-swatch { display:inline-block; width:11px; height:11px; border:1px solid #8888; border-radius:2px; margin-right:5px; vertical-align:middle; }
.dt-layer-json { margin:6px 0; font:11px/1.6 ui-monospace,SFMono-Regular,monospace; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--dt-string); max-height:300px; overflow:auto; }
.dt-layer-curve { display:flex; flex-wrap:wrap; gap:5px 10px; margin-top:6px; padding:6px; background:var(--surface); }
.dt-layer-curve span { flex-basis:100%; color:var(--muted); }
.dt-layer-section,.dt-layer-origin { padding:9px 12px; border-bottom:1px solid var(--border); }
.dt-layer-section h4 { margin:0 0 7px; font-size:11px; font-weight:500; }
.dt-layer-origin > code { margin-left:10px; color:var(--accent); }
.dt-layer-origin dl { display:grid; grid-template-columns:110px minmax(0,1fr); gap:6px 10px; font-size:11px; }
.dt-layer-origin dt { color:var(--muted); }.dt-layer-origin dd { margin:0; overflow-wrap:anywhere; }
.dt-layer-data-summary { margin:8px 12px; font-size:11px; }
.dt-layer-samples { max-height:180px; overflow:auto; border-bottom:1px solid var(--border); }
.dt-layer-notice { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.dt-layer-dialog { width:min(820px,90vw); height:min(680px,85vh); padding:16px; border:1px solid var(--border); border-radius:6px; color:var(--ink); background:var(--paper); box-shadow:0 15px 70px #0005; }
.dt-layer-dialog[open] { display:flex; flex-direction:column; gap:12px; }.dt-layer-dialog::backdrop { background:#0005; }
.dt-layer-dialog-head { display:flex; align-items:center; justify-content:space-between; }.dt-layer-dialog-head strong { font-size:14px; font-weight:500; }
.dt-layer-dialog label { display:flex; flex-direction:column; gap:5px; }.dt-layer-dialog input { padding:7px; border:1px solid var(--border); background:var(--paper); color:var(--ink); }
.dt-layer-dialog textarea { flex:1; min-height:100px; resize:none; background:var(--surface); color:var(--ink); padding:10px; border:1px solid var(--border); font:11px/1.6 ui-monospace,monospace; }
.dt-layer-dialog .dt-layer-copy { margin-left:auto; }
@container(max-width:700px) {
  .dt-layer-heading { padding:6px 9px; }.dt-layer-title { flex-basis:100%; }
  .dt-layer-tools input[type=search] { order:1; flex:1 0 100%; }.dt-layer-tools .dt-layer-copy { margin-left:auto; }
  .dt-layer-evidence-row { grid-template-columns:12px 92px minmax(0,1fr); gap:5px; }
}
`;
