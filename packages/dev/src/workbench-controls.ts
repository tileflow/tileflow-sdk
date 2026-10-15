import {workbenchIcon} from './workbench-ui';

export const controlsStyles = `
  .map-controls { flex:0 0 360px; width:360px; max-width:45vw; min-height:0; overflow:auto; border-left:1px solid var(--border); background:var(--paper); padding:0 18px 18px; }
  .map-controls[hidden] { display:none; }
  .controls-heading { display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:var(--paper); z-index:2; padding:15px 0 10px; }
  .controls-heading h2 { display:flex; align-items:center; gap:8px; font-size:16px; margin:0; }
  .controls-heading button { padding:6px; }
  .controls-subtitle { color:var(--muted); font-size:12px; line-height:1.5; margin:4px 0 14px; }
  .controls-section-title { font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin:20px 0 9px; }
  .control-module { border:1px solid var(--border); border-radius:8px; margin:7px 0; background:#fffdf7; overflow:hidden; }
  .control-module-header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; gap:8px; }
  .control-module-header label { display:flex; align-items:center; justify-content:space-between; flex:1; flex-direction:row; gap:10px; font-size:13px; font-weight:600; cursor:pointer; }
  .control-module-header input { appearance:none; width:30px; height:18px; min-height:0; padding:0; border:0; border-radius:12px; background:#d5cec1; cursor:pointer; position:relative; flex:none; }
  .control-module-header input::before { content:''; position:absolute; width:12px; height:12px; top:3px; left:3px; border-radius:50%; background:#fff; }
  .control-module-header input:checked { background:var(--accent); }
  .control-module-header input:checked::before { transform:translateX(12px); }
  .control-module-header input:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  .control-module summary { cursor:pointer; padding:0 12px 10px; font-size:11px; color:var(--muted); }
  .control-module fieldset { border:0; padding:0 12px 12px; margin:0; }
  .control-module fieldset:disabled { opacity:.45; }
  .control-field { display:flex; align-items:center; justify-content:space-between; flex-direction:row; gap:12px; font-size:12px; margin:9px 0; }
  .control-field select,.control-field input[type=number] { width:132px; min-width:0; padding:5px 7px; font:inherit; }
  .control-field input[type=checkbox] { accent-color:var(--accent); }
  .controls-runtime { border:0; border-bottom:1px solid var(--border); padding:0 0 12px; margin:0; min-width:0; }
  #controls-modules { border:0; padding:0; margin:0; min-width:0; }
  .controls-runtime:disabled,#controls-modules:disabled { opacity:.6; }
  .controls-footer { position:sticky; bottom:-18px; background:var(--paper); border-top:1px solid var(--border); margin-top:18px; padding:12px 0; z-index:2; }
  .controls-actions { display:flex; gap:6px; }
  .controls-actions button { flex:1; }
  #controls-status { font-size:12px; line-height:1.5; color:var(--muted); margin:8px 0; overflow-wrap:anywhere; }
  #controls-status[data-error=true] { color:#a32e36; }
  .controls-export { width:100%; margin-top:8px; }
  .controls-code { font:11px/1.5 monospace; white-space:pre-wrap; overflow-wrap:anywhere; max-height:220px; overflow:auto; }
  @media(max-width:760px) { .workspace:has(.map-controls:not([hidden])) { display:flex; flex-direction:column; } .map-controls { flex:0 1 55vh; width:auto; max-width:none; border-left:0; border-top:1px solid var(--border); } .workspace:has(.map-controls:not([hidden])) .stage { flex:1 0 35vh; } }
`;

export const controlsPanel = `
  <aside class="map-controls" id="map-controls" aria-labelledby="controls-title" tabindex="-1" hidden>
    <div class="controls-heading"><h2 id="controls-title">${workbenchIcon('settings')}Map controls</h2><button id="controls-close" aria-label="Close map controls">${workbenchIcon('close')}</button></div>
    <p class="controls-subtitle" id="controls-owner">Loading map…</p>
    <fieldset class="controls-runtime" id="controls-runtime">
      <div class="controls-section-title">Preview rendering</div>
      <label class="control-field">3D view<input id="controls-3d" type="checkbox"></label>
      <label class="control-field">Building animation<select id="controls-animation"><option value="0">Off</option><option value="300">Quick · 300 ms</option><option value="800">Smooth · 800 ms</option><option value="1500">Slow · 1.5 s</option></select></label>
    </fieldset>
    <div class="controls-section-title">Map modules</div>
    <fieldset id="controls-modules"></fieldset>
    <div class="controls-footer">
      <p id="controls-status" role="status">Loading controls…</p>
      <div class="controls-actions"><button id="controls-reset">Reset</button></div>
      <button id="controls-copy" class="controls-export">Copy module overrides</button>
      <details><summary>Configuration changes</summary><pre id="controls-code" class="controls-code"></pre></details>
      <p class="controls-subtitle">Changes apply automatically to this preview. Source files stay unchanged. Reset before capturing the source configuration.</p>
    </div>
  </aside>
`;

/** Shares the comparison shell's existing map bridge; never depends on a particular map. */
export const controlsClient = String.raw`
      const ctl = (id) => document.getElementById("controls-" + id);
      const controlsPanel = document.getElementById("map-controls");
      const controlsButton = document.getElementById("controls-toggle");
      let controlsKey = "", controlsSequence = 0, controlsModel, controlsDraft = {}, controlsBusy = false;
      let controlsApplyTimer, controlsRevision = 0, controlsPending = false, controlsResetPending = false;
      controlsButton.addEventListener("click", () => toggleMapControls(controlsPanel.hidden, true));
      ctl("close").addEventListener("click", () => toggleMapControls(false, true));
      ctl("reset").addEventListener("click", () => {
        if (!controlsModel) return;
        controlsDraft = {};
        ctl("3d").checked = false; ctl("animation").value = "0";
        renderMapControls();
        scheduleMapControls(true);
      });
      ctl("copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(controlsDraft, null, 2)); controlsNotice("Module overrides copied as JSON."); }
        catch { controlsNotice("Copy the JSON under Configuration changes.", true); }
      });
      for (const name of ["3d", "animation"]) ctl(name).addEventListener("change", () => scheduleMapControls());
      addEventListener("keydown", (event) => { if (event.key === "Escape" && !controlsPanel.hidden) toggleMapControls(false, true); });
      const controlsTimer = setInterval(() => { if (!controlsPanel.hidden) void loadMapControls(); }, 1000);
      addEventListener("beforeunload", () => { clearInterval(controlsTimer); cancelMapControlsApply(); });

      function cancelMapControlsApply() {
        clearTimeout(controlsApplyTimer); controlsApplyTimer = undefined;
        controlsPending = false; controlsResetPending = false; controlsRevision++;
      }
      function setMapControlsDisabled(disabled) {
        for (const name of ["modules", "runtime", "reset"]) ctl(name).disabled = disabled;
      }
      function scheduleMapControls(reset = false) {
        clearTimeout(controlsApplyTimer);
        controlsRevision++; controlsPending = true; controlsResetPending = reset;
        controlsNotice(reset ? "Restoring the original map…" : "Updating preview…");
        controlsApplyTimer = setTimeout(() => {
          controlsApplyTimer = undefined;
          void applyMapControls();
        }, reset ? 0 : 300);
      }

      function toggleMapControls(open, focus = false) {
        if (open) {
          setInspectionEnabled(false);
          document.getElementById("wb-welcome").hidden = true;
        }
        controlsPanel.hidden = !open;
        controlsButton.setAttribute("aria-expanded", String(open));
        for (const side of Object.values(states)) side.map?.resize?.();
        if (open) void loadMapControls();
        if (focus) (open ? controlsPanel : controlsButton).focus();
      }
      function hasMapControlOverrides(side) {
        return Boolean(new URL(side.frame.src, location.href).searchParams.get("controls"));
      }
      function controlsNotice(text, error = false) {
        ctl("status").textContent = text;
        ctl("status").dataset.error = String(error);
      }
      function controlsIdentity(side) {
        const meta = side.map?.getStyle?.()?.metadata;
        return meta ? {map:meta["tileflow:map"], theme:meta["tileflow:theme"]} : undefined;
      }
      async function loadMapControls() {
        const side = states[activeSideId], identity = controlsIdentity(side);
        if (!side.bridgeReady || !identity?.map || !identity.theme) {
          setMapControlsDisabled(true);
          return;
        }
        const key = JSON.stringify([side.id, side.definition.basePath, identity, side.artifactGeneration, side.loadEpoch]);
        const epoch = side.loadEpoch;
        if (key === controlsKey) return;
        cancelMapControlsApply();
        controlsKey = key;
        const sequence = ++controlsSequence;
        const keepExpanded = controlsModel?.side === side && controlsModel.map === identity.map && controlsModel.theme === identity.theme;
        const expanded = keepExpanded ? [...ctl("modules").querySelectorAll("details[open]")].map((item) => item.dataset.module) : [];
        controlsModel = undefined;
        ctl("modules").replaceChildren(); setMapControlsDisabled(true);
        controlsNotice("Reading this map’s modules…");
        try {
          const url = new URL(side.definition.basePath + "/__controls", location.href);
          url.search = new URLSearchParams(identity).toString();
          const response = await fetch(url, {cache:"no-store"});
          const model = await response.json();
          if (!response.ok) throw new Error(model.error || "Controls are unavailable for this preview.");
          if (sequence !== controlsSequence || activeSideId !== side.id || key !== controlsKey || epoch !== side.loadEpoch) return;
          controlsModel = {...model, side, key, epoch};
          const query = new URL(side.frame.src, location.href).searchParams;
          controlsDraft = JSON.parse(query.get("controls") || "{}");
          const liveQuery = new URL(side.frame.contentWindow.location.href).searchParams;
          ctl("3d").checked = liveQuery.get("buildings3d") === "on";
          ctl("animation").value = query.get("animation") || "0";
          ctl("owner").textContent = identity.map + " · " + identity.theme + " · " + (options.right ? side.id + " map" : "Local preview");
          renderMapControls(expanded); setMapControlsDisabled(false);
          controlsNotice(Object.keys(controlsDraft).length ? "Preview overrides applied." : "Using the map’s original settings.");
        } catch (error) {
          if (sequence === controlsSequence) { controlsKey = ""; controlsNotice(safeErrorMessage(error), true); }
        }
      }
      function controlValue(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); }
      function changeControl(module, path, value, original) {
        const patch = controlsDraft[module] ||= {};
        const parts = path.split("."); const leaf = parts.pop();
        let parent = patch;
        for (const part of parts) parent = parent[part] ||= {};
        if (value === original) delete parent[leaf]; else parent[leaf] = value;
        for (const [key, item] of Object.entries(patch)) if (item && typeof item === "object" && !Object.keys(item).length) delete patch[key];
        if (!Object.keys(patch).length) delete controlsDraft[module];
        ctl("code").textContent = JSON.stringify(controlsDraft, null, 2);
        scheduleMapControls();
      }
      function renderMapControls(expanded = [...ctl("modules").querySelectorAll("details[open]")].map((item) => item.dataset.module)) {
        ctl("modules").replaceChildren();
        const names = {poi:"Points of interest", land:"Land", water:"Water", nautical:"Nautical", roads:"Roads", buildings:"Buildings", boundaries:"Boundaries", labels:"Labels", aeroways:"Airports", transit:"Transit", vegetation:"Vegetation", addresses:"Addresses", landforms:"Landforms"};
        const modules = [...controlsModel.modules].sort((a,b) => {
          const priority = {vegetation:0, buildings:1};
          return (priority[a.id] ?? 2) - (priority[b.id] ?? 2);
        });
        for (const module of modules) {
          const card = document.createElement("section"); card.className = "control-module";
          const row = document.createElement("div"); row.className = "control-module-header";
          const label = document.createElement("label"); label.textContent = names[module.id] || module.id;
          const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = controlsDraft[module.id]?.enabled ?? module.enabled;
          toggle.setAttribute("aria-label", "Enable " + (names[module.id] || module.id));
          label.append(toggle); row.append(label); card.append(row);
          const fieldset = document.createElement("fieldset"); fieldset.disabled = !toggle.checked;
          toggle.addEventListener("change", () => { changeControl(module.id, "enabled", toggle.checked, module.enabled); fieldset.disabled = !toggle.checked; });
          if (module.fields.length) {
            const details = document.createElement("details");
            details.dataset.module = module.id; details.open = expanded.includes(module.id);
            const summary = document.createElement("summary"); summary.textContent = "Appearance & behavior";
            details.append(summary, fieldset); card.append(details);
            for (const field of module.fields) {
              const line = document.createElement("label"); line.className = "control-field";
              const title = document.createElement("span"); title.textContent = field.label;
              const input = document.createElement(field.choices ? "select" : "input");
              const override = controlValue(controlsDraft[module.id], field.path);
              const value = field.inherit && override === undefined ? "inherit" : override ?? field.value;
              if (field.choices) {
                const labels = {"3d":"Always 3D",auto:"Follow 2D / 3D view",flat:"Flat (2D)",none:"Hidden",style:"Map light",sun:"Scene sun",faceted:"Faceted",smooth:"Smooth",toon:"Toon"};
                const choices = field.choices.map((choice) => new Option(labels[choice] || choice, choice));
                if (field.inherit) choices.unshift(new Option("Auto · " + (labels[field.value] || field.value), "inherit"));
                input.replaceChildren(...choices); input.value = String(value);
              } else if (typeof field.value === "boolean") { input.type = "checkbox"; input.checked = value; }
              else { input.type = "number"; input.required = true; input.min = String(field.min); input.max = String(field.max); input.step = "any"; input.value = String(value); }
              input.addEventListener(input.type === "number" ? "input" : "change", () => {
                if (!input.checkValidity()) { cancelMapControlsApply(); controlsNotice("Enter a valid value to update the preview.", true); return; }
                const value = field.inherit && input.value === "inherit" ? undefined : input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
                changeControl(module.id, field.path, value, field.inherit ? undefined : field.value);
              });
              line.append(title, input); fieldset.append(line);
            }
          }
          ctl("modules").append(card);
        }
        ctl("code").textContent = JSON.stringify(controlsDraft, null, 2);
      }
      async function applyMapControls() {
        if (!controlsModel || controlsBusy || !controlsPending) return;
        const revision = controlsRevision, reset = controlsResetPending;
        const {side, map, theme, key} = controlsModel;
        const epoch = side.loadEpoch, source = side.frame.src;
        if (!side.bridgeReady || side.id !== activeSideId || side.loadEpoch !== controlsModel.epoch) return;
        if (!reset && [...ctl("modules").querySelectorAll("input")].some((input) => !input.checkValidity())) {
          controlsPending = false;
          controlsNotice("Enter valid field values to update the preview.", true); return;
        }
        const draft = reset ? {} : structuredClone(controlsDraft);
        const url = new URL(side.frame.src, location.href);
        if (Object.keys(draft).length) url.searchParams.set("controls", JSON.stringify(draft)); else url.searchParams.delete("controls");
        url.searchParams.set("buildings3d", !reset && ctl("3d").checked ? "on" : "off");
        url.searchParams.delete("trees3d");
        if (!reset && ctl("animation").value !== "0") url.searchParams.set("animation", ctl("animation").value); else url.searchParams.delete("animation");
        controlsBusy = true; controlsPending = false;
        controlsNotice("Compiling preview…");
        try {
          const style = new URL(side.definition.basePath + "/styles/" + map + "/" + theme + ".json", location.href);
          if (Object.keys(draft).length) style.searchParams.set("controls", JSON.stringify(draft));
          const response = await fetch(style, {cache:"no-store"});
          if (!response.ok) { const failure = await response.json(); throw new Error(failure.error || "Unable to compile these settings."); }
          if (revision !== controlsRevision || controlsKey !== key || side.id !== activeSideId || !side.bridgeReady || epoch !== side.loadEpoch || source !== side.frame.src) return;
          const camera = side.camera || canonicalCamera;
          if (camera) {
            const values = {lng:camera.center[0], lat:camera.center[1], zoom:camera.zoom, bearing:camera.bearing, pitch:camera.pitch};
            for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
          }
          controlsDraft = draft;
          setMapControlsDisabled(true);
          side.bridgeReady = false;
          side.frame.src = url.href;
          controlsKey = "";
          controlsNotice(reset ? "Restoring the original map…" : "Loading the compiled preview…");
        } catch (error) {
          if (revision === controlsRevision && controlsKey === key) controlsNotice(safeErrorMessage(error) + " The previous map is still shown.", true);
        } finally {
          controlsBusy = false;
          if (controlsPending && controlsApplyTimer === undefined) void applyMapControls();
        }
      }
`;
