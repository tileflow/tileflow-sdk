export const controlsStyles = `
  .map-controls { flex:0 0 360px; width:360px; max-width:45vw; min-height:0; overflow:auto; border-left:1px solid var(--border); background:var(--paper); padding:0 18px 18px; }
  .map-controls[hidden] { display:none; }
  .controls-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--border); }
  .controls-heading h2 { margin:0; font:inherit; }
  .controls-segments { display:flex; min-width:0; width:max-content; max-width:100%; border:1px solid var(--border); border-radius:4px; overflow:hidden; }
  .controls-segments button { flex:1; min-width:0; padding:4px 10px; border:0; border-radius:0; background:var(--paper); color:var(--muted); cursor:pointer; }
  .controls-segments button + button { border-left:1px solid var(--border); }
  .controls-segments button[aria-checked=true] { color:var(--accent); background:var(--dt-selected,var(--surface)); box-shadow:inset 0 -2px var(--accent); }
  .controls-segments button:disabled { opacity:.4; cursor:not-allowed; }
  .controls-selection { border-bottom:1px solid var(--border); padding-bottom:8px; }
  .controls-selection .control-field select { width:190px; max-width:70%; }
  .controls-selection [hidden] { display:none; }
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
  #controls-status { font-size:12px; line-height:1.5; color:var(--muted); margin:8px 0; overflow-wrap:anywhere; }
  #controls-status[data-error=true] { color:#a32e36; }
  @media(max-width:760px) { .workspace:has(.map-controls:not([hidden])) { display:flex; flex-direction:column; } .map-controls { flex:0 1 55vh; width:auto; max-width:none; border-left:0; border-top:1px solid var(--border); } .workspace:has(.map-controls:not([hidden])) .stage { flex:1 0 35vh; } }
`;

export const controlsPanel = `
  <aside class="map-controls" id="map-controls" aria-label="Scene settings" tabindex="-1" hidden>
    <div class="controls-heading"><h2>Styles</h2><button id="controls-reset">Reset</button></div>
    <div class="controls-grid">
    <div class="controls-selection workbench-only" id="controls-selection" hidden>
      <div class="controls-section-title">Appearance</div>
      <div class="control-field" id="wb-time-of-day-field" hidden><span>Time of day</span><div class="controls-segments" id="wb-time-of-day" role="radiogroup" aria-label="Time of day"></div></div>
      <div class="control-field dt-palette-field" id="wb-theme-field"><span>Theme</span><select id="wb-theme" aria-label="Palette" disabled hidden><option value="">Waiting for map…</option></select><div id="wb-palettes" class="dt-palettes" role="radiogroup" aria-label="Theme palette"></div></div>
    </div>
    <fieldset class="controls-runtime" id="controls-runtime">
      <div class="controls-section-title">Preview rendering</div>
      <label class="control-field">3D view<input id="controls-3d" type="checkbox" role="switch"></label>
      <label class="control-field">Building animation<select id="controls-animation" hidden><option value="0">Off</option><option value="800">Grow</option><option value="fade">Fade</option></select><span class="controls-segments" id="controls-animation-segments" role="radiogroup" aria-label="Building animation"></span></label>
    </fieldset>
    </div>
    <div class="controls-section-title">Map modules</div>
    <fieldset id="controls-modules"></fieldset>
    <p id="controls-status" role="status" hidden></p>
  </aside>
`;

/** Shares the comparison shell's existing map bridge; never depends on a particular map. */
export const controlsClient = String.raw`
      const ctl = (id) => document.getElementById("controls-" + id);
      const controlsPanel = document.getElementById("map-controls");
      const controlsButton = document.getElementById("controls-toggle");
      let controlsKey = "", controlsSequence = 0, controlsModel, controlsDraft = {}, controlsBusy = false;
      let controlsApplyTimer, controlsRevision = 0, controlsPending = false, controlsResetPending = false;
      let controlsLoadingKey = "", controlsBindings = [], controlsLastError = "";
      let controlsHistoryCurrent, controlsInitial, controlsHistoryQuiet = 0;
      const controlsUndo = [], controlsRedo = [];
      ctl("selection").hidden = !options.workbenchUrl;
      controlsButton.addEventListener("click", () => toggleMapControls(controlsPanel.hidden, true));
      ctl("reset").addEventListener("click", () => {
        if (!controlsModel) return;
        controlsDraft = {};
        ctl("3d").checked = false; ctl("animation").value = "0";
        renderMapControls();
        scheduleMapControls(true);
      });
      for (const name of ["3d", "animation"]) ctl(name).addEventListener("change", () => { syncAnimationSegments(); scheduleMapControls(); });
      for (const [value,label] of [["0","Off"],["800","Grow"],["fade","Fade"]]) {
        const button=document.createElement("button"); button.type="button";button.value=value;button.textContent=label;button.setAttribute("role","radio");
        button.addEventListener("click",()=>{ctl("animation").value=value;ctl("animation").dispatchEvent(new Event("change"));});ctl("animation-segments").append(button);
      }
      function syncAnimationSegments(){for(const button of ctl("animation-segments").children)button.setAttribute("aria-checked",String(button.value===ctl("animation").value));}
      syncAnimationSegments();
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
        if (globalThis.__tileflowDevtoolsUI) { globalThis.__tileflowDevtoolsUI.controls(open); return; }
        if (open) {
          setInspectionEnabled(false);
        }
        controlsPanel.hidden = !open;
        controlsButton.setAttribute("aria-expanded", String(open));
        for (const side of Object.values(states)) side.map?.resize?.();
        if (open) void loadMapControls();
        if (focus) (open ? controlsPanel : controlsButton).focus();
      }
      function controlsNotice(text, error = false) {
        ctl("status").hidden = !error;
        ctl("status").textContent = error ? text : "";
        ctl("status").dataset.error = String(error);
      }
      function controlsIdentity(side) {
        const meta = side.map?.getStyle?.()?.metadata;
        return meta ? {map:meta["tileflow:map"], theme:meta["tileflow:theme"]} : undefined;
      }
      function livePreviewUrl(side) {
        return new URL(side.frame.contentWindow.location.href, location.href);
      }
      async function loadMapControls() {
        const side = states[activeSideId], identity = controlsIdentity(side);
        if (!side.bridgeConnected || !identity?.map || !identity.theme) {
          setMapControlsDisabled(!side.bridgeConnected || !controlsModel);
          controlsNotice("Waiting for the map to finish loading…");
          return;
        }
        identity.theme = side.workbenchTheme || identity.theme;
        const key = JSON.stringify([side.id, side.definition.basePath, identity.map, side.loadEpoch]);
        const epoch = side.loadEpoch;
        const loadingKey = key + identity.theme;
        if (key === controlsKey && controlsModel?.theme === identity.theme) {
          setMapControlsDisabled(false);
          return;
        }
        if (loadingKey === controlsLoadingKey) return;
        const preserve = key === controlsKey && controlsModel;
        if (!preserve) {
          const pendingAppearance = side.pendingAppearance;
          cancelMapControlsApply();
          controlsPending = Boolean(pendingAppearance);
          controlsKey = key;
          controlsModel = undefined;
          ctl("modules").replaceChildren(); setMapControlsDisabled(true);
        }
        controlsLoadingKey = loadingKey;
        const sequence = ++controlsSequence;
        controlsNotice("Reading this map’s modules…");
        try {
          const url = new URL(side.definition.basePath + "/__controls", location.href);
          url.search = new URLSearchParams(identity).toString();
          const response = await fetch(url, {cache:"no-store"});
          const model = await response.json();
          if (!response.ok) throw new Error(model.error || "Controls are unavailable for this preview.");
          if (sequence !== controlsSequence || activeSideId !== side.id || key !== controlsKey || epoch !== side.loadEpoch || identity.theme !== (side.workbenchTheme || controlsIdentity(side)?.theme)) return;
          if (preserve) {
            // Keep the actual inputs and their handlers mounted, including focus/selection.
            for (const module of controlsModel.modules) {
              const updated = model.modules.find((item) => item.id === module.id);
              if (!updated) continue;
              module.enabled = updated.enabled;
              for (const field of module.fields) Object.assign(field, updated.fields.find((item) => item.path === field.path));
            }
            controlsModel.theme = model.theme;
            for (const sync of controlsBindings) sync();
          } else {
            controlsModel = {...model, side, key, epoch};
            const query = livePreviewUrl(side).searchParams;
            controlsDraft = JSON.parse(query.get("controls") || "{}");
            side.appliedSceneStyle ||= JSON.stringify([identity.map, controlsIdentity(side).theme, controlsDraft]);
            ctl("3d").checked = query.get("buildings3d") === "on";
            ctl("animation").value = query.get("animation") === "fade" ? "fade" : Number(query.get("animation")) > 0 ? "800" : "0"; syncAnimationSegments();
            renderMapControls();
            controlsUndo.length = controlsRedo.length = 0;
            controlsHistoryCurrent = globalThis.__tileflowScene.snapshot();
            controlsInitial = structuredClone(controlsHistoryCurrent);
          }
          setMapControlsDisabled(false);
          controlsNotice(Object.keys(controlsDraft).length ? "Preview overrides applied." : "Using the map’s original settings.");
        } catch (error) {
          if (sequence === controlsSequence) { if (!preserve) controlsKey = ""; controlsNotice(safeErrorMessage(error), true); }
        } finally {
          if (sequence === controlsSequence) {
            controlsLoadingKey = "";
            if (controlsPending && controlsApplyTimer === undefined) void applyMapControls();
          }
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
        scheduleMapControls();
      }
      function renderMapControls(expanded = [...ctl("modules").querySelectorAll("details[open]")].map((item) => item.dataset.module)) {
        ctl("modules").replaceChildren();
        controlsBindings = [];
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
          toggle.setAttribute("role", "switch");
          toggle.setAttribute("aria-label", "Enable " + (names[module.id] || module.id));
          label.append(toggle); row.append(label); card.append(row);
          const fieldset = document.createElement("fieldset"); fieldset.disabled = !toggle.checked;
          let details;
          const syncModuleEnabled = () => {
            const wasEnabled = !fieldset.disabled;
            fieldset.disabled = !toggle.checked;
            if (details && wasEnabled !== toggle.checked) details.open = toggle.checked;
          };
          controlsBindings.push(() => {
            if (document.activeElement !== toggle) toggle.checked = controlsDraft[module.id]?.enabled ?? module.enabled;
            syncModuleEnabled();
          });
          toggle.addEventListener("change", () => { changeControl(module.id, "enabled", toggle.checked, module.enabled); syncModuleEnabled(); });
          if (module.fields.length) {
            details = document.createElement("details");
            details.dataset.module = module.id; details.open = toggle.checked || expanded.includes(module.id);
            const summary = document.createElement("summary"); summary.textContent = "Appearance & behavior";
            details.append(summary, fieldset); card.append(details);
            for (const field of module.fields) {
              const line = document.createElement("label"); line.className = "control-field";
              const title = document.createElement("span"); title.textContent = field.label;
              const input = document.createElement(field.choices ? "select" : "input");
              const override = controlValue(controlsDraft[module.id], field.path);
              const value = field.inherit && override === undefined ? "inherit" : override ?? field.value;
              const labels = {"3d":"Always 3D",auto:"Follow 2D / 3D view",flat:"Flat (2D)",none:"Hidden",style:"Map light",sun:"Scene sun",faceted:"Faceted",smooth:"Smooth",toon:"Toon"};
              if (field.choices) {
                const choices = field.choices.map((choice) => new Option(labels[choice] || choice, choice));
                if (field.inherit) choices.unshift(new Option("Auto · " + (labels[field.value] || field.value), "inherit"));
                input.replaceChildren(...choices); input.value = String(value);
              } else if (typeof field.value === "boolean") { input.type = "checkbox"; input.setAttribute("role", "switch"); input.checked = value; }
              else { input.type = "number"; input.required = true; input.min = String(field.min); input.max = String(field.max); input.step = "any"; input.value = String(value); }
              controlsBindings.push(() => {
                if (document.activeElement === input || !input.checkValidity()) return;
                const override = controlValue(controlsDraft[module.id], field.path);
                const value = field.inherit && override === undefined ? "inherit" : override ?? field.value;
                if (input.type === "checkbox") input.checked = value;
                else input.value = String(value);
                if (field.inherit) input.options[0].textContent = "Auto · " + (labels[field.value] || field.value);
              });
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
      }
      async function applyMapControls() {
        if (!controlsModel || controlsBusy || !controlsPending) return;
        const revision = controlsRevision, reset = controlsResetPending;
        const {side, map, key} = controlsModel;
        const theme = side.workbenchTheme || controlsModel.theme;
        const epoch = side.loadEpoch, source = side.frame.src;
        if (!side.bridgeConnected || side.id !== activeSideId || side.loadEpoch !== controlsModel.epoch) return;
        if (!reset && [...ctl("modules").querySelectorAll("input")].some((input) => !input.checkValidity())) {
          controlsPending = false;
          controlsNotice("Enter valid field values to update the preview.", true); return;
        }
        const draft = reset ? {} : structuredClone(controlsDraft);
        const next = {map, theme, controls:draft, buildings3d:!reset && ctl("3d").checked, animation:reset ? 0 : ctl("animation").value === "fade" ? "fade" : Number(ctl("animation").value)};
        const styleKey = JSON.stringify([map, theme, draft]);
        const isCurrent = () => revision === controlsRevision && controlsKey === key && side.id === activeSideId && side.bridgeConnected && epoch === side.loadEpoch && source === side.frame.src;
        const before = controlsHistoryCurrent && {...controlsHistoryCurrent, style:side.map.getStyle()};
        controlsBusy = true; controlsPending = false; controlsLastError = "";
        controlsNotice("Compiling preview…");
        try {
          if (styleKey !== side.appliedSceneStyle) {
            const style = new URL(side.definition.basePath + "/styles/" + map + "/" + theme + ".json", location.href);
            if (Object.keys(draft).length) style.searchParams.set("controls", JSON.stringify(draft));
            const response = await fetch(style, {cache:"no-store"});
            const document = await response.json();
            if (!response.ok) throw new Error(document.error || "Unable to compile these settings.");
            next.style = document;
          }
          if (!isCurrent()) return;
          const apply = side.frame.contentWindow.__tileflowApplyScene;
          if (!apply) throw new Error("Reload DevTools once to enable live scene updates.");
          if (!await apply(JSON.stringify(next), isCurrent)) return;
          side.appliedSceneStyle = styleKey;
          const after = globalThis.__tileflowScene.snapshot();
          if (!controlsHistoryQuiet && before && JSON.stringify([before.theme,before.controls,before.buildings3d,before.animation]) !== JSON.stringify([after.theme,after.controls,after.buildings3d,after.animation])) {
            controlsUndo.push({before,after,time:performance.now()}); if(controlsUndo.length>100)controlsUndo.shift(); controlsRedo.length=0;
          }
          controlsHistoryCurrent=after;
          side.pendingAppearance = undefined;
          side.definition.previewUrl = livePreviewUrl(side).href;
          side.sidecarAbort?.abort(); side.sidecar = undefined; side.sidecarPromise = undefined;
          if (selectedInspection?.side === side) void loadSidecar(side);
          if (isCurrent()) controlsNotice("");
        } catch (error) {
          if (revision === controlsRevision && controlsKey === key) { controlsLastError = safeErrorMessage(error); controlsNotice(controlsLastError + " The previous map is still shown.", true); }
        } finally {
          controlsBusy = false;
          if (controlsPending && controlsApplyTimer === undefined) void applyMapControls();
        }
      }
      globalThis.__tileflowScene = {
        get history() {return {undo:controlsUndo.at(-1)?.time || 0,redo:controlsRedo.at(-1)?.redoTime || 0,changed:controlsUndo.length>0||controlsRedo.length>0};},
        async undo() {const entry=controlsUndo.at(-1);if(!entry)return;await this.restore(entry.before);controlsUndo.pop();entry.redoTime=performance.now();controlsRedo.push(entry);},
        async redo() {const entry=controlsRedo.at(-1);if(!entry)return;await this.restore(entry.after);controlsRedo.pop();entry.time=performance.now();controlsUndo.push(entry);},
        async reset() {if(controlsInitial)await this.restore(controlsInitial);controlsUndo.length=controlsRedo.length=0;},
        audit(active) {controlsHistoryQuiet=Math.max(0,controlsHistoryQuiet+(active?1:-1));},
        variants() {
          const side = states[activeSideId], owner = wbCatalog?.sides[side.serviceId || side.id];
          const variants = owner?.timeOfDay?.[side.workbenchMap] || {};
          return (owner?.selections || []).filter(entry => entry.map === side.workbenchMap && !entry.scene).map(entry => {
            const family = Object.keys(variants).find(name => Object.values(variants[name]).includes(entry.theme));
            return {theme:entry.theme, palette:family || entry.theme, timeOfDay:family ? Object.keys(variants[family]).find(moment => variants[family][moment] === entry.theme) : undefined};
          });
        },
        snapshot() {
          const side = states[activeSideId];
          return {side:side.id, theme:side.workbenchTheme || controlsIdentity(side)?.theme, controls:structuredClone(controlsDraft), buildings3d:ctl("3d").checked, animation:ctl("animation").value, style:side.map?.getStyle()};
        },
        async style(theme, signal) {
          const side = states[activeSideId], identity = controlsIdentity(side);
          const url = new URL(side.definition.basePath + "/styles/" + identity.map + "/" + theme + ".json", location.href);
          if (Object.keys(controlsDraft).length) url.searchParams.set("controls", JSON.stringify(controlsDraft));
          const response = await fetch(url, {signal});
          if (!response.ok) throw new Error("Could not read theme " + theme);
          return response.json();
        },
        async apply(theme, signal) {
          if (signal?.aborted) throw new Error("Audit cancelled.");
          const side = states[activeSideId], owner = wbCatalog?.sides[side.serviceId || side.id];
          const entry = owner?.selections.find(item => item.map === side.workbenchMap && item.theme === theme && !item.scene);
          if (!entry) throw new Error("Theme is not available: " + theme);
          applyWorkbenchAppearance(side, entry);
          const started = performance.now();
          do {
            if (signal?.aborted) throw new Error("Audit cancelled.");
            if (states[activeSideId] !== side) throw new Error("The active map changed.");
            if (performance.now() - started > 30000) throw new Error("Theme update timed out.");
            await new Promise(resolve => setTimeout(resolve,40));
          } while (controlsBusy || controlsPending || controlsLoadingKey || controlsApplyTimer !== undefined);
          if (controlsLastError) throw new Error(controlsLastError);
          if (controlsIdentity(side)?.theme !== theme) throw new Error("Theme could not be applied.");
        },
        async restore(saved) {
          if (states[activeSideId].id !== saved.side) return;
          controlsHistoryQuiet++;
          try {
          controlsDraft = structuredClone(saved.controls);
          ctl("3d").checked = saved.buildings3d; ctl("animation").value = saved.animation;
          scheduleMapControls();
          await this.apply(saved.theme);
          const side = states[activeSideId];
          if (saved.style) await side.frame.contentWindow.__tileflowApplyScene(JSON.stringify({map:controlsIdentity(side).map,theme:saved.theme,controls:saved.controls,buildings3d:saved.buildings3d,animation:saved.animation === "fade" ? "fade" : Number(saved.animation),style:saved.style}), () => states[activeSideId] === side);
          renderMapControls();syncAnimationSegments();controlsHistoryCurrent=this.snapshot();
          } finally {controlsHistoryQuiet--;}
        }
      };
`;
