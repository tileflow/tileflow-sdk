export type TileflowComparisonHtmlSide = {
  basePath: string;
  captureConfig?: string;
  eventsUrl: string;
  label: string;
  previewUrl: string;
  sidecarUrl?: string;
  statusUrl: string;
};

export type TileflowComparisonHtmlOptions = {
  basePath: string;
  cspNonce?: string;
  initialMode: 'blink' | 'overlay' | 'side-by-side' | 'split';
  left: TileflowComparisonHtmlSide;
  right: TileflowComparisonHtmlSide;
  schemaVersion: 1;
  title: string;
};

/** Render a dependency-free local comparison workbench around two same-origin previews. */
export function renderTileflowComparisonHtml(options: TileflowComparisonHtmlOptions): string {
  const documentOptions = serializeInlineJson(options);
  const nonceAttribute = options.cspNonce ? ` nonce="${escapeHtml(options.cspNonce)}"` : '';
  return `<!doctype html>
<html lang="en" data-tileflow-state="loading">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <style${nonceAttribute}>
      :root {
        color-scheme: light;
        --accent: #3157d5;
        --border: #d8dbe2;
        --ink: #202124;
        --muted: #656b76;
        --paper: #f6f7f9;
        --split: 50%;
        --overlay-alpha: .5;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        overflow: hidden;
        background: var(--paper);
        color: var(--ink);
        font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
      }
      button, input, select { font: inherit; }
      button {
        border: 1px solid var(--border);
        border-radius: 6px;
        background: white;
        color: var(--ink);
        cursor: pointer;
        padding: 5px 9px;
      }
      button:hover { border-color: #a8afbd; }
      button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
      button:focus-visible, input:focus-visible, select:focus-visible, .inspector:focus-visible {
        outline: 3px solid color-mix(in srgb, var(--accent) 45%, transparent);
        outline-offset: 2px;
      }
      .toolbar {
        z-index: 10;
        display: flex;
        min-height: 48px;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-bottom: 1px solid var(--border);
        background: rgba(255, 255, 255, .97);
        flex-wrap: wrap;
      }
      .toolbar-title { font-weight: 750; margin-right: 4px; }
      .toolbar-group { display: inline-flex; min-width: 0; align-items: center; gap: 8px; flex-wrap: wrap; }
      .toolbar-separator { width: 1px; height: 25px; flex: 0 0 auto; background: var(--border); }
      .toolbar label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
      .toolbar input[type="range"] { width: 96px; }
      .toolbar input[type="text"] { width: 150px; padding: 5px 7px; border: 1px solid var(--border); border-radius: 6px; }
      .workspace { position: relative; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; }
      .stage { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: #d8dadd; }
      .pane { position: absolute; inset: 0; min-width: 0; min-height: 0; overflow: hidden; background: #d8dadd; }
      .pane iframe { width: 100%; height: 100%; display: block; border: 0; background: #d8dadd; }
      .pane-label {
        position: absolute;
        z-index: 3;
        top: 10px;
        left: 10px;
        display: flex;
        max-width: calc(100% - 20px);
        align-items: center;
        gap: 7px;
        border: 1px solid rgba(0, 0, 0, .12);
        border-radius: 999px;
        background: rgba(255, 255, 255, .93);
        box-shadow: 0 3px 14px rgba(0, 0, 0, .12);
        padding: 5px 9px;
        pointer-events: none;
      }
      .pane-label-text { overflow: hidden; text-overflow: ellipsis; }
      .side-state-text { flex: 0 0 auto; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
      .side-state { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #8d929b; }
      .side-state[data-status="ready"] { background: #248a4a; }
      .side-state[data-status="building"] { background: #cf8114; }
      .side-state[data-status="invalid"], .side-state[data-status="error"] { background: #ba3838; }
      .stage[data-mode="side-by-side"] { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1px; }
      .stage[data-mode="side-by-side"] .pane { position: relative; inset: auto; }
      .stage[data-mode="side-by-side"] .pane-right { grid-column: 2; }
      .stage:not([data-mode="side-by-side"]) .pane-right { z-index: 2; }
      .stage[data-mode="split"] .pane-right { clip-path: inset(0 0 0 var(--split)); }
      .stage[data-mode="overlay"] .pane-right { opacity: var(--overlay-alpha); }
      .stage[data-mode="blink"] .pane-right { opacity: 0; }
      .stage[data-mode="blink"][data-blink-side="right"] .pane-right { opacity: 1; }
      .stage[data-mode="blink"][data-blink-side="right"] .pane-left { opacity: 0; }
      .stage:not([data-mode="side-by-side"]) .pane-right { pointer-events: none; }
      .stage[data-driver="right"]:not([data-mode="side-by-side"]) .pane-right { pointer-events: auto; }
      .stage[data-driver="right"]:not([data-mode="side-by-side"]) .pane-left { pointer-events: none; }
      .stage[data-driver="left"]:not([data-mode="side-by-side"]) .pane-left { pointer-events: auto; }
      .split-line { display: none; position: absolute; z-index: 4; inset-block: 0; left: var(--split); width: 1px; background: rgba(255,255,255,.9); box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none; }
      .stage[data-mode="split"] .split-line { display: block; }
      .inspector {
        width: min(390px, 42vw);
        border-left: 1px solid var(--border);
        background: white;
        overflow: auto;
        padding: 12px;
      }
      .inspector[hidden] { display: none; }
      .inspector h2 { margin: 0 0 10px; font-size: 15px; }
      .inspector-heading { position: sticky; z-index: 2; top: -12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: -12px -12px 10px; padding: 12px; border-bottom: 1px solid var(--border); background: white; }
      .inspector-heading h2 { margin: 0; }
      .inspector h3 { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
      .inspector pre { max-height: 240px; margin: 6px 0; overflow: auto; border-radius: 6px; background: var(--paper); padding: 8px; font: 11px/1.45 ui-monospace, SFMono-Regular, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
      .inspector select { max-width: 100%; padding: 5px 7px; border: 1px solid var(--border); border-radius: 6px; }
      .feature-picker { display: grid; gap: 4px; margin: 8px 0; color: var(--muted); }
      .feature-picker select { width: 100%; color: var(--ink); }
      .curve-meta { margin: 5px 0; color: var(--muted); font-size: 11px; }
      .empty { color: var(--muted); }
      .curve { width: 100%; height: 116px; display: block; border: 1px solid var(--border); border-radius: 6px; background: #fbfbfc; }
      .color-curve { display: grid; grid-template-columns: repeat(97, 1fr); height: 42px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
      .sprite-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 7px; margin-top: 8px; }
      .sprite-card { min-width: 0; border: 1px solid var(--border); border-radius: 7px; padding: 7px; background: var(--paper); text-align: center; }
      .sprite-card canvas { display: block; margin: auto; max-width: 64px; max-height: 64px; image-rendering: auto; }
      .sprite-name { display: block; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; font-size: 10px; }
      .feedback { color: var(--muted); min-width: 64px; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      @media (max-width: 760px) {
        .toolbar { align-content: center; gap: 6px; padding: 6px; }
        .toolbar-title { flex: 1 0 calc(100% - 12px); }
        .toolbar-separator { display: none; }
        .toolbar-group { flex: 1 1 100%; gap: 5px; }
        .toolbar-group button { padding-inline: 7px; }
        .toolbar input[type="range"] { width: min(24vw, 86px); }
        .toolbar input[type="text"] { width: min(34vw, 130px); }
        .workspace { grid-template-columns: minmax(0, 1fr); }
        .inspector { position: absolute; z-index: 20; right: 0; inset-block: 0; width: min(92vw, 390px); box-shadow: -8px 0 28px rgba(0,0,0,.18); }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
      }
    </style>
  </head>
  <body>
    <header class="toolbar" aria-label="Comparison controls">
      <span class="toolbar-title" id="title"></span>
      <div class="toolbar-group" role="group" aria-label="Comparison mode">
        <button type="button" data-mode="side-by-side">Side by side</button>
        <button type="button" data-mode="split">Split</button>
        <button type="button" data-mode="overlay">Overlay</button>
        <button type="button" data-mode="blink">Blink</button>
      </div>
      <span class="toolbar-separator"></span>
      <div class="toolbar-group">
        <label id="split-control">Split <input id="split" type="range" min="5" max="95" value="50" aria-label="Split position" /></label>
        <label id="alpha-control">Opacity <input id="alpha" type="range" min="0" max="100" value="50" aria-label="Overlay opacity" /></label>
        <button type="button" id="driver">Interact: left</button>
        <button type="button" id="blink-pause">Pause blink</button>
        <button type="button" id="inspect-toggle" aria-controls="inspector" aria-expanded="false" aria-pressed="false">Inspect</button>
      </div>
      <span class="toolbar-separator"></span>
      <div class="toolbar-group">
        <input id="scene-name" type="text" value="comparison-view" aria-label="Scene name" />
        <label>DPR <select id="scene-dpr"><option value="1">1</option><option value="2">2</option></select></label>
        <button type="button" id="copy-scene">Copy scene</button>
        <button type="button" id="copy-command">Copy command</button>
      </div>
      <span class="feedback" id="feedback" role="status"></span>
    </header>
    <div class="workspace">
      <main class="stage" id="stage" data-driver="left" data-tileflow-capture-id="tileflow-comparison" data-tileflow-state="loading">
        <section class="pane pane-left" data-side="left">
          <div class="pane-label"><span class="side-state" id="left-state" role="status" aria-live="polite"></span><span class="pane-label-text" id="left-label"></span><span class="side-state-text" id="left-status-text">Building</span></div>
          <iframe id="left-frame" title="Left Tileflow preview" referrerpolicy="no-referrer"></iframe>
        </section>
        <section class="pane pane-right" data-side="right">
          <div class="pane-label"><span class="side-state" id="right-state" role="status" aria-live="polite"></span><span class="pane-label-text" id="right-label"></span><span class="side-state-text" id="right-status-text">Building</span></div>
          <iframe id="right-frame" title="Right Tileflow preview" referrerpolicy="no-referrer"></iframe>
        </section>
        <div class="split-line" aria-hidden="true"></div>
      </main>
      <aside class="inspector" id="inspector" tabindex="-1" aria-labelledby="inspector-title" hidden>
        <div class="inspector-heading"><h2 id="inspector-title">Cartographic inspector</h2><button type="button" id="inspector-close" aria-label="Close inspector">Close</button></div>
        <div id="inspection" class="empty">Enable Inspect, then click either map.</div>
        <h3>Zoom curve</h3>
        <select id="curve-property" disabled><option>Select a rendered layer first</option></select>
        <div id="curve-output" class="empty">Paint and layout values appear here.</div>
        <h3>Compiler sidecar</h3>
        <pre id="sidecar-output">No layer selected.</pre>
        <h3>Sprite atlas</h3>
        <button type="button" id="load-sprites">Load active side sprites</button>
        <div id="sprite-output" class="sprite-grid"></div>
      </aside>
    </div>
    <script type="module"${nonceAttribute}>
      const options = ${documentOptions};
      const bridgeSchemaVersion = 1;
      const bridgeSetCameraType = "tileflow:comparison-set-camera";
      const bridgeSetInspectionType = "tileflow:comparison-set-inspection";
      const bridgeCameraType = "tileflow:comparison-camera";
      const bridgeInspectionType = "tileflow:comparison-inspection";
      const bridgeReadyType = "tileflow:comparison-ready";
      const bridgeRuntimeErrorType = "tileflow:comparison-runtime-error";
      const stage = document.getElementById("stage");
      const inspector = document.getElementById("inspector");
      const inspectionOutput = document.getElementById("inspection");
      const curveProperty = document.getElementById("curve-property");
      const curveOutput = document.getElementById("curve-output");
      const sidecarOutput = document.getElementById("sidecar-output");
      const spriteOutput = document.getElementById("sprite-output");
      const feedback = document.getElementById("feedback");
      const splitInput = document.getElementById("split");
      const alphaInput = document.getElementById("alpha");
      const driverButton = document.getElementById("driver");
      const blinkPauseButton = document.getElementById("blink-pause");
      const inspectButton = document.getElementById("inspect-toggle");
      const inspectorCloseButton = document.getElementById("inspector-close");
      const sceneNameInput = document.getElementById("scene-name");
      const sceneDprInput = document.getElementById("scene-dpr");
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      const states = Object.fromEntries(["left", "right"].map((id) => {
        const definition = options[id];
        return [id, {
          id,
          definition,
          frame: document.getElementById(id + "-frame"),
          stateElement: document.getElementById(id + "-state"),
          statusTextElement: document.getElementById(id + "-status-text"),
          map: undefined,
          camera: undefined,
          bridgeReady: false,
          artifactStatus: "building",
          artifactGeneration: -1,
          artifactLastGoodGeneration: undefined,
          sidecar: undefined,
          sidecarPromise: undefined,
          sidecarAbort: undefined,
          spriteAbort: undefined,
          loadEpoch: 0,
          lastCameraRequestId: undefined,
          cleanupBridge: undefined,
          runtimeErrors: [],
          runtimeFailed: false
        }];
      }));
      let canonicalCamera = cameraFromUrl();
      let activeSideId = "left";
      let inspectionEnabled = false;
      let selectedInspection;
      let requestSequence = 0;
      let blinkTimer;
      let blinkPaused = reducedMotion.matches;
      let blinkSide = "left";
      let spriteLoadSequence = 0;
      let spriteOwnerId;

      document.getElementById("title").textContent = options.title;
      const initialUi = readUiFromUrl();
      splitInput.value = String(initialUi.split);
      alphaInput.value = String(initialUi.alpha);
      applySliders();
      setMode(initialUi.mode || options.initialMode);
      updateBlinkMotionPreference();
      for (const id of ["left", "right"]) {
        const side = states[id];
        document.getElementById(id + "-label").textContent = side.definition.label;
        side.frame.src = side.definition.previewUrl;
        side.frame.addEventListener("load", () => connectSide(side));
        side.frame.addEventListener("focus", () => selectSide(side.id));
        startStatus(side);
      }

      for (const button of document.querySelectorAll("[data-mode]")) {
        button.addEventListener("click", () => setMode(button.dataset.mode));
      }
      splitInput.addEventListener("input", () => { applySliders(); writeUrlState(); });
      alphaInput.addEventListener("input", () => { applySliders(); writeUrlState(); });
      driverButton.addEventListener("click", () => {
        selectSide(stage.dataset.driver === "left" ? "right" : "left");
      });
      blinkPauseButton.addEventListener("click", () => {
        blinkPaused = !blinkPaused;
        updateBlinkMotionPreference();
        restartBlink();
      });
      inspectButton.addEventListener("click", () => setInspectionEnabled(!inspectionEnabled, true));
      inspectorCloseButton.addEventListener("click", () => setInspectionEnabled(false, true));
      document.getElementById("copy-scene").addEventListener("click", () => copyScene(false));
      document.getElementById("copy-command").addEventListener("click", () => copyScene(true));
      document.getElementById("load-sprites").addEventListener("click", () => loadSprites(states[activeSideId]));
      curveProperty.addEventListener("change", renderCurve);
      reducedMotion.addEventListener?.("change", () => {
        blinkPaused = reducedMotion.matches;
        updateBlinkMotionPreference();
        restartBlink();
      });
      addEventListener("keydown", (event) => {
        if (event.key === "Escape" && inspectionEnabled) setInspectionEnabled(false, true);
      });
      addEventListener("message", receiveBridgeMessage);
      addEventListener("beforeunload", () => {
        clearInterval(blinkTimer);
        for (const side of Object.values(states)) {
          side.eventSource?.close();
          side.sidecarAbort?.abort();
          side.spriteAbort?.abort();
          side.cleanupBridge?.();
        }
      });

      function selectSide(id, writeState = true) {
        if (id !== "left" && id !== "right") return;
        const changed = activeSideId !== id || stage.dataset.driver !== id;
        const previousSpriteOwner = spriteOwnerId;
        activeSideId = id;
        stage.dataset.driver = id;
        driverButton.textContent = "Interact: " + id;
        driverButton.setAttribute("aria-label", "Interact with " + states[id].definition.label);
        if (changed && previousSpriteOwner && previousSpriteOwner !== id) {
          states[previousSpriteOwner].spriteAbort?.abort();
          spriteLoadSequence += 1;
          spriteOwnerId = undefined;
          spriteOutput.replaceChildren();
        }
        if (writeState) writeUrlState();
        if (!canonicalCamera) maybeEstablishInitialCamera();
      }

      function setInspectionEnabled(enabled, manageFocus = false) {
        inspectionEnabled = enabled;
        inspectButton.setAttribute("aria-pressed", String(enabled));
        inspectButton.setAttribute("aria-expanded", String(enabled));
        inspector.hidden = !enabled;
        for (const side of Object.values(states)) sendInspectionState(side);
        if (manageFocus) {
          if (enabled) inspector.focus();
          else inspectButton.focus();
        }
      }

      function updateBlinkMotionPreference() {
        const motionBlocked = reducedMotion.matches;
        blinkPauseButton.disabled = motionBlocked;
        blinkPauseButton.textContent = motionBlocked
          ? "Blink paused (reduced motion)"
          : blinkPaused ? "Resume blink" : "Pause blink";
      }

      function setMode(mode) {
        if (!["side-by-side", "split", "overlay", "blink"].includes(mode)) return;
        stage.dataset.mode = mode;
        for (const button of document.querySelectorAll("[data-mode]")) {
          button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
        }
        document.getElementById("split-control").hidden = mode !== "split";
        document.getElementById("alpha-control").hidden = mode !== "overlay";
        blinkPauseButton.hidden = mode !== "blink";
        restartBlink();
        writeUrlState();
        setTimeout(() => {
          for (const side of Object.values(states)) side.map?.resize?.();
        }, 0);
      }

      function applySliders() {
        const split = boundedNumber(Number(splitInput.value), 5, 95, 50);
        const alpha = boundedNumber(Number(alphaInput.value), 0, 100, 50);
        stage.style.setProperty("--split", split + "%");
        stage.style.setProperty("--overlay-alpha", String(alpha / 100));
      }

      function restartBlink() {
        clearInterval(blinkTimer);
        blinkTimer = undefined;
        blinkSide = "left";
        stage.dataset.blinkSide = blinkSide;
        if (stage.dataset.mode !== "blink" || blinkPaused) return;
        blinkTimer = setInterval(() => {
          blinkSide = blinkSide === "left" ? "right" : "left";
          stage.dataset.blinkSide = blinkSide;
        }, 700);
      }

      function connectSide(side) {
        side.loadEpoch += 1;
        const epoch = side.loadEpoch;
        side.cleanupBridge?.();
        side.cleanupBridge = undefined;
        side.sidecarAbort?.abort();
        side.spriteAbort?.abort();
        side.sidecarAbort = undefined;
        side.spriteAbort = undefined;
        side.map = undefined;
        side.bridgeReady = false;
        side.camera = undefined;
        side.sidecar = undefined;
        side.sidecarPromise = undefined;
        side.runtimeErrors = [];
        side.runtimeFailed = false;
        side.lastCameraRequestId = undefined;
        if (spriteOwnerId === side.id) {
          spriteLoadSequence += 1;
          spriteOwnerId = undefined;
          spriteOutput.replaceChildren();
          spriteOutput.textContent = "The selected map reloaded; load its sprite atlas again.";
        }
        if (selectedInspection?.side === side) {
          selectedInspection = undefined;
          inspectionOutput.className = "empty";
          inspectionOutput.textContent = "The selected map reloaded; click a rendered feature again.";
          curveProperty.disabled = true;
          curveProperty.replaceChildren(new Option("Select a rendered layer first"));
          curveOutput.className = "empty";
          curveOutput.textContent = "Paint and layout values appear here.";
          sidecarOutput.textContent = "No layer selected.";
        }
        renderSideStatus(side);
        updateDocumentReadiness();
        const started = performance.now();
        const findMap = () => {
          if (side.loadEpoch !== epoch) return;
          let childWindow;
          try {
            childWindow = side.frame.contentWindow;
            const map = childWindow?.__tileflowPreviewMap;
            if (map) {
              side.map = map;
              side.cleanupBridge = installChildBridge(side, childWindow, map, epoch);
              return;
            }
          } catch (error) {
            markSideRuntimeError(side, error);
            return;
          }
          if (performance.now() - started < 10_000) {
            setTimeout(findMap, 50);
          } else {
            markSideRuntimeError(side, "Preview map did not initialize.");
            maybeEstablishInitialCamera();
          }
        };
        findMap();
      }

      function installChildBridge(side, childWindow, map, epoch) {
        let applyingRequestId;
        let inspectionActive = inspectionEnabled;
        let movementFrame;
        let queuedUserMovement = false;
        let releaseFrame;
        let releaseFrameAfterPaint;
        let readyTimer;
        let readyAnnounced = false;
        const targetOrigin = childWindow.location.origin;
        // The bridge is installed by the same-origin parent, so callbacks created here
        // belong to the parent realm. Dispatch directly with an explicit child source;
        // commands still cross the iframe boundary through validated postMessage events.
        const postToParent = (message) => receiveBridgeMessage({
          data: message,
          origin: targetOrigin,
          source: childWindow
        });
        let userMovementActive = false;
        const postCamera = (phase, requestId, userInitiated = false) => {
          postToParent({
            type: bridgeCameraType,
            schemaVersion: bridgeSchemaVersion,
            side: side.id,
            phase,
            ...(requestId === undefined ? {} : {requestId}),
            ...(userInitiated ? {userInitiated: true} : {}),
            camera: readMapCamera(map)
          });
        };
        const handleMoveStart = (event) => {
          if (applyingRequestId === undefined && event?.originalEvent) userMovementActive = true;
        };
        const handleMove = (event) => {
          if (applyingRequestId !== undefined) return;
          if (event?.originalEvent) userMovementActive = true;
          queuedUserMovement = queuedUserMovement || userMovementActive;
          if (movementFrame !== undefined) return;
          movementFrame = childWindow.requestAnimationFrame(() => {
            movementFrame = undefined;
            const userInitiated = queuedUserMovement;
            queuedUserMovement = false;
            postCamera("move", undefined, userInitiated);
          });
        };
        const handleMoveEnd = (event) => {
          if (applyingRequestId !== undefined) {
            postCamera("end", applyingRequestId);
            scheduleApplyingRelease(applyingRequestId);
            return;
          }
          if (event?.originalEvent) userMovementActive = true;
          if (movementFrame !== undefined) {
            childWindow.cancelAnimationFrame(movementFrame);
            movementFrame = undefined;
          }
          queuedUserMovement = false;
          postCamera("end", undefined, userMovementActive);
          userMovementActive = false;
        };
        const handleClick = (event) => {
          if (!inspectionActive) return;
          const features = map.queryRenderedFeatures(event.point).slice(0, 16).map(projectFeature);
          postToParent({
            type: bridgeInspectionType,
            schemaVersion: bridgeSchemaVersion,
            side: side.id,
            coordinate: [event.lngLat.lng, event.lngLat.lat],
            features
          });
        };
        const handleError = (event) => {
          postToParent({
            type: bridgeRuntimeErrorType,
            schemaVersion: bridgeSchemaVersion,
            side: side.id,
            message: sanitizeRuntimeMessage(event?.error?.message || event?.message || "Map runtime error")
          });
        };
        const handleCommand = (event) => {
          if (event.source !== childWindow.parent || event.origin !== targetOrigin) return;
          const message = event.data;
          if (!message || message.schemaVersion !== bridgeSchemaVersion) return;
          if (message.type === bridgeSetInspectionType && typeof message.enabled === "boolean") {
            inspectionActive = message.enabled;
            map.getCanvas().style.cursor = inspectionActive ? "crosshair" : "";
            return;
          }
          if (message.type !== bridgeSetCameraType || !validCamera(message.camera)) return;
          if (movementFrame !== undefined) {
            childWindow.cancelAnimationFrame(movementFrame);
            movementFrame = undefined;
          }
          queuedUserMovement = false;
          userMovementActive = false;
          cancelApplyingRelease();
          applyingRequestId = typeof message.requestId === "number" ? message.requestId : 0;
          try {
            map.jumpTo(message.camera);
            postCamera("end", applyingRequestId);
            scheduleApplyingRelease(applyingRequestId);
          } catch (error) {
            applyingRequestId = undefined;
            handleError({error});
          }
        };
        const announceReady = () => {
          if (readyAnnounced || side.loadEpoch !== epoch) return;
          readyAnnounced = true;
          clearTimeout(readyTimer);
          postToParent({
            type: bridgeReadyType,
            schemaVersion: bridgeSchemaVersion,
            side: side.id,
            camera: readMapCamera(map)
          });
        };
        const handleReadyTimeout = () => {
          if (readyAnnounced || side.loadEpoch !== epoch) return;
          markSideRuntimeError(side, "Preview map did not become ready within 10 seconds.");
          maybeEstablishInitialCamera();
        };
        const cancelApplyingRelease = () => {
          if (releaseFrame !== undefined) childWindow.cancelAnimationFrame(releaseFrame);
          if (releaseFrameAfterPaint !== undefined) childWindow.cancelAnimationFrame(releaseFrameAfterPaint);
          releaseFrame = undefined;
          releaseFrameAfterPaint = undefined;
        };
        const scheduleApplyingRelease = (requestId) => {
          cancelApplyingRelease();
          releaseFrame = childWindow.requestAnimationFrame(() => {
            releaseFrame = undefined;
            releaseFrameAfterPaint = childWindow.requestAnimationFrame(() => {
              releaseFrameAfterPaint = undefined;
              if (applyingRequestId === requestId) applyingRequestId = undefined;
            });
          });
        };
        map.on("movestart", handleMoveStart);
        map.on("move", handleMove);
        map.on("moveend", handleMoveEnd);
        map.on("click", handleClick);
        map.on("error", handleError);
        childWindow.addEventListener("message", handleCommand);
        if (map.loaded?.()) announceReady();
        else {
          map.once("load", announceReady);
          map.once("idle", announceReady);
          readyTimer = setTimeout(handleReadyTimeout, 10_000);
        }
        return () => {
          if (movementFrame !== undefined) childWindow.cancelAnimationFrame(movementFrame);
          cancelApplyingRelease();
          clearTimeout(readyTimer);
          map.off("movestart", handleMoveStart);
          map.off("move", handleMove);
          map.off("moveend", handleMoveEnd);
          map.off("click", handleClick);
          map.off("error", handleError);
          map.off("load", announceReady);
          map.off("idle", announceReady);
          childWindow.removeEventListener("message", handleCommand);
        };
      }

      function receiveBridgeMessage(event) {
        if (event.origin !== location.origin || !event.data || event.data.schemaVersion !== bridgeSchemaVersion) return;
        const side = Object.values(states).find((candidate) => candidate.frame.contentWindow === event.source);
        if (!side || event.data.side !== side.id) return;
        const message = event.data;
        if (message.type === bridgeReadyType && validCamera(message.camera)) {
          side.bridgeReady = true;
          side.camera = message.camera;
          renderSideStatus(side);
          maybeEstablishInitialCamera();
          sendInspectionState(side);
          void loadSidecar(side);
          updateDocumentReadiness();
          return;
        }
        if (message.type === bridgeCameraType && validCamera(message.camera)) {
          if (message.requestId !== undefined) {
            if (message.requestId !== side.lastCameraRequestId) return;
            side.camera = message.camera;
            if (
              side.id === stage.dataset.driver &&
              canonicalCamera &&
              !camerasEqual(message.camera, canonicalCamera)
            ) {
              canonicalCamera = message.camera;
              sendCamera(states[side.id === "left" ? "right" : "left"], canonicalCamera);
              writeUrlState();
            }
            if (message.phase === "end" && selectedInspection?.side === side) renderCurve();
            return;
          }
          side.camera = message.camera;
          if (message.userInitiated !== true) {
            if (canonicalCamera && !camerasEqual(message.camera, canonicalCamera)) {
              sendCamera(side, canonicalCamera);
            }
            return;
          }
          selectSide(side.id, false);
          canonicalCamera = message.camera;
          const other = states[side.id === "left" ? "right" : "left"];
          sendCamera(other, canonicalCamera);
          if (message.phase === "end") {
            writeUrlState();
            if (selectedInspection?.side === side) renderCurve();
          }
          return;
        }
        if (message.type === bridgeInspectionType && Array.isArray(message.features)) {
          selectSide(side.id);
          selectedInspection = {side, coordinate: message.coordinate, features: message.features.slice(0, 16), featureIndex: 0};
          renderInspection();
          return;
        }
        if (message.type === bridgeRuntimeErrorType) {
          markSideRuntimeError(side, message.message);
        }
      }

      function sendCamera(side, camera) {
        if (!side.bridgeReady || !camera || !side.frame.contentWindow) return;
        if (side.camera && camerasEqual(side.camera, camera)) return;
        const requestId = ++requestSequence;
        side.lastCameraRequestId = requestId;
        side.frame.contentWindow.postMessage({
          type: bridgeSetCameraType,
          schemaVersion: bridgeSchemaVersion,
          requestId,
          camera
        }, location.origin);
      }

      function maybeEstablishInitialCamera() {
        if (canonicalCamera) {
          for (const side of Object.values(states)) sendCamera(side, canonicalCamera);
          writeUrlState();
          return;
        }
        const driver = states[stage.dataset.driver];
        let source = driver.bridgeReady && driver.camera ? driver : undefined;
        const driverUnavailable = driver.runtimeFailed || (
          driver.artifactStatus === "invalid" && !Number.isInteger(driver.artifactLastGoodGeneration)
        );
        if (!source && driverUnavailable && states.left.bridgeReady && states.left.camera) {
          source = states.left;
        }
        if (!source) return;
        canonicalCamera = source.camera;
        for (const side of Object.values(states)) {
          if (side !== source) sendCamera(side, canonicalCamera);
        }
        writeUrlState();
      }

      function sendInspectionState(side) {
        if (!side.bridgeReady || !side.frame.contentWindow) return;
        side.frame.contentWindow.postMessage({
          type: bridgeSetInspectionType,
          schemaVersion: bridgeSchemaVersion,
          enabled: inspectionEnabled
        }, location.origin);
      }

      function startStatus(side) {
        fetch(side.definition.statusUrl, {cache: "no-store"})
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("Status unavailable")))
          .then((status) => applyArtifactStatus(side, status))
          .catch(() => undefined);
        const events = new EventSource(side.definition.eventsUrl);
        side.eventSource = events;
        for (const name of ["building", "ready", "invalid"]) {
          events.addEventListener(name, (event) => {
            try { applyArtifactStatus(side, JSON.parse(event.data)); } catch {}
          });
        }
      }

      function applyArtifactStatus(side, status) {
        if (!status || !["building", "ready", "invalid"].includes(status.status)) return;
        const generation = Number.isInteger(status.generation) && status.generation >= 0 ? status.generation : 0;
        if (generation < side.artifactGeneration) return;
        if (
          generation === side.artifactGeneration &&
          status.status === "building" &&
          side.artifactStatus !== "building"
        ) return;
        side.artifactGeneration = generation;
        side.artifactStatus = status.status;
        side.artifactLastGoodGeneration = Number.isInteger(status.lastGoodGeneration)
          ? status.lastGoodGeneration
          : undefined;
        side.artifactDiagnostic = status.diagnostics?.[0]?.message;
        renderSideStatus(side);
        maybeEstablishInitialCamera();
        updateDocumentReadiness();
      }

      function updateDocumentReadiness() {
        const sides = Object.values(states);
        const failed = sides.some((side) => side.runtimeFailed || (
          side.artifactStatus === "invalid" && !Number.isInteger(side.artifactLastGoodGeneration)
        ));
        const ready = sides.every((side) => side.bridgeReady && (
          side.artifactStatus === "ready" ||
          (side.artifactStatus === "invalid" && Number.isInteger(side.artifactLastGoodGeneration))
        ));
        const value = failed ? "error" : ready ? "idle" : "loading";
        document.documentElement.dataset.tileflowState = value;
        stage.dataset.tileflowState = value;
      }

      function renderSideStatus(side) {
        const diagnostic = side.artifactDiagnostic;
        const message = side.runtimeFailed
          ? "Runtime error: " + (side.runtimeErrors.at(-1) || "Preview runtime failed")
          : side.artifactStatus === "invalid"
            ? "Invalid generation; showing last valid preview" + (diagnostic ? ": " + diagnostic : "")
            : "Generation " + String(Math.max(0, side.artifactGeneration)) + " · " + side.artifactStatus;
        side.stateElement.dataset.status = side.runtimeFailed ? "error" : side.artifactStatus;
        side.stateElement.title = message;
        side.stateElement.setAttribute("aria-label", side.definition.label + ": " + message);
        side.statusTextElement.textContent = side.runtimeFailed ? "Runtime error" : side.artifactStatus;
      }

      async function loadSidecar(side) {
        if (!side.definition.sidecarUrl) return undefined;
        if (side.sidecar !== undefined) return side.sidecar;
        if (side.sidecarPromise) return side.sidecarPromise;
        const epoch = side.loadEpoch;
        const controller = new AbortController();
        side.sidecarAbort?.abort();
        side.sidecarAbort = controller;
        const promise = fetch(currentSidecarUrl(side), {cache: "no-store", signal: controller.signal})
          .then((response) => response.ok ? response.json() : Promise.reject(new Error("Compiler sidecar unavailable")))
          .then((document) => {
            if (side.loadEpoch !== epoch || controller.signal.aborted) return undefined;
            side.sidecar = document;
            if (selectedInspection?.side === side) renderInspection();
            return document;
          })
          .catch((error) => {
            if (error?.name !== "AbortError" && selectedInspection?.side === side) {
              sidecarOutput.textContent = "Unable to load compiler sidecar; reload or select the feature to retry.";
            }
            return undefined;
          })
          .finally(() => {
            if (side.sidecarPromise === promise) side.sidecarPromise = undefined;
            if (side.sidecarAbort === controller) side.sidecarAbort = undefined;
          });
        side.sidecarPromise = promise;
        return promise;
      }

      function currentSidecarUrl(side) {
        const configured = new URL(side.definition.sidecarUrl, location.href);
        const marker = "/__inspection/";
        const markerIndex = configured.pathname.lastIndexOf(marker);
        if (markerIndex < 0) return configured.href;
        const suffixParts = configured.pathname.slice(markerIndex + marker.length).split("/");
        const configuredMap = suffixParts[0];
        const configuredThemeFile = suffixParts[1];
        const configuredTheme = configuredThemeFile?.endsWith(".json") ? configuredThemeFile.slice(0, -5) : undefined;
        if (suffixParts.length !== 2 || !validPortableName(configuredMap) || !validPortableName(configuredTheme)) {
          return configured.href;
        }
        const metadata = side.map?.getStyle?.().metadata;
        const map = metadata?.["tileflow:map"];
        const theme = metadata?.["tileflow:theme"];
        if (!validPortableName(map) || !validPortableName(theme)) {
          return configured.href;
        }
        configured.pathname = configured.pathname.slice(0, markerIndex) + marker + map + "/" + theme + ".json";
        return configured.href;
      }

      function renderInspection() {
        if (!selectedInspection) return;
        const side = selectedInspection.side;
        const feature = selectedInspection.features[selectedInspection.featureIndex];
        inspectionOutput.replaceChildren();
        if (!feature) {
          inspectionOutput.className = "empty";
          inspectionOutput.textContent = side.definition.label + ": no rendered feature at this point.";
          curveProperty.disabled = true;
          curveOutput.className = "empty";
          curveOutput.textContent = "Paint and layout values appear here.";
          sidecarOutput.textContent = "No layer selected.";
          return;
        }
        inspectionOutput.className = "";
        const layer = side.map?.getStyle?.().layers?.find((candidate) => candidate.id === feature.layerId);
        const title = document.createElement("strong");
        title.textContent = side.definition.label + " · " + feature.layerId;
        const pickerLabel = document.createElement("label");
        pickerLabel.className = "feature-picker";
        pickerLabel.append(document.createTextNode("Rendered feature (" + selectedInspection.features.length + ")"));
        const picker = document.createElement("select");
        picker.setAttribute("aria-label", "Rendered feature at inspected point");
        selectedInspection.features.forEach((candidate, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = String(index + 1) + ". " + candidate.layerId + " · " + candidate.geometryType +
            (candidate.id === null ? "" : " · " + String(candidate.id));
          picker.append(option);
        });
        picker.value = String(selectedInspection.featureIndex);
        picker.addEventListener("change", () => {
          selectedInspection.featureIndex = boundedInteger(Number(picker.value), 0, selectedInspection.features.length - 1, 0);
          renderInspection();
        });
        pickerLabel.append(picker);
        const summary = document.createElement("pre");
        summary.textContent = boundedJson({
          coordinate: selectedInspection.coordinate,
          feature: {id: feature.id, geometryType: feature.geometryType, properties: feature.properties},
          layer: layer ? {
            id: layer.id,
            type: layer.type,
            source: layer.source,
            sourceLayer: layer["source-layer"],
            minzoom: layer.minzoom,
            maxzoom: layer.maxzoom,
            filter: layer.filter
          } : undefined
        });
        inspectionOutput.append(title, pickerLabel, summary);
        populateCurveProperties(layer);
        const sidecarLayer = findSidecarLayer(side.sidecar, feature.layerId);
        sidecarOutput.textContent = sidecarLayer
          ? boundedJson(sidecarLayerWithSemanticAttribution(sidecarLayer))
          : "No compiler sidecar entry for this layer.";
        if (side.sidecar === undefined && !side.sidecarPromise) void loadSidecar(side);
      }

      function populateCurveProperties(layer) {
        const previousValue = curveProperty.value;
        curveProperty.replaceChildren();
        if (!layer) {
          curveProperty.disabled = true;
          return;
        }
        const entries = [];
        for (const section of ["paint", "layout"]) {
          for (const name of Object.keys(layer[section] || {}).sort()) entries.push({section, name});
        }
        if (entries.length === 0) {
          curveProperty.disabled = true;
          curveOutput.textContent = "This layer has no paint or layout values.";
          return;
        }
        for (const entry of entries) {
          const option = document.createElement("option");
          option.value = entry.section + ":" + entry.name;
          option.textContent = entry.section + "." + entry.name;
          curveProperty.append(option);
        }
        if (Array.from(curveProperty.options).some((option) => option.value === previousValue)) {
          curveProperty.value = previousValue;
        }
        curveProperty.disabled = false;
        renderCurve();
      }

      function renderCurve() {
        if (!selectedInspection) return;
        const side = selectedInspection.side;
        const feature = selectedInspection.features[selectedInspection.featureIndex];
        if (!feature) return;
        const layer = side.map?.getStyle?.().layers?.find((candidate) => candidate.id === feature.layerId);
        const [section, name] = curveProperty.value.split(":");
        const raw = layer?.[section]?.[name];
        curveOutput.replaceChildren();
        if (raw === undefined) return;
        const maximumZoom = 24;
        const samples = Array.from({length: maximumZoom * 4 + 1}, (_, index) => {
          const zoom = index / 4;
          return {zoom, value: evaluateBasicZoomValue(raw, zoom)};
        });
        if (samples.some((sample) => sample.value === unsupportedValue)) {
          const pre = document.createElement("pre");
          pre.textContent = "Unsupported or data-driven expression; no approximate curve is shown.\\n" + boundedJson(raw);
          curveOutput.append(pre);
          return;
        }
        const currentZoom = boundedNumber(side.camera?.zoom ?? canonicalCamera?.zoom, 0, maximumZoom, 0);
        const currentValue = evaluateBasicZoomValue(raw, currentZoom);
        const meta = document.createElement("div");
        meta.className = "curve-meta";
        meta.textContent = "Current z" + formatNumber(currentZoom) + ": " + formatCurveValue(currentValue) + " · sampled every 0.25 zoom";
        curveOutput.append(meta);
        if (samples.every((sample) => typeof sample.value === "number" && Number.isFinite(sample.value))) {
          curveOutput.append(renderNumericCurve(samples, currentZoom));
          return;
        }
        if (samples.every((sample) => parseColor(sample.value))) {
          const strip = document.createElement("div");
          strip.className = "color-curve";
          for (const sample of samples) {
            const swatch = document.createElement("span");
            swatch.style.background = colorToCss(parseColor(sample.value));
            swatch.title = "z" + formatNumber(sample.zoom) + ": " + String(sample.value);
            strip.append(swatch);
          }
          curveOutput.append(strip);
          return;
        }
        const pre = document.createElement("pre");
        pre.textContent = samples.map((sample) => "z" + sample.zoom + "  " + String(sample.value)).join("\\n");
        curveOutput.append(pre);
      }

      const unsupportedValue = Symbol("unsupported");
      function evaluateBasicZoomValue(value, zoom) {
        if (!Array.isArray(value)) {
          return value && typeof value === "object" && ("stops" in value || "property" in value)
            ? unsupportedValue
            : value;
        }
        if (value[0] === "literal") return value[1];
        if (value[0] === "step" && isZoomInput(value[1])) {
          let output = value[2];
          for (let index = 3; index + 1 < value.length; index += 2) {
            if (zoom < value[index]) break;
            output = value[index + 1];
          }
          return evaluateBasicZoomValue(output, zoom);
        }
        if (value[0] === "interpolate" && isZoomInput(value[2])) {
          const stops = [];
          for (let index = 3; index + 1 < value.length; index += 2) stops.push([value[index], value[index + 1]]);
          if (!stops.length) return unsupportedValue;
          if (zoom <= stops[0][0]) return evaluateBasicZoomValue(stops[0][1], zoom);
          if (zoom >= stops.at(-1)[0]) return evaluateBasicZoomValue(stops.at(-1)[1], zoom);
          const upperIndex = stops.findIndex((stop) => zoom < stop[0]);
          const lower = stops[upperIndex - 1];
          const upper = stops[upperIndex];
          const interpolation = value[1];
          let base;
          if (Array.isArray(interpolation) && interpolation.length === 1 && interpolation[0] === "linear") {
            base = 1;
          } else if (
            Array.isArray(interpolation) && interpolation.length === 2 &&
            interpolation[0] === "exponential" && Number.isFinite(Number(interpolation[1])) &&
            Number(interpolation[1]) > 0
          ) {
            base = Number(interpolation[1]);
          } else {
            return unsupportedValue;
          }
          const progress = interpolationProgress(zoom, lower[0], upper[0], base);
          const from = evaluateBasicZoomValue(lower[1], zoom);
          const to = evaluateBasicZoomValue(upper[1], zoom);
          if (typeof from === "number" && typeof to === "number") return from + (to - from) * progress;
          const fromColor = parseColor(from);
          const toColor = parseColor(to);
          return fromColor && toColor ? colorToCss(fromColor.map((part, index) => part + (toColor[index] - part) * progress)) : unsupportedValue;
        }
        return unsupportedValue;
      }

      function isZoomInput(value) { return Array.isArray(value) && value.length === 1 && value[0] === "zoom"; }
      function interpolationProgress(value, lower, upper, base) {
        const distance = upper - lower;
        if (!distance) return 0;
        if (!Number.isFinite(base) || base === 1) return (value - lower) / distance;
        return (Math.pow(base, value - lower) - 1) / (Math.pow(base, distance) - 1);
      }

      function renderNumericCurve(samples, currentZoom) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "curve");
        svg.setAttribute("viewBox", "0 0 320 116");
        const values = samples.map((sample) => sample.value);
        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const span = maximum - minimum || 1;
        const points = samples.map((sample) => {
          const x = 10 + sample.zoom / 24 * 300;
          const y = 104 - (sample.value - minimum) / span * 92;
          return x.toFixed(2) + "," + y.toFixed(2);
        }).join(" ");
        const polyline = document.createElementNS(svg.namespaceURI, "polyline");
        polyline.setAttribute("points", points);
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", "#3157d5");
        polyline.setAttribute("stroke-width", "2");
        svg.append(polyline);
        const marker = document.createElementNS(svg.namespaceURI, "line");
        const markerX = 10 + currentZoom / 24 * 300;
        marker.setAttribute("x1", String(markerX));
        marker.setAttribute("x2", String(markerX));
        marker.setAttribute("y1", "8");
        marker.setAttribute("y2", "108");
        marker.setAttribute("stroke", "#ba3838");
        marker.setAttribute("stroke-width", "1.5");
        marker.setAttribute("stroke-dasharray", "3 3");
        svg.append(marker);
        const title = document.createElementNS(svg.namespaceURI, "title");
        title.textContent = "minimum " + minimum + ", maximum " + maximum + ", current zoom " + formatNumber(currentZoom);
        svg.append(title);
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", title.textContent);
        return svg;
      }

      async function loadSprites(side) {
        const epoch = side.loadEpoch;
        const sequence = ++spriteLoadSequence;
        spriteOwnerId = side.id;
        side.spriteAbort?.abort();
        const controller = new AbortController();
        side.spriteAbort = controller;
        spriteOutput.replaceChildren();
        const style = side.map?.getStyle?.();
        if (typeof style?.sprite !== "string") {
          spriteOutput.textContent = "The active style has no single served sprite atlas.";
          if (side.spriteAbort === controller) side.spriteAbort = undefined;
          return;
        }
        let base;
        try {
          base = new URL(style.sprite, side.frame.contentWindow.location.href);
        } catch {
          spriteOutput.textContent = "Invalid sprite URL.";
          if (side.spriteAbort === controller) side.spriteAbort = undefined;
          return;
        }
        if (!urlBelongsToSide(base, side)) {
          spriteOutput.textContent = "Only sprite atlases served by the active comparison side can be opened.";
          if (side.spriteAbort === controller) side.spriteAbort = undefined;
          return;
        }
        try {
          const atlasUrl = spriteAssetUrl(base, ".json");
          const imageUrl = spriteAssetUrl(base, ".png");
          const [atlasResponse, image] = await Promise.all([
            fetch(atlasUrl, {cache: "no-store", signal: controller.signal}),
            loadImage(imageUrl, controller.signal)
          ]);
          if (!atlasResponse.ok) throw new Error("Sprite metadata request failed");
          const atlas = await atlasResponse.json();
          if (
            controller.signal.aborted ||
            side.loadEpoch !== epoch ||
            sequence !== spriteLoadSequence ||
            activeSideId !== side.id
          ) return;
          const entries = Object.entries(atlas).sort(([left], [right]) => left.localeCompare(right)).slice(0, 256);
          for (const [name, item] of entries) {
            if (!validSpriteEntry(item, image)) continue;
            const card = document.createElement("div");
            card.className = "sprite-card";
            const canvas = document.createElement("canvas");
            const ratio = item.pixelRatio || 1;
            canvas.width = Math.max(1, Math.ceil(item.width / ratio));
            canvas.height = Math.max(1, Math.ceil(item.height / ratio));
            canvas.getContext("2d").drawImage(image, item.x, item.y, item.width, item.height, 0, 0, canvas.width, canvas.height);
            const label = document.createElement("span");
            label.className = "sprite-name";
            label.textContent = name;
            label.title = name;
            card.append(canvas, label);
            spriteOutput.append(card);
          }
          if (!spriteOutput.childElementCount) spriteOutput.textContent = "The atlas is empty.";
        } catch (error) {
          if (error?.name !== "AbortError" && sequence === spriteLoadSequence) {
            spriteOutput.textContent = "Unable to load the served sprite atlas: " + safeErrorMessage(error);
          }
        } finally {
          if (side.spriteAbort === controller) side.spriteAbort = undefined;
        }
      }

      function loadImage(url, signal) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          const cleanup = () => signal.removeEventListener("abort", handleAbort);
          const handleAbort = () => {
            image.src = "";
            cleanup();
            reject(new DOMException("Sprite image request aborted", "AbortError"));
          };
          image.onload = () => { cleanup(); resolve(image); };
          image.onerror = () => { cleanup(); reject(new Error("Sprite image request failed")); };
          if (signal.aborted) return handleAbort();
          signal.addEventListener("abort", handleAbort, {once: true});
          image.src = url;
        });
      }

      function urlBelongsToSide(url, side) {
        const basePath = side.definition.basePath;
        return url.origin === location.origin &&
          (url.pathname === basePath || url.pathname.startsWith(basePath + "/"));
      }

      function spriteAssetUrl(base, suffix) {
        const asset = new URL(base.href);
        asset.pathname += suffix;
        return asset.href;
      }

      function validSpriteEntry(value, image) {
        return value && [value.x, value.y, value.width, value.height].every(Number.isFinite) &&
          value.x >= 0 && value.y >= 0 && value.width > 0 && value.height > 0 &&
          value.x + value.width <= image.naturalWidth && value.y + value.height <= image.naturalHeight;
      }

      async function copyScene(commandOnly) {
        const name = sceneNameInput.value;
        if (!validPortableName(name)) {
          setFeedback("Use a portable kebab-case scene name.");
          return;
        }
        const side = states[activeSideId];
        const camera = side.camera || canonicalCamera;
        if (!camera) {
          setFeedback("Wait for the maps to become ready.");
          return;
        }
        const style = side.map?.getStyle?.();
        const map = style?.metadata?.["tileflow:map"];
        const theme = style?.metadata?.["tileflow:theme"];
        if (!validPortableName(map) || !validConcreteThemeName(theme)) {
          setFeedback("The active preview does not expose a concrete map and theme.");
          return;
        }
        const dpr = Number(sceneDprInput.value) === 2 ? 2 : 1;
        const viewport = readMapViewport(side, dpr);
        const {width, height} = viewport;
        if (commandOnly) {
          const command = [
            "tileflow capture",
            ...(side.definition.captureConfig
              ? ["--config " + quoteCliArgument(side.definition.captureConfig)]
              : []),
            "--map " + quoteCliArgument(map),
            "--theme " + quoteCliArgument(theme),
            "--center=" + formatNumber(camera.center[0]) + "," + formatNumber(camera.center[1]),
            "--zoom=" + formatNumber(camera.zoom),
            "--bearing=" + formatNumber(camera.bearing),
            "--pitch=" + formatNumber(camera.pitch),
            "--width=" + width,
            "--height=" + height,
            "--dpr=" + dpr,
            "--out=" + quoteCliArgument(name + ".png")
          ].join(" ");
          if (!await copyText(command)) {
            setFeedback("Clipboard access is unavailable.");
            return;
          }
          setFeedback("Exploratory capture command copied.");
          return;
        }
        const definition = {
          theme,
          camera: {
            type: "center",
            center: [roundNumber(camera.center[0]), roundNumber(camera.center[1])],
            zoom: roundNumber(camera.zoom),
            bearing: roundNumber(camera.bearing),
            pitch: roundNumber(camera.pitch)
          },
          viewport: {width, height, dpr},
          target: {kind: "map"}
        };
        const serialized = JSON.stringify(definition, null, 2).replace(/^/gm, "  ");
        if (!await copyText("'" + name + "': " + serialized.trimStart() + ",")) {
          setFeedback("Clipboard access is unavailable.");
          return;
        }
        setFeedback("Scene entry copied.");
      }

      function readMapViewport(side, dpr) {
        const container = side.map?.getContainer?.();
        const canvas = side.map?.getCanvas?.();
        const maximum = dpr === 2 ? 2048 : 4096;
        const width = boundedInteger(container?.clientWidth || canvas?.clientWidth, 64, maximum, 1280);
        const height = boundedInteger(container?.clientHeight || canvas?.clientHeight, 64, maximum, 800);
        return {width, height};
      }

      async function copyText(value) {
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch {
          const textarea = document.createElement("textarea");
          textarea.value = value;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.append(textarea);
          textarea.select();
          const copied = document.execCommand("copy");
          textarea.remove();
          return copied;
        }
      }

      function writeUrlState() {
        const url = new URL(location.href);
        url.searchParams.set("mode", stage.dataset.mode);
        url.searchParams.set("split", String(Math.round(Number(splitInput.value))));
        url.searchParams.set("alpha", String(Math.round(Number(alphaInput.value))));
        url.searchParams.set("driver", stage.dataset.driver);
        if (canonicalCamera) {
          const values = {
            lng: canonicalCamera.center[0], lat: canonicalCamera.center[1], zoom: canonicalCamera.zoom,
            bearing: canonicalCamera.bearing, pitch: canonicalCamera.pitch
          };
          for (const [name, value] of Object.entries(values)) url.searchParams.set(name, formatNumber(value));
        }
        history.replaceState(history.state, "", url.href);
      }

      function readUiFromUrl() {
        const query = new URL(location.href).searchParams;
        const modeValue = singleQueryValue(query, "mode");
        const mode = ["side-by-side", "split", "overlay", "blink"].includes(modeValue) ? modeValue : undefined;
        const driver = singleQueryValue(query, "driver");
        selectSide(driver === "right" ? "right" : "left", false);
        const split = singleQueryValue(query, "split");
        const alpha = singleQueryValue(query, "alpha");
        return {
          mode,
          split: split === undefined ? 50 : boundedNumber(Number(split), 5, 95, 50),
          alpha: alpha === undefined ? 50 : boundedNumber(Number(alpha), 0, 100, 50)
        };
      }

      function cameraFromUrl() {
        const query = new URL(location.href).searchParams;
        if (!["lng", "lat", "zoom", "bearing", "pitch"].every((name) => query.getAll(name).length === 1)) return undefined;
        const camera = {
          center: [Number(query.get("lng")), Number(query.get("lat"))],
          zoom: Number(query.get("zoom")), bearing: Number(query.get("bearing")), pitch: Number(query.get("pitch"))
        };
        return validCamera(camera) ? camera : undefined;
      }

      function readMapCamera(map) {
        const center = map.getCenter();
        return {
          center: [wrapLongitude(center.lng), center.lat], zoom: map.getZoom(),
          bearing: map.getBearing(), pitch: map.getPitch()
        };
      }

      function validCamera(camera) {
        return camera && Array.isArray(camera.center) && camera.center.length === 2 &&
          camera.center.every(Number.isFinite) && camera.center[0] >= -180 && camera.center[0] <= 180 &&
          camera.center[1] >= -90 && camera.center[1] <= 90 && Number.isFinite(camera.zoom) &&
          camera.zoom >= 0 && camera.zoom <= 24 && Number.isFinite(camera.bearing) &&
          camera.bearing >= -180 && camera.bearing <= 180 && Number.isFinite(camera.pitch) &&
          camera.pitch >= 0 && camera.pitch <= 85;
      }

      function projectFeature(feature) {
        return {
          layerId: String(feature.layer?.id || "").slice(0, 256),
          id: ["number", "string"].includes(typeof feature.id) ? feature.id : null,
          geometryType: String(feature.geometry?.type || "Unknown").slice(0, 32),
          properties: sanitizeProperties(feature.properties)
        };
      }

      function sanitizeProperties(input) {
        const result = {};
        for (const key of Object.keys(input || {}).sort().slice(0, 64)) {
          if (key.length > 128) continue;
          const value = input[key];
          if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) result[key] = value;
          else if (typeof value === "string") result[key] = value.slice(0, 512);
        }
        return result;
      }

      function findSidecarLayer(document, layerId) {
        const layers = document?.layers;
        if (Array.isArray(layers)) return layers.find((layer) => layer?.id === layerId || layer?.layerId === layerId);
        if (layers && typeof layers === "object") return layers[layerId];
        return undefined;
      }

      function sidecarLayerWithSemanticAttribution(layer) {
        // Sidecar v1 proves semantic provenance, not token provenance. Keep explicit
        // tokens when present, but never infer them by matching compiled values.
        const contributions = Array.isArray(layer?.contributions) ? layer.contributions : [];
        const semanticAttribution = contributions.flatMap((contribution) => {
          const semanticOwner = typeof contribution?.owner === "string" ? contribution.owner : undefined;
          const semanticTarget = typeof contribution?.target === "string" ? contribution.target : undefined;
          if (!semanticOwner || !semanticTarget) return [];
          const effects = Array.isArray(contribution.effects) ? contribution.effects : [];
          const authoringPaths = [...new Set([
            "modules." + semanticOwner,
            ...causalStringArray(contribution.authoringPaths),
            ...effects.flatMap((effect) =>
              (effect?.kind === "add" || effect?.kind === "patch") && typeof effect.target === "string"
                ? ["compilerEffects." + effect.target + "." + effect.kind]
                : []
            )
          ])];
          const themeTokens = causalArray(contribution.themeTokens);
          return [{
            semanticOwner,
            semanticTarget,
            authoringPaths,
            ...(themeTokens.length > 0 ? {themeTokens} : {})
          }];
        });
        return {...layer, semanticAttribution};
      }

      function causalStringArray(value) {
        return causalArray(value).filter((entry) => typeof entry === "string");
      }

      function causalArray(value) {
        return Array.isArray(value) ? value.slice(0, 64) : [];
      }

      function markSideRuntimeError(side, input) {
        const message = sanitizeRuntimeMessage(safeErrorMessage(input));
        if (!side.runtimeErrors.includes(message)) side.runtimeErrors.push(message);
        side.runtimeErrors = side.runtimeErrors.slice(-16);
        side.runtimeFailed = true;
        renderSideStatus(side);
        updateDocumentReadiness();
      }

      function sanitizeRuntimeMessage(value) {
        return String(value).replace(/https?:\\/\\/[^\\s)]+/gu, (url) => {
          try { return new URL(url).origin; } catch { return "[url]"; }
        }).slice(0, 512);
      }

      function parseColor(value) {
        if (typeof value !== "string") return undefined;
        const hex = /^#([a-f\\d]{3}|[a-f\\d]{6}|[a-f\\d]{8})$/iu.exec(value);
        if (hex) {
          let digits = hex[1];
          if (digits.length === 3) digits = digits.split("").map((part) => part + part).join("");
          const alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
          return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16), alpha];
        }
        const rgb = /^rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)$/iu.exec(value);
        return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])] : undefined;
      }

      function colorToCss(color) {
        return "rgba(" + color.slice(0, 3).map((part) => Math.round(part)).join(",") + "," + Math.max(0, Math.min(1, color[3])) + ")";
      }

      function boundedJson(value) {
        let result;
        try { result = JSON.stringify(value, null, 2); } catch { result = "[unserializable]"; }
        if (typeof result !== "string") result = String(value);
        return result.length > 12_000 ? result.slice(0, 12_000) + "\\n…" : result;
      }
      function camerasEqual(left, right) {
        return Boolean(left && right) &&
          Math.abs(left.center[0] - right.center[0]) < 1e-7 &&
          Math.abs(left.center[1] - right.center[1]) < 1e-7 &&
          Math.abs(left.zoom - right.zoom) < 1e-7 &&
          Math.abs(left.bearing - right.bearing) < 1e-7 &&
          Math.abs(left.pitch - right.pitch) < 1e-7;
      }
      function formatCurveValue(value) {
        if (typeof value === "number" && Number.isFinite(value)) return formatNumber(value);
        return typeof value === "string" ? value : boundedJson(value);
      }
      function singleQueryValue(query, name) {
        const values = query.getAll(name);
        return values.length === 1 ? values[0] : undefined;
      }
      function validPortableName(value) {
        return typeof value === "string" &&
          /^[a-z][a-z0-9-]{0,63}$/u.test(value) &&
          value !== "constructor" && value !== "prototype" &&
          !/^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])$/u.test(value);
      }
      function validConcreteThemeName(value) { return validPortableName(value) && value !== "system"; }
      function quoteCliArgument(value) {
        if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
        const quote = String.fromCharCode(39);
        const escapedQuote = quote + '"' + quote + '"' + quote;
        return quote + value.replaceAll(quote, escapedQuote) + quote;
      }
      function safeErrorMessage(error) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
      function boundedNumber(value, minimum, maximum, fallback) { return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback; }
      function boundedInteger(value, minimum, maximum, fallback) { return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback; }
      function roundNumber(value) { return Number(value.toFixed(6)); }
      function formatNumber(value) { return String(roundNumber(value)); }
      function wrapLongitude(value) { return ((value + 180) % 360 + 360) % 360 - 180; }
      function setFeedback(value) { feedback.textContent = value; setTimeout(() => { if (feedback.textContent === value) feedback.textContent = ""; }, 2500); }
    </script>
  </body>
</html>`;
}

function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/gu,
    (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
