export const diagnosticsStyles = `
.inspector-diagnostics{background:var(--paper);color:var(--ink);font:12px/1.45 var(--ui)}
.inspector-diagnostics-toolbar{justify-content:space-between;gap:8px;padding:7px 10px}
.inspector-diagnostics-actions,.inspector-diagnostics-filters{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.inspector-diagnostics-toolbar strong{font-size:12px;font-weight:600}
.inspector-diagnostics-toolbar .inspector-diagnostics-check{border:1px solid var(--border);background:var(--surface)}
.inspector-diagnostics-filters{padding:6px 10px;border-bottom:1px solid var(--border);flex:none}
.inspector-diagnostics-filters button{border:1px solid transparent;background:transparent;padding:3px 8px;border-radius:4px;font-size:11px}
.inspector-diagnostics-filters button[aria-pressed=true]{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 25%,transparent)}
.inspector-diagnostics-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--border);color:var(--muted);font-size:11px;flex:none}
.inspector-diagnostics-summary .inspector-diagnostics-scope{margin-left:auto;color:var(--faint)}
.inspector-diagnostics-summary button{margin-left:auto;background:transparent;border:0;font-size:11px;color:var(--muted);padding:0}
.inspector-diagnostics-list{flex:1;min-height:0;overflow:auto}
.inspector-diagnostic{border-bottom:1px solid var(--border)}
.inspector-diagnostic>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:17px minmax(0,1fr) auto;align-items:start;column-gap:8px;padding:10px 12px}
.inspector-diagnostic>summary::-webkit-details-marker{display:none}
.inspector-diagnostic>summary:hover{background:var(--hover)}
.inspector-diagnostic>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.inspector-diagnostic-indicator{font-size:13px;line-height:18px;color:var(--warn)}
.inspector-diagnostic[data-kind=problem] .inspector-diagnostic-indicator{color:var(--danger)}
.inspector-diagnostic-title{font-weight:500;font-size:12px;display:block;line-height:18px}
.inspector-diagnostic-subtitle{display:block;color:var(--muted);font-size:11px;margin-top:2px;overflow-wrap:anywhere}
.inspector-diagnostic-category{font-size:10px;line-height:18px;color:var(--muted);white-space:nowrap;text-align:right}
.inspector-diagnostic-context{display:block;color:var(--faint);font-size:10px;margin-top:3px}
.inspector-diagnostic[data-stale=true] .inspector-diagnostic-context{color:var(--warn)}
.inspector-diagnostic-detail{padding:0 12px 12px 37px;max-width:1040px;display:flex;flex-direction:column;gap:10px}
.inspector-diagnostic-detail p{margin:0;color:var(--muted);font-size:12px;max-width:820px}
.inspector-diagnostic-detail .inspector-diagnostic-state{border-left:2px solid var(--warn);padding:4px 9px;background:var(--warn-soft);font-size:11px}
.inspector-diagnostic-evidence{display:grid;grid-template-columns:minmax(100px,max-content) minmax(0,1fr);column-gap:18px;row-gap:5px;margin:0;padding:9px 11px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-size:11px}
.inspector-diagnostic-evidence dt{color:var(--muted)}
.inspector-diagnostic-evidence dd{margin:0;overflow-wrap:anywhere;font-family:var(--mono)}
.inspector-diagnostic-links,.inspector-diagnostic-layers{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.inspector-diagnostic-links button{font-size:11px;min-height:25px;padding:3px 8px}
.inspector-diagnostic-links .inspector-diagnostic-dismiss{margin-left:auto;background:transparent;border-color:transparent;color:var(--muted)}
.inspector-diagnostic-layers button{font:10px/1.4 var(--mono);padding:3px 6px;background:var(--surface);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.inspector-diagnostic-layers span{font-size:11px;color:var(--muted)}
.inspector-diagnostic-samples{display:flex;flex-direction:column;gap:5px}
.inspector-diagnostic-samples button{text-align:left;background:transparent;border:1px solid var(--border);font-size:11px;padding:5px 8px;overflow-wrap:anywhere}
.inspector-diagnostic-samples button::before{content:'↗';color:var(--muted);padding-right:6px}
.inspector-diagnostic-limitations{margin:0;padding-left:16px;color:var(--muted);font-size:11px}
.inspector-diagnostic-limitations li+li{margin-top:4px}
.inspector-diagnostics-empty{padding:28px 20px;max-width:620px;display:flex;flex-direction:column;gap:7px;color:var(--muted)}
.inspector-diagnostics-empty strong{font-size:13px;font-weight:500;color:var(--ink)}
.inspector-diagnostics-empty p{margin:0;font-size:12px}
.inspector-diagnostics-status{min-height:25px;align-items:center;font-size:11px}
.inspector-diagnostics-status:empty{display:none}
@container(max-width:520px){.inspector-diagnostic>summary{grid-template-columns:15px minmax(0,1fr);padding:9px}.inspector-diagnostic-category{grid-column:2;text-align:left;font-size:10px}.inspector-diagnostic-detail{padding-left:32px}.inspector-diagnostic-evidence{grid-template-columns:minmax(0,1fr)}.inspector-diagnostic-evidence dd+dt{margin-top:5px}.inspector-diagnostics-filters{gap:2px}.inspector-diagnostics-filters button{padding:3px 5px}}
`;
