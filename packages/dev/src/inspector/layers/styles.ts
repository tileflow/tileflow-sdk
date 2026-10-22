export const layersStyles = `
.inspector-layer-tools { gap:8px; padding:5px 8px; background:var(--surface); }
.inspector-layer-modes { display:flex; flex:none; border:1px solid var(--border); border-radius:3px; overflow:hidden; }
.inspector-layer-modes button { border:0; border-radius:0; padding:3px 9px; white-space:nowrap; }
.inspector-layer-modes button + button { border-left:1px solid var(--border); }
.inspector-layer-visible { flex:none; cursor:pointer; }
.inspector-layer-visible input { width:13px; height:13px; cursor:pointer; }
.inspector-layer-total { color:var(--muted); font:11px ui-monospace,monospace; white-space:nowrap; }
.inspector-ready .inspector-layer-copy { border:1px solid var(--accent); color:var(--accent); background:var(--paper); white-space:nowrap; }
.inspector-layer-split { display:grid; grid-template-columns:minmax(270px,34%) minmax(0,1fr); flex:1; min-height:0; }
.inspector-layer-list { min-height:0; overflow:auto; border-right:1px solid var(--border); padding-bottom:10px; }
.inspector-layer-group-title { display:flex; align-items:center; gap:7px; width:100%; border:0; border-bottom:1px solid var(--border); background:var(--surface) !important; border-radius:0 !important; padding:5px 9px !important; text-align:left; position:sticky; top:0; z-index:1; }
.inspector-layer-group-title strong { font-size:11px; text-transform:capitalize; font-weight:600; }
.inspector-layer-count { color:var(--muted); margin-left:auto; font-size:10px; }
.inspector-ready .inspector-layer-row { display:flex; align-items:center; gap:8px; width:100%; padding:5px 9px 5px 18px; text-align:left; border:0; border-left:2px solid transparent; border-radius:0; min-height:29px; }
.inspector-layer-row[aria-pressed=true] { border-left-color:var(--accent); }
.inspector-layer-glyph { width:17px; flex:none; font:16px ui-monospace,monospace; text-align:center; color:var(--muted); }
.inspector-layer-color { text-shadow:0 0 1px #777; }
.inspector-layer-label { display:flex; flex-direction:column; min-width:0; flex:1; }
.inspector-layer-label > * { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.inspector-layer-state { color:var(--muted); font-size:10px; white-space:nowrap; }
.inspector-layer-state[data-state=Hidden],.inspector-layer-state[data-state="Outside zoom"] { color:light-dark(#93620b,#e9bd67); }
.inspector-layer-state[data-state=Runtime] { color:light-dark(#7c3dc6,#c9a4f4); }
.inspector-layer-detail { display:flex; flex-direction:column; min-width:0; min-height:0; }
.inspector-layer-heading { padding:8px 12px 6px; border-bottom:1px solid var(--border); display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.inspector-layer-title { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 0 200px; }
.inspector-layer-title strong { font-size:13px; font-weight:500; overflow-wrap:anywhere; }
.inspector-layer-title code { font:10px ui-monospace,monospace; overflow-wrap:anywhere; color:var(--muted); }
.inspector-layer-content { padding:0; }
.inspector-layer-evidence { padding:5px 12px; }
.inspector-layer-evidence-row { display:grid; grid-template-columns:16px 115px minmax(0,1fr); gap:8px; padding:7px 0; border-bottom:1px solid var(--border); font-size:11px; align-items:baseline; }
.inspector-layer-evidence-row strong { font-weight:500; }
.inspector-layer-evidence-row > :last-child { overflow-wrap:anywhere; }
.inspector-layer-indicator { font:13px ui-monospace,monospace; color:var(--muted); }
.inspector-layer-evidence-row[data-state=pass] .inspector-layer-indicator { color:light-dark(#188038,#81c995); }
.inspector-layer-evidence-row[data-state=warn] .inspector-layer-indicator { color:light-dark(#a15c00,#fdd663); }
.inspector-layer-muted,.inspector-layer-dependency { color:var(--muted); font-size:11px; }
.inspector-layer-neighbors { margin:7px 12px 12px; }
.inspector-layer-neighbors > strong { font-weight:500; font-size:11px; }
.inspector-layer-neighbors > div { display:flex; align-items:baseline; gap:8px; padding-top:3px; }
.inspector-layer-neighbors > div > span:first-child { width:55px; flex:none; }
.inspector-ready .inspector-layer-link { border:0; padding:2px 0; background:transparent; color:var(--accent); font-size:11px; text-align:left; overflow-wrap:anywhere; }
.inspector-layer-rules { width:100%; border-collapse:collapse; table-layout:fixed; font-size:11px; }
.inspector-layer-rules th { text-align:left; background:var(--surface); color:var(--muted); font-weight:500; padding:5px 12px; border-bottom:1px solid var(--border); }
.inspector-layer-rules th:first-child { width:57%; }
.inspector-layer-rules td { padding:5px 12px; border-bottom:1px solid var(--border); vertical-align:top; overflow-wrap:anywhere; }
.inspector-layer-rules code { font:11px/1.6 ui-monospace,monospace; }
.inspector-layer-rule-name { color:light-dark(#881391,#c58af9); }
.inspector-layer-dependency { display:block; font-size:10px; }
.inspector-layer-rule-editor { display:flex; align-items:center; gap:5px; min-width:0; }
.inspector-layer-rule-editor input:not([type=color]):not([type=checkbox]),.inspector-layer-rule-editor select { width:100%; min-width:0; flex:1; padding:2px 4px; border:1px solid transparent; border-radius:2px; background:transparent; color:var(--ink); font:11px/1.6 ui-monospace,monospace; }
.inspector-layer-rule-editor input[type=checkbox] { flex:none; width:13px; height:13px; margin:0 2px 0 0; accent-color:var(--accent); cursor:pointer; }
.inspector-layer-rule-editor input[type=checkbox]:disabled { cursor:default; }
.inspector-layer-rule-editor input:hover,.inspector-layer-rule-editor select:hover { border-color:var(--border); }
.inspector-layer-rule-editor input:focus,.inspector-layer-rule-editor select:focus { border-color:var(--accent); outline:1px solid var(--accent); background:var(--paper); }
.inspector-layer-rule-editor input[type=color] { flex:none; width:16px; height:20px; padding:0; border:0; background:transparent; cursor:pointer; }
.inspector-layer-rule-editor input[type=color]::-webkit-color-swatch-wrapper { padding:3px 0; }
.inspector-layer-rule-editor input[type=color]::-webkit-color-swatch { border:1px solid #8888; border-radius:2px; }
.inspector-layer-rule-editor .inspector-layer-rule-reset { flex:none; padding:1px 4px; border:0; color:var(--accent); background:transparent; }
.inspector-layer-rule-reset:disabled { visibility:hidden; }
.inspector-layer-rules tr[data-modified=true] > td:first-child { box-shadow:inset 2px 0 var(--accent); }
.inspector-layer-rules tr[data-disabled=true] .inspector-layer-rule-name,.inspector-layer-rules tr[data-disabled=true] input:not([type=checkbox]):not([type=color]),.inspector-layer-rules tr[data-disabled=true] select { color:var(--muted); text-decoration:line-through; }
.inspector-layer-rules tr[data-disabled=true] input[type=color] { opacity:.45; cursor:default; }
.inspector-layer-rule-error { display:block; padding-top:4px; color:light-dark(#b3261e,#f28b82); font-size:10px; }
.inspector-layer-rule-error[hidden] { display:none; }
.inspector-layer-rules tr[data-selected=true] { background:var(--inspector-selected); }
.inspector-layer-content [data-diagnostic-target=true] { background:var(--inspector-selected); outline:1px solid var(--accent); outline-offset:-1px; }
.inspector-layer-swatch { display:inline-block; width:11px; height:11px; border:1px solid #8888; border-radius:2px; margin-right:5px; vertical-align:middle; }
.inspector-layer-json { margin:6px 0; font:11px/1.6 ui-monospace,SFMono-Regular,monospace; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--inspector-string); max-height:300px; overflow:auto; }
.inspector-layer-curve { display:flex; flex-wrap:wrap; gap:5px 10px; margin-top:6px; padding:6px; background:var(--surface); }
.inspector-layer-curve span { flex-basis:100%; color:var(--muted); }
.inspector-layer-section,.inspector-layer-origin { padding:9px 12px; border-bottom:1px solid var(--border); }
.inspector-layer-section h4 { margin:0 0 7px; font-size:11px; font-weight:500; }
.inspector-layer-origin > code { margin-left:10px; color:var(--accent); }
.inspector-layer-origin dl { display:grid; grid-template-columns:110px minmax(0,1fr); gap:6px 10px; font-size:11px; }
.inspector-layer-origin dt { color:var(--muted); }.inspector-layer-origin dd { margin:0; overflow-wrap:anywhere; }
.inspector-layer-data-summary { margin:8px 12px; font-size:11px; }
.inspector-layer-samples { max-height:180px; overflow:auto; border-bottom:1px solid var(--border); }
.inspector-layer-notice { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
.inspector-layer-dialog { width:min(820px,90vw); height:min(680px,85vh); padding:16px; border:1px solid var(--border); border-radius:6px; color:var(--ink); background:var(--paper); box-shadow:0 15px 70px #0005; }
.inspector-layer-dialog[open] { display:flex; flex-direction:column; gap:12px; }.inspector-layer-dialog::backdrop { background:#0005; }
.inspector-layer-dialog-head { display:flex; align-items:center; justify-content:space-between; }.inspector-layer-dialog-head strong { font-size:14px; font-weight:500; }
.inspector-layer-dialog label { display:flex; flex-direction:column; gap:5px; }.inspector-layer-dialog input { padding:7px; border:1px solid var(--border); background:var(--paper); color:var(--ink); }
.inspector-layer-dialog textarea { flex:1; min-height:100px; resize:none; background:var(--surface); color:var(--ink); padding:10px; border:1px solid var(--border); font:11px/1.6 ui-monospace,monospace; }
.inspector-layer-dialog .inspector-layer-copy { margin-left:auto; }
@container(max-width:700px) {
  .inspector-layer-heading { padding:6px 9px; }.inspector-layer-title { flex-basis:100%; }
  .inspector-layer-tools input[type=search] { order:1; flex:1 0 100%; }.inspector-layer-tools .inspector-layer-copy { margin-left:auto; }
  .inspector-layer-evidence-row { grid-template-columns:12px 92px minmax(0,1fr); gap:5px; }
}
`;
