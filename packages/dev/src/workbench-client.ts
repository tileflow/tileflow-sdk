/** Runs in the comparison document's scope and uses its existing map bridge. */
export const workbenchClient = String.raw`
      let wbCatalog;
      let wbLastContext = "";
      let wbInterval;
      let wbRefreshing = false;
      let wbError = "";
      let wbLastPublished = 0;
      let wbPickerKey = "";
      let wbTimeOfDay = "";
      const wbPaletteColors = new Map();
      const wbClient = "view-" + Math.random().toString(36).slice(2);
      const wb = (id) => document.getElementById("wb-" + id);
      if (options.workbenchUrl) initializeWorkbench();

      function initializeWorkbench() {
        wb("theme").addEventListener("change", () => selectWorkbenchAppearance());
        for (const [moment, label] of Object.entries({day:"Day", dawn:"Dawn", dusk:"Dusk", night:"Night"})) {
          const segment = document.createElement("button");
          segment.type = "button"; segment.value = moment; segment.textContent = label;
          segment.setAttribute("role", "radio"); segment.setAttribute("aria-checked", "false");
          segment.tabIndex = -1; segment.disabled = true;
          segment.addEventListener("click", () => selectWorkbenchAppearance(moment));
          segment.addEventListener("keydown", (event) => {
            const direction = {ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1}[event.key];
            if (!direction && event.key !== "Home" && event.key !== "End") return;
            event.preventDefault();
            const enabled = [...wb("time-of-day").querySelectorAll("button")].filter((item) => !item.disabled);
            if (!enabled.length) return;
            const index = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (enabled.indexOf(segment) + direction + enabled.length) % enabled.length;
            const next = enabled[index];
            selectWorkbenchAppearance(next.value); next.focus();
          });
          wb("time-of-day").append(segment);
        }
        void refreshWorkbench();
        wbInterval = setInterval(refreshWorkbench, 2500);
        addEventListener("beforeunload", () => clearInterval(wbInterval));
        addEventListener("keydown", (event) => {
          if (event.target.closest?.("input,select,textarea,[contenteditable]")) return;
          if (event.key === "i" && !event.metaKey && !event.ctrlKey) setInspectionEnabled(!inspectionEnabled, true);
        });
      }

      async function workbenchRequest(path, body) {
        const response = await fetch(options.workbenchUrl + path, body === undefined
          ? {cache:"no-store"}
          : {method:"POST", headers:{"Content-Type":"application/json", "X-Tileflow-Workbench":"1"}, body:JSON.stringify(body)});
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Map DevTools request failed.");
        return result;
      }

      async function refreshWorkbench() {
        if (wbRefreshing) return;
        wbRefreshing = true;
        try {
          wbCatalog = await workbenchRequest("");
          const side = states[activeSideId];
          const owner = wbCatalog.sides[side.serviceId || side.id];
          resolveWorkbenchAppearance(side, owner);
          if (side.bridgeConnected && side.workbenchMap && side.workbenchTheme && !side.workbenchRestored) {
            side.workbenchRestored = true;
            if (side.id === "left") {
              const query = new URL(location.href).searchParams;
              const requested = owner?.selections.find((entry) => !entry.scene && entry.map === side.workbenchMap && entry.id === query.get("view"));
              if (requested) {
                side.requestedTimeOfDay = query.get("time-of-day");
                applyWorkbenchAppearance(side, requested);
              }
            }
          }
          syncWorkbenchPickers();
          const failure = side.runtimeFailed ? side.runtimeErrors.at(-1) : owner?.status === "invalid" ? owner.diagnostics.map((item) => item.message).join(" ") : wbError;
          wb("notice").hidden = !failure;
          wb("notice").textContent = failure ? (owner?.status === "invalid" ? "Showing the last available preview. " : "") + failure : "";
          await publishWorkbenchContext();
        } catch (error) { showWorkbenchError(error); }
        finally { wbRefreshing = false; }
      }

      function resolveWorkbenchAppearance(side, owner) {
        const source = new URL(side.definition.previewUrl, location.href);
        const startup = owner?.selections.find((entry) => entry.scene && entry.scene === source.searchParams.get("scene"));
        const metadata = side.bridgeConnected ? side.map?.getStyle?.()?.metadata : undefined;
        // The command chooses the map. Never infer it from catalog order or a saved URL's view.
        side.workbenchMap ||= source.searchParams.get("map") || startup?.map || metadata?.["tileflow:map"];
        if (!side.pendingAppearance && metadata?.["tileflow:map"] === side.workbenchMap) side.workbenchTheme = metadata?.["tileflow:theme"] || side.workbenchTheme;
        side.workbenchTheme ||= source.searchParams.get("theme") || startup?.theme;
      }

      function applyWorkbenchAppearance(side, selected) {
        if (selected.map !== side.workbenchMap || selected.scene) return;
        const changed = selected.theme !== side.workbenchTheme;
        side.workbenchTheme = selected.theme;
        if (changed || side.pendingAppearance) {
          side.pendingAppearance = selected;
          side.definition.label = selected.label;
          scheduleMapControls();
          void loadMapControls();
        }
        syncWorkbenchPickers();
        writeUrlState();
        if (side.id === "left") {
          const url = new URL(location.href);
          url.searchParams.set("view", selected.id);
          const moment = wbTimeOfDay;
          if (moment) url.searchParams.set("time-of-day", moment); else url.searchParams.delete("time-of-day");
          history.replaceState(null, "", url);
        }
      }

      function syncWorkbenchPickers() {
        const side = states[activeSideId];
        const owner = wbCatalog?.sides[side.serviceId || side.id];
        const selections = owner?.selections.filter((entry) => entry.map === side.workbenchMap) || [];
        const selectedTheme = side.workbenchTheme;
        if (!side.camera || !selections.length || !selectedTheme) {
          wbPickerKey = "";
          wb("theme").replaceChildren(new Option("Waiting for map…", ""));
          wb("theme").disabled = true;
          wb("time-of-day-field").hidden = true;
          wbTimeOfDay = "";
          return;
        }
        const variants = owner?.timeOfDay?.[side.workbenchMap] || {};
        const key = JSON.stringify([activeSideId, selectedTheme, selections, variants, side.requestedTimeOfDay]);
        if (key === wbPickerKey) return;
        wbPickerKey = key;
        const allThemes = [...new Set(selections.map((entry) => entry.theme))];
        const family = Object.keys(variants).find((name) => Object.values(variants[name]).includes(selectedTheme));
        const members = new Set(Object.values(variants).flatMap((moments) => Object.values(moments)));
        const themes = allThemes.filter((name) => !members.has(name) || Object.hasOwn(variants, name));
        const moments = family ? variants[family] : {};
        wbTimeOfDay = moments[side.requestedTimeOfDay] === selectedTheme ? side.requestedTimeOfDay : Object.keys(moments).find((moment) => moments[moment] === selectedTheme) || "";
        for (const segment of wb("time-of-day").querySelectorAll("button")) {
          const selected = segment.value === wbTimeOfDay;
          segment.setAttribute("aria-checked", String(selected));
          segment.tabIndex = selected ? 0 : -1;
          segment.disabled = !moments[segment.value];
        }
        wb("time-of-day-field").hidden = !family;
        wb("theme").replaceChildren(...themes.map((theme) => new Option(theme, theme)));
        wb("theme").value = family || selectedTheme;
        wb("theme").disabled = themes.length < 2;
        wb("palettes").replaceChildren(...themes.map(theme => {
          const button=document.createElement("button");button.type="button";button.setAttribute("role","radio");button.setAttribute("aria-checked",String(theme===(family||selectedTheme)));
          const swatches=document.createElement("span");swatches.className="dt-palette-swatches";
          const label=document.createElement("span");label.textContent=theme.replace(/[-_]/g," ");button.append(swatches,label);
          button.onclick=()=>{wb("theme").value=theme;selectWorkbenchAppearance();};
          const concrete=variants[theme]?.[wbTimeOfDay] || variants[theme]?.day || theme;
          const fill=colors=>{if(!button.isConnected)return;swatches.replaceChildren(...colors.map(color=>{const swatch=document.createElement("i");swatch.style.background=color;return swatch;}));};
          if(wbPaletteColors.has(concrete))queueMicrotask(()=>fill(wbPaletteColors.get(concrete)));
          else {
            const url=new URL(side.definition.basePath+"/styles/"+side.workbenchMap+"/"+concrete+".json",location.href);
            fetch(url).then(response=>{if(!response.ok)throw new Error("Palette unavailable");return response.json();}).then(style=>{
              const choices=[/background/,/water/,/land.*(?:park|vegetation)|vegetation/,/building/];
              const colors=choices.map(pattern=>style.layers.flatMap(layer=>pattern.test(layer.id)||pattern.test(layer.type)?Object.entries(layer.paint||{}).filter(([key,value])=>key.endsWith("-color")&&typeof value==="string").map(([,value])=>value):[])[0]).filter(Boolean);
              wbPaletteColors.set(concrete,colors);fill(colors);
            }).catch(()=>{swatches.textContent="—";});
          }
          return button;
        }));
      }

      function selectWorkbenchAppearance(requested = wbTimeOfDay) {
        const side = states[activeSideId];
        const owner = wbCatalog?.sides[side.serviceId || side.id];
        const moments = owner?.timeOfDay?.[side.workbenchMap]?.[wb("theme").value];
        const moment = moments?.[requested] ? requested : moments ? Object.keys(moments)[0] : undefined;
        const theme = moments?.[moment] || wb("theme").value;
        const selected = owner?.selections.find((entry) => !entry.scene && entry.map === side.workbenchMap && entry.theme === theme);
        if (!selected) { wbPickerKey = ""; syncWorkbenchPickers(); return; }
        side.requestedTimeOfDay = moment;
        applyWorkbenchAppearance(side, selected);
      }

      function currentWorkbenchDefinition() {
        const side = states[activeSideId];
        const camera = side.camera || canonicalCamera;
        const metadata = side.map?.getStyle?.().metadata;
        if (!camera || !validPortableName(metadata?.["tileflow:map"]) || !validConcreteThemeName(metadata?.["tileflow:theme"]))
          throw new Error("Wait for the current map to finish loading.");
        const container = side.map?.getContainer?.();
        const width = boundedInteger(container?.clientWidth, 64, 4096, 1280);
        const height = boundedInteger(container?.clientHeight, 64, 4096, 800);
        return {map:metadata["tileflow:map"], theme:metadata["tileflow:theme"],
          camera:{type:"center", center:[roundNumber(camera.center[0]),roundNumber(camera.center[1])], zoom:roundNumber(camera.zoom), bearing:roundNumber(camera.bearing), pitch:roundNumber(camera.pitch)},
          viewport:{width,height,dpr:1}, target:{kind:"map"}};
      }

      function workbenchContext() {
        const side = states[activeSideId];
        const layerObservation = globalThis.__tileflowDevtoolsUI?.layerContext?.();
        const selected = !layerObservation && selectedInspection?.side === side ? selectedInspection : undefined;
        const feature = selected?.features[selected.featureIndex];
        const layer = feature && side.map?.getStyle?.().layers?.find((entry) => entry.id === feature.layerId);
        const provenance = feature && findSidecarLayer(side.sidecar, feature.layerId);
        let definition;
        try { definition = currentWorkbenchDefinition(); } catch { /* Loading previews have no camera yet. */ }
        const configuration = side.definition.captureConfig ? " --config " + quoteCliArgument(side.definition.captureConfig) : "";
        const semanticOwner = provenance && sidecarLayerWithSemanticAttribution(provenance).semanticAttribution[0]?.semanticOwner;
        const captureCommand = definition ? "tileflow capture" + configuration + " --map " + quoteCliArgument(definition.map) + " --theme " + quoteCliArgument(definition.theme) +
          " --center=" + definition.camera.center.join(",") + " --zoom=" + definition.camera.zoom + " --bearing=" + definition.camera.bearing + " --pitch=" + definition.camera.pitch +
          " --width=" + definition.viewport.width + " --height=" + definition.viewport.height + " --dpr=" + definition.viewport.dpr + " --json" : undefined;
        return {schemaVersion:1, source:"browser-observation", config:side.definition.captureConfig || "tileflow.config.ts",
          status:side.artifactStatus, generation:side.artifactGeneration, inspectionEnabled,
          displayedGeneration:Number(side.frame.contentDocument?.documentElement.dataset.tileflowArtifactGeneration), definition,
          captureSemantics:"Compiled map at the observed camera and viewport; temporary preview edits are excluded.",
          review:{referenceId:null, before:null, after:null, liveMode:stage.dataset.mode, source:"map"},
          commands:{inspect:"tileflow inspect" + configuration + (semanticOwner ? " --domain " + quoteCliArgument(semanticOwner) : " --limit 80") + " --json", capture:captureCommand,
            session:"tileflow inspect session --url " + quoteCliArgument(location.origin) + " --json"},
          selection:layerObservation || (feature ? {coordinate:selected.coordinate,
            provenance:provenance ? sidecarLayerWithSemanticAttribution(provenance).semanticAttribution : [],
            provenanceScope:"Semantic ownership only; exact file, line and token are not inferred.",
            feature, layer:layer ? {id:layer.id,type:layer.type,source:layer.source,sourceLayer:layer["source-layer"],minzoom:layer.minzoom,maxzoom:layer.maxzoom,filter:layer.filter,paint:layer.paint,layout:layer.layout} : undefined} : null)};
      }

      function boundedWorkbenchContext() {
        const observed = workbenchContext();
        const nodeLimit = observed.selection?.kind === "layer" ? 2400 : 200;
        let entries = 0;
        const omitted = [];
        function visit(value, path, depth) {
          if (++entries > nodeLimit || depth > 16) { omitted.push(path); return undefined; }
          if (typeof value === "string") { if (value.length > 512) omitted.push(path); return value.slice(0,512); }
          if (!value || typeof value !== "object") return value;
          if (Array.isArray(value)) {
            if (value.length > 32) omitted.push(path);
            return value.slice(0,32).map((entry,index) => visit(entry,path + "/" + index,depth + 1));
          }
          return Object.fromEntries(Object.entries(value).flatMap(([key,entry]) => {
            const result = visit(entry,path + "/" + key.replaceAll("~","~0").replaceAll("/","~1"),depth + 1);
            return result === undefined ? [] : [[key,result]];
          }));
        }
        const context = visit(observed,"",0);
        context.projection = {truncated:omitted.length > 0, omitted:omitted.slice(0,32)};
        return context;
      }

      async function publishWorkbenchContext() {
        const side = states[activeSideId];
        if (!side.bridgeReady) return;
        const context = boundedWorkbenchContext();
        const key = JSON.stringify(context);
        if (key === wbLastContext && Date.now() - wbLastPublished < 60_000) return;
        await workbenchRequest("/context", {client:wbClient, side:side.serviceId || side.id, generation:side.artifactGeneration, context});
        wbLastContext = key;
        wbLastPublished = Date.now();
      }

      function featureDisplayName(feature) {
        return String(feature.properties?.name || feature.properties?.class || feature.layerId.replace(/^tileflow-/, "").replace(/-render-/, " · ") || "Map element")
          .replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
      }

      function renderFeatureSummary(side, feature, layer, picker, raw) {
        const section = document.createElement("section"); section.className = "feature-summary";
        const heading = document.createElement("h3");
        heading.textContent = featureDisplayName(feature);
        const kind = document.createElement("div"); kind.className = "compact-note";
        const kinds = {fill:"Area", line:"Line", symbol:"Label or icon", "fill-extrusion":"3D building", circle:"Point", raster:"Imagery", hillshade:"Terrain shading", background:"Background"};
        kind.textContent = (kinds[layer?.type] || layer?.type || feature.geometryType) + " · Zoom " + (side.camera?.zoom ?? 0).toFixed(2);
        const headingStyle = document.createElement("h4"); headingStyle.textContent = "Appearance here";
        section.append(heading, kind, headingStyle);
        const values = document.createElement("dl"); values.className = "property-list";
        const labels = {"fill-color":"Fill color", "fill-opacity":"Opacity", "fill-outline-color":"Outline", "line-color":"Line color", "line-width":"Width", "line-opacity":"Opacity", "line-gap-width":"Gap", "text-color":"Text color", "text-halo-color":"Text outline", "text-halo-width":"Outline width", "text-opacity":"Text opacity", "text-size":"Text size", "icon-color":"Icon color", "icon-opacity":"Icon opacity", "fill-extrusion-color":"Building color", "fill-extrusion-height":"Height", "fill-extrusion-opacity":"Opacity"};
        for (const [name, rawValue] of Object.entries({...layer?.paint, ...(layer?.layout?.["text-size"] !== undefined ? {"text-size":layer.layout["text-size"]} : {})}).slice(0,8)) {
          const value = evaluateBasicZoomValue(rawValue, side.camera?.zoom ?? 0);
          const label = document.createElement("dt"); label.textContent = labels[name] || name.replaceAll("-", " "); label.title = name;
          const detail = document.createElement("dd"); detail.textContent = value === unsupportedValue ? "Varies by feature" : formatCurveValue(value);
          if (typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value)) {
            const swatch = document.createElement("span"); swatch.className = "color-swatch"; swatch.style.backgroundColor = value; swatch.setAttribute("aria-hidden", "true"); detail.append(swatch);
          }
          values.append(label,detail);
        }
        section.append(values);
        const provenance = findSidecarLayer(side.sidecar, feature.layerId);
        const owners = provenance ? sidecarLayerWithSemanticAttribution(provenance).semanticAttribution : [];
        const label = document.createElement("h4"); label.textContent = "Where to edit";
        section.append(label);
        const paths = [...new Set(owners.flatMap((owner) => owner.authoringPaths))];
        for (const path of paths.slice(0,8)) { const code = document.createElement("code"); code.className = "authoring-path"; code.textContent = path; section.append(code); }
        const note = document.createElement("p"); note.className = "compact-note";
        note.textContent = paths.length ? "Edit these configuration sections in your editor or ask your coding agent. The map updates here." : "No semantic configuration path is available for this layer.";
        section.append(note);
        const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "Feature data";
        const provenanceNote = document.createElement("p"); provenanceNote.className = "compact-note"; provenanceNote.textContent = "Configuration paths describe semantic ownership. Exact source lines and tokens are not reported.";
        details.append(summary,provenanceNote,raw);
        inspectionOutput.append(section,picker,details);
      }

      function showWorkbenchError(error) {
        const message = safeErrorMessage(error);
        wbError = message;
        setFeedback(message);
        wb("notice").textContent = message; wb("notice").hidden = false;
      }
`;
