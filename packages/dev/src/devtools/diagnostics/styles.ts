export const diagnosticsStyles = `
.dt-diagnostics{background:var(--paper);color:var(--ink);font:12px/1.45 var(--ui)}
.dt-diagnostics-toolbar{justify-content:space-between;gap:8px;padding:7px 10px}
.dt-diagnostics-actions,.dt-diagnostics-filters{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.dt-diagnostics-toolbar strong{font-size:12px;font-weight:600}
.dt-diagnostics-toolbar .dt-diagnostics-check{border:1px solid var(--border);background:var(--surface)}
.dt-diagnostics-filters{padding:6px 10px;border-bottom:1px solid var(--border);flex:none}
.dt-diagnostics-filters button{border:1px solid transparent;background:transparent;padding:3px 8px;border-radius:4px;font-size:11px}
.dt-diagnostics-filters button[aria-pressed=true]{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 25%,transparent)}
.dt-diagnostics-summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-bottom:1px solid var(--border);color:var(--muted);font-size:11px;flex:none}
.dt-diagnostics-summary .dt-diagnostics-scope{margin-left:auto;color:var(--faint)}
.dt-diagnostics-summary button{margin-left:auto;background:transparent;border:0;font-size:11px;color:var(--muted);padding:0}
.dt-diagnostics-list{flex:1;min-height:0;overflow:auto}
.dt-diagnostic{border-bottom:1px solid var(--border)}
.dt-diagnostic>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:17px minmax(0,1fr) auto;align-items:start;column-gap:8px;padding:10px 12px}
.dt-diagnostic>summary::-webkit-details-marker{display:none}
.dt-diagnostic>summary:hover{background:var(--hover)}
.dt-diagnostic>summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.dt-diagnostic-indicator{font-size:13px;line-height:18px;color:var(--warn)}
.dt-diagnostic[data-kind=problem] .dt-diagnostic-indicator{color:var(--danger)}
.dt-diagnostic-title{font-weight:500;font-size:12px;display:block;line-height:18px}
.dt-diagnostic-subtitle{display:block;color:var(--muted);font-size:11px;margin-top:2px;overflow-wrap:anywhere}
.dt-diagnostic-category{font-size:10px;line-height:18px;color:var(--muted);white-space:nowrap;text-align:right}
.dt-diagnostic-context{display:block;color:var(--faint);font-size:10px;margin-top:3px}
.dt-diagnostic[data-stale=true] .dt-diagnostic-context{color:var(--warn)}
.dt-diagnostic-detail{padding:0 12px 12px 37px;max-width:1040px;display:flex;flex-direction:column;gap:10px}
.dt-diagnostic-detail p{margin:0;color:var(--muted);font-size:12px;max-width:820px}
.dt-diagnostic-detail .dt-diagnostic-state{border-left:2px solid var(--warn);padding:4px 9px;background:var(--warn-soft);font-size:11px}
.dt-diagnostic-evidence{display:grid;grid-template-columns:minmax(100px,max-content) minmax(0,1fr);column-gap:18px;row-gap:5px;margin:0;padding:9px 11px;border:1px solid var(--border);border-radius:4px;background:var(--surface);font-size:11px}
.dt-diagnostic-evidence dt{color:var(--muted)}
.dt-diagnostic-evidence dd{margin:0;overflow-wrap:anywhere;font-family:var(--mono)}
.dt-diagnostic-links,.dt-diagnostic-layers{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
.dt-diagnostic-links button{font-size:11px;min-height:25px;padding:3px 8px}
.dt-diagnostic-links .dt-diagnostic-dismiss{margin-left:auto;background:transparent;border-color:transparent;color:var(--muted)}
.dt-diagnostic-layers button{font:10px/1.4 var(--mono);padding:3px 6px;background:var(--surface);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dt-diagnostic-layers span{font-size:11px;color:var(--muted)}
.dt-diagnostic-samples{display:flex;flex-direction:column;gap:5px}
.dt-diagnostic-samples button{text-align:left;background:transparent;border:1px solid var(--border);font-size:11px;padding:5px 8px;overflow-wrap:anywhere}
.dt-diagnostic-samples button::before{content:'↗';color:var(--muted);padding-right:6px}
.dt-diagnostic-limitations{margin:0;padding-left:16px;color:var(--muted);font-size:11px}
.dt-diagnostic-limitations li+li{margin-top:4px}
.dt-diagnostics-empty{padding:28px 20px;max-width:620px;display:flex;flex-direction:column;gap:7px;color:var(--muted)}
.dt-diagnostics-empty strong{font-size:13px;font-weight:500;color:var(--ink)}
.dt-diagnostics-empty p{margin:0;font-size:12px}
.dt-diagnostics-status{min-height:25px;align-items:center;font-size:11px}
.dt-diagnostics-status:empty{display:none}
@container(max-width:520px){.dt-diagnostic>summary{grid-template-columns:15px minmax(0,1fr);padding:9px}.dt-diagnostic-category{grid-column:2;text-align:left;font-size:10px}.dt-diagnostic-detail{padding-left:32px}.dt-diagnostic-evidence{grid-template-columns:minmax(0,1fr)}.dt-diagnostic-evidence dd+dt{margin-top:5px}.dt-diagnostics-filters{gap:2px}.dt-diagnostics-filters button{padding:3px 5px}}
`;
