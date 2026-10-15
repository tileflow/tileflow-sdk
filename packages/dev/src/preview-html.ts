import type {TileflowStyleFontFace} from '@tileflow/core';
import {
  normalizeTileflowLandmarkManifest,
  readBoundedTileflowJsonResponse,
  readBoundedTileflowResponse,
} from './landmarks';
import type {ResolvedTileflowPreview} from './preview';

export function renderTileflowPreviewHtml(
  preview: ResolvedTileflowPreview | undefined,
  basePath: string,
  initialStatus: unknown,
  isSemanticPreview: boolean,
  fontFaces: readonly TileflowStyleFontFace[] = [],
  fitViewport = false,
): string {
  const styleUrl = preview
    ? `${basePath}/styles/${preview.mapName}/${preview.themeName}.json`
    : undefined;
  const mapOptions = preview ? previewMapOptions(preview) : undefined;
  const viewportCss =
    preview?.viewport && !fitViewport
      ? `
      html, body { min-height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        overflow: auto;
        background: #E8E5DE;
      }
      #map {
        width: ${preview.viewport.width}px;
        height: ${preview.viewport.height}px;
        box-shadow: 0 24px 80px rgba(37, 34, 29, 0.18);
      }`
      : 'html, body, #map { height: 100%; margin: 0; }';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tileflow Preview</title>
    <link rel="stylesheet" href="${basePath}/__runtime/maplibre-gl.css" />
    <style>
      ${viewportCss}
      body { font-family: ui-sans-serif, system-ui, sans-serif; }
      #map {
        background-color: var(--tileflow-space, #2F5070);
        background-image:
          radial-gradient(circle at 18% 24%, rgba(225, 240, 250, 0.34) 0 1px, transparent 1.4px),
          radial-gradient(circle at 72% 62%, rgba(225, 240, 250, 0.22) 0 1px, transparent 1.3px),
          radial-gradient(circle at 42% 78%, rgba(225, 240, 250, 0.18) 0 0.8px, transparent 1.2px);
        background-position: 0 0, 37px 71px, 113px 29px;
        background-size: 173px 149px, 257px 211px, 337px 283px;
      }
      #map.tileflow-globe {
        position: relative;
        background-image:
          radial-gradient(circle at 18% 24%, rgba(225, 240, 250, 0.34) 0 1px, transparent 1.4px),
          radial-gradient(circle at 72% 62%, rgba(225, 240, 250, 0.22) 0 1px, transparent 1.3px),
          radial-gradient(circle at 42% 78%, rgba(225, 240, 250, 0.18) 0 0.8px, transparent 1.2px);
      }
      #map.tileflow-globe .maplibregl-canvas {
        filter: var(--tileflow-globe-rim, none);
      }
      #map.tileflow-globe > .maplibregl-canvas-container {
        position: relative;
        z-index: 1;
      }
      .badge {
        display: none;
        position: fixed;
        left: 16px;
        top: 16px;
        z-index: 1;
        border-radius: 8px;
        background: rgba(246, 247, 243, 0.92);
        border: 1px solid rgba(60, 64, 67, 0.12);
        color: #3C4043;
        padding: 10px 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
      }
      .status {
        position: fixed;
        left: 16px;
        right: 16px;
        bottom: 16px;
        z-index: 2;
        display: none;
        max-width: 720px;
        border: 1px solid rgba(160, 46, 46, 0.35);
        border-radius: 8px;
        background: rgba(255, 244, 244, 0.96);
        color: #702020;
        padding: 12px;
        white-space: pre-wrap;
      }
      .maplibregl-ctrl-group .tileflow-3d-toggle,
      .maplibregl-ctrl-group .tileflow-tree-toggle,
      .maplibregl-ctrl-group .tileflow-theme-toggle {
        width: auto;
        min-width: 58px;
        padding: 0 9px;
        color: #3C4043;
        font: 700 11px/29px ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.02em;
      }
      .maplibregl-ctrl-group .tileflow-3d-toggle[aria-pressed="true"],
      .maplibregl-ctrl-group .tileflow-tree-toggle[aria-pressed="true"] {
        background-color: #E8F0FE;
        color: #174EA6;
      }
      .maplibregl-ctrl-group .tileflow-3d-toggle:hover,
      .maplibregl-ctrl-group .tileflow-tree-toggle:hover,
      .maplibregl-ctrl-group .tileflow-theme-toggle:hover {
        background-color: #F1F3F4;
      }
      .maplibregl-ctrl-group { background:#faf6eb; border:1px solid #e0d5c4; border-radius:3px; box-shadow:0 3px 12px #30251f18; }
      .maplibregl-ctrl-group button { color:#30251f; }
      .maplibregl-ctrl-group button + button { border-top-color:#e0d5c4; }
      .maplibregl-ctrl-group .tileflow-3d-toggle,.maplibregl-ctrl-group .tileflow-tree-toggle,.maplibregl-ctrl-group .tileflow-theme-toggle { color:#30251f; font-weight:500; }
      .maplibregl-ctrl-group .tileflow-3d-toggle[aria-pressed="true"],.maplibregl-ctrl-group .tileflow-tree-toggle[aria-pressed="true"] { background:#f0dfe0; color:#8c2e3f; }
      .maplibregl-ctrl-group .tileflow-3d-toggle:hover,.maplibregl-ctrl-group .tileflow-tree-toggle:hover,.maplibregl-ctrl-group .tileflow-theme-toggle:hover { background:#eee4d3; }
    </style>
  </head>
  <body>
    <div class="badge" id="badge">Tileflow preview</div>
    <div class="status" id="status" role="status"></div>
    <div id="map"></div>
    <script type="importmap">{"imports":{"fflate":"${basePath}/__runtime/fflate.js","three":"${basePath}/__runtime/three.module.js"}}</script>
    <script type="module">
      import * as maplibregl from "${basePath}/__runtime/maplibre-gl.mjs";
      import {loadTileflowStyleFonts} from "${basePath}/__runtime/tileflow-browser.js";
      import {registerTileflowContourProtocol} from "${basePath}/__runtime/tileflow-browser.js";
      import {registerTileflowPmtilesProtocol} from "${basePath}/__runtime/tileflow-browser.js";
      import {createTileflowBuildings3D, createTileflowStreetLights, createTileflowTrees3D} from "${basePath}/__runtime/tileflow-browser.js";
      import {readTileflowSunPreset, resolveTileflowSun, tileflowDefaultSunPreset} from "${basePath}/__runtime/tileflow-browser.js";

      maplibregl.setWorkerUrl("${basePath}/__runtime/maplibre-gl-worker.mjs");

      const initialStatus = ${JSON.stringify(initialStatus)};
      const normalizeTileflowLandmarkManifest = ${normalizeTileflowLandmarkManifest.toString()};
      const readBoundedTileflowResponse = ${readBoundedTileflowResponse.toString()};
      const readBoundedTileflowJsonResponse = ${readBoundedTileflowJsonResponse.toString()};
      const initialGeneration = initialStatus.generation;
      document.documentElement.dataset.tileflowArtifactGeneration = String(initialStatus.lastGoodGeneration ?? initialGeneration);
      const badge = document.getElementById("badge");
      const status = document.getElementById("status");
      const previewLabel = ${JSON.stringify(preview?.label)};
      const styleUrl = ${JSON.stringify(styleUrl)};
      const previewMapOptions = ${JSON.stringify(mapOptions)};
      const previewTheme = ${serializeInlineJson(preview?.themeName ?? null)};
      const previewThemes = ${serializeInlineJson(preview?.themeNames ?? [])};
      const isSemanticPreview = ${JSON.stringify(isSemanticPreview)};
      const previewFontFaces = ${serializeInlineJson(fontFaces)};
      const previewSearchParameters = new URL(location.href).searchParams;
      const mapBenchmarkEnabled = previewSearchParameters.get("mapBenchmark") === "1";
      const mapSweepEnabled = previewSearchParameters.get("mapSweep") === "1";
      const mapCompareEnabled = previewSearchParameters.get("mapCompare") === "1";
      const requestedMapCompareLimit = Number(previewSearchParameters.get("mapCompareLimit"));
      const mapCompareLimit =
        Number.isInteger(requestedMapCompareLimit) &&
        requestedMapCompareLimit >= 1 &&
        requestedMapCompareLimit <= 64
          ? requestedMapCompareLimit
          : 16;
      const requestedMapWorkerCount = Number(previewSearchParameters.get("mapWorkers"));
      const mapWorkerCountOverride =
        Number.isInteger(requestedMapWorkerCount) &&
        requestedMapWorkerCount >= 1 &&
        requestedMapWorkerCount <= 3
          ? requestedMapWorkerCount
          : undefined;
      const mapBenchmarkLongitude = Number(previewSearchParameters.get("lng"));
      const mapBenchmarkLatitude = Number(previewSearchParameters.get("lat"));
      const mapBenchmarkCenter =
        previewSearchParameters.has("lng") &&
        previewSearchParameters.has("lat") &&
        Number.isFinite(mapBenchmarkLongitude) &&
        Number.isFinite(mapBenchmarkLatitude)
          ? [mapBenchmarkLongitude, mapBenchmarkLatitude]
          : undefined;
      function readToggleFromUrl(name, fallback) {
        const values = previewSearchParameters.getAll(name);
        if (values.length !== 1) return fallback;
        if (values[0] === "on") return true;
        if (values[0] === "off") return false;
        return fallback;
      }
      let threeDimensionalEnabled = readToggleFromUrl("buildings3d", false);
      let treesEnabled = readToggleFromUrl("trees3d", false);
      const landmarkState = {
        active: [],
        cacheLimit: undefined,
        enabled: threeDimensionalEnabled,
        manifestId: undefined,
        loaded: [],
        loading: [],
        errors: []
      };
      globalThis.__tileflowLandmarkState = landmarkState;
      const buildingWireframeMetrics = {
        buildingCount: 0,
        refreshMilliseconds: undefined,
        segmentCount: 0,
        truncated: false
      };
      globalThis.__tileflowBuildingWireframeMetrics = buildingWireframeMetrics;
      let THREE;
      let GLTFLoader;
      let DRACOLoader;
      let MeshoptDecoder;
      let LineMaterial;
      let LineSegments2;
      let LineSegmentsGeometry;
      let PMTiles;
      let FetchSource;
      let landmarkDracoLoader;
      let threeCoreRuntimePromise;
      let buildingWireframeRuntimePromise;
      let landmarkRuntimePromise;
      let pmtilesRuntimePromise;
      const landmarkManifestPromises = new Map();
      const landmarkManifestMaximumBytes = 1024 * 1024;
      const landmarkManifestTimeoutMs = 10000;

      function loadThreeCoreRuntime() {
        if (!threeCoreRuntimePromise) {
          threeCoreRuntimePromise = import("${basePath}/__runtime/three.module.js").then(
            (threeModule) => {
              THREE = threeModule;
            }
          );
        }
        return threeCoreRuntimePromise;
      }

      function loadBuildingWireframeRuntime() {
        if (!buildingWireframeRuntimePromise) {
          buildingWireframeRuntimePromise = Promise.all([
            loadThreeCoreRuntime(),
            import("${basePath}/__runtime/three-addons/lines/LineMaterial.js"),
            import("${basePath}/__runtime/three-addons/lines/LineSegments2.js"),
            import("${basePath}/__runtime/three-addons/lines/LineSegmentsGeometry.js")
          ]).then(([, lineMaterialModule, lineSegmentsModule, lineGeometryModule]) => {
            LineMaterial = lineMaterialModule.LineMaterial;
            LineSegments2 = lineSegmentsModule.LineSegments2;
            LineSegmentsGeometry = lineGeometryModule.LineSegmentsGeometry;
          });
        }
        return buildingWireframeRuntimePromise;
      }

      function loadLandmarkRuntime() {
        if (!landmarkRuntimePromise) {
          landmarkRuntimePromise = Promise.all([
            loadThreeCoreRuntime(),
            import("${basePath}/__runtime/three-addons/loaders/GLTFLoader.js"),
            import("${basePath}/__runtime/three-addons/loaders/DRACOLoader.js"),
            import("${basePath}/__runtime/three-addons/libs/meshopt_decoder.module.js"),
            loadPmtilesRuntime()
          ]).then(([, gltfLoaderModule, dracoLoaderModule, meshoptDecoderModule, pmtilesModule]) => {
            GLTFLoader = gltfLoaderModule.GLTFLoader;
            DRACOLoader = dracoLoaderModule.DRACOLoader;
            MeshoptDecoder = meshoptDecoderModule.MeshoptDecoder;
            PMTiles = pmtilesModule.PMTiles;
            FetchSource = pmtilesModule.FetchSource;
            landmarkDracoLoader = new DRACOLoader()
              .setDecoderPath("${basePath}/__runtime/three-addons/libs/draco/gltf/")
              .setDecoderConfig({type: "wasm"});
            landmarkDracoLoader.preload();
          });
        }
        return landmarkRuntimePromise;
      }

      function loadPmtilesRuntime() {
        if (!pmtilesRuntimePromise) {
          pmtilesRuntimePromise = import("${basePath}/__runtime/pmtiles.js").then((pmtilesModule) => {
            PMTiles = pmtilesModule.PMTiles;
            FetchSource = pmtilesModule.FetchSource;
            return pmtilesModule;
          });
        }
        return pmtilesRuntimePromise;
      }

      function waitForLandmarkManifest(promise, signal) {
        if (!signal) return promise;
        if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
        return new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          signal.addEventListener("abort", abort, {once: true});
          promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        });
      }

      function loadLandmarkManifestCandidate(manifestUrl, signal) {
        const existing = landmarkManifestPromises.get(manifestUrl);
        if (existing) return waitForLandmarkManifest(existing, signal);
        const resolvedUrl = new URL(manifestUrl, location.href);
        if (
          !["http:", "https:"].includes(resolvedUrl.protocol) ||
          resolvedUrl.username ||
          resolvedUrl.password
        ) throw new Error("invalid landmark manifest URL");
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), landmarkManifestTimeoutMs);
        const pending = (async () => {
          try {
            const response = await fetch(resolvedUrl, {
              credentials: "include",
              signal: controller.signal
            });
            if (!response.ok) throw new Error("HTTP " + response.status);
            return readBoundedTileflowJsonResponse(response, landmarkManifestMaximumBytes);
          } finally {
            clearTimeout(timeout);
          }
        })();
        landmarkManifestPromises.set(manifestUrl, pending);
        pending.catch(() => {
          if (landmarkManifestPromises.get(manifestUrl) === pending) {
            landmarkManifestPromises.delete(manifestUrl);
          }
        });
        return waitForLandmarkManifest(pending, signal);
      }

      function loadLandmarkPrerequisites(manifestUrl, signal) {
        return Promise.all([
          loadLandmarkRuntime(),
          loadLandmarkManifestCandidate(manifestUrl, signal)
        ]);
      }

      function percentile(values, percentileValue) {
        if (values.length === 0) return undefined;
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
      }

      function installMapBenchmark(map) {
        if (!mapBenchmarkEnabled) return;
        let activeRun;
        const metrics = {
          activeLayers: 0,
          bucketCount: 0,
          bucketTypes: {},
          errors: [],
          frameMaximumMilliseconds: 0,
          frameP95Milliseconds: 0,
          frames: 0,
          idleMilliseconds: 0,
          layerTypes: {},
          renderedFeatures: 0,
          resourceCount: 0,
          resourceDecodedBytes: 0,
          resourceDurationMaximumMilliseconds: 0,
          resourceEncodedBytes: 0,
          resourceServerTiming: {},
          resourceTransferBytes: 0,
          requestedZoom: map.getZoom(),
          sourceDataEvents: 0,
          timedOut: false,
          visibleDecodedTileBytes: 0,
          visibleTileCoordinates: [],
          visibleTiles: 0,
          zoom: map.getZoom()
        };

        function inspectRenderBuckets() {
          const tileManagers = map.style?.tileManagers || {};
          const bucketTypes = {};
          const coordinates = new Map();
          const resourceTiming = [];
          const visitedTiles = new Set();
          let bucketCount = 0;
          let visibleDecodedTileBytes = 0;
          for (const [sourceId, tileManager] of Object.entries(tileManagers)) {
            const tiles = tileManager?._inViewTiles?.getAllTiles?.() || [];
            for (const tile of tiles) {
              const tileKey = sourceId + ":" + (tile.uid ?? tile.tileID?.key);
              if (visitedTiles.has(tileKey)) continue;
              visitedTiles.add(tileKey);
              const buckets = Object.values(tile.buckets || {});
              bucketCount += buckets.length;
              for (const bucket of buckets) {
                const type = bucket?.type || bucket?.constructor?.name || "unknown";
                bucketTypes[type] = (bucketTypes[type] || 0) + 1;
              }
              visibleDecodedTileBytes += tile.latestRawTileData?.byteLength || 0;
              if (tile.resourceTiming) resourceTiming.push(...tile.resourceTiming);
              const canonical = tile.tileID?.canonical;
              if (canonical && canonical.z <= 24) {
                const coordinate = {z: canonical.z, x: canonical.x, y: canonical.y};
                coordinates.set(coordinate.z + "/" + coordinate.x + "/" + coordinate.y, coordinate);
              }
            }
          }
          return {
            bucketCount,
            bucketTypes,
            resourceTiming,
            visibleDecodedTileBytes,
            visibleTileCoordinates: [...coordinates.values()],
            visibleTiles: visitedTiles.size
          };
        }

        function uniqueResources(resources) {
          const unique = new Map();
          for (const resource of resources) {
            const key = [
              resource.name,
              resource.startTime,
              resource.encodedBodySize,
              resource.decodedBodySize
            ].join("|");
            unique.set(key, resource);
          }
          return [...unique.values()];
        }

        function summarizeServerTiming(resources) {
          const totals = {};
          for (const resource of resources) {
            for (const timing of resource.serverTiming || []) {
              const current = totals[timing.name] || {count: 0, maximumMilliseconds: 0, totalMilliseconds: 0};
              current.count += 1;
              current.maximumMilliseconds = Math.max(current.maximumMilliseconds, timing.duration || 0);
              current.totalMilliseconds += timing.duration || 0;
              totals[timing.name] = current;
            }
          }
          for (const timing of Object.values(totals)) {
            timing.averageMilliseconds = timing.count ? timing.totalMilliseconds / timing.count : 0;
          }
          return totals;
        }

        function sampleMapFrame(frameTime) {
          if (activeRun) {
            if (activeRun.previousFrameTime !== undefined) {
              activeRun.frameSamples.push(frameTime - activeRun.previousFrameTime);
            }
            activeRun.previousFrameTime = frameTime;
          }
          requestAnimationFrame(sampleMapFrame);
        }

        map.on("sourcedata", (event) => {
          if (!activeRun) return;
          activeRun.sourceDataEvents += 1;
          if (event.resourceTiming) activeRun.workerResources.push(...event.resourceTiming);
        });
        map.on("error", (event) => {
          if (!activeRun) return;
          const message = String(event?.error?.message || event?.message || "MapLibre error");
          if (!activeRun.errors.includes(message) && activeRun.errors.length < 8) {
            activeRun.errors.push(message);
          }
        });
        requestAnimationFrame(sampleMapFrame);

        function finishMapBenchmark(run, timedOut, resolve) {
          if (activeRun !== run) return;
          activeRun = undefined;
          clearTimeout(run.timeout);
          map.off("idle", run.handleIdle);
          const zoom = map.getZoom();
          const styleLayers = map.getStyle()?.layers || [];
          const activeLayers = styleLayers.filter((layer) =>
            (layer.minzoom === undefined || layer.minzoom <= zoom) &&
            (layer.maxzoom === undefined || zoom < layer.maxzoom) &&
            layer.layout?.visibility !== "none"
          );
          const layerTypes = {};
          for (const layer of activeLayers) {
            layerTypes[layer.type] = (layerTypes[layer.type] || 0) + 1;
          }
          const renderState = inspectRenderBuckets();
          const {resourceTiming, ...renderMetrics} = renderState;
          const resources = uniqueResources([
            ...performance.getEntriesByType("resource").filter(
              (entry) => entry.startTime >= run.startedAt
            ),
            ...run.workerResources,
            ...resourceTiming
          ]);
          const frameP95 = percentile(run.frameSamples, 0.95) || 0;
          Object.assign(metrics, {
            activeLayers: activeLayers.length,
            errors: run.errors,
            frameMaximumMilliseconds: Math.max(0, ...run.frameSamples),
            frameP95Milliseconds: frameP95,
            frames: run.frameSamples.length,
            idleMilliseconds: performance.now() - run.startedAt,
            layerTypes,
            renderedFeatures: map.queryRenderedFeatures().length,
            resourceCount: resources.length,
            resourceDecodedBytes: resources.reduce(
              (total, entry) => total + (entry.decodedBodySize || 0),
              0
            ),
            resourceDurationMaximumMilliseconds: Math.max(
              0,
              ...resources.map((entry) => entry.duration || 0)
            ),
            resourceEncodedBytes: resources.reduce(
              (total, entry) => total + (entry.encodedBodySize || 0),
              0
            ),
            resourceServerTiming: summarizeServerTiming(resources),
            resourceTransferBytes: resources.reduce(
              (total, entry) => total + (entry.transferSize || 0),
              0
            ),
            requestedZoom: run.requestedZoom,
            sourceDataEvents: run.sourceDataEvents,
            timedOut,
            ...renderMetrics,
            zoom
          });
          resolve({...metrics});
        }

        function settleZoom(zoom) {
          if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) {
            return Promise.reject(new Error("Benchmark zoom must be between 0 and 22."));
          }
          if (activeRun) {
            return Promise.reject(new Error("A map benchmark run is already active."));
          }
          return new Promise((resolve) => {
            const run = {
              errors: [],
              frameSamples: [],
              handleIdle: undefined,
              previousFrameTime: undefined,
              requestedZoom: zoom,
              sourceDataEvents: 0,
              startedAt: performance.now(),
              timeout: undefined,
              workerResources: []
            };
            run.handleIdle = () => requestAnimationFrame(() =>
              requestAnimationFrame(() => finishMapBenchmark(run, false, resolve))
            );
            run.timeout = setTimeout(() => finishMapBenchmark(run, true, resolve), 12000);
            activeRun = run;
            map.on("idle", run.handleIdle);
            map.jumpTo({
              ...(mapBenchmarkCenter ? {center: mapBenchmarkCenter} : {}),
              zoom
            });
          });
        }

        function resolveTileTemplate(template, coordinate) {
          return template
            .replace("{z}", String(coordinate.z))
            .replace("{x}", String(coordinate.x))
            .replace("{y}", String(coordinate.y))
            .replace("{-y}", String((2 ** coordinate.z) - coordinate.y - 1));
        }

        async function digest(bytes) {
          const hash = await crypto.subtle.digest("SHA-256", bytes);
          return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        }

        async function fetchComparableTile(url, credentials) {
          const comparisonTileMaximumBytes = 16 * 1024 * 1024;
          const startedAt = performance.now();
          const response = await fetch(url, {cache: "no-store", credentials});
          if (!response.ok) throw new Error("Tile comparison request failed (" + response.status + "): " + url);
          const encodedHeaderValue =
            response.headers.get("x-tileflow-compressed-bytes") ||
            response.headers.get("content-length");
          const encodedHeader = encodedHeaderValue === null
            ? undefined
            : Number(encodedHeaderValue);
          const bytes = await readBoundedTileflowResponse(
            response,
            comparisonTileMaximumBytes
          );
          const contentEncoding = response.headers.get("content-encoding");
          return {
            archive: response.headers.get("x-tileflow-archive") || undefined,
            compressed: contentEncoding?.includes("gzip") || false,
            contentEncoding: contentEncoding || undefined,
            contentLength: Number.isFinite(encodedHeader) ? encodedHeader : undefined,
            decodedBytes: bytes.byteLength,
            decodedSha256: await digest(bytes),
            durationMilliseconds: performance.now() - startedAt,
            encodedBytes: Number.isFinite(encodedHeader) ? encodedHeader : undefined,
            url
          };
        }

        async function compareRemote(options = {}) {
          const requestedLimit = Number(options.limit ?? 16);
          const limit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 64
            ? requestedLimit
            : 16;
          const source = Object.values(map.getStyle()?.sources || {}).find(
            (candidate) => candidate.type === "vector" && candidate.url?.includes("/tiles.json")
          );
          if (!source?.url) throw new Error("No vector TileJSON source is active in the map.");
          const localTileJsonUrl = new URL(source.url, location.href);
          const comparisonUrl = new URL("/comparison.json", localTileJsonUrl);
          const contractResponse = await fetch(comparisonUrl, {cache: "no-store"});
          if (!contractResponse.ok) throw new Error("The local comparison contract is unavailable.");
          const contract = await readBoundedTileflowJsonResponse(contractResponse, 64 * 1024);
          const remoteTileJsonUrl = options.remoteTileJson || contract.remoteTileJson;
          if (!remoteTileJsonUrl) throw new Error("No remote TileJSON comparison target is configured.");
          const remoteTileJsonResponse = await fetch(remoteTileJsonUrl, {
            cache: "no-store",
            credentials: "include"
          });
          if (!remoteTileJsonResponse.ok) {
            throw new Error("Remote TileJSON request failed (" + remoteTileJsonResponse.status + ").");
          }
          const remoteTileJson = await readBoundedTileflowJsonResponse(
            remoteTileJsonResponse,
            256 * 1024
          );
          const remoteTemplate = remoteTileJson.tiles?.[0];
          if (!remoteTemplate) throw new Error("Remote TileJSON has no tile template.");
          const coordinates = inspectRenderBuckets().visibleTileCoordinates.slice(0, limit);
          if (coordinates.length === 0) throw new Error("No visible vector tiles are available to compare.");

          const perTile = [];
          for (const coordinate of coordinates) {
            const localUrl = resolveTileTemplate(contract.localTileTemplate, coordinate);
            const remoteUrl = resolveTileTemplate(remoteTemplate, coordinate);
            const [local, remote] = await Promise.all([
              fetchComparableTile(localUrl, "omit"),
              fetchComparableTile(remoteUrl, "include")
            ]);
            perTile.push({
              coordinate,
              identicalDecodedPayload: local.decodedSha256 === remote.decodedSha256,
              local,
              remote
            });
          }
          const sum = (side, field) => perTile.reduce(
            (total, tile) => total + (tile[side][field] || 0),
            0
          );
          const identicalTiles = perTile.filter((tile) => tile.identicalDecodedPayload).length;
          return {
            archive: contract.archive,
            identicalDecodedPercent: (identicalTiles / perTile.length) * 100,
            identicalDecodedTiles: identicalTiles,
            local: {
              decodedBytes: sum("local", "decodedBytes"),
              encodedBytes: sum("local", "encodedBytes"),
              durationMilliseconds: sum("local", "durationMilliseconds")
            },
            perTile,
            remote: {
              decodedBytes: sum("remote", "decodedBytes"),
              encodedBytes: sum("remote", "encodedBytes"),
              durationMilliseconds: sum("remote", "durationMilliseconds"),
              tileJson: remoteTileJsonUrl
            },
            tilesCompared: perTile.length
          };
        }

        globalThis.__tileflowMapBenchmark = {compareRemote, metrics, settleZoom};
        if (mapCompareEnabled) {
          document.body.dataset.tileflowMapCompareStatus = "running";
          const handleInitialMapCompareIdle = async () => {
            map.off("idle", handleInitialMapCompareIdle);
            try {
              document.body.dataset.tileflowMapCompare = JSON.stringify(
                await compareRemote({limit: mapCompareLimit})
              );
              document.body.dataset.tileflowMapCompareStatus = "complete";
            } catch (error) {
              document.body.dataset.tileflowMapCompare = JSON.stringify({
                error: String(error?.message || error)
              });
              document.body.dataset.tileflowMapCompareStatus = "failed";
            }
          };
          map.on("idle", handleInitialMapCompareIdle);
        }
        if (mapSweepEnabled) {
          document.body.dataset.tileflowMapSweepStatus = "running";
          map.once("load", async () => {
            const results = [];
            try {
              const zooms = new Set(Array.from({length: 23}, (_, zoom) => zoom));
              for (const layer of map.getStyle()?.layers || []) {
                for (const boundary of [layer.minzoom, layer.maxzoom]) {
                  if (!Number.isFinite(boundary)) continue;
                  for (const sample of [boundary - 0.01, boundary, boundary + 0.01]) {
                    if (sample >= 0 && sample <= 22) zooms.add(sample);
                  }
                }
              }
              for (const zoom of [...zooms].sort((left, right) => left - right)) {
                const result = await settleZoom(zoom);
                results.push(result);
                if (result.timedOut) {
                  throw new Error("Map sweep timed out at zoom " + zoom + ".");
                }
                if (result.errors.length > 0) {
                  throw new Error(
                    "Map sweep reported an error at zoom " + zoom + ": " + result.errors[0]
                  );
                }
              }
              document.body.dataset.tileflowMapSweep = JSON.stringify(results);
              document.body.dataset.tileflowMapSweepStatus = "complete";
            } catch (error) {
              document.body.dataset.tileflowMapSweep = JSON.stringify({
                error: String(error?.message || error),
                results
              });
              document.body.dataset.tileflowMapSweepStatus = "failed";
            }
          });
        }
      }

      const cameraRanges = {
        bearing: [-180, 180],
        lat: [-90, 90],
        lng: [-180, 180],
        pitch: [0, 85],
        zoom: [0, 24]
      };

      function readCameraFromUrl() {
        const params = new URL(location.href).searchParams;
        const camera = {};

        for (const [name, range] of Object.entries(cameraRanges)) {
          const values = params.getAll(name);
          if (values.length !== 1 || values[0].trim() === "") return undefined;
          const value = Number(values[0]);
          if (!Number.isFinite(value) || value < range[0] || value > range[1]) return undefined;
          camera[name] = value;
        }

        return {
          bearing: camera.bearing,
          center: [camera.lng, camera.lat],
          pitch: camera.pitch,
          zoom: camera.zoom
        };
      }

      function resolveInitialMapOptions(options) {
        const camera = readCameraFromUrl();
        if (!camera) return options;
        const resolved = {...options};
        delete resolved.bounds;
        delete resolved.fitBoundsOptions;
        return {...resolved, ...camera};
      }

      function formatCameraNumber(value) {
        return String(Number(value.toFixed(6)));
      }

      function wrapLongitude(value) {
        return ((value + 180) % 360 + 360) % 360 - 180;
      }

      function writeCameraToUrl(map) {
        const center = map.getCenter();
        const url = new URL(location.href);
        const camera = {
          bearing: map.getBearing(),
          lat: center.lat,
          lng: wrapLongitude(center.lng),
          pitch: map.getPitch(),
          zoom: map.getZoom()
        };

        for (const [name, value] of Object.entries(camera)) {
          url.searchParams.set(name, formatCameraNumber(value));
        }
        url.searchParams.set("buildings3d", threeDimensionalEnabled ? "on" : "off");
        url.searchParams.set("trees3d", treesEnabled ? "on" : "off");
        history.replaceState(history.state, "", url.href);
      }

      function writeToggleStateToUrl() {
        const url = new URL(location.href);
        url.searchParams.set("buildings3d", threeDimensionalEnabled ? "on" : "off");
        url.searchParams.set("trees3d", treesEnabled ? "on" : "off");
        history.replaceState(history.state, "", url.href);
      }

      function updateGlobeBackdrop(map) {
        const projection = map.getProjection?.()?.type ?? map.getStyle?.()?.projection?.type;
        const container = map.getContainer?.();
        if (!container || !projection) return;
        if (projection !== "globe") {
          container.classList.remove("tileflow-globe");
          return;
        }

        container.classList.add("tileflow-globe");
        applyAtmosphereBackdrop(map, container);
      }

      // Uses the map's declared atmosphere for the preview's space and rim, so a themed globe shows
      // its own colours; maps without one keep the default backdrop.
      function applyAtmosphereBackdrop(map, container) {
        const atmosphere = map.getStyle?.()?.metadata?.["tileflow:atmosphere"];
        const rgba = (hex, alpha) => {
          const match = /^#([0-9a-f]{6})$/i.exec(String(hex ?? ""));
          if (!match) return undefined;
          const value = Number.parseInt(match[1], 16);
          return "rgba(" + (value >> 16) + ", " + ((value >> 8) & 255) + ", " + (value & 255) + ", " + alpha + ")";
        };
        // Use the rendered canvas alpha, as the shared browser atmosphere does.
        // A zoom-only circle cannot track the globe's latitude, viewport or pitch.
        const opacity = Math.max(0, Math.min(1, (6 - map.getZoom()) / 3));
        const core = rgba(atmosphere?.horizonColor ?? "#F8FCFF", opacity * 0.65);
        const glow = rgba(atmosphere?.horizonColor ?? "#B0DCF6", opacity * 0.4);
        const properties = {
          "--tileflow-space": rgba(atmosphere?.spaceColor, 1),
          "--tileflow-globe-rim": opacity > 0
            ? "drop-shadow(0 0 2px " + core + ") drop-shadow(0 0 12px " + glow + ")"
            : "none",
        };
        for (const [name, value] of Object.entries(properties)) {
          if (value) container.style.setProperty(name, value);
          else container.style.removeProperty(name);
        }
      }

      function createBuildingWireframeLayer(map, styleLayer) {
        const maximumBuildings = 10000;
        const maximumSegments = 300000;
        const viewportBufferPixels = 96;
        const sourceId = styleLayer.source;
        const metadata = styleLayer.metadata ?? {};
        const heightField = metadata["tileflow:building-wireframe-height-field"] ??
          "render_height";
        const baseField = metadata["tileflow:building-wireframe-base-field"] ??
          "render_min_height";
        const configuredHeightScale = Number(
          metadata["tileflow:building-wireframe-height-scale"] ?? 1
        );
        const heightScale = Number.isFinite(configuredHeightScale) && configuredHeightScale > 0
          ? configuredHeightScale
          : 1;
        const color = metadata["tileflow:building-wireframe-color"] ?? "#43E4FF";
        const glowColor = metadata["tileflow:building-wireframe-glow-color"] ?? "#147DFF";
        const configuredOpacity = Number(
          metadata["tileflow:building-wireframe-opacity"] ?? 0.76
        );
        const opacity = Number.isFinite(configuredOpacity)
          ? Math.max(0, Math.min(1, configuredOpacity))
          : 0.76;
        const configuredWidth = Number(
          metadata["tileflow:building-wireframe-width"] ?? 1.15
        );
        const width = Number.isFinite(configuredWidth) && configuredWidth > 0
          ? configuredWidth
          : 1.15;
        const configuredGlowOpacity = Number(
          metadata["tileflow:building-wireframe-glow-opacity"] ?? 0.11
        );
        const glowOpacity = Number.isFinite(configuredGlowOpacity)
          ? Math.max(0, Math.min(1, configuredGlowOpacity))
          : 0.11;
        const configuredGlowWidth = Number(
          metadata["tileflow:building-wireframe-glow-width"] ?? 3.5
        );
        const glowWidth = Number.isFinite(configuredGlowWidth) && configuredGlowWidth > width
          ? configuredGlowWidth
          : Math.max(3.5, width * 3);
        let camera;
        let renderer;
        let scene;
        let group;
        let geometry;
        let glowLines;
        let coreLines;
        let glowMaterial;
        let coreMaterial;
        let sceneOriginMercator;
        let refreshTimer;
        let emptyRefreshAttempts = 0;
        let lastGeometrySignature;
        const mapMatrix = new THREE.Matrix4();
        const sceneMatrix = new THREE.Matrix4();

        function geometryPolygons(candidate) {
          if (candidate?.type === "Polygon") return [candidate.coordinates];
          if (candidate?.type === "MultiPolygon") return candidate.coordinates;
          return [];
        }

        function ringIntersectsViewport(ring, viewportWidth, viewportHeight) {
          if (!Array.isArray(ring) || ring.length < 3) return false;
          let minimumX = Infinity;
          let minimumY = Infinity;
          let maximumX = -Infinity;
          let maximumY = -Infinity;
          for (const coordinate of ring) {
            const longitude = Number(coordinate?.[0]);
            const latitude = Number(coordinate?.[1]);
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
            const point = map.project([longitude, latitude]);
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
            minimumX = Math.min(minimumX, point.x);
            minimumY = Math.min(minimumY, point.y);
            maximumX = Math.max(maximumX, point.x);
            maximumY = Math.max(maximumY, point.y);
          }
          return (
            maximumX >= -viewportBufferPixels &&
            minimumX <= viewportWidth + viewportBufferPixels &&
            maximumY >= -viewportBufferPixels &&
            minimumY <= viewportHeight + viewportBufferPixels
          );
        }

        function ringVertexCount(ring) {
          if (!Array.isArray(ring) || ring.length < 3) return 0;
          const first = ring[0];
          const last = ring.at(-1);
          const closes =
            Number(first?.[0]) === Number(last?.[0]) &&
            Number(first?.[1]) === Number(last?.[1]);
          return closes ? ring.length - 1 : ring.length;
        }

        function buildingKey(feature, rings, height, base) {
          let pointCount = 0;
          let minimumLongitude = Infinity;
          let minimumLatitude = Infinity;
          let maximumLongitude = -Infinity;
          let maximumLatitude = -Infinity;
          for (const ring of rings) {
            for (const coordinate of ring) {
              const longitude = Number(coordinate?.[0]);
              const latitude = Number(coordinate?.[1]);
              if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
              pointCount += 1;
              minimumLongitude = Math.min(minimumLongitude, longitude);
              minimumLatitude = Math.min(minimumLatitude, latitude);
              maximumLongitude = Math.max(maximumLongitude, longitude);
              maximumLatitude = Math.max(maximumLatitude, latitude);
            }
          }
          const properties = feature.properties ?? {};
          const sourceFeatureId =
            feature.id ?? properties.osm_id ?? properties.osmId ?? properties.id ?? "geometry";
          return [
            sourceFeatureId,
            pointCount,
            minimumLongitude.toFixed(6),
            minimumLatitude.toFixed(6),
            maximumLongitude.toFixed(6),
            maximumLatitude.toFixed(6),
            height.toFixed(2),
            base.toFixed(2)
          ].join(":");
        }

        function appendSegment(positions, left, right) {
          positions.push(left[0], left[1], left[2], right[0], right[1], right[2]);
        }

        function appendRing(positions, ring, base, height, mercatorPerMeter) {
          if (!Array.isArray(ring) || ring.length < 3) return 0;
          const first = ring[0];
          const last = ring.at(-1);
          const closes =
            Number(first?.[0]) === Number(last?.[0]) &&
            Number(first?.[1]) === Number(last?.[1]);
          const vertexCount = closes ? ring.length - 1 : ring.length;
          if (vertexCount < 3) return 0;
          if (positions.length / 6 + vertexCount * 3 > maximumSegments) return 0;
          const lower = [];
          const upper = [];
          for (let index = 0; index < vertexCount; index += 1) {
            const longitude = Number(ring[index]?.[0]);
            const latitude = Number(ring[index]?.[1]);
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return 0;
            const mercator = maplibregl.MercatorCoordinate.fromLngLat([longitude, latitude]);
            const x = (mercator.x - sceneOriginMercator.x) / mercatorPerMeter;
            const y = (mercator.y - sceneOriginMercator.y) / mercatorPerMeter;
            lower.push([x, y, base]);
            upper.push([x, y, height]);
          }
          for (let index = 0; index < vertexCount; index += 1) {
            const next = (index + 1) % vertexCount;
            appendSegment(positions, lower[index], lower[next]);
            appendSegment(positions, upper[index], upper[next]);
            appendSegment(positions, lower[index], upper[index]);
          }
          return vertexCount * 3;
        }

        function replaceGeometry(positions) {
          const nextGeometry = new LineSegmentsGeometry();
          nextGeometry.setPositions(new Float32Array(positions));
          nextGeometry.computeBoundingSphere();
          if (!glowLines) {
            glowLines = new LineSegments2(nextGeometry, glowMaterial);
            coreLines = new LineSegments2(nextGeometry, coreMaterial);
            glowLines.frustumCulled = false;
            coreLines.frustumCulled = false;
            group.add(glowLines, coreLines);
          } else {
            glowLines.geometry = nextGeometry;
            coreLines.geometry = nextGeometry;
            geometry?.dispose();
          }
          geometry = nextGeometry;
        }

        function wireframeShouldBeVisible() {
          return (
            threeDimensionalEnabled &&
            visibleLayerGroups.has("buildings") &&
            styleLayerIsVisibleAtZoom(styleLayer, map.getZoom()) &&
            map.getLayoutProperty(styleLayer.id, "visibility") !== "none"
          );
        }

        function hideWireframe() {
          if (group) group.visible = false;
          buildingWireframeMetrics.buildingCount = 0;
          buildingWireframeMetrics.refreshMilliseconds = undefined;
          buildingWireframeMetrics.segmentCount = 0;
          buildingWireframeMetrics.truncated = false;
        }

        function refresh() {
          const startedAt = performance.now();
          refreshTimer = undefined;
          if (!wireframeShouldBeVisible() || map.isMoving()) {
            hideWireframe();
            return;
          }
          const canvas = map.getCanvas();
          const viewportWidth = canvas.clientWidth || canvas.width;
          const viewportHeight = canvas.clientHeight || canvas.height;
          let features;
          try {
            features = map.queryRenderedFeatures(
              [
                [-viewportBufferPixels, -viewportBufferPixels],
                [
                  viewportWidth + viewportBufferPixels,
                  viewportHeight + viewportBufferPixels
                ]
              ],
              {layers: [styleLayer.id]}
            );
          } catch (error) {
            console.warn("Tileflow building wireframe could not read visible buildings", error);
            return;
          }
          if (features.length === 0) {
            hideWireframe();
            if (emptyRefreshAttempts < 12) {
              emptyRefreshAttempts += 1;
              queueRefresh(160);
            }
            return;
          }
          emptyRefreshAttempts = 0;
          sceneOriginMercator = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter(), 0);
          const mercatorPerMeter = sceneOriginMercator.meterInMercatorCoordinateUnits();
          const positions = [];
          const seen = new Set();
          let buildingCount = 0;
          let segmentCount = 0;
          let truncated = false;
          featureLoop: for (const feature of features) {
            const polygons = geometryPolygons(feature.geometry);
            if (polygons.length === 0) continue;
            const properties = feature.properties ?? {};
            const parsedHeight = Number(properties[heightField]);
            const sourceHeight = Math.max(0, Number.isFinite(parsedHeight) ? parsedHeight : 5);
            const parsedBase = Number(properties[baseField]);
            const sourceBase = Math.max(
              0,
              Math.min(Number.isFinite(parsedBase) ? parsedBase : 0, sourceHeight)
            );
            const height = sourceHeight * heightScale;
            const base = sourceBase * heightScale;
            if (height <= base) continue;
            for (const rings of polygons) {
              if (buildingCount >= maximumBuildings) {
                truncated = true;
                break featureLoop;
              }
              const outerRing = rings?.[0];
              if (!ringIntersectsViewport(outerRing, viewportWidth, viewportHeight)) continue;
              const key = buildingKey(feature, rings, height, base);
              if (seen.has(key)) continue;
              const requiredSegments = rings.reduce(
                (total, ring) => total + ringVertexCount(ring) * 3,
                0
              );
              if (segmentCount + requiredSegments > maximumSegments) {
                truncated = true;
                break featureLoop;
              }
              seen.add(key);
              const segmentCountBefore = segmentCount;
              for (const ring of rings) {
                segmentCount += appendRing(positions, ring, base, height, mercatorPerMeter);
              }
              if (segmentCount > segmentCountBefore) buildingCount += 1;
            }
          }
          if (positions.length === 0) {
            hideWireframe();
            return;
          }
          const geometrySignature = [
            sceneOriginMercator.x.toFixed(9),
            sceneOriginMercator.y.toFixed(9),
            buildingCount,
            segmentCount,
            ...[...seen].sort()
          ].join("|");
          if (geometrySignature !== lastGeometrySignature || !geometry) {
            replaceGeometry(positions);
            lastGeometrySignature = geometrySignature;
          }
          group.visible = true;
          buildingWireframeMetrics.buildingCount = buildingCount;
          buildingWireframeMetrics.segmentCount = segmentCount;
          buildingWireframeMetrics.refreshMilliseconds = performance.now() - startedAt;
          buildingWireframeMetrics.truncated = truncated;
          map.triggerRepaint();
        }

        function queueRefresh(delay = 80) {
          if (refreshTimer !== undefined) return;
          refreshTimer = setTimeout(refresh, delay);
        }

        function handleMoveEnd() {
          emptyRefreshAttempts = 0;
          queueRefresh(0);
        }

        function handleSourceData(event) {
          if (event.sourceId !== sourceId || event.isSourceLoaded !== true || map.isMoving()) {
            return;
          }
          queueRefresh();
        }

        function handleThreeDimensionalToggle() {
          if (!threeDimensionalEnabled) {
            if (refreshTimer !== undefined) clearTimeout(refreshTimer);
            refreshTimer = undefined;
            hideWireframe();
            map.triggerRepaint();
            return;
          }
          emptyRefreshAttempts = 0;
          queueRefresh(0);
        }

        function handleVisibleLayerGroups() {
          if (!visibleLayerGroups.has("buildings")) {
            hideWireframe();
            map.triggerRepaint();
            return;
          }
          emptyRefreshAttempts = 0;
          queueRefresh(0);
        }

        return {
          id: "tileflow-buildings-wireframe-3d",
          type: "custom",
          renderingMode: "3d",
          onAdd(_map, gl) {
            camera = new THREE.Camera();
            scene = new THREE.Scene();
            group = new THREE.Group();
            group.visible = false;
            scene.add(group);
            glowMaterial = new LineMaterial({
              blending: THREE.AdditiveBlending,
              color: glowColor,
              depthTest: false,
              depthWrite: false,
              linewidth: glowWidth,
              opacity: glowOpacity,
              toneMapped: false,
              transparent: true,
              worldUnits: false
            });
            coreMaterial = new LineMaterial({
              blending: THREE.NormalBlending,
              color,
              depthTest: false,
              depthWrite: false,
              linewidth: width,
              opacity,
              toneMapped: false,
              transparent: true,
              worldUnits: false
            });
            renderer = new THREE.WebGLRenderer({
              canvas: map.getCanvas(),
              context: gl
            });
            renderer.autoClear = false;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            map.on("moveend", handleMoveEnd);
            map.on("sourcedata", handleSourceData);
            map.on("tileflow:3d-toggle", handleThreeDimensionalToggle);
            map.on("tileflow:visible-layer-groups", handleVisibleLayerGroups);
            queueRefresh(0);
          },
          render(_gl, options) {
            if (!wireframeShouldBeVisible() || !sceneOriginMercator || !group?.visible) return;
            const canvas = map.getCanvas();
            const pixelRatio = map.getPixelRatio?.() ?? globalThis.devicePixelRatio ?? 1;
            glowMaterial.linewidth = glowWidth * pixelRatio;
            coreMaterial.linewidth = width * pixelRatio;
            glowMaterial.resolution.set(canvas.width, canvas.height);
            coreMaterial.resolution.set(canvas.width, canvas.height);
            const meter = sceneOriginMercator.meterInMercatorCoordinateUnits();
            mapMatrix.fromArray(options.defaultProjectionData.mainMatrix);
            sceneMatrix
              .makeTranslation(
                sceneOriginMercator.x,
                sceneOriginMercator.y,
                sceneOriginMercator.z
              )
              .scale(new THREE.Vector3(meter, meter, meter));
            camera.projectionMatrix.copy(mapMatrix).multiply(sceneMatrix);
            renderer.resetState();
            renderer.setViewport(0, 0, canvas.width, canvas.height);
            renderer.render(scene, camera);
          },
          onRemove() {
            if (refreshTimer !== undefined) clearTimeout(refreshTimer);
            map.off("moveend", handleMoveEnd);
            map.off("sourcedata", handleSourceData);
            map.off("tileflow:3d-toggle", handleThreeDimensionalToggle);
            map.off("tileflow:visible-layer-groups", handleVisibleLayerGroups);
            geometry?.dispose();
            glowMaterial?.dispose();
            coreMaterial?.dispose();
            renderer?.dispose();
            hideWireframe();
          }
        };
      }

      function addBuildingWireframeLayerIfConfigured(map, styleLayers) {
        const styleLayer = styleLayers.find(
          (layer) => layer.metadata?.["tileflow:building-wireframe"] === true
        );
        if (!styleLayer || map.getLayer("tileflow-buildings-wireframe-3d")) return;
        if (map.getProjection().type !== "mercator") {
          map.setProjection({type: "mercator"});
        }
        if (map.getLayer("tileflow-buildings-wireframe-3d")) return;
        const styleLayerIndex = styleLayers.findIndex((layer) => layer.id === styleLayer.id);
        const layerAboveBuildings = styleLayers[styleLayerIndex + 1]?.id;
        map.addLayer(createBuildingWireframeLayer(map, styleLayer), layerAboveBuildings);
      }

      function styleLayerZoomRange(layer) {
        return {
          minzoom: Number.isFinite(layer?.minzoom) ? layer.minzoom : 0,
          maxzoom: Number.isFinite(layer?.maxzoom) ? layer.maxzoom : Infinity
        };
      }

      function styleLayerIsVisibleAtZoom(layer, zoom) {
        const {minzoom, maxzoom} = styleLayerZoomRange(layer);
        return zoom >= minzoom && zoom < maxzoom;
      }

      function createLandmarkLayer(map, configLayer, fallbackLayers = []) {
        const manifestUrl = configLayer.metadata?.["tileflow:landmark-manifest-url"];
        const {minzoom: landmarkMinimumZoom, maxzoom: landmarkMaximumZoom} =
          styleLayerZoomRange(configLayer);
        const abortController = new AbortController();
        const loaded = new Map();
        const loading = new Map();
        const archiveReaders = new Map();
        const activeLandmarkIds = new Set();
        let cacheClock = 0;
        let camera;
        let renderer;
        let scene;
        let group;
        let sceneOriginMercator;
        let sceneElevation = 0;
        let manifest;
        let fallbackSignature;
        let queuedRefresh;
        const mapMatrix = new THREE.Matrix4();
        const sceneMatrix = new THREE.Matrix4();

        function overlapsViewport(bounds, paddingRatio = 0) {
          const viewport = map.getBounds();
          const longitudePadding = Math.abs(viewport.getEast() - viewport.getWest()) * paddingRatio;
          const latitudePadding = Math.abs(viewport.getNorth() - viewport.getSouth()) * paddingRatio;
          return !(
            bounds[2] < viewport.getWest() - longitudePadding ||
            bounds[0] > viewport.getEast() + longitudePadding ||
            bounds[3] < viewport.getSouth() - latitudePadding ||
            bounds[1] > viewport.getNorth() + latitudePadding
          );
        }

        function updateLandmarkFallbackFilters() {
          const readyIds = [...activeLandmarkIds]
            .filter((id) => loaded.has(id))
            .sort();
          const signature = JSON.stringify(readyIds);
          if (signature === fallbackSignature) return;
          fallbackSignature = signature;
          for (const fallback of fallbackLayers) {
            if (!map.getLayer(fallback.id)) continue;
            const spatialExclusions = (fallback.spatialFallbacks ?? [])
              .filter((entry) => readyIds.includes(entry.id))
              .map((entry) => ["!", ["within", {
                type: "Polygon",
                coordinates: [[
                  [entry.bounds[0], entry.bounds[1]],
                  [entry.bounds[2], entry.bounds[1]],
                  [entry.bounds[2], entry.bounds[3]],
                  [entry.bounds[0], entry.bounds[3]],
                  [entry.bounds[0], entry.bounds[1]]
                ]]
              }]]);
            map.setFilter(
              fallback.id,
              readyIds.length === 0 && spatialExclusions.length === 0
                ? (fallback.filter ?? null)
                : [
                    "all",
                    ...(fallback.filter ? [fallback.filter] : []),
                    [
                      "!",
                      ["in", ["get", "landmark_id"], ["literal", readyIds]]
                    ],
                    ...spatialExclusions
                  ]
            );
          }
        }

        function queueRefresh() {
          if (queuedRefresh !== undefined) return;
          queuedRefresh = setTimeout(() => {
            queuedRefresh = undefined;
            refresh();
          }, 100);
        }

        function ensureSceneOrigin(elevation) {
          if (sceneOriginMercator) return;
          sceneElevation = elevation;
          sceneOriginMercator = maplibregl.MercatorCoordinate.fromLngLat(
            map.getCenter(),
            elevation
          );
        }

        function localPosition(lng, lat, elevation) {
          const mercator = maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
          const mercatorPerMeter = sceneOriginMercator.meterInMercatorCoordinateUnits();
          return new THREE.Vector3(
            (mercator.x - sceneOriginMercator.x) / mercatorPerMeter,
            elevation - sceneElevation,
            (sceneOriginMercator.y - mercator.y) / mercatorPerMeter
          );
        }

        function disposeModel(model) {
          const disposed = new Set();
          group?.remove(model);
          for (const texture of model.userData?.tileflowDetachedTextures ?? []) {
            if (!texture?.isTexture || disposed.has(texture)) continue;
            disposed.add(texture);
            texture.dispose();
          }
          for (const material of model.userData?.tileflowDetachedMaterials ?? []) {
            if (!material || disposed.has(material)) continue;
            for (const value of Object.values(material)) {
              if (value?.isTexture && !disposed.has(value)) {
                disposed.add(value);
                value.dispose();
              }
            }
            disposed.add(material);
            material.dispose?.();
          }
          model.traverse((object) => {
            if (object.geometry && !disposed.has(object.geometry)) {
              disposed.add(object.geometry);
              object.geometry.dispose?.();
            }
            const materials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const material of materials) {
              if (!material || disposed.has(material)) continue;
              for (const value of Object.values(material)) {
                if (value?.isTexture && !disposed.has(value)) {
                  disposed.add(value);
                  value.dispose();
                }
              }
              disposed.add(material);
              material.dispose?.();
            }
          });
        }

        function harmonizeLandmarkModel(model) {
          const detachedMaterials = new Set();
          const uniformMaterial = new THREE.MeshStandardMaterial({
            alphaTest: 0,
            color: "#EEE4D4",
            depthWrite: true,
            metalness: 0,
            opacity: 1,
            roughness: 0.9,
            side: THREE.DoubleSide,
            transparent: false
          });
          model.traverse((object) => {
            if (!object.isMesh) return;
            const originalMaterials = Array.isArray(object.material)
              ? object.material
              : [object.material];
            for (const material of originalMaterials) {
              if (material) detachedMaterials.add(material);
            }
            object.material = Array.isArray(object.material)
              ? object.material.map(() => uniformMaterial)
              : uniformMaterial;
          });
          model.userData.tileflowDetachedMaterials = [...detachedMaterials];
        }

        function normalizeLandmarkAxes(sourceModel, axisConvention) {
          if (axisConvention === "EUN_Y_UP") return sourceModel;
          if (axisConvention === "ENU_Z_UP") {
            sourceModel.rotateX(-Math.PI / 2);
          }
          const normalizedModel = new THREE.Group();
          normalizedModel.scale.z = -1;
          normalizedModel.add(sourceModel);
          return normalizedModel;
        }

        function unloadLandmark(id) {
          const entry = loaded.get(id);
          if (!entry) return;
          disposeModel(entry.model);
          loaded.delete(id);
          landmarkState.loaded = [...loaded.keys()];
          fallbackSignature = undefined;
        }

        function enforceCacheLimit() {
          if (!manifest || loaded.size <= manifest.maximumCachedModels) return;
          const evictionCandidates = [...loaded.entries()]
            .filter(([id]) => !activeLandmarkIds.has(id))
            .sort(
              ([leftId, left], [rightId, right]) =>
                left.lastUsed - right.lastUsed || leftId.localeCompare(rightId)
            );
          while (
            loaded.size > manifest.maximumCachedModels &&
            evictionCandidates.length > 0
          ) {
            unloadLandmark(evictionCandidates.shift()[0]);
          }
        }

        function landmarkModelAtZoom(landmark, zoom) {
          let selected = landmark.models[0];
          for (const candidate of landmark.models) {
            if (candidate.minzoom > zoom) break;
            selected = candidate;
          }
          return selected;
        }

        async function sha256Hex(bytes) {
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          return [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
        }

        function archiveReader(archive) {
          let reader = archiveReaders.get(archive.url);
          if (!reader) {
            reader = new PMTiles(
              new FetchSource(archive.url, new Headers(), "include")
            );
            archiveReaders.set(archive.url, reader);
          }
          return reader;
        }

        async function loadLandmarkBytes(modelDefinition) {
          const tile = await archiveReader(modelDefinition.archive).getZxy(
            modelDefinition.z,
            modelDefinition.x,
            modelDefinition.y,
            abortController.signal
          );
          if (!tile) throw new Error("landmark entry is missing from PMTiles");
          if (tile.data.byteLength !== modelDefinition.bytes) {
            throw new Error("landmark entry has an unexpected byte length");
          }
          if ((await sha256Hex(tile.data)) !== modelDefinition.sha256) {
            throw new Error("landmark entry has an unexpected SHA-256");
          }
          return tile.data;
        }

        function loadLandmark(landmark, requestedModel) {
          const cached = loaded.get(landmark.id);
          const nextModel = cached ? requestedModel : landmark.models[0];
          if (cached?.modelKey === nextModel.key) {
            cached.lastUsed = ++cacheClock;
            cached.model.visible = activeLandmarkIds.has(landmark.id);
            return;
          }
          if (cached) {
            // Keep the previous LOD visible until its replacement has loaded.
            cached.lastUsed = ++cacheClock;
            cached.model.visible = activeLandmarkIds.has(landmark.id);
          }
          if (loading.has(landmark.id)) return;
          loading.set(landmark.id, nextModel.key);
          landmarkState.loading = [...loading.keys()];
          const loader = new GLTFLoader();
          loader.setMeshoptDecoder(MeshoptDecoder);
          loader.setDRACOLoader(landmarkDracoLoader);
          loader.setWithCredentials(true);
          const fail = (error) => {
            if (loading.get(landmark.id) !== nextModel.key) return;
            loading.delete(landmark.id);
            landmarkState.loading = [...loading.keys()];
            landmarkState.errors = [
              ...landmarkState.errors.filter((item) => item.id !== landmark.id),
              {id: landmark.id, message: String(error)}
            ];
            console.warn("Tileflow landmark failed to load", landmark.id, error);
          };
          void loadLandmarkBytes(nextModel).then((bytes) => {
            if (loading.get(landmark.id) !== nextModel.key) return;
            loader.parse(
              bytes,
              new URL(".", nextModel.archive.url).toString(),
            (gltf) => {
              if (loading.get(landmark.id) !== nextModel.key) {
                disposeModel(gltf.scene);
                return;
              }
              loading.delete(landmark.id);
              landmarkState.loading = [...loading.keys()];
              if (abortController.signal.aborted) {
                disposeModel(gltf.scene);
                return;
              }
              const elevation = map.queryTerrainElevation(landmark.center) ?? 0;
              ensureSceneOrigin(elevation);
              const model = normalizeLandmarkAxes(
                gltf.scene,
                nextModel.axisConvention
              );
              model.name = "tileflow-landmark-" + landmark.id;
              harmonizeLandmarkModel(model);
              model.position.copy(
                localPosition(landmark.center[0], landmark.center[1], elevation)
              );
              model.traverse((object) => {
                if (!object.isMesh) return;
                object.frustumCulled = true;
                object.castShadow = false;
                object.receiveShadow = false;
              });
              model.visible = activeLandmarkIds.has(landmark.id);
              if (loaded.has(landmark.id)) unloadLandmark(landmark.id);
              loaded.set(landmark.id, {
                lastUsed: ++cacheClock,
                model,
                modelKey: nextModel.key
              });
              landmarkState.errors = landmarkState.errors.filter(
                (item) => item.id !== landmark.id
              );
              landmarkState.loaded = [...loaded.keys()];
              group.add(model);
              enforceCacheLimit();
              fallbackSignature = undefined;
              refresh();
            },
              fail
            );
          }).catch(fail);
        }

        function refresh() {
          if (
            !threeDimensionalEnabled ||
            !manifest ||
            !styleLayerIsVisibleAtZoom(configLayer, map.getZoom())
          ) {
            activeLandmarkIds.clear();
            landmarkState.active = [];
            for (const entry of loaded.values()) entry.model.visible = false;
            updateLandmarkFallbackFilters();
            return;
          }
          const zoom = map.getZoom();
          const visible = manifest.landmarks
            .filter((landmark) => overlapsViewport(landmark.bounds))
            .sort(
              (left, right) =>
                right.priority - left.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
            )
            .slice(0, manifest.maximumVisibleModels);
          activeLandmarkIds.clear();
          for (const landmark of visible) activeLandmarkIds.add(landmark.id);
          landmarkState.active = visible.map((landmark) => landmark.id);
          for (const [id, entry] of loaded) {
            entry.model.visible = activeLandmarkIds.has(id);
          }
          for (const landmark of visible) {
            loadLandmark(landmark, landmarkModelAtZoom(landmark, zoom));
          }
          const nearbyCacheSlots = Math.max(
            0,
            manifest.maximumCachedModels - visible.length
          );
          const nearby = manifest.landmarks
            .filter(
              (landmark) =>
                !activeLandmarkIds.has(landmark.id) &&
                overlapsViewport(landmark.bounds, 0.35)
            )
            .sort(
              (left, right) =>
                right.priority - left.priority || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
            )
            .slice(0, nearbyCacheSlots);
          for (const landmark of nearby) {
            loadLandmark(landmark, landmark.models[0]);
          }
          enforceCacheLimit();
          updateLandmarkFallbackFilters();
          map.triggerRepaint();
        }

        function normalizeManifest(candidate) {
          return normalizeTileflowLandmarkManifest(candidate, manifestUrl);
        }

        async function loadManifest() {
          try {
            const candidate = await loadLandmarkManifestCandidate(
              manifestUrl,
              abortController.signal
            );
            if (abortController.signal.aborted) return;
            manifest = normalizeManifest(candidate);
            landmarkState.manifestId = candidate.id;
            landmarkState.cacheLimit = manifest.maximumCachedModels;
            refresh();
          } catch (error) {
            if (error?.name !== "AbortError") {
              console.warn("Tileflow landmark manifest failed to load", error);
            }
          }
        }

        return {
          id: "tileflow-landmarks-3d",
          type: "custom",
          renderingMode: "3d",
          minzoom: landmarkMinimumZoom,
          ...(Number.isFinite(landmarkMaximumZoom)
            ? {maxzoom: landmarkMaximumZoom}
            : {}),
          metadata: {"tileflow:3d-toggle": "landmark"},
          onAdd(_map, gl) {
            camera = new THREE.Camera();
            scene = new THREE.Scene();
            scene.rotateX(Math.PI / 2);
            scene.scale.multiply(new THREE.Vector3(1, 1, -1));
            group = new THREE.Group();
            scene.add(group);
            scene.add(new THREE.AmbientLight(0xffffff, 2.2));
            scene.add(new THREE.HemisphereLight(0xfff8e8, 0xd8cfbd, 0.8));
            const sun = new THREE.DirectionalLight(0xffffff, 0.45);
            sun.position.set(-120, 220, 100);
            scene.add(sun);
            renderer = new THREE.WebGLRenderer({
              canvas: map.getCanvas(),
              context: gl
            });
            renderer.autoClear = false;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            map.on("move", queueRefresh);
            map.on("moveend", refresh);
            map.on("tileflow:3d-toggle", refresh);
            void loadManifest();
          },
          render(_gl, options) {
            if (
              !threeDimensionalEnabled ||
              !sceneOriginMercator ||
              group.children.length === 0
            ) return;
            const meter = sceneOriginMercator.meterInMercatorCoordinateUnits();
            mapMatrix.fromArray(options.defaultProjectionData.mainMatrix);
            sceneMatrix
              .makeTranslation(
                sceneOriginMercator.x,
                sceneOriginMercator.y,
                sceneOriginMercator.z
              )
              .scale(new THREE.Vector3(meter, -meter, meter));
            camera.projectionMatrix.copy(mapMatrix).multiply(sceneMatrix);
            renderer.resetState();
            renderer.render(scene, camera);
          },
          onRemove() {
            abortController.abort();
            if (queuedRefresh !== undefined) clearTimeout(queuedRefresh);
            map.off("move", queueRefresh);
            map.off("moveend", refresh);
            map.off("tileflow:3d-toggle", refresh);
            for (const entry of loaded.values()) disposeModel(entry.model);
            loaded.clear();
            for (const fallback of fallbackLayers) {
              if (map.getLayer(fallback.id)) {
                map.setFilter(fallback.id, fallback.filter ?? null);
              }
            }
            renderer?.dispose();
          }
        };
      }

      function addLandmarkLayerIfConfigured(map, styleLayers) {
        const configLayer = styleLayers.find(
          (layer) => layer.metadata?.["tileflow:landmark-manifest-url"]
        );
        if (!configLayer || map.getLayer("tileflow-landmarks-3d")) return;
        const fallbackLayers = styleLayers
          .filter((layer) => layer.metadata?.["tileflow:landmark-fallback"] === true)
          .map((layer) => ({
            filter: layer.filter,
            id: layer.id,
            spatialFallbacks:
              layer.metadata?.["tileflow:landmark-spatial-fallbacks"] ?? []
          }));
        // Landmark custom layers use Mercator world coordinates.
        if (map.getProjection().type !== "mercator") {
          map.setProjection({type: "mercator"});
        }
        const firstForegroundLabel = styleLayers.find(
          (layer) =>
            (layer.id.startsWith("tileflow-label-") &&
              !layer.id.startsWith("tileflow-label-road-")) ||
            layer.id === "tileflow-poi" ||
            layer.id.startsWith("tileflow-poi-")
        )?.id;
        const treeLayer = map.getLayer("tileflow-vegetation-trees")
          ? "tileflow-vegetation-trees"
          : firstForegroundLabel;
        map.addLayer(createLandmarkLayer(map, configLayer, fallbackLayers), treeLayer);
      }

      // Core's 3D layers, as an application mounts them: the map's style describes how its
      // buildings, trees and street lights look, and the controls only show and hide them. With
      // both controls off the preview draws what Capture draws. The preview shows one theme at a
      // time, so the style on screen holds the sun and the design.
      const coreScene = {buildings: undefined, trees: undefined, lights: undefined, buildingsShown: false, treesShown: false};
      globalThis.__tileflowPreviewScene = coreScene;
      function coreSceneThemes(map) {
        return {
          getSun() {
            const preset = readTileflowSunPreset(map.getStyle()?.metadata);
            return resolveTileflowSun(preset ?? tileflowDefaultSunPreset);
          },
          getThemeMetadata(key) {
            return {values: [map.getStyle()?.metadata?.[key]], position: 0};
          }
        };
      }
      function mountCoreScene(map) {
        const metadata = map.getStyle()?.metadata ?? {};
        const controller = coreSceneThemes(map);
        if (!coreScene.buildings && metadata["tileflow:buildings"]) {
          coreScene.buildings = createTileflowBuildings3D({map, controller});
        }
        if (!coreScene.trees && metadata["tileflow:vegetation"]) {
          coreScene.trees = createTileflowTrees3D({map, controller});
        }
        // Street lights have no capture fallback, so they shine only with the 3D control on.
        if (!coreScene.lights && threeDimensionalEnabled && metadata["tileflow:street-lights"]) {
          coreScene.lights = createTileflowStreetLights({map, controller});
        } else if (coreScene.lights && !threeDimensionalEnabled) {
          coreScene.lights.dispose();
          coreScene.lights = undefined;
        }
        const instant = {transition: {duration: 0}};
        // Only a change of the controls moves the layers, so a style event does not restart them.
        if (coreScene.buildings && coreScene.buildingsShown !== threeDimensionalEnabled) {
          coreScene.buildingsShown = threeDimensionalEnabled;
          void (threeDimensionalEnabled ? coreScene.buildings.show() : coreScene.buildings.hide(instant));
        }
        if (coreScene.trees && coreScene.treesShown !== treesEnabled) {
          coreScene.treesShown = treesEnabled;
          void (treesEnabled ? coreScene.trees.show() : coreScene.trees.hide(instant));
        }
      }

      class ThreeDimensionalControl {
        constructor() {
          this.enabled = threeDimensionalEnabled;
          this.handleClick = this.handleClick.bind(this);
          this.update = this.update.bind(this);
        }

        onAdd(map) {
          this.map = map;
          this.container = document.createElement("div");
          this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
          this.button = document.createElement("button");
          this.button.type = "button";
          this.button.className = "tileflow-3d-toggle";
          this.button.title = "Toggle 3D view";
          this.button.setAttribute("aria-label", "Toggle 3D view");
          this.button.addEventListener("click", this.handleClick);
          this.container.appendChild(this.button);
          map.on("styledata", this.update);
          this.update();
          return this.container;
        }

        handleClick() {
          this.setEnabled(!this.enabled);
        }

        setEnabled(enabled) {
          if (typeof enabled !== "boolean" || enabled === this.enabled) return;
          this.enabled = enabled;
          threeDimensionalEnabled = this.enabled;
          landmarkState.enabled = this.enabled;
          this.update();
          writeToggleStateToUrl();
          this.map.fire("tileflow:3d-toggle", {enabled: this.enabled});
          mountCoreScene(this.map);
          this.map.triggerRepaint();
        }

        update() {
          for (const layer of this.map.getStyle()?.layers || []) {
            const toggle = layer.metadata?.["tileflow:3d-toggle"];
            if (toggle !== "building" && toggle !== "landmark") continue;
            // Core's 3D buildings stand in for the compiled extrusion where the style describes them.
            const replaced = toggle === "building" && this.map.getStyle()?.metadata?.["tileflow:buildings"];
            const visibility = this.enabled && !replaced ? "visible" : "none";
            if (this.map.getLayoutProperty(layer.id, "visibility") !== visibility) {
              this.map.setLayoutProperty(layer.id, "visibility", visibility);
            }
          }
          if (this.map.isStyleLoaded()) mountCoreScene(this.map);
          this.button.textContent = this.enabled ? "3D ON" : "3D OFF";
          this.button.setAttribute("aria-pressed", String(this.enabled));
          this.button.title = this.enabled ? "Disable 3D buildings" : "Enable 3D buildings";
        }

        onRemove() {
          this.map?.off("styledata", this.update);
          this.button?.removeEventListener("click", this.handleClick);
          this.container?.remove();
          this.map = undefined;
        }
      }

      class TreeControl {
        constructor() {
          this.enabled = treesEnabled;
          this.handleClick = this.handleClick.bind(this);
          this.update = this.update.bind(this);
        }

        onAdd(map) {
          this.map = map;
          this.container = document.createElement("div");
          this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
          this.button = document.createElement("button");
          this.button.type = "button";
          this.button.className = "tileflow-tree-toggle";
          this.button.setAttribute("aria-label", "Toggle trees");
          this.button.addEventListener("click", this.handleClick);
          this.container.appendChild(this.button);
          map.on("styledata", this.update);
          this.update();
          return this.container;
        }

        handleClick() {
          this.setEnabled(!this.enabled);
        }

        setEnabled(enabled) {
          if (typeof enabled !== "boolean" || enabled === this.enabled) return;
          this.enabled = enabled;
          treesEnabled = this.enabled;
          this.update();
          writeToggleStateToUrl();
          this.map.fire("tileflow:trees-toggle", {enabled: this.enabled});
          mountCoreScene(this.map);
          this.map.triggerRepaint();
        }

        update() {
          const treeLayer = this.map.getStyle()?.layers?.find(
            (layer) => layer.id === "tileflow-vegetation-trees"
          );
          // Core's 3D trees hide the style's flat trees while they stand (mountCoreScene).
          if (treeLayer && !this.map.getStyle()?.metadata?.["tileflow:vegetation"]) {
            if (this.map.getLayoutProperty(treeLayer.id, "visibility") !== "visible") {
              this.map.setLayoutProperty(treeLayer.id, "visibility", "visible");
            }
          }
          this.button.textContent = this.enabled ? "TREES ON" : "TREES OFF";
          this.button.setAttribute("aria-pressed", String(this.enabled));
          this.button.title = this.enabled ? "Show flat trees" : "Show 3D trees";
        }

        onRemove() {
          this.map?.off("styledata", this.update);
          this.button?.removeEventListener("click", this.handleClick);
          this.container?.remove();
          this.map = undefined;
        }
      }

      // Switches a map preview between its themes. The preview reloads with the next theme and keeps
      // the camera and toggles already written to the URL; scene previews own their theme.
      class ThemeControl {
        onAdd(map) {
          this.map = map;
          this.container = document.createElement("div");
          this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
          this.button = document.createElement("button");
          this.button.type = "button";
          this.button.className = "tileflow-theme-toggle";
          const next = previewThemes[(previewThemes.indexOf(previewTheme) + 1) % previewThemes.length];
          this.button.textContent = String(previewTheme).toUpperCase();
          this.button.title = "Switch to the " + next + " theme";
          this.button.setAttribute("aria-label", "Switch to the " + next + " theme");
          this.handleClick = () => {
            writeCameraToUrl(map);
            const url = new URL(location.href);
            url.searchParams.set("theme", next);
            location.assign(url.href);
          };
          this.button.addEventListener("click", this.handleClick);
          this.container.appendChild(this.button);
          return this.container;
        }

        onRemove() {
          this.button?.removeEventListener("click", this.handleClick);
          this.container?.remove();
          this.map = undefined;
        }
      }

      const previewLayerGroupIds = [
        "labels", "pois", "roads", "transit", "buildings", "landuse", "water"
      ];
      let visibleLayerGroups = new Set(previewLayerGroupIds);
      const defaultLayerVisibility = new Map();
      const defaultLayerTextField = new Map();

      function previewLayoutValuesEqual(left, right) {
        return JSON.stringify(left) === JSON.stringify(right);
      }

      function previewLayerGroups(layer) {
        const id = layer.id.toLowerCase();
        const sourceLayer = layer["source-layer"] || "";
        const groups = [];
        const isLanduseLayer = [
          "landuse", "landcover", "park", "business_corridor"
        ].includes(sourceLayer);
        if (
          !isLanduseLayer &&
          /poi|parking|business|amenity/u.test(id + " " + sourceLayer)
        ) groups.push("pois");
        if (/transit|rail|ferry|aeroway|aerodrome/u.test(id + " " + sourceLayer)) {
          groups.push("transit");
        } else if (
          [
            "transportation",
            "transportation_name",
            "circular_feature",
            "sidewalk",
            "street_furniture"
          ].includes(sourceLayer)
        ) {
          groups.push("roads");
        }
        if (sourceLayer === "building" || id.includes("building")) {
          groups.push("buildings");
        }
        if (isLanduseLayer) {
          groups.push("landuse");
        }
        if (["water", "waterway", "water_name", "bathymetry"].includes(sourceLayer)) {
          groups.push("water");
        }
        return groups;
      }

      function applyVisibleLayerGroups(map) {
        if (document.documentElement) {
          document.documentElement.dataset.visibleLayerGroups = [
            ...visibleLayerGroups,
          ].join(",");
        }
        for (const layer of map.getStyle()?.layers || []) {
          if (!defaultLayerVisibility.has(layer.id)) {
            defaultLayerVisibility.set(
              layer.id,
              map.getLayoutProperty(layer.id, "visibility") || "visible"
            );
          }
          if (layer.type === "symbol" && layer.layout?.["text-field"] !== undefined) {
            if (!defaultLayerTextField.has(layer.id)) {
              defaultLayerTextField.set(
                layer.id,
                map.getLayoutProperty(layer.id, "text-field")
              );
            }
            const textField = visibleLayerGroups.has("labels")
              ? defaultLayerTextField.get(layer.id)
              : "";
            if (
              !previewLayoutValuesEqual(
                map.getLayoutProperty(layer.id, "text-field"),
                textField
              )
            ) {
              map.setLayoutProperty(layer.id, "text-field", textField);
            }
          }
          const groups = previewLayerGroups(layer);
          const threeDimensionalToggle = layer.metadata?.["tileflow:3d-toggle"];
          const authoredVisibility = defaultLayerVisibility.get(layer.id);
          const styleMetadata = map.getStyle()?.metadata ?? {};
          // Core's 3D buildings and trees stand in for compiled extrusions and flat trees.
          const flatTrees = styleMetadata["tileflow:vegetation"]?.flatLayers ?? [];
          const replacedByCore =
            (threeDimensionalToggle === "building" && styleMetadata["tileflow:buildings"]) ||
            (treesEnabled && flatTrees.includes(layer.id.split("::")[0]));
          const toggleVisibility = replacedByCore
            ? "none"
            : threeDimensionalToggle === "building" || threeDimensionalToggle === "landmark"
              ? (threeDimensionalEnabled ? "visible" : "none")
              : authoredVisibility;
          const visibility = groups.some((group) => !visibleLayerGroups.has(group))
            ? "none"
            : toggleVisibility;
          if (map.getLayoutProperty(layer.id, "visibility") !== visibility) {
            map.setLayoutProperty(layer.id, "visibility", visibility);
          }
        }
      }

      function setVisibleLayerGroups(map, groups) {
        visibleLayerGroups = new Set(groups);
        applyVisibleLayerGroups(map);
        map.fire("tileflow:visible-layer-groups", {groups: [...visibleLayerGroups]});
      }

      if (styleUrl) {
        // Dense vector tiles finish in bursts with multiple workers, causing several
        // bucket uploads in one frame. One worker keeps navigation smooth; benchmarks
        // can still compare up to three workers through the explicit URL override.
        const mapWorkerCount = mapWorkerCountOverride ?? 1;
        maplibregl.setWorkerCount?.(mapWorkerCount);
        await loadTileflowStyleFonts(styleUrl, {fontFaces: previewFontFaces});
        registerTileflowContourProtocol({addProtocol: maplibregl.addProtocol});
        registerTileflowPmtilesProtocol({addProtocol: maplibregl.addProtocol});
        const map = new maplibregl.Map({
          collectResourceTiming: mapBenchmarkEnabled,
          container: "map",
          style: styleUrl,
          transformRequest: (url) => {
            try {
              return new URL(url, location.href).hostname === "dev-tiles.tileflow.dev"
                ? {credentials: "include", url}
                : {url};
            } catch {
              return {url};
            }
          },
          ...resolveInitialMapOptions(previewMapOptions)
        });
        globalThis.__tileflowPreviewMap = map;
        installMapBenchmark(map);
        map.addControl(new maplibregl.NavigationControl(), "top-right");
        let threeDimensionalControl;
        let treeControl;
        if (isSemanticPreview) {
          threeDimensionalControl = new ThreeDimensionalControl();
          treeControl = new TreeControl();
          map.addControl(threeDimensionalControl, "top-right");
          map.addControl(treeControl, "top-right");
        }
        if (previewThemes.length > 1) map.addControl(new ThemeControl(), "top-right");
        let ensuringThreeDimensionalLayers;
        const ensureThreeDimensionalLayers = () => {
          if (ensuringThreeDimensionalLayers) return ensuringThreeDimensionalLayers;
          const currentStyleLayers = map.getStyle()?.layers || [];
          const landmarkConfigLayer = currentStyleLayers.find(
            (layer) => layer.metadata?.["tileflow:landmark-manifest-url"]
          );
          const buildingWireframeConfigLayer = currentStyleLayers.find(
            (layer) => layer.metadata?.["tileflow:building-wireframe"] === true
          );
          const landmarkManifestUrl =
            landmarkConfigLayer?.metadata?.["tileflow:landmark-manifest-url"];
          const landmarkPreloadZoom = landmarkConfigLayer
            ? Math.max(0, styleLayerZoomRange(landmarkConfigLayer).minzoom - 1)
            : Infinity;
          const shouldPreloadLandmarks =
            landmarkManifestUrl &&
            threeDimensionalEnabled &&
            map.getZoom() >= landmarkPreloadZoom;
          const needsLandmarks =
            landmarkConfigLayer &&
            threeDimensionalEnabled &&
            styleLayerIsVisibleAtZoom(landmarkConfigLayer, map.getZoom()) &&
            !map.getLayer("tileflow-landmarks-3d");
          const needsBuildingWireframe =
            buildingWireframeConfigLayer &&
            threeDimensionalEnabled &&
            styleLayerIsVisibleAtZoom(buildingWireframeConfigLayer, map.getZoom()) &&
            !map.getLayer("tileflow-buildings-wireframe-3d");
          if (
            !needsLandmarks &&
            !needsBuildingWireframe &&
            !shouldPreloadLandmarks
          ) return;
          const runtimePrerequisites = [
            shouldPreloadLandmarks
              ? loadLandmarkPrerequisites(landmarkManifestUrl)
              : loadThreeCoreRuntime(),
            ...(needsBuildingWireframe ? [loadBuildingWireframeRuntime()] : [])
          ];
          ensuringThreeDimensionalLayers = Promise.all(runtimePrerequisites)
            .then(async () => {
              const styleLayers = map.getStyle()?.layers || [];
              const buildingWireframeConfigLayer = styleLayers.find(
                (layer) => layer.metadata?.["tileflow:building-wireframe"] === true
              );
              if (
                buildingWireframeConfigLayer &&
                threeDimensionalEnabled &&
                styleLayerIsVisibleAtZoom(buildingWireframeConfigLayer, map.getZoom())
              ) {
                // A tree-only load may already be in flight when buildings are
                // enabled. Reassert the line runtime before mounting the layer.
                await loadBuildingWireframeRuntime();
                addBuildingWireframeLayerIfConfigured(map, styleLayers);
              }
              const landmarkConfigLayer = styleLayers.find(
                (layer) => layer.metadata?.["tileflow:landmark-manifest-url"]
              );
              const shouldAddLandmarks =
                landmarkConfigLayer &&
                threeDimensionalEnabled &&
                styleLayerIsVisibleAtZoom(landmarkConfigLayer, map.getZoom()) &&
                !map.getLayer("tileflow-landmarks-3d");
              if (shouldAddLandmarks) {
                // The tree-only path may already be in flight when landmarks
                // are enabled. Reassert the richer runtime here so a shared
                // core promise can never expose an undefined GLTF loader.
                await loadLandmarkPrerequisites(
                  landmarkConfigLayer.metadata["tileflow:landmark-manifest-url"]
                );
                addLandmarkLayerIfConfigured(map, styleLayers);
              }
            })
            .catch((error) => console.warn("Tileflow 3D runtime failed to load", error))
            .finally(() => {
              ensuringThreeDimensionalLayers = undefined;
            });
          return ensuringThreeDimensionalLayers;
        };
        map.on("styledata", ensureThreeDimensionalLayers);
        map.on("styledata", () => applyVisibleLayerGroups(map));
        map.on("zoomend", ensureThreeDimensionalLayers);
        map.on("tileflow:3d-toggle", ensureThreeDimensionalLayers);
        map.on("tileflow:trees-toggle", ensureThreeDimensionalLayers);
        map.on("load", () => {
          writeCameraToUrl(map);
          updateGlobeBackdrop(map);
          ensureThreeDimensionalLayers();
          mountCoreScene(map);
        });
        map.on("move", () => updateGlobeBackdrop(map));
        map.on("style.load", () => updateGlobeBackdrop(map));
        map.on("moveend", () => writeCameraToUrl(map));
        addEventListener("message", (event) => {
          if (
            window.parent === window ||
            event.source !== window.parent ||
            event.origin !== location.origin ||
            event.data?.type !== "tileflow:set-map-state" ||
            event.data?.schemaVersion !== 1 ||
            !threeDimensionalControl ||
            !treeControl
          ) return;
          const state = event.data.state;
          const nextVisibleLayerGroups = state?.visibleLayerGroups;
          const center = state?.center;
          const numericValues = {
            bearing: state?.bearing,
            lat: center?.[1],
            lng: center?.[0],
            pitch: state?.pitch,
            zoom: state?.zoom
          };
          if (
            !Array.isArray(center) ||
            center.length !== 2 ||
            Object.entries(numericValues).some(
              ([name, value]) =>
                !Number.isFinite(value) ||
                value < cameraRanges[name][0] ||
                value > cameraRanges[name][1]
            ) ||
            typeof state?.buildings3d !== "boolean" ||
            typeof state?.trees3d !== "boolean" ||
            (nextVisibleLayerGroups !== undefined &&
              (!Array.isArray(nextVisibleLayerGroups) ||
                new Set(nextVisibleLayerGroups).size !== nextVisibleLayerGroups.length ||
                nextVisibleLayerGroups.some(
                  (group) => !previewLayerGroupIds.includes(group)
                )))
          ) return;
          threeDimensionalControl.setEnabled(state.buildings3d);
          treeControl.setEnabled(state.trees3d);
          if (nextVisibleLayerGroups) {
            setVisibleLayerGroups(map, nextVisibleLayerGroups);
          }
          map.jumpTo({
            bearing: numericValues.bearing,
            center,
            pitch: numericValues.pitch,
            zoom: numericValues.zoom
          });
          writeCameraToUrl(map);
        });
      }

      function applyStatus(next) {
        badge.textContent = ["Tileflow preview", previewLabel, next.status].filter(Boolean).join(" · ");
        if (next.status === "invalid") {
          const diagnostics = next.diagnostics || [];
          status.textContent = diagnostics.map((item) =>
            (item.path ? item.path + ": " : "") + item.message
          ).join("\\n") || "Tileflow config is invalid.";
          status.style.display = "block";
          return;
        }
        status.style.display = "none";
        if (next.status === "ready" && next.generation > initialGeneration) {
          location.reload();
        }
      }

      applyStatus(initialStatus);
      const events = new EventSource(${JSON.stringify(`${basePath}/__events`)});
      // Generations are monotonic only within one dev-server process. A source-code watcher can
      // restart that process at generation 1, so reconnecting after a live connection was lost
      // must refresh the document even when the numeric generation did not increase.
      let eventsConnected = false;
      let eventsDisconnected = false;
      events.addEventListener("open", () => {
        if (eventsConnected && eventsDisconnected) {
          location.reload();
          return;
        }
        eventsConnected = true;
        eventsDisconnected = false;
      });
      events.addEventListener("error", () => {
        if (eventsConnected) eventsDisconnected = true;
      });
      for (const eventName of ["building", "ready", "invalid"]) {
        events.addEventListener(eventName, (event) => applyStatus(JSON.parse(event.data)));
      }
    </script>
  </body>
</html>`;
}

function previewMapOptions(preview: ResolvedTileflowPreview): Record<string, unknown> {
  if (preview.camera.type === 'center') {
    return {
      bearing: preview.camera.bearing,
      center: preview.camera.center,
      pitch: preview.camera.pitch,
      zoom: preview.camera.zoom,
    };
  }

  const [west, south, east, north] = preview.camera.bounds;

  return {
    bearing: preview.camera.bearing,
    bounds: [
      [west, south],
      [east, north],
    ],
    fitBoundsOptions: {padding: preview.camera.padding},
    pitch: preview.camera.pitch,
  };
}

function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/gu,
    (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  );
}
