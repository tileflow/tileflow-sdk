/** Runs in the comparison document's scope and uses its existing map bridge. */
export const workbenchClient = String.raw`
      let wbCatalog;
      let wbCatalogKey = "";
      let wbRecords = [];
      let wbNext;
      let wbBusy = false;
      let wbLastContext = "";
      let wbInterval;
      let wbRestored = false;
      let wbRefreshing = false;
      let wbError = "";
      let wbLastPublished = 0;
      let wbActiveOwner = "left";
      let wbPinnedReference;
      let wbPickerKey = "";
      let wbComparable = false;
      const wbClient = "view-" + Math.random().toString(36).slice(2);
      const wbDefinitions = {left:{...options.left}, ...(options.right ? {right:{...options.right}} : {})};
      const wb = (id) => document.getElementById("wb-" + id);
      if (options.workbenchUrl) initializeWorkbench();

      function initializeWorkbench() {
        wb("capture").addEventListener("click", () => captureCurrentView());
        wb("save-reference").addEventListener("click", () => captureCurrentView({pin:true}));
        wb("first-reference").addEventListener("click", () => captureCurrentView({pin:true}));
        wb("capture-compare").addEventListener("click", () => captureCurrentView({compare:true}));
        wb("clear-reference").addEventListener("click", () => { wbPinnedReference = undefined; renderPinnedReference(); });
        wb("pin-reference").addEventListener("click", () => pinReference(wbRecords.find((record) => record.id === wb("before").value)));
        wb("saved-tab").addEventListener("click", () => setReviewTab("saved"));
        wb("live-tab").addEventListener("click", () => setReviewTab("live"));
        wb("saved-mode").addEventListener("change", renderSavedDisplay);
        for (const name of ["map", "theme", "scene"]) wb(name).addEventListener("change", () => selectPicker(name));
        for (const name of ["frame", "width", "height"]) wb(name).addEventListener("change", updateCaptureFrame);
        if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateCaptureFrame).observe(stage);
        wb("view").addEventListener("change", () => selectWorkbenchView());
        wb("history-toggle").addEventListener("click", () => toggleHistory(wb("history").hidden));
        wb("history-close").addEventListener("click", () => toggleHistory(false));
        wb("compare-toggle").addEventListener("click", openReview);
        wb("review-close").addEventListener("click", () => { wb("review").hidden = true; wb("compare-toggle").focus(); });
        wb("run-compare").addEventListener("click", compareSavedCaptures);
        wb("before").addEventListener("change", renderReviewImages);
        wb("after").addEventListener("change", renderReviewImages);
        wb("swipe-position").addEventListener("input", () => {
          const position = Number(wb("swipe-position").value);
          wb("swipe-before").style.clipPath = "inset(0 " + (100-position) + "% 0 0)";
          wb("swipe").style.setProperty("--swipe", position + "%");
        });
        wb("more").addEventListener("click", () => loadHistory(true).catch(showWorkbenchError));
        wb("add-reference").addEventListener("click", addLiveReference);
        wb("copy-context").addEventListener("click", copyWorkbenchContext);
        wb("selection-context").addEventListener("click", copyWorkbenchContext);
        wb("start").addEventListener("click", () => { dismissWelcome(); setInspectionEnabled(true, true); });
        wb("dismiss").addEventListener("click", dismissWelcome);
        wb("help").addEventListener("click", () => { wb("review").hidden = true; void toggleHistory(false); wb("welcome").hidden = false; });
        try { wb("welcome").hidden = localStorage.getItem("tileflow-workbench-welcome-v1") === "seen"; } catch { wb("welcome").hidden = false; }
        void refreshWorkbench();
        wbInterval = setInterval(refreshWorkbench, 2500);
        addEventListener("beforeunload", () => clearInterval(wbInterval));
        addEventListener("keydown", (event) => {
          if (event.key === "Escape") { wb("review").hidden = true; toggleHistory(false); }
          if (event.target.closest?.("input,select,textarea,[contenteditable]")) return;
          if (event.key === "i" && !event.metaKey && !event.ctrlKey) setInspectionEnabled(!inspectionEnabled, true);
        });
      }

      function dismissWelcome() {
        wb("welcome").hidden = true;
        try { localStorage.setItem("tileflow-workbench-welcome-v1", "seen"); } catch { /* Storage is optional. */ }
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
          wb("project-path").textContent = wbCatalog.sides.left.config || "tileflow.config.ts";
          const key = JSON.stringify(Object.entries(wbCatalog.sides).map(([side, value]) => [side, value.selections]));
          if (key !== wbCatalogKey) { wbCatalogKey = key; populateWorkbenchViews(); }
          const side = states[activeSideId];
          const owner = wbCatalog.sides[side.serviceId || side.id];
          if (wbActiveOwner !== (side.serviceId || side.id)) { wbActiveOwner = side.serviceId || side.id; populateWorkbenchViews(); }
          if (side.bridgeReady) {
            const metadata = side.map?.getStyle?.().metadata;
            const current = owner?.selections.find((item) => item.id === wb("view").value);
            if (!current || current.map !== metadata?.["tileflow:map"] || current.theme !== metadata?.["tileflow:theme"])
              wb("view").value = "map:" + metadata?.["tileflow:map"] + ":" + metadata?.["tileflow:theme"];
          }
          syncWorkbenchPickers();
          const displayed = Number(side.frame.contentDocument?.documentElement.dataset.tileflowArtifactGeneration);
          wb("capture").disabled = hasMapControlOverrides(side) || wbBusy || wbCatalog.busy || !side.bridgeReady || side.runtimeFailed || owner?.status !== "ready" || displayed !== owner.generation;
          for (const name of ["save-reference", "first-reference", "capture-compare"]) wb(name).disabled = wb("capture").disabled;
          wb("capture").title = hasMapControlOverrides(side) ? "Reset Controls before capturing the source configuration" : wb("capture").disabled ? "Wait for the current map to finish loading" : "Save the compiled map at the selected capture size";
          wb("status").textContent = side.runtimeFailed ? "Preview error" : owner?.status === "ready"
            ? "Up to date · Local · " + (side.camera ? "z" + side.camera.zoom.toFixed(2) : "Loading map")
            : owner?.status === "invalid" ? "Configuration invalid · last valid map shown" : "Building map…";
          wb("status").textContent += " · Capture " + wb("width").value + "×" + wb("height").value + "";
          const failure = side.runtimeFailed ? side.runtimeErrors.at(-1) : owner?.status === "invalid" ? owner.diagnostics.map((item) => item.message).join(" ") : wbError;
          wb("notice").hidden = !failure;
          wb("notice").textContent = failure ? (owner?.status === "invalid" ? "Showing the last available preview. " : "") + failure : "";
          await publishWorkbenchContext();
        } catch (error) { wb("status").textContent = "Map DevTools unavailable · " + safeErrorMessage(error); wb("capture").disabled = true; }
        finally { wbRefreshing = false; }
      }

      function populateWorkbenchViews() {
        const ownerId = states[activeSideId].serviceId || activeSideId;
        const current = wb("view").value;
        wb("view").replaceChildren();
        for (const selection of wbCatalog.sides[ownerId]?.selections || []) {
          const option = new Option((selection.scene ? "Scene · " : "Map · ") + selection.label, selection.id);
          wb("view").append(option);
        }
        if (Array.from(wb("view").options).some((option) => option.value === current)) wb("view").value = current;
        else {
          const side = states[activeSideId];
          const source = new URL(side.definition.previewUrl, location.href);
          const metadata = side.map?.getStyle?.().metadata;
          const id = source.searchParams.has("scene") ? "scene:" + source.searchParams.get("scene")
            : "map:" + metadata?.["tileflow:map"] + ":" + metadata?.["tileflow:theme"];
          if (Array.from(wb("view").options).some((option) => option.value === id)) wb("view").value = id;
        }
        const reference = wb("reference").value;
        wb("reference").replaceChildren();
        for (const [id, owner] of Object.entries(wbCatalog.sides)) {
          for (const selection of owner.selections) wb("reference").append(new Option((id === "right" ? "Reference · " : "") + selection.label, id + "|" + selection.id));
        }
        if (Array.from(wb("reference").options).some((option) => option.value === reference)) wb("reference").value = reference;
        if (!wbRestored) {
          wbRestored = true;
          const requested = new URL(location.href).searchParams.get("view");
          if (requested && Array.from(wb("view").options).some((option) => option.value === requested)) {
            wb("view").value = requested; selectWorkbenchView(true);
          } else {
            const startupScene = new URL(states[activeSideId].definition.previewUrl, location.href).searchParams.get("scene");
            const startup = wbCatalog.sides[ownerId]?.selections.find((item) => item.scene === startupScene);
            if (startup?.scene) applyWorkbenchSceneFrame(startup);
          }
        }
      }

      function selectWorkbenchView(preserveCamera = false) {
        const side = states[activeSideId];
        const owner = wbCatalog.sides[side.serviceId || side.id];
        const selected = owner.selections.find((entry) => entry.id === wb("view").value);
        if (!selected) return;
        const sameMapThemeChange = !selected.scene && side.map?.getStyle?.().metadata?.["tileflow:map"] === selected.map;
        if (!preserveCamera && !sameMapThemeChange) canonicalCamera = selected.camera.type === "center" ? {...selected.camera, bearing:selected.camera.bearing || 0, pitch:selected.camera.pitch || 0} : undefined;
        applyWorkbenchSceneFrame(selected);
        side.definition.previewUrl = selected.url;
        side.definition.label = selected.label;
        side.bridgeReady = false;
        wb("capture").disabled = true;
        side.frame.src = selected.url;
        syncWorkbenchPickers();
        document.getElementById(side.id + "-label").textContent = selected.label;
        writeUrlState();
        const url = new URL(location.href);
        if (side.id === "left") url.searchParams.set("view", selected.id);
        history.replaceState(null, "", url);
      }

      function applyWorkbenchSceneFrame(selection) {
        if (selection.viewport) {
          wb("width").value = String(selection.viewport.width); wb("height").value = String(selection.viewport.height);
          sceneDprInput.value = String(selection.viewport.dpr);
        }
        if (selection.scene) sceneNameInput.value = selection.scene;
        updateCaptureFrame();
      }

      function syncWorkbenchPickers() {
        const side = states[activeSideId];
        const selections = wbCatalog?.sides[side.serviceId || side.id]?.selections || [];
        const selected = selections.find((entry) => entry.id === wb("view").value);
        if (!selected) return;
        const key = JSON.stringify([activeSideId, selected.id, selections]);
        if (key === wbPickerKey) return;
        wbPickerKey = key;
        const maps = [...new Set(selections.map((entry) => entry.map))];
        const themes = [...new Set(selections.filter((entry) => entry.map === selected.map).map((entry) => entry.theme))];
        wb("map").replaceChildren(...maps.map((map) => new Option(map, map)));
        wb("theme").replaceChildren(...themes.map((theme) => new Option(theme, theme)));
        wb("scene").replaceChildren(new Option("Custom view", ""), ...selections.filter((entry) => entry.scene).map((entry) => new Option(entry.scene, entry.id)));
        wb("map").value = selected.map; wb("theme").value = selected.theme;
        wb("scene").value = selected.scene ? selected.id : "";
        wb("map-field").hidden = maps.length < 2;
        wb("theme-field").hidden = themes.length < 2;
        wb("scene-field").hidden = !selections.some((entry) => entry.scene);
        ctl("scene-help").hidden = wb("scene-field").hidden;
        wb("project").textContent = selected.map + " · Local";
      }

      function selectPicker(kind) {
        const side = states[activeSideId];
        const selections = wbCatalog.sides[side.serviceId || side.id].selections;
        const selected = kind === "scene"
          ? selections.find((entry) => entry.id === wb("scene").value)
          : selections.find((entry) => !entry.scene && entry.map === wb("map").value && entry.theme === wb("theme").value)
            || selections.find((entry) => !entry.scene && entry.map === wb("map").value);
        if (!selected) { wbPickerKey = ""; syncWorkbenchPickers(); return; }
        wb("view").value = selected.id;
        selectWorkbenchView(kind === "theme");
      }

      function updateCaptureFrame() {
        if (!options.workbenchUrl) return;
        const enabled = wb("frame").checked && stage.dataset.mode === "single";
        stage.dataset.frame = String(!!enabled);
        wb("frame-note").hidden = !enabled;
        if (enabled) {
          const width = Math.max(64, Math.min(4096, Number(wb("width").value) || 1280));
          const height = Math.max(64, Math.min(4096, Number(wb("height").value) || 800));
          const size = stage.getBoundingClientRect();
          const scale = Math.max(.05, Math.min((size.width - 28) / width, (size.height - 85) / height, 1));
          stage.style.setProperty("--frame-width", width + "px");
          stage.style.setProperty("--frame-height", height + "px");
          stage.style.setProperty("--frame-scale", String(scale));
          wb("frame-note").textContent = "Capture frame · " + width + "×" + height + " · 3D and tree switches are preview-only";
        }
        for (const side of Object.values(states)) side.map?.resize?.();
      }

      function setReviewTab(tab) {
        wb("saved-review").hidden = tab !== "saved";
        wb("live-picker").hidden = tab !== "live";
        wb("saved-tab").setAttribute("aria-pressed", String(tab === "saved"));
        wb("live-tab").setAttribute("aria-pressed", String(tab === "live"));
      }

      function captureLabel(record) {
        return record.scene + " · " + record.theme + " · " + new Date(record.savedAt).toLocaleString(undefined, {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit"});
      }

      function pinReference(record) {
        if (!record) return;
        wbPinnedReference = record;
        wb("before").value = record.id;
        renderPinnedReference();
        wb("review").hidden = true;
        void toggleHistory(false);
        setFeedback("Reference saved. Edit your map, then Capture & compare.");
      }

      function renderPinnedReference() {
        wb("reference-bar").hidden = !wbPinnedReference;
        wb("reference-summary").replaceChildren();
        if (!wbPinnedReference) return;
        const label = document.createElement("strong"); label.textContent = "Reference · " + captureLabel(wbPinnedReference);
        const note = document.createElement("small"); note.textContent = "Frozen capture · next comparison reuses its camera and " + wbPinnedReference.definition.viewport.width + "×" + wbPinnedReference.definition.viewport.height + " frame";
        wb("reference-summary").append(label, note);
      }

      function renderSavedDisplay() {
        const split = wbComparable && wb("saved-mode").value !== "side-by-side";
        wb("saved-display").hidden = !wbComparable;
        wb("swipe").hidden = !split; wb("swipe-control").hidden = !split;
        wb("review-images").hidden = split;
      }

      function addLiveReference() {
        const [ownerId, selectionId] = wb("reference").value.split("|");
        const selection = wbCatalog.sides[ownerId]?.selections.find((entry) => entry.id === selectionId);
        if (!selection) return;
        const definition = {...wbDefinitions[ownerId], previewUrl:selection.url, label:selection.label};
        options.right = definition;
        let side = states.right;
        if (!side) {
          side = states.right = {id:"right", definition, frame:document.getElementById("right-frame"),
            stateElement:document.getElementById("right-state"), statusTextElement:document.getElementById("right-status-text"),
            artifactStatus:"building", artifactGeneration:-1, bridgeReady:false, loadEpoch:0, runtimeErrors:[], runtimeFailed:false};
          sideIds.push("right");
          side.frame.addEventListener("load", () => connectSide(side));
          side.frame.addEventListener("focus", () => selectSide("right"));
        }
        side.eventSource?.close(); cleanupSideBridge(side); side.sidecarAbort?.abort();
        side.definition = definition; side.serviceId = ownerId;
        side.artifactGeneration = -1; side.bridgeReady = false;
        document.getElementById("right-label").textContent = selection.label;
        side.frame.src = selection.url;
        startStatus(side);
        wb("live-tools").hidden = false; driverButton.hidden = false;
        wb("review").hidden = true;
        setMode("side-by-side");
      }

      function currentWorkbenchDefinition() {
        const side = states[activeSideId];
        const camera = side.camera || canonicalCamera;
        const metadata = side.map?.getStyle?.().metadata;
        if (!camera || !validPortableName(metadata?.["tileflow:map"]) || !validConcreteThemeName(metadata?.["tileflow:theme"]))
          throw new Error("Wait for the current map to finish loading.");
        const width = Number(wb("width").value), height = Number(wb("height").value);
        const maximum = Number(sceneDprInput.value) === 2 ? 2048 : 4096;
        if (![width,height].every((value) => Number.isInteger(value) && value >= 64 && value <= maximum)) throw new Error("Choose frame dimensions from 64 to " + maximum + " pixels at this pixel ratio.");
        return {map:metadata["tileflow:map"], theme:metadata["tileflow:theme"],
          camera:{type:"center", center:[roundNumber(camera.center[0]),roundNumber(camera.center[1])], zoom:roundNumber(camera.zoom), bearing:roundNumber(camera.bearing), pitch:roundNumber(camera.pitch)},
          viewport:{width,height,dpr:Number(sceneDprInput.value) === 2 ? 2 : 1}, target:{kind:"map"}};
      }

      async function captureCurrentView(action = {}) {
        if (wbBusy) return;
        let captured;
        const reference = action.compare ? wbPinnedReference : undefined;
        try {
          if (!validPortableName(sceneNameInput.value)) throw new Error("Use a kebab-case capture name in Capture settings.");
          const side = states[activeSideId];
          if (!side.bridgeReady || side.runtimeFailed) throw new Error("Wait for the current map to finish loading.");
          if (hasMapControlOverrides(side)) throw new Error("Reset Controls or adopt the changes in source before capturing.");
          let definition = currentWorkbenchDefinition();
          if (action.compare) {
            if (!reference) throw new Error("Choose a reference capture first.");
            if (definition.map !== reference.map) throw new Error("Switch to " + reference.map + " to compare against this reference, or choose another reference.");
            definition = {...definition, camera:reference.definition.camera, viewport:reference.definition.viewport};
          }
          wbBusy = true; wb("capture").disabled = true; wb("capture-label").textContent = "Capturing…";
          wb("capture-compare").disabled = true;
          dismissWelcome(); wbError = "";
          document.getElementById("capture-settings").open = false;
          const generation = Number(side.frame.contentDocument?.documentElement.dataset.tileflowArtifactGeneration);
          const result = await workbenchRequest("/capture", {side:side.serviceId || side.id, generation, name:sceneNameInput.value, definition});
          setFeedback("Capture saved · " + sceneNameInput.value);
          await loadHistory();
          captured = result.captureId;
          wb("after").value = captured;
          if (action.pin) pinReference(wbRecords.find((entry) => entry.id === captured));
          else if (!action.compare) { wb("review").hidden = true; wb("history").hidden = false; wb("history-toggle").setAttribute("aria-expanded", "true"); }
        } catch (error) { showWorkbenchError(error); }
        finally { wbBusy = false; wb("capture-label").textContent = "Capture"; void refreshWorkbench(); }
        if (action.compare && captured) {
          wb("before").value = reference.id;
          setReviewTab("saved"); await openReview(false); await compareSavedCaptures();
        }
      }

      async function toggleHistory(open) {
        if (open) { toggleMapControls(false); setInspectionEnabled(false); wb("welcome").hidden = true; }
        wb("history").hidden = !open;
        wb("history-toggle").setAttribute("aria-expanded", String(open));
        if (open) { wb("review").hidden = true; try { await loadHistory(); } catch (error) { showWorkbenchError(error); } }
      }

      async function loadHistory(append = false) {
        const result = await workbenchRequest("/captures" + (append && wbNext !== null ? "?offset=" + wbNext : ""));
        wbRecords = append ? [...wbRecords, ...result.records.filter((entry) => !wbRecords.some((old) => old.id === entry.id))] : result.records;
        if (wbPinnedReference && !wbRecords.some((entry) => entry.id === wbPinnedReference.id)) wbRecords.push(wbPinnedReference);
        wbNext = result.next; wb("more").hidden = wbNext === null;
        if (result.truncated) result.warnings.push("History is limited to 5,000 directory entries. Use the CLI to open older capture IDs.");
        wb("history-note").textContent = result.warnings.length ? result.warnings.join(" ") : wbRecords.length
          ? "Choose a capture to review, or use it as the reference for your next change. Saved in this project."
          : "Start with Capture as reference, edit your map, then Capture & compare.";
        wb("captures").replaceChildren();
        for (const record of wbRecords) {
          const card = document.createElement("article"); card.className = "capture-card"; card.dataset.reference = String(record.id === wbPinnedReference?.id);
          const button = document.createElement("button"); button.setAttribute("aria-label", "Review " + captureLabel(record));
          const img = document.createElement("img"); img.src = record.imageUrl; img.alt = record.scene + " · " + record.theme; img.loading = "lazy";
          const title = document.createElement("span"); title.textContent = record.scene + " · " + record.theme;
          const detail = document.createElement("span"); const small = document.createElement("small");
          small.textContent = new Date(record.savedAt).toLocaleString(); detail.append(small);
          button.append(img,title,detail);
          button.addEventListener("click", () => { wb("after").value = record.id; void openReview(false); });
          const pin = document.createElement("button"); pin.className = "capture-reference"; pin.textContent = record.id === wbPinnedReference?.id ? "Current reference" : "Use as reference";
          pin.addEventListener("click", () => pinReference(record));
          const remove = document.createElement("button"); remove.className = "capture-delete"; remove.textContent = "Delete";
          remove.setAttribute("aria-label", "Delete " + captureLabel(record));
          remove.addEventListener("click", () => deleteSavedCapture(record, remove));
          const actions = document.createElement("div"); actions.className = "capture-actions"; actions.append(pin, remove);
          card.append(button, actions); wb("captures").append(card);
        }
        for (const name of ["before", "after"]) {
          const selected = wb(name).value;
          wb(name).replaceChildren();
          for (const record of wbRecords) wb(name).append(new Option(captureLabel(record), record.id));
          if (wbRecords.some((record) => record.id === selected)) wb(name).value = selected;
          else if (name === "before" && wbRecords.length > 1) wb(name).value = wbRecords[1].id;
        }
        wb("first-reference").hidden = wbRecords.length > 0;
        wb("pin-reference").hidden = wbRecords.length === 0;
        wb("run-compare").disabled = wbRecords.length < 2;
        wb("review-help").textContent = wbRecords.length < 2 ? "Save a reference before editing. After your change, Capture & compare will reuse the same camera and frame." : "These are frozen captures. Choose a reference and a result to review your change.";
      }

      async function openReview(refresh = true) {
        toggleMapControls(false);
        wb("welcome").hidden = true;
        if (inspectionEnabled) setInspectionEnabled(false);
        setReviewTab("saved");
        wb("history").hidden = true; wb("history-toggle").setAttribute("aria-expanded", "false"); wb("review").hidden = false;
        try { if (refresh !== false) await loadHistory(); renderReviewImages(); } catch (error) { showWorkbenchError(error); }
      }

      async function deleteSavedCapture(record, button) {
        if (wbBusy || !confirm("Delete " + captureLabel(record) + "? This permanently removes its saved image and capture record from this project.")) return;
        wbBusy = true; button.disabled = true; button.textContent = "Deleting…";
        try {
          await workbenchRequest("/captures/delete", {id:record.id});
          if (wbPinnedReference?.id === record.id) { wbPinnedReference = undefined; renderPinnedReference(); }
          wbRecords = wbRecords.filter((entry) => entry.id !== record.id);
          await loadHistory();
          renderReviewImages();
          setFeedback("Capture deleted.");
        } catch (error) { showWorkbenchError(error); }
        finally { wbBusy = false; button.disabled = false; button.textContent = "Delete"; void refreshWorkbench(); }
      }

      function renderReviewImages() {
        wbComparable = false; wb("saved-display").hidden = true;
        wb("review-result").hidden = true; wb("diff-section").hidden = true; wb("review-json-section").hidden = true;
        wb("swipe").hidden = true; wb("swipe-control").hidden = true; wb("review-images").hidden = false; wb("review-notes").hidden = true;
        for (const key of ["before","after"]) {
          const record = wbRecords.find((entry) => entry.id === wb(key).value);
          wb(key + "-image").hidden = !record;
          if (record) wb(key + "-image").src = record.imageUrl;
          wb(key + "-caption").textContent = record ? (key === "before" ? "Reference" : "Result") + " · " + captureLabel(record) + " · " + record.definition.viewport.width + "×" + record.definition.viewport.height : "";
        }
      }

      async function compareSavedCaptures() {
        if (wbBusy) return;
        wbBusy = true; wb("run-compare").disabled = true; wb("run-compare").textContent = "Comparing…";
        try {
          wbError = "";
          const before = wb("before").value, after = wb("after").value;
          const result = await workbenchRequest("/compare", {before, after});
          if (before !== wb("before").value || after !== wb("after").value) return;
          const review = result.review;
          wb("review-result").hidden = false; wb("review-result").dataset.status = review.status;
          const mismatches = {"frame-mismatch":"Different cameras or frames", "dimensions-mismatch":"Different image dimensions", "runtime-mismatch":"Different renderers", "data-mismatch":"Different or unverified data identities"};
          wb("review-result").textContent = review.status === "comparable"
            ? before === after ? "No change · the result matches the saved reference exactly." : "Same frame and data · " + (review.exact.ratio * 100).toFixed(2) + "% of pixels changed. This measures difference, not visual quality."
            : (mismatches[review.status] || review.status) + ". Pixel metrics are unavailable. Capture the same scene with matching inputs.";
          wb("review-notes").hidden = !review.warnings.length;
          wb("review-warnings").textContent = review.warnings.join(" ");
          const comparable = review.status === "comparable";
          wbComparable = comparable; renderSavedDisplay();
          if (comparable) {
            const viewport = wbRecords.find((entry) => entry.id === before)?.definition.viewport;
            if (viewport) wb("swipe").style.setProperty("--capture-aspect", String(viewport.width / viewport.height));
            wb("swipe-before").src = wb("before-image").src; wb("swipe-after").src = wb("after-image").src;
          }
          wb("diff-section").hidden = !result.diff;
          if (result.diff) wb("diff").src = result.diff;
          wb("review-json-section").hidden = false;
          wb("review-json").textContent = JSON.stringify({...result, diff:result.diff ? "Available in Pixel difference" : null}, null, 2);
        } catch (error) { showWorkbenchError(error); }
        finally { wbBusy = false; wb("run-compare").disabled = wbRecords.length < 2; wb("run-compare").textContent = "Compare captures"; }
      }

      function workbenchContext() {
        const side = states[activeSideId];
        const selected = selectedInspection?.side === side ? selectedInspection : undefined;
        const feature = selected?.features[selected.featureIndex];
        const layer = feature && side.map?.getStyle?.().layers?.find((entry) => entry.id === feature.layerId);
        const provenance = feature && findSidecarLayer(side.sidecar, feature.layerId);
        let definition;
        try { definition = currentWorkbenchDefinition(); } catch { /* Loading previews have no capture frame yet. */ }
        const configuration = side.definition.captureConfig ? " --config " + quoteCliArgument(side.definition.captureConfig) : "";
        const semanticOwner = provenance && sidecarLayerWithSemanticAttribution(provenance).semanticAttribution[0]?.semanticOwner;
        const captureCommand = definition ? "tileflow capture" + configuration + " --map " + quoteCliArgument(definition.map) + " --theme " + quoteCliArgument(definition.theme) +
          " --center=" + definition.camera.center.join(",") + " --zoom=" + definition.camera.zoom + " --bearing=" + definition.camera.bearing + " --pitch=" + definition.camera.pitch +
          " --width=" + definition.viewport.width + " --height=" + definition.viewport.height + " --dpr=" + definition.viewport.dpr + " --json" : undefined;
        return {schemaVersion:1, source:"browser-observation", config:side.definition.captureConfig || "tileflow.config.ts",
          status:side.artifactStatus, generation:side.artifactGeneration, inspectionEnabled,
          displayedGeneration:Number(side.frame.contentDocument?.documentElement.dataset.tileflowArtifactGeneration), definition,
          captureSemantics:"Compiled map at this camera and fixed frame; temporary preview visibility is excluded.",
          review:{referenceId:wbPinnedReference?.id || null, before:wb("before").value || null, after:wb("after").value || null, liveMode:stage.dataset.mode, source:wb("review").hidden ? (stage.dataset.mode === "single" ? "map" : "live-maps") : wb("live-picker").hidden ? "saved-captures" : "live-maps"},
          commands:{inspect:"tileflow inspect" + configuration + (semanticOwner ? " --domain " + quoteCliArgument(semanticOwner) : " --limit 80") + " --json", capture:captureCommand,
            session:"tileflow inspect session --url " + quoteCliArgument(location.origin) + " --json"},
          selection:feature ? {coordinate:selected.coordinate,
            provenance:provenance ? sidecarLayerWithSemanticAttribution(provenance).semanticAttribution : [],
            provenanceScope:"Semantic ownership only; exact file, line and token are not inferred.",
            feature, layer:layer ? {id:layer.id,type:layer.type,source:layer.source,sourceLayer:layer["source-layer"],minzoom:layer.minzoom,maxzoom:layer.maxzoom,filter:layer.filter,paint:layer.paint,layout:layer.layout} : undefined} : null};
      }

      function boundedWorkbenchContext() {
        let entries = 0;
        const omitted = [];
        function visit(value, path, depth) {
          if (++entries > 200 || depth > 10) { omitted.push(path); return undefined; }
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
        const context = visit(workbenchContext(),"",0);
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

      async function copyWorkbenchContext() {
        try {
          const side = states[activeSideId];
          if (selectedInspection && side.sidecar === undefined) await loadSidecar(side);
          const context = boundedWorkbenchContext();
          if (!await copyText(JSON.stringify(context,null,2))) throw new Error("Clipboard access is unavailable.");
          await publishWorkbenchContext(); setFeedback(selectedInspection?.side === side ? "Selected element context copied for your coding agent." : "Map context copied for your coding agent.");
        } catch (error) { showWorkbenchError(error); }
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
