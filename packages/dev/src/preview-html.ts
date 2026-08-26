import {
  normalizeTileflowLandmarkManifest,
  readBoundedTileflowJsonResponse,
  readBoundedTileflowResponse,
} from './landmarks';
import type {TileflowStyleFontFace} from '@tileflow/core';
import type {ResolvedTileflowPreview} from './preview';

export function renderTileflowPreviewHtml(
  preview: ResolvedTileflowPreview | undefined,
  basePath: string,
  initialStatus: unknown,
  isStreetsPreview: boolean,
  fontFaces: readonly TileflowStyleFontFace[] = [],
): string {
  const styleUrl = preview ? `${basePath}/styles/${preview.mapName}.json` : undefined;
  const mapOptions = preview ? previewMapOptions(preview) : undefined;
  const viewportCss = preview?.viewport
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
        --tileflow-globe-radius: 220px;
        background-color: #2F5070;
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
      #map.tileflow-globe::before {
        content: "";
        position: absolute;
        z-index: 0;
        left: 50%;
        top: 50%;
        width: calc(var(--tileflow-globe-radius) * 2);
        height: calc(var(--tileflow-globe-radius) * 2);
        border: 1px solid rgba(248, 252, 255, 0.88);
        border-radius: 50%;
        box-shadow:
          0 0 9px 3px rgba(248, 252, 255, 0.9),
          0 0 28px 10px rgba(176, 220, 246, 0.52),
          0 0 58px 20px rgba(132, 195, 232, 0.2);
        pointer-events: none;
        transform: translate(-50%, -50%);
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
      .maplibregl-ctrl-group .tileflow-tree-toggle {
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
      .maplibregl-ctrl-group .tileflow-tree-toggle:hover {
        background-color: #F1F3F4;
      }
    </style>
  </head>
  <body>
    <div class="badge" id="badge">Tileflow preview</div>
    <div class="status" id="status" role="status"></div>
    <div id="map"></div>
    <script src="${basePath}/__runtime/maplibre-gl.js"></script>
    <script type="importmap">{"imports":{"fflate":"${basePath}/__runtime/fflate.js","three":"${basePath}/__runtime/three.module.js"}}</script>
    <script type="module">
      import {loadTileflowStyleFonts} from "${basePath}/__runtime/tileflow-browser.js";

      const initialStatus = ${JSON.stringify(initialStatus)};
      const normalizeTileflowLandmarkManifest = ${normalizeTileflowLandmarkManifest.toString()};
      const readBoundedTileflowResponse = ${readBoundedTileflowResponse.toString()};
      const readBoundedTileflowJsonResponse = ${readBoundedTileflowJsonResponse.toString()};
      const initialGeneration = initialStatus.generation;
      const badge = document.getElementById("badge");
      const status = document.getElementById("status");
      const previewLabel = ${JSON.stringify(preview?.label)};
      const styleUrl = ${JSON.stringify(styleUrl)};
      const previewMapOptions = ${JSON.stringify(mapOptions)};
      const isStreetsPreview = ${JSON.stringify(isStreetsPreview)};
      const previewFontFaces = ${serializeInlineJson(fontFaces)};
      const treeSearchParameters = new URL(location.href).searchParams;
      const requestedTreeRenderer = treeSearchParameters.get("treeRenderer");
      const treeRendererMode = ["circle", "simple", "complex"].includes(
        requestedTreeRenderer
      ) ? requestedTreeRenderer : "circle";
      const treeBackendMode = treeSearchParameters.get("treeBackend") === "three"
        ? "three"
        : "webgl2";
      const treeBenchmarkEnabled = treeSearchParameters.get("treeBenchmark") === "1";
      const mapBenchmarkEnabled = treeSearchParameters.get("mapBenchmark") === "1";
      const mapSweepEnabled = treeSearchParameters.get("mapSweep") === "1";
      const mapCompareEnabled = treeSearchParameters.get("mapCompare") === "1";
      const requestedMapCompareLimit = Number(treeSearchParameters.get("mapCompareLimit"));
      const mapCompareLimit =
        Number.isInteger(requestedMapCompareLimit) &&
        requestedMapCompareLimit >= 1 &&
        requestedMapCompareLimit <= 64
          ? requestedMapCompareLimit
          : 16;
      const requestedMapWorkerCount = Number(treeSearchParameters.get("mapWorkers"));
      const mapWorkerCountOverride =
        Number.isInteger(requestedMapWorkerCount) &&
        requestedMapWorkerCount >= 1 &&
        requestedMapWorkerCount <= 3
          ? requestedMapWorkerCount
          : undefined;
      const mapBenchmarkLongitude = Number(treeSearchParameters.get("lng"));
      const mapBenchmarkLatitude = Number(treeSearchParameters.get("lat"));
      const mapBenchmarkCenter =
        treeSearchParameters.has("lng") &&
        treeSearchParameters.has("lat") &&
        Number.isFinite(mapBenchmarkLongitude) &&
        Number.isFinite(mapBenchmarkLatitude)
          ? [mapBenchmarkLongitude, mapBenchmarkLatitude]
          : undefined;
      function readToggleFromUrl(name, fallback) {
        const values = treeSearchParameters.getAll(name);
        if (values.length !== 1) return fallback;
        if (values[0] === "on") return true;
        if (values[0] === "off") return false;
        return fallback;
      }
      const treeFrameSamples = [];
      const treeMetrics = {
        buildMilliseconds: undefined,
        backend: treeBackendMode,
        frameP95Milliseconds: undefined,
        mode: treeRendererMode,
        queryMilliseconds: undefined,
        refreshMilliseconds: undefined,
        renderCalls: 0,
        renderMilliseconds: undefined,
        renderedTriangles: 0,
        selectionMilliseconds: undefined,
        terrainMilliseconds: undefined,
        treeCount: 0
      };
      globalThis.__tileflowTreeMetrics = treeMetrics;
      let threeDimensionalEnabled = readToggleFromUrl("buildings3d", false);
      let treesEnabled = readToggleFromUrl("trees3d", true);
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
            import("${basePath}/__runtime/pmtiles.js")
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

      function updateTreeStatus(message, details = {}) {
        globalThis.__tileflowTreeState = {message, ...details};
      }

      if (treeBenchmarkEnabled) {
        let previousFrameTime;
        function sampleTreeFrame(frameTime) {
          if (previousFrameTime !== undefined) {
            treeFrameSamples.push(frameTime - previousFrameTime);
          }
          previousFrameTime = frameTime;
          if (treeFrameSamples.length < 360) {
            requestAnimationFrame(sampleTreeFrame);
            return;
          }
          treeMetrics.frameP95Milliseconds = percentile(treeFrameSamples, 0.95);
        }
        requestAnimationFrame(sampleTreeFrame);
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

        // A Web Mercator world is 512 * 2^zoom pixels wide. Dividing its
        // circumference by 2π closely tracks MapLibre's on-screen globe radius.
        const radius = Math.min(
          4096,
          ((512 * Math.pow(2, map.getZoom())) / (2 * Math.PI)) * 0.91
        );
        container.classList.add("tileflow-globe");
        container.style.setProperty("--tileflow-globe-radius", radius.toFixed(2) + "px");
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

      function createTreeLayer(map, styleLayer) {
        const maximumTrees = 3000;
        const maximumCachedTrees = 12000;
        const sourceRefreshIntervalMilliseconds = 120;
        const viewportBufferPixels = 96;
        const treeLods = [
          {
            densityCellPixels: 12,
            maximumTrees: 1200,
            name: "low",
            untilZoom: 16.5
          },
          {
            densityCellPixels: 8,
            maximumTrees: 2200,
            name: "medium",
            untilZoom: 17.5
          },
          {
            densityCellPixels: 0,
            maximumTrees,
            name: "full",
            untilZoom: Infinity
          }
        ];
        const sourceId = styleLayer.source;
        const heightField = styleLayer.metadata?.["tileflow:tree-height-field"] ?? "height";
        const crownField = styleLayer.metadata?.["tileflow:tree-crown-field"] ?? "diameter_crown";
        const genusField = styleLayer.metadata?.["tileflow:tree-genus-field"] ?? "genus";
        const leafTypeField = styleLayer.metadata?.["tileflow:tree-leaf-type-field"] ?? "leaf_type";
        const speciesField = styleLayer.metadata?.["tileflow:tree-species-field"] ?? "species";
        const heightScaleValue = Number(
          styleLayer.metadata?.["tileflow:tree-height-scale"] ?? 1
        );
        const crownScaleValue = Number(
          styleLayer.metadata?.["tileflow:tree-crown-scale"] ?? 1
        );
        const heightScale = Number.isFinite(heightScaleValue) && heightScaleValue > 0
          ? heightScaleValue
          : 1;
        const crownScale = Number.isFinite(crownScaleValue) && crownScaleValue > 0
          ? crownScaleValue
          : 1;
        let scene;
        let sceneElevation;
        let sceneOriginMercator;
        let camera;
        let renderer;
        let treeGroup;
        let treeMaterial;
        let treeMeshes = [];
        let treeShadowMesh;
        let treeShadowMaterial;
        let activeTreeBackend = treeBackendMode;
        let rawGl;
        let rawProgram;
        let rawMatrixUniform;
        let rawTreeResources = [];
        let rawShadowProgram;
        let rawShadowMatrixUniform;
        let rawShadowOpacityUniform;
        let rawShadowResource;
        let rawTreesVisible = false;
        const fallbackCircleOpacity = styleLayer.paint?.["circle-opacity"] ?? 0.82;
        const fallbackCircleStrokeOpacity =
          styleLayer.paint?.["circle-stroke-opacity"] ?? 0.55;
        let fallbackVisible = true;
        let emptyRefreshAttempts = 0;
        let emptyRefreshTimer;
        let lastRefreshTime = 0;
        let lastTreeSelectionSignature;
        let refreshQueued = false;
        let refreshTimer;
        let renderedTreeCount = 0;
        let sourceSettled = false;
        const treeStateCache = new Map();
        const matrix = new THREE.Matrix4();
        const mapMatrix = new THREE.Matrix4();
        const sceneMatrix = new THREE.Matrix4();
        const combinedMatrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const crownRotation = new THREE.Quaternion();
        const yAxis = new THREE.Vector3(0, 1, 0);
        const instanceTint = new THREE.Color();
        const shadowMatrix = new THREE.Matrix4();
        const shadowPosition = new THREE.Vector3();
        const shadowScale = new THREE.Vector3();
        const shadowRotation = new THREE.Quaternion();
        const treeShadowLiftMeters = 0.04;
        const treeShadowOpacity = 0.17;
        const barkColor = new THREE.Color(
          styleLayer.metadata?.["tileflow:tree-bark-color"] ?? "#8F8E79"
        );
        const broadleafColorValues =
          styleLayer.metadata?.["tileflow:tree-broadleaf-colors"];
        const broadleafPalette = (
          Array.isArray(broadleafColorValues) && broadleafColorValues.length > 0
            ? broadleafColorValues
            : ["#87BA8C", "#98C89A", "#AAD4A7", "#B8DDB1"]
        ).map((color) => new THREE.Color(color));
        const coniferColorValues = styleLayer.metadata?.["tileflow:tree-conifer-colors"];
        const coniferPalette = (
          Array.isArray(coniferColorValues) && coniferColorValues.length > 0
            ? coniferColorValues
            : ["#77A77E", "#87B58A", "#98C399"]
        ).map((color) => new THREE.Color(color));
        const palmPalette = ["#82B77C", "#91C487", "#A0D093"].map(
          (color) => new THREE.Color(color)
        );

        function addGeometryPart(parts, geometry, partPosition, partScale, rotation, color) {
          const partMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(...partPosition),
            rotation,
            new THREE.Vector3(...partScale)
          );
          geometry.applyMatrix4(partMatrix);
          if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
          const renderGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
          const positions = renderGeometry.getAttribute("position").array;
          const normals = renderGeometry.getAttribute("normal").array;
          const colors = new Float32Array((positions.length / 3) * 3);
          const indices = Uint32Array.from(
            {length: positions.length / 3},
            (_value, index) => index
          );
          for (let index = 0; index < colors.length; index += 3) {
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
          }
          parts.push({
            colors,
            indices,
            normals: new Float32Array(normals),
            positions: new Float32Array(positions)
          });
          if (renderGeometry !== geometry) renderGeometry.dispose();
          geometry.dispose();
        }

        function addTaperedBranchPart(
          parts,
          start,
          end,
          baseRadius,
          tipRadius,
          radialSegments = 6
        ) {
          const startPoint = new THREE.Vector3(...start);
          const endPoint = new THREE.Vector3(...end);
          const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
          const branchRotation = new THREE.Quaternion().setFromUnitVectors(
            yAxis,
            direction.clone().normalize()
          );
          const center = startPoint.clone().add(endPoint).multiplyScalar(0.5);
          addGeometryPart(
            parts,
            new THREE.CylinderGeometry(tipRadius, baseRadius, 1, radialSegments, 1, true),
            [center.x, center.y, center.z],
            [1, direction.length(), 1],
            branchRotation,
            barkColor
          );
        }

        function createOrganicCrownGeometry(seed, simple) {
          const geometry = new THREE.SphereGeometry(
            0.5,
            simple ? 8 : 12,
            simple ? 5 : 7
          );
          const positions = geometry.getAttribute("position");
          for (let index = 0; index < positions.count; index += 1) {
            const x = positions.getX(index);
            const y = positions.getY(index);
            const z = positions.getZ(index);
            const angle = Math.atan2(z, x);
            const normalizedHeight = Math.max(-1, Math.min(1, y * 2));
            const latitudeWeight = 1 - normalizedHeight * normalizedHeight;
            const ripple =
              1 +
              Math.sin(angle * 3 + seed * 1.73) * 0.065 * latitudeWeight +
              Math.sin(angle * 5 - seed * 0.91) * 0.035 * latitudeWeight +
              Math.sin(y * Math.PI * 4 + seed * 0.63) * 0.025;
            positions.setXYZ(
              index,
              x * ripple,
              y * (1 + Math.cos(angle * 2 + seed) * 0.035),
              z * ripple
            );
          }
          positions.needsUpdate = true;
          geometry.deleteAttribute("normal");
          geometry.computeVertexNormals();
          return geometry;
        }

        function createScallopedConeGeometry(seed, simple) {
          const geometry = new THREE.ConeGeometry(
            0.5,
            1,
            simple ? 8 : 12,
            simple ? 2 : 3
          );
          const positions = geometry.getAttribute("position");
          for (let index = 0; index < positions.count; index += 1) {
            const x = positions.getX(index);
            const y = positions.getY(index);
            const z = positions.getZ(index);
            const angle = Math.atan2(z, x);
            const progress = Math.max(0, Math.min(1, y + 0.5));
            const ripple =
              1 +
              Math.sin(angle * 3 + seed * 1.31) * 0.08 +
              Math.sin(angle * 5 - seed * 0.77) * 0.045 +
              Math.sin(progress * Math.PI * 3 + seed) * 0.035;
            positions.setXYZ(
              index,
              x * ripple,
              y + Math.sin(angle * 2 + seed) * (1 - progress) * 0.018,
              z * ripple
            );
          }
          positions.needsUpdate = true;
          geometry.deleteAttribute("normal");
          geometry.computeVertexNormals();
          return geometry;
        }

        function createCurvedPalmFrondGeometry(seed, simple, fan) {
          const segments = simple ? 5 : 8;
          const length = fan ? 0.49 + (seed % 3) * 0.025 : 0.58 + (seed % 3) * 0.03;
          const droop = fan ? 0.16 + (seed % 2) * 0.025 : 0.25 + (seed % 3) * 0.025;
          const sway = (((seed * 37) % 7) - 3) * 0.008;
          const widthScale = fan ? 0.17 : 0.024;
          const centerAt = (progress) => [
            length * progress,
            Math.sin(Math.PI * progress) * (fan ? 0.08 : 0.11) -
              droop * Math.pow(progress, 1.7),
            sway * Math.sin(Math.PI * progress)
          ];
          const points = [];
          for (let step = 0; step <= segments; step += 1) {
            const progress = step / segments;
            const envelope = Math.pow(Math.sin(Math.PI * progress), 0.7) * (1 - 0.25 * progress);
            const width = Math.max(0.008, widthScale * envelope);
            const [centerX, centerY, centerZ] = centerAt(progress);
            points.push(
              [centerX, centerY, centerZ - width],
              [centerX, centerY, centerZ + width]
            );
          }
          const trianglePositions = [];
          const appendTriangle = (first, second, third) => {
            trianglePositions.push(...first, ...second, ...third);
          };
          const appendDoubleSidedQuad = (leftStart, rightStart, leftEnd, rightEnd) => {
            appendTriangle(leftStart, rightStart, leftEnd);
            appendTriangle(rightStart, rightEnd, leftEnd);
            appendTriangle(leftEnd, rightStart, leftStart);
            appendTriangle(leftEnd, rightEnd, rightStart);
          };
          for (let segment = 0; segment < segments; segment += 1) {
            const leftStart = points[segment * 2];
            const rightStart = points[segment * 2 + 1];
            const leftEnd = points[(segment + 1) * 2];
            const rightEnd = points[(segment + 1) * 2 + 1];
            appendDoubleSidedQuad(leftStart, rightStart, leftEnd, rightEnd);
          }
          if (!fan) {
            const leafletCount = simple ? 4 : 7;
            for (let leaflet = 0; leaflet < leafletCount; leaflet += 1) {
              const progress = 0.17 + (leaflet / (leafletCount - 1)) * 0.66;
              const [centerX, centerY, centerZ] = centerAt(progress);
              const leafletLength =
                (0.075 + Math.sin(Math.PI * progress) * 0.095) *
                (0.94 + ((leaflet + seed) % 3) * 0.035);
              const leafletWidth = 0.018 + Math.sin(Math.PI * progress) * 0.012;
              const leafletBack = 0.018 + ((leaflet + seed) % 2) * 0.012;
              const leafletDrop = 0.022 + progress * 0.045;
              for (const side of [-1, 1]) {
                const base = [centerX - 0.014, centerY, centerZ + side * 0.007];
                const midCenter = [
                  centerX + 0.012,
                  centerY - leafletDrop * 0.35,
                  centerZ + side * leafletLength * 0.58
                ];
                const midLeft = [
                  midCenter[0] - leafletWidth,
                  midCenter[1],
                  midCenter[2] - side * leafletWidth * 0.14
                ];
                const midRight = [
                  midCenter[0] + leafletWidth,
                  midCenter[1],
                  midCenter[2] + side * leafletWidth * 0.14
                ];
                const tip = [
                  centerX - leafletBack,
                  centerY - leafletDrop,
                  centerZ + side * leafletLength
                ];
                appendTriangle(base, midRight, midLeft);
                appendTriangle(midLeft, midRight, tip);
                appendTriangle(midLeft, midRight, base);
                appendTriangle(tip, midRight, midLeft);
              }
            }
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(trianglePositions, 3)
          );
          geometry.computeVertexNormals();
          return geometry;
        }

        function mergeGeometryParts(parts) {
          const positionLength = parts.reduce((total, part) => total + part.positions.length, 0);
          const positions = new Float32Array(positionLength);
          const normals = new Float32Array(positionLength);
          const colors = new Float32Array(positionLength);
          const indexLength = parts.reduce((total, part) => total + part.indices.length, 0);
          const indices = new Uint32Array(indexLength);
          let offset = 0;
          let indexOffset = 0;
          let vertexOffset = 0;
          for (const part of parts) {
            positions.set(part.positions, offset);
            normals.set(part.normals, offset);
            colors.set(part.colors, offset);
            for (let index = 0; index < part.indices.length; index += 1) {
              indices[indexOffset + index] = part.indices[index] + vertexOffset;
            }
            indexOffset += part.indices.length;
            vertexOffset += part.positions.length / 3;
            offset += part.positions.length;
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
          geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          geometry.setIndex(new THREE.BufferAttribute(indices, 1));
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          return geometry;
        }

        function createBroadleafTreeGeometry(variant, geometryVariant, simple) {
          const parts = [];
          const trunkTops = [
            [0.008, 0.56, -0.004],
            [-0.012, 0.51, 0.008],
            [0.006, 0.62, 0.004]
          ];
          const trunkTopBase = trunkTops[variant] ?? trunkTops[0];
          const trunkTop = [
            trunkTopBase[0] + (geometryVariant === 0 ? -0.008 : 0.012),
            trunkTopBase[1] + (geometryVariant === 0 ? -0.012 : 0.016),
            trunkTopBase[2] + (geometryVariant === 0 ? 0.006 : -0.01)
          ];
          addTaperedBranchPart(
            parts,
            [0, 0, 0],
            trunkTop,
            0.04 + variant * 0.001,
            0.022,
            simple ? 6 : 8
          );

          const branchTargetLayouts = [
            [
              [-0.2, 0.72, 0.03],
              [0.01, 0.79, -0.04],
              [0.21, 0.72, -0.02],
              [-0.03, 0.7, 0.18],
              [0.06, 0.73, -0.17]
            ],
            [
              [-0.27, 0.68, 0.02],
              [-0.09, 0.76, -0.08],
              [0.25, 0.69, -0.03],
              [0.06, 0.72, 0.2],
              [0.13, 0.79, -0.13]
            ],
            [
              [-0.15, 0.75, 0.02],
              [0.04, 0.86, -0.04],
              [0.16, 0.77, 0.01],
              [0.02, 0.8, 0.15]
            ]
          ];
          const branchTargets = branchTargetLayouts[variant] ?? branchTargetLayouts[0];
          const branchCount = simple ? Math.min(4, branchTargets.length) : branchTargets.length;
          for (let branch = 0; branch < branchCount; branch += 1) {
            const branchTarget = branchTargets[branch];
            const shelteredBranchTarget = [
              branchTarget[0] * 0.86,
              branchTarget[1] - 0.07,
              branchTarget[2] * 0.86
            ];
            addTaperedBranchPart(
              parts,
              [trunkTop[0] * 0.55, 0.38 + branch * 0.018, trunkTop[2] * 0.55],
              shelteredBranchTarget,
              0.022 - branch * 0.0015,
              0.0095 - branch * 0.00065,
              simple ? 5 : 7
            );
          }

          const roundCrownLayout = [
            {position: [0, 0.8, 0.01], scale: [0.72, 0.39, 0.66]},
            {position: [-0.27, 0.73, 0.05], scale: [0.45, 0.26, 0.42]},
            {position: [0.27, 0.75, -0.06], scale: [0.44, 0.25, 0.41]},
            {position: [-0.08, 0.7, 0.24], scale: [0.4, 0.23, 0.37]},
            {position: [0.1, 0.72, -0.24], scale: [0.41, 0.24, 0.38]}
          ];
          const openCrownLayout = [
            {position: [-0.29, 0.72, 0.03], scale: [0.47, 0.22, 0.39]},
            {position: [-0.08, 0.83, -0.1], scale: [0.44, 0.24, 0.36]},
            {position: [0.22, 0.79, -0.04], scale: [0.49, 0.22, 0.4]},
            {position: [0.31, 0.67, 0.09], scale: [0.4, 0.19, 0.34]},
            {position: [0.04, 0.68, 0.22], scale: [0.45, 0.21, 0.38]},
            {position: [-0.19, 0.65, 0.18], scale: [0.38, 0.18, 0.32]}
          ];
          const tallCrownLayout = [
            {position: [0, 0.79, 0.01], scale: [0.53, 0.58, 0.48]},
            {position: [-0.19, 0.76, 0.05], scale: [0.34, 0.4, 0.32]},
            {position: [0.18, 0.8, -0.05], scale: [0.34, 0.42, 0.31]},
            {position: [-0.05, 0.94, -0.08], scale: [0.32, 0.34, 0.3]},
            {position: [0.06, 0.69, 0.15], scale: [0.32, 0.35, 0.3]}
          ];
          const crownLayouts = [roundCrownLayout, openCrownLayout, tallCrownLayout];
          const crownLayout = crownLayouts[variant] ?? crownLayouts[0];
          const lobeCount = simple ? Math.max(4, crownLayout.length - 1) : crownLayout.length;
          const crownColorPatterns = [
            [2, 1, 3, 0, 1],
            [1, 2, 0, 3, 1, 2],
            [2, 1, 3, 1, 2]
          ];
          const crownColorPattern = crownColorPatterns[variant] ?? crownColorPatterns[0];
          for (let lobe = 0; lobe < lobeCount; lobe += 1) {
            const lobeShape = crownLayout[lobe];
            const lobeSeed = variant * 23 + geometryVariant * 11 + lobe * 3;
            const lobePosition = [
              lobeShape.position[0] + Math.sin(lobeSeed * 1.7) * 0.018,
              lobeShape.position[1] + Math.cos(lobeSeed * 1.1) * 0.012,
              lobeShape.position[2] + Math.cos(lobeSeed * 1.9) * 0.018
            ];
            addGeometryPart(
              parts,
              createOrganicCrownGeometry(lobeSeed, simple),
              lobePosition,
              lobeShape.scale,
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                  ((lobe % 3) - 1) * 0.09,
                  variant * 0.41 + geometryVariant * 0.27 + lobe * 0.37,
                  (((lobe + variant + geometryVariant) % 3) - 1) * 0.11
                )
              ),
              broadleafPalette[
                (crownColorPattern[lobe] + geometryVariant * 2) % broadleafPalette.length
              ]
            );
          }
          const crownCapShapes = [
            {position: [0.01, 0.9, 0], scale: [0.3, 0.18, 0.28]},
            {position: [0, 0.84, 0.01], scale: [0.29, 0.17, 0.27]},
            {position: [0, 0.96, 0], scale: [0.24, 0.22, 0.23]}
          ];
          const crownCapShape = crownCapShapes[variant] ?? crownCapShapes[0];
          addGeometryPart(
            parts,
            createOrganicCrownGeometry(149 + variant * 17 + geometryVariant * 7, simple),
            crownCapShape.position,
            crownCapShape.scale,
            new THREE.Quaternion().setFromAxisAngle(
              yAxis,
              variant * 0.31 + geometryVariant * 0.43
            ),
            broadleafPalette[(1 + variant + geometryVariant * 2) % broadleafPalette.length]
          );
          return mergeGeometryParts(parts);
        }

        function createConiferTreeGeometry(variant, geometryVariant, simple) {
          const parts = [];
          const columnar = variant === 1;
          addTaperedBranchPart(
            parts,
            [0, 0, 0],
            [variant === 0 ? 0.006 : -0.006, columnar ? 0.54 : 0.43, 0],
            0.035,
            0.018,
            simple ? 6 : 8
          );
          if (columnar) {
            const columnarCrownLayout = [
              {position: [-0.01, 0.5, 0.01], scale: [0.38, 0.48, 0.36]},
              {position: [0.01, 0.66, -0.01], scale: [0.42, 0.5, 0.39]},
              {position: [-0.015, 0.8, 0.01], scale: [0.34, 0.42, 0.32]},
              {position: [0.008, 0.91, 0], scale: [0.22, 0.28, 0.21]}
            ];
            const massCount = simple ? 3 : columnarCrownLayout.length;
            for (let mass = 0; mass < massCount; mass += 1) {
              const crownMass = columnarCrownLayout[mass];
              addGeometryPart(
                parts,
                createOrganicCrownGeometry(71 + geometryVariant * 13 + mass * 5, simple),
                crownMass.position,
                crownMass.scale,
                new THREE.Quaternion().setFromAxisAngle(yAxis, mass * 0.43),
                coniferPalette[(mass + 1) % coniferPalette.length]
              );
            }
            return mergeGeometryParts(parts);
          }
          const tierCount = simple ? 3 : 5;
          for (let tier = 0; tier < tierCount; tier += 1) {
            const progress = tier / (tierCount - 1);
            const tierDiameter = 0.94 - progress * 0.5;
            const tierHeight = 0.35 - progress * 0.075;
            addGeometryPart(
              parts,
              createScallopedConeGeometry(geometryVariant * 19 + tier * 7, simple),
              [
                Math.sin(tier * 2.1 + geometryVariant) * 0.012,
                0.45 + progress * 0.44,
                Math.cos(tier * 1.7 + geometryVariant) * 0.012
              ],
              [tierDiameter, tierHeight, tierDiameter],
              new THREE.Quaternion().setFromAxisAngle(
                yAxis,
                variant * 0.6 + geometryVariant * 0.29 + tier * 0.31
              ),
              coniferPalette[(variant + tier) % coniferPalette.length]
            );
          }
          return mergeGeometryParts(parts);
        }

        function createPalmTreeGeometry(geometryVariant, simple) {
          const parts = [];
          const fan = geometryVariant === 1;
          const lowerTrunkTop = [fan ? -0.014 : 0.012, 0.42, fan ? 0.006 : -0.004];
          const upperTrunkTop = [fan ? 0.014 : -0.012, fan ? 0.73 : 0.78, fan ? -0.008 : 0.012];
          addTaperedBranchPart(parts, [0, 0, 0], lowerTrunkTop, 0.032, 0.026, simple ? 7 : 9);
          addTaperedBranchPart(
            parts,
            lowerTrunkTop,
            upperTrunkTop,
            0.026,
            0.016,
            simple ? 7 : 9
          );
          addGeometryPart(
            parts,
            createOrganicCrownGeometry(113 + geometryVariant * 17, simple),
            [upperTrunkTop[0], upperTrunkTop[1] + 0.018, upperTrunkTop[2]],
            [fan ? 0.19 : 0.16, 0.1, fan ? 0.19 : 0.16],
            new THREE.Quaternion(),
            palmPalette[1]
          );
          const frondCount = simple ? (fan ? 8 : 7) : (fan ? 12 : 11);
          for (let frond = 0; frond < frondCount; frond += 1) {
            const angle =
              (frond / frondCount) * Math.PI * 2 +
              (((frond * 5 + geometryVariant) % 3) - 1) * 0.045;
            addGeometryPart(
              parts,
              createCurvedPalmFrondGeometry(frond + geometryVariant * 17, simple, fan),
              [upperTrunkTop[0], upperTrunkTop[1] + 0.018, upperTrunkTop[2]],
              [0.94 + (frond % 3) * 0.035, 0.96 + (frond % 2) * 0.035, 1],
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                  (((frond * 7 + geometryVariant) % 3) - 1) * 0.045,
                  -angle,
                  (((frond * 5 + geometryVariant) % 5) - 2) * 0.022
                )
              ),
              palmPalette[(frond + geometryVariant) % palmPalette.length]
            );
          }
          return mergeGeometryParts(parts);
        }

        function createTreeGeometries() {
          const simple = treeRendererMode === "simple";
          return [
            createBroadleafTreeGeometry(0, 0, simple),
            createBroadleafTreeGeometry(0, 1, simple),
            createBroadleafTreeGeometry(1, 0, simple),
            createBroadleafTreeGeometry(1, 1, simple),
            createBroadleafTreeGeometry(2, 0, simple),
            createBroadleafTreeGeometry(2, 1, simple),
            createConiferTreeGeometry(0, 0, simple),
            createConiferTreeGeometry(1, 0, simple),
            createPalmTreeGeometry(0, simple),
            createPalmTreeGeometry(1, simple)
          ];
        }

        function compileRawShader(gl, type, source) {
          const shader = gl.createShader(type);
          if (!shader) throw new Error("Unable to create tree shader");
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || "unknown shader error";
            gl.deleteShader(shader);
            throw new Error(message);
          }
          return shader;
        }

        function createRawTreeProgram(gl) {
          const vertexShader = compileRawShader(
            gl,
            gl.VERTEX_SHADER,
            "#version 300 es\\n" +
              "precision highp float;\\n" +
              "layout(location=0) in vec3 a_position;\\n" +
              "layout(location=1) in vec3 a_normal;\\n" +
              "layout(location=2) in vec3 a_color;\\n" +
              "layout(location=3) in vec3 a_instance_position;\\n" +
              "layout(location=4) in vec3 a_instance_scale;\\n" +
              "layout(location=5) in vec2 a_instance_rotation;\\n" +
              "layout(location=6) in float a_instance_tint;\\n" +
              "uniform mat4 u_matrix;\\n" +
              "out vec3 v_color;\\n" +
              "void main() {\\n" +
              "  vec2 horizontal = a_position.xz * a_instance_scale.xz;\\n" +
              "  vec2 rotated = vec2(\\n" +
              "    horizontal.x * a_instance_rotation.x - horizontal.y * a_instance_rotation.y,\\n" +
              "    horizontal.x * a_instance_rotation.y + horizontal.y * a_instance_rotation.x\\n" +
              "  );\\n" +
              "  vec3 scaledNormal = normalize(a_normal / max(a_instance_scale, vec3(0.001)));\\n" +
              "  vec2 normalHorizontal = vec2(\\n" +
              "    scaledNormal.x * a_instance_rotation.x - scaledNormal.z * a_instance_rotation.y,\\n" +
              "    scaledNormal.x * a_instance_rotation.y + scaledNormal.z * a_instance_rotation.x\\n" +
              "  );\\n" +
              "  vec3 mapNormal = normalize(vec3(normalHorizontal.x, normalHorizontal.y, scaledNormal.y));\\n" +
              "  float sky = mapNormal.z * 0.5 + 0.5;\\n" +
              "  float key = max(dot(mapNormal, normalize(vec3(-0.35, -0.5, 0.78))), 0.0);\\n" +
              "  float heightOcclusion = mix(0.84, 1.0, smoothstep(0.16, 0.88, a_position.y));\\n" +
              "  float light = (0.67 + sky * 0.18 + key * 0.23) * heightOcclusion;\\n" +
              "  v_color = a_color * light * a_instance_tint;\\n" +
              "  vec3 mapPosition = vec3(\\n" +
              "    a_instance_position.x + rotated.x,\\n" +
              "    a_instance_position.z + rotated.y,\\n" +
              "    a_instance_position.y + a_position.y * a_instance_scale.y\\n" +
              "  );\\n" +
              "  gl_Position = u_matrix * vec4(mapPosition, 1.0);\\n" +
              "}\\n"
          );
          const fragmentShader = compileRawShader(
            gl,
            gl.FRAGMENT_SHADER,
            "#version 300 es\\n" +
              "precision highp float;\\n" +
              "in vec3 v_color;\\n" +
              "out vec4 out_color;\\n" +
              "vec3 linearToSrgb(vec3 color) {\\n" +
              "  vec3 lower = color * 12.92;\\n" +
              "  vec3 upper = 1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055;\\n" +
              "  return mix(lower, upper, step(vec3(0.0031308), color));\\n" +
              "}\\n" +
              "void main() { out_color = vec4(linearToSrgb(v_color), 1.0); }\\n"
          );
          const program = gl.createProgram();
          if (!program) throw new Error("Unable to create tree program");
          gl.attachShader(program, vertexShader);
          gl.attachShader(program, fragmentShader);
          gl.linkProgram(program);
          gl.deleteShader(vertexShader);
          gl.deleteShader(fragmentShader);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || "unknown program error";
            gl.deleteProgram(program);
            throw new Error(message);
          }
          return program;
        }

        function createRawTreeShadowProgram(gl) {
          const vertexShader = compileRawShader(
            gl,
            gl.VERTEX_SHADER,
            "#version 300 es\\n" +
              "precision highp float;\\n" +
              "layout(location=0) in vec2 a_corner;\\n" +
              "layout(location=1) in vec4 a_instance;\\n" +
              "uniform mat4 u_matrix;\\n" +
              "out vec2 v_shadow_coordinate;\\n" +
              "void main() {\\n" +
              "  v_shadow_coordinate = a_corner;\\n" +
              "  vec2 shadowOffset = vec2(-0.28, 0.34) * a_instance.w;\\n" +
              "  vec2 shadowPosition = a_corner * vec2(1.0, 0.76) * a_instance.w + shadowOffset;\\n" +
              "  vec3 mapPosition = vec3(\\n" +
              "    a_instance.x + shadowPosition.x,\\n" +
              "    a_instance.z + shadowPosition.y,\\n" +
              "    a_instance.y + 0.04\\n" +
              "  );\\n" +
              "  gl_Position = u_matrix * vec4(mapPosition, 1.0);\\n" +
              "}\\n"
          );
          const fragmentShader = compileRawShader(
            gl,
            gl.FRAGMENT_SHADER,
            "#version 300 es\\n" +
              "precision mediump float;\\n" +
              "in vec2 v_shadow_coordinate;\\n" +
              "uniform float u_opacity;\\n" +
              "out vec4 out_color;\\n" +
              "void main() {\\n" +
              "  float radiusSquared = dot(v_shadow_coordinate, v_shadow_coordinate);\\n" +
              "  if (radiusSquared >= 1.0) discard;\\n" +
              "  float coverage = 1.0 - smoothstep(0.90, 1.0, radiusSquared);\\n" +
              "  float alpha = u_opacity * coverage;\\n" +
              "  out_color = vec4(0.18, 0.21, 0.17, alpha);\\n" +
              "}\\n"
          );
          const program = gl.createProgram();
          if (!program) throw new Error("Unable to create tree shadow program");
          gl.attachShader(program, vertexShader);
          gl.attachShader(program, fragmentShader);
          gl.linkProgram(program);
          gl.deleteShader(vertexShader);
          gl.deleteShader(fragmentShader);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || "unknown tree shadow program error";
            gl.deleteProgram(program);
            throw new Error(message);
          }
          return program;
        }

        function createRawTreeShadowResource(gl) {
          const vertexArray = gl.createVertexArray();
          const cornerBuffer = gl.createBuffer();
          const instanceBuffer = gl.createBuffer();
          if (!vertexArray || !cornerBuffer || !instanceBuffer) {
            throw new Error("Unable to allocate tree shadow buffers");
          }
          gl.bindVertexArray(vertexArray);
          gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
          gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
            gl.STATIC_DRAW
          );
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
          gl.vertexAttribDivisor(1, 1);
          gl.bindVertexArray(null);
          return {cornerBuffer, count: 0, instanceBuffer, vertexArray};
        }

        function createRawTreeResource(gl, geometry) {
          const vertexArray = gl.createVertexArray();
          const positionBuffer = gl.createBuffer();
          const normalBuffer = gl.createBuffer();
          const colorBuffer = gl.createBuffer();
          const indexBuffer = gl.createBuffer();
          const instanceBuffer = gl.createBuffer();
          if (
            !vertexArray ||
            !positionBuffer ||
            !normalBuffer ||
            !colorBuffer ||
            !indexBuffer ||
            !instanceBuffer
          ) {
            throw new Error("Unable to allocate tree buffers");
          }
          gl.bindVertexArray(vertexArray);
          const attributes = [
            [0, positionBuffer, geometry.getAttribute("position").array],
            [1, normalBuffer, geometry.getAttribute("normal").array],
            [2, colorBuffer, geometry.getAttribute("color").array]
          ];
          for (const [location, buffer, values] of attributes) {
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
          }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.index.array, gl.STATIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
          gl.enableVertexAttribArray(3);
          gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 36, 0);
          gl.vertexAttribDivisor(3, 1);
          gl.enableVertexAttribArray(4);
          gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 36, 12);
          gl.vertexAttribDivisor(4, 1);
          gl.enableVertexAttribArray(5);
          gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 36, 24);
          gl.vertexAttribDivisor(5, 1);
          gl.enableVertexAttribArray(6);
          gl.vertexAttribPointer(6, 1, gl.FLOAT, false, 36, 32);
          gl.vertexAttribDivisor(6, 1);
          gl.bindVertexArray(null);
          return {
            colorBuffer,
            count: 0,
            indexBuffer,
            indexCount: geometry.index.count,
            instanceBuffer,
            normalBuffer,
            positionBuffer,
            vertexArray
          };
        }

        function disposeRawTreeResources() {
          if (!rawGl) return;
          for (const resource of rawTreeResources) {
            rawGl.deleteBuffer(resource.positionBuffer);
            rawGl.deleteBuffer(resource.normalBuffer);
            rawGl.deleteBuffer(resource.colorBuffer);
            rawGl.deleteBuffer(resource.indexBuffer);
            rawGl.deleteBuffer(resource.instanceBuffer);
            rawGl.deleteVertexArray(resource.vertexArray);
          }
          rawTreeResources = [];
          if (rawProgram) rawGl.deleteProgram(rawProgram);
          if (rawShadowResource) {
            rawGl.deleteBuffer(rawShadowResource.cornerBuffer);
            rawGl.deleteBuffer(rawShadowResource.instanceBuffer);
            rawGl.deleteVertexArray(rawShadowResource.vertexArray);
          }
          if (rawShadowProgram) rawGl.deleteProgram(rawShadowProgram);
          rawProgram = undefined;
          rawMatrixUniform = undefined;
          rawShadowProgram = undefined;
          rawShadowMatrixUniform = undefined;
          rawShadowOpacityUniform = undefined;
          rawShadowResource = undefined;
        }

        function numberProperty(properties, name) {
          const value = Number(properties?.[name]);
          return Number.isFinite(value) && value > 0 ? value : undefined;
        }

        function stableTreeKey(feature, lng, lat) {
          const properties = feature.properties ?? {};
          const sourceFeatureId =
            properties.osm_id ??
            properties.osmId ??
            properties.id ??
            properties["@id"] ??
            feature.id;
          return sourceFeatureId === undefined || sourceFeatureId === null
            ? lng.toFixed(6) + ":" + lat.toFixed(6)
            : String(sourceFeatureId);
        }

        function stableUnit(key, salt = 0) {
          let hash = (2166136261 ^ salt) >>> 0;
          for (let index = 0; index < key.length; index += 1) {
            hash ^= key.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
          }
          hash += hash << 13;
          hash ^= hash >>> 7;
          hash += hash << 3;
          hash ^= hash >>> 17;
          hash += hash << 5;
          return (hash >>> 0) / 4294967296;
        }

        function treeLodForZoom(zoom) {
          return treeLods.find((lod) => zoom < lod.untilZoom) ?? treeLods.at(-1);
        }

        function setFallbackVisible(visible) {
          if (fallbackVisible === visible || !map.getLayer(styleLayer.id)) return;
          map.setPaintProperty(
            styleLayer.id,
            "circle-opacity",
            visible ? fallbackCircleOpacity : 0
          );
          map.setPaintProperty(
            styleLayer.id,
            "circle-stroke-opacity",
            visible ? fallbackCircleStrokeOpacity : 0
          );
          fallbackVisible = visible;
        }

        function updateFallbackVisibility() {
          // A non-empty query can still represent only one loaded tile. Keep
          // the vector circles underneath until MapLibre reports the complete
          // source settled, otherwise a partial 3D batch erases neighbouring
          // tiles at source boundaries.
          setFallbackVisible(!sourceSettled || renderedTreeCount === 0);
        }

        function treeSelectionSignature(trees, lodName) {
          let hash = 2166136261;
          for (const tree of trees) {
            for (let index = 0; index < tree.key.length; index += 1) {
              hash ^= tree.key.charCodeAt(index);
              hash = Math.imul(hash, 16777619);
            }
            hash ^= 0xff;
            hash = Math.imul(hash, 16777619);
          }
          return lodName + ":" + trees.length + ":" + (hash >>> 0);
        }

        function selectVisibleTrees(features, lod) {
          const worldSize = 512 * Math.pow(2, map.getZoom());
          const seen = new Set();
          const candidates = [];
          for (const feature of features) {
            if (feature.geometry?.type !== "Point") continue;
            const [lng, lat] = feature.geometry.coordinates;
            const key = stableTreeKey(feature, lng, lat);
            if (seen.has(key)) continue;
            seen.add(key);
            const latitudeSine = Math.sin(
              (Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI) / 180
            );
            const worldX = ((lng + 180) / 360) * worldSize;
            const worldY =
              (0.5 - Math.log((1 + latitudeSine) / (1 - latitudeSine)) / (4 * Math.PI)) *
              worldSize;
            candidates.push({feature, key, lat, lng, worldX, worldY});
          }
          candidates.sort((left, right) =>
            left.key < right.key ? -1 : left.key > right.key ? 1 : 0
          );
          if (lod.densityCellPixels === 0) return candidates.slice(0, lod.maximumTrees);
          const occupiedCells = new Set();
          const selected = [];
          for (const candidate of candidates) {
            const cellKey =
              Math.floor(candidate.worldX / lod.densityCellPixels) +
              ":" +
              Math.floor(candidate.worldY / lod.densityCellPixels);
            if (occupiedCells.has(cellKey)) continue;
            occupiedCells.add(cellKey);
            selected.push(candidate);
            if (selected.length >= lod.maximumTrees) break;
          }
          return selected;
        }

        function rememberTreeState(key, state) {
          if (treeStateCache.size >= maximumCachedTrees) {
            treeStateCache.delete(treeStateCache.keys().next().value);
          }
          treeStateCache.set(key, state);
          return state;
        }

        const treeFormDimensions = {
          round: {crownMaximum: 0.9, crownMinimum: 0.66, heightMaximum: 12, heightMinimum: 6},
          open: {crownMaximum: 1.05, crownMinimum: 0.8, heightMaximum: 10, heightMinimum: 5},
          tall: {crownMaximum: 0.68, crownMinimum: 0.48, heightMaximum: 17, heightMinimum: 9},
          conifer: {crownMaximum: 0.66, crownMinimum: 0.46, heightMaximum: 16, heightMinimum: 7},
          columnar: {crownMaximum: 0.36, crownMinimum: 0.22, heightMaximum: 18, heightMinimum: 9},
          palm: {crownMaximum: 0.5, crownMinimum: 0.34, heightMaximum: 16, heightMinimum: 8}
        };

        function resolveTreeState(feature, key, lng, lat, treeElevation) {
          const cached = treeStateCache.get(key);
          if (cached) return cached;
          const variation = stableUnit(key, 1);
          const form = resolveTreeForm(feature.properties, key);
          const dimensions = treeFormDimensions[form] ?? treeFormDimensions.round;
          const baseHeight = Math.min(
            32,
            numberProperty(feature.properties, heightField) ??
              dimensions.heightMinimum +
                variation * (dimensions.heightMaximum - dimensions.heightMinimum)
          );
          const baseCrownDiameter = Math.min(
            20,
            numberProperty(feature.properties, crownField) ??
              baseHeight *
                (dimensions.crownMinimum +
                  stableUnit(key, 2) * (dimensions.crownMaximum - dimensions.crownMinimum))
          );
          return rememberTreeState(key, {
            colorGain: 0.94 + stableUnit(key, 13) * 0.12,
            crownAspect: 0.92 + stableUnit(key, 11) * 0.16,
            crownDiameter:
              baseCrownDiameter * crownScale * (0.94 + stableUnit(key, 5) * 0.12),
            form,
            height: baseHeight * heightScale,
            lat,
            lng,
            treeElevation,
            variantIndex: treeVariantIndex(form, key)
          });
        }

        function ensureSceneOrigin(elevation) {
          if (sceneOriginMercator) return;
          const center = map.getCenter();
          sceneElevation = elevation;
          sceneOriginMercator = maplibregl.MercatorCoordinate.fromLngLat(
            center,
            sceneElevation
          );
        }

        function localTreePosition(lng, lat, elevation) {
          const mercator = maplibregl.MercatorCoordinate.fromLngLat([lng, lat]);
          const mercatorPerMeter = sceneOriginMercator.meterInMercatorCoordinateUnits();
          return new THREE.Vector3(
            (mercator.x - sceneOriginMercator.x) / mercatorPerMeter,
            elevation - sceneElevation,
            (sceneOriginMercator.y - mercator.y) / mercatorPerMeter
          );
        }

        function createTerrainSampler(trees, fallbackElevation) {
          const gridSize = 5;
          const longitudes = trees.map((tree) => tree.lng);
          const latitudes = trees.map((tree) => tree.lat);
          const minimumLongitude = Math.min(...longitudes);
          const maximumLongitude = Math.max(...longitudes);
          const minimumLatitude = Math.min(...latitudes);
          const maximumLatitude = Math.max(...latitudes);
          const longitudeSpan = Math.max(1e-9, maximumLongitude - minimumLongitude);
          const latitudeSpan = Math.max(1e-9, maximumLatitude - minimumLatitude);
          const elevations = new Float32Array(gridSize * gridSize);
          for (let y = 0; y < gridSize; y += 1) {
            for (let x = 0; x < gridSize; x += 1) {
              const longitude = minimumLongitude + (x / (gridSize - 1)) * longitudeSpan;
              const latitude = minimumLatitude + (y / (gridSize - 1)) * latitudeSpan;
              elevations[y * gridSize + x] =
                map.queryTerrainElevation([longitude, latitude]) ?? fallbackElevation;
            }
          }
          return (longitude, latitude) => {
            const gridX = Math.max(
              0,
              Math.min(gridSize - 1, ((longitude - minimumLongitude) / longitudeSpan) * (gridSize - 1))
            );
            const gridY = Math.max(
              0,
              Math.min(gridSize - 1, ((latitude - minimumLatitude) / latitudeSpan) * (gridSize - 1))
            );
            const x0 = Math.floor(gridX);
            const y0 = Math.floor(gridY);
            const x1 = Math.min(gridSize - 1, x0 + 1);
            const y1 = Math.min(gridSize - 1, y0 + 1);
            const xMix = gridX - x0;
            const yMix = gridY - y0;
            const bottom = elevations[y0 * gridSize + x0] * (1 - xMix) +
              elevations[y0 * gridSize + x1] * xMix;
            const top = elevations[y1 * gridSize + x0] * (1 - xMix) +
              elevations[y1 * gridSize + x1] * xMix;
            return bottom * (1 - yMix) + top * yMix;
          };
        }

        function botanicalName(properties) {
          return [properties?.[genusField], properties?.[speciesField]]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
        }

        function resolveTreeForm(properties, key) {
          const leafType = String(properties?.[leafTypeField] ?? "").toLowerCase();
          const botanical = botanicalName(properties);
          if (
            leafType.includes("palm") ||
            /(?:^| )(?:archontophoenix|arecaceae|butia|chamaerops|cocos|howea|livistona|phoenix|sabal|syagrus|trachycarpus|washingtonia)(?: |$)/.test(
              botanical
            )
          ) return "palm";
          if (/(?:^| )(?:cupressus|cypress)(?: |$)/.test(botanical)) return "columnar";
          if (
            leafType.includes("needle") ||
            /(?:^| )(?:abies|cedrus|juniperus|picea|pinus|taxodium|taxus)(?: |$)/.test(botanical)
          ) return "conifer";
          if (
            /(?:^| )(?:arbutus|olea|quercus|tamarix)(?: |$)/.test(botanical)
          ) return "open";
          if (
            /(?:^| )(?:celtis|ginkgo|platanus|populus|ulmus)(?: |$)/.test(botanical)
          ) return "tall";
          return ["round", "open", "tall"][Math.floor(stableUnit(key, 67) * 3)];
        }

        function treeVariantIndex(form, key) {
          const alternate = Math.floor(stableUnit(key, 101) * 2);
          const base = {
            round: 0,
            open: 2,
            tall: 4,
            conifer: 6,
            columnar: 7,
            palm: 8
          }[form] ?? 0;
          return base + (["round", "open", "tall", "palm"].includes(form) ? alternate : 0);
        }

        function refresh() {
          const refreshStartedAt = performance.now();
          refreshQueued = false;
          lastRefreshTime = performance.now();
          if (
            activeTreeBackend === "three"
              ? !treeGroup || treeMeshes.length === 0
              : rawTreeResources.length === 0
          ) return;
          if (!treesEnabled) {
            if (treeGroup) treeGroup.visible = false;
            rawTreesVisible = false;
            setFallbackVisible(false);
            return;
          }
          if (map.getZoom() < 15.5) {
            for (const treeMesh of treeMeshes) treeMesh.count = 0;
            for (const resource of rawTreeResources) resource.count = 0;
            if (treeShadowMesh) treeShadowMesh.count = 0;
            if (rawShadowResource) rawShadowResource.count = 0;
            if (treeGroup) treeGroup.visible = false;
            rawTreesVisible = false;
            renderedTreeCount = 0;
            treeMetrics.treeCount = 0;
            treeMetrics.refreshMilliseconds = performance.now() - refreshStartedAt;
            lastTreeSelectionSignature = undefined;
            setFallbackVisible(true);
            updateTreeStatus("zoom too low", {phase: "refresh", treeCount: 0});
            map.triggerRepaint();
            return;
          }
          let features;
          const queryStartedAt = performance.now();
          try {
            const canvas = map.getCanvas();
            const viewportWidth = canvas.clientWidth || canvas.width;
            const viewportHeight = canvas.clientHeight || canvas.height;
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
            updateTreeStatus("error reading source", {
              error: String(error),
              phase: "refresh",
              treeCount: 0
            });
            return;
          }
          treeMetrics.queryMilliseconds = performance.now() - queryStartedAt;
          sourceSettled = map.isSourceLoaded(sourceId);
          const lod = treeLodForZoom(map.getZoom());
          const selectionStartedAt = performance.now();
          const visibleTrees = selectVisibleTrees(features, lod);
          treeMetrics.selectionMilliseconds = performance.now() - selectionStartedAt;
          if (visibleTrees.length === 0) {
            updateFallbackVisibility();
            if (emptyRefreshAttempts < 12) {
              emptyRefreshAttempts += 1;
              clearTimeout(emptyRefreshTimer);
              emptyRefreshTimer = setTimeout(queueRefresh, 150);
            }
            updateTreeStatus("waiting for tiles", {
              lod: lod.name,
              phase: "refresh",
              sourceFeatureCount: features.length,
              sourceLoaded: sourceSettled,
              treeCount: renderedTreeCount
            });
            map.triggerRepaint();
            return;
          }
          const selectionSignature = treeSelectionSignature(visibleTrees, lod.name);
          if (sourceSettled && selectionSignature === lastTreeSelectionSignature) {
            if (treeGroup) treeGroup.visible = true;
            rawTreesVisible = true;
            treeMetrics.refreshMilliseconds = performance.now() - refreshStartedAt;
            updateFallbackVisibility();
            map.triggerRepaint();
            return;
          }
          // The viewport elevation is only a fallback. Each tree uses its own
          // terrain sample so sloped ground cannot clip different parts of the
          // crown as the camera center moves.
          const viewportElevation = map.queryTerrainElevation(map.getCenter()) ?? 0;
          ensureSceneOrigin(viewportElevation);
          const terrainStartedAt = performance.now();
          const terrainElevationAt = createTerrainSampler(visibleTrees, viewportElevation);
          treeMetrics.terrainMilliseconds = performance.now() - terrainStartedAt;
          const buildStartedAt = performance.now();
          let count = 0;
          const variantCount = activeTreeBackend === "three"
            ? treeMeshes.length
            : rawTreeResources.length;
          const variantCounts = Array.from({length: variantCount}, () => 0);
          const rawInstanceValues = Array.from({length: variantCount}, () => []);
          const rawShadowInstanceValues = [];
          for (const {feature, key, lat, lng} of visibleTrees) {
            const treeState = resolveTreeState(
              feature,
              key,
              lng,
              lat,
              terrainElevationAt(lng, lat)
            );
            const {
              colorGain,
              crownAspect,
              crownDiameter,
              height,
              lat: treeLat,
              lng: treeLng,
              treeElevation,
              variantIndex
            } = treeState;
            const treePosition = localTreePosition(treeLng, treeLat, treeElevation);
            const rotation = stableUnit(key, 3) * Math.PI * 2;
            const crownWidth = crownDiameter * crownAspect;
            const crownDepth = crownDiameter / crownAspect;
            const shadowRadius = Math.max(0.75, Math.min(5.5, crownDiameter * 0.42));
            if (activeTreeBackend === "three") {
              crownRotation.setFromAxisAngle(yAxis, rotation);
              position.copy(treePosition);
              scale.set(crownWidth, height, crownDepth);
              matrix.compose(position, crownRotation, scale);
              const treeMesh = treeMeshes[variantIndex];
              treeMesh.setMatrixAt(variantCounts[variantIndex], matrix);
              instanceTint.setRGB(colorGain, colorGain, colorGain);
              treeMesh.setColorAt(variantCounts[variantIndex], instanceTint);
              shadowPosition.copy(treePosition);
              shadowPosition.x -= shadowRadius * 0.28;
              shadowPosition.y += treeShadowLiftMeters;
              shadowPosition.z += shadowRadius * 0.34;
              shadowScale.set(shadowRadius, 1, shadowRadius * 0.76);
              shadowMatrix.compose(shadowPosition, shadowRotation, shadowScale);
              treeShadowMesh.setMatrixAt(count, shadowMatrix);
            } else {
              rawInstanceValues[variantIndex].push(
                treePosition.x,
                treePosition.y,
                treePosition.z,
                crownWidth,
                height,
                crownDepth,
                Math.cos(rotation),
                Math.sin(rotation),
                colorGain
              );
              rawShadowInstanceValues.push(
                treePosition.x,
                treePosition.y,
                treePosition.z,
                shadowRadius
              );
            }
            variantCounts[variantIndex] += 1;
            count += 1;
          }
          if (activeTreeBackend === "three") {
            for (let variantIndex = 0; variantIndex < treeMeshes.length; variantIndex += 1) {
              const treeMesh = treeMeshes[variantIndex];
              treeMesh.count = variantCounts[variantIndex];
              treeMesh.instanceMatrix.needsUpdate = true;
              if (treeMesh.instanceColor) treeMesh.instanceColor.needsUpdate = true;
            }
            treeShadowMesh.count = count;
            treeShadowMesh.instanceMatrix.needsUpdate = true;
          } else {
            for (let variantIndex = 0; variantIndex < rawTreeResources.length; variantIndex += 1) {
              const resource = rawTreeResources[variantIndex];
              resource.count = variantCounts[variantIndex];
              rawGl.bindBuffer(rawGl.ARRAY_BUFFER, resource.instanceBuffer);
              rawGl.bufferData(
                rawGl.ARRAY_BUFFER,
                new Float32Array(rawInstanceValues[variantIndex]),
                rawGl.DYNAMIC_DRAW
              );
            }
            rawShadowResource.count = count;
            rawGl.bindBuffer(rawGl.ARRAY_BUFFER, rawShadowResource.instanceBuffer);
            rawGl.bufferData(
              rawGl.ARRAY_BUFFER,
              new Float32Array(rawShadowInstanceValues),
              rawGl.DYNAMIC_DRAW
            );
            rawGl.bindBuffer(rawGl.ARRAY_BUFFER, null);
          }
          treeMetrics.buildMilliseconds = performance.now() - buildStartedAt;
          if (treeGroup) treeGroup.visible = true;
          rawTreesVisible = true;
          renderedTreeCount = count;
          treeMetrics.treeCount = count;
          treeMetrics.refreshMilliseconds = performance.now() - refreshStartedAt;
          lastTreeSelectionSignature = selectionSignature;
          emptyRefreshAttempts = 0;
          clearTimeout(emptyRefreshTimer);
          emptyRefreshTimer = undefined;
          updateTreeStatus(count + " 3D trees", {
            lod: lod.name,
            phase: "refresh",
            renderer: treeRendererMode,
            sourceFeatureCount: features.length,
            sourceLoaded: sourceSettled,
            treeCount: count
          });
          updateFallbackVisibility();
          if (!sourceSettled) {
            clearTimeout(emptyRefreshTimer);
            emptyRefreshTimer = setTimeout(() => queueRefresh(true), 150);
          }
          map.triggerRepaint();
        }

        function queueRefresh(immediate = false) {
          if (refreshQueued) return;
          if (immediate && refreshTimer !== undefined) {
            clearTimeout(refreshTimer);
            refreshTimer = undefined;
          }
          if (!immediate) {
            if (refreshTimer !== undefined) return;
            const elapsed = performance.now() - lastRefreshTime;
            const delay = Math.max(0, sourceRefreshIntervalMilliseconds - elapsed);
            if (delay > 0) {
              refreshTimer = setTimeout(() => {
                refreshTimer = undefined;
                queueRefresh(true);
              }, delay);
              return;
            }
          }
          refreshQueued = true;
          requestAnimationFrame(refresh);
        }

        function handleMoveStart() {
          if (!treesEnabled) return;
          sourceSettled = false;
          updateFallbackVisibility();
        }

        function handleMoveEnd() {
          if (!treesEnabled) return;
          emptyRefreshAttempts = 0;
          sourceSettled = map.isSourceLoaded(sourceId);
          updateFallbackVisibility();
          queueRefresh(true);
        }

        function handleSourceLoading(event) {
          if (!treesEnabled || event.sourceId !== sourceId) return;
          sourceSettled = false;
          updateFallbackVisibility();
        }

        function handleSourceData(event) {
          if (!treesEnabled || event.sourceId !== sourceId) return;
          sourceSettled = map.isSourceLoaded(sourceId);
          if (map.isMoving()) return;
          queueRefresh();
        }

        function handleTreesToggle() {
          clearTimeout(emptyRefreshTimer);
          clearTimeout(refreshTimer);
          emptyRefreshTimer = undefined;
          refreshTimer = undefined;
          if (!treesEnabled) {
            if (treeGroup) treeGroup.visible = false;
            rawTreesVisible = false;
            setFallbackVisible(false);
            updateTreeStatus("disabled", {phase: "toggle", treeCount: renderedTreeCount});
            map.triggerRepaint();
            return;
          }
          if (treeGroup) treeGroup.visible = renderedTreeCount > 0;
          rawTreesVisible = renderedTreeCount > 0;
          updateFallbackVisibility();
          updateTreeStatus(
            renderedTreeCount > 0 ? renderedTreeCount + " 3D trees" : "enabling",
            {phase: "toggle", treeCount: renderedTreeCount}
          );
          queueRefresh(true);
          map.triggerRepaint();
        }

        return {
          id: "tileflow-vegetation-trees-3d",
          type: "custom",
          renderingMode: "3d",
          onAdd(_map, gl) {
            updateTreeStatus("layer mounted", {phase: "onAdd", treeCount: 0});
            const geometries = createTreeGeometries();
            if (
              activeTreeBackend === "webgl2" &&
              typeof gl.createVertexArray === "function" &&
              typeof gl.drawArraysInstanced === "function"
            ) {
              rawGl = gl;
              rawProgram = createRawTreeProgram(gl);
              rawMatrixUniform = gl.getUniformLocation(rawProgram, "u_matrix");
              rawShadowProgram = createRawTreeShadowProgram(gl);
              rawShadowMatrixUniform = gl.getUniformLocation(rawShadowProgram, "u_matrix");
              rawShadowOpacityUniform = gl.getUniformLocation(rawShadowProgram, "u_opacity");
              rawShadowResource = createRawTreeShadowResource(gl);
              rawTreeResources = geometries.map((geometry) =>
                createRawTreeResource(gl, geometry)
              );
              for (const geometry of geometries) geometry.dispose();
            } else {
              activeTreeBackend = "three";
              treeMetrics.backend = activeTreeBackend;
              camera = new THREE.Camera();
              scene = new THREE.Scene();
              scene.rotateX(Math.PI / 2);
              scene.scale.multiply(new THREE.Vector3(1, 1, -1));
              scene.add(new THREE.HemisphereLight(0xf4fff1, 0x808878, 1.35));
              const sunlight = new THREE.DirectionalLight(0xfff3d8, 0.88);
              sunlight.position.set(-2, -3, 6);
              scene.add(sunlight);
              treeGroup = new THREE.Group();
              treeMaterial = new THREE.MeshLambertMaterial({
                flatShading: false,
                vertexColors: true
              });
              treeMeshes = geometries.map((geometry) => {
                const treeMesh = new THREE.InstancedMesh(
                  geometry,
                  treeMaterial,
                  maximumTrees
                );
                treeMesh.count = 0;
                treeMesh.frustumCulled = false;
                return treeMesh;
              });
              const shadowGeometry = new THREE.PlaneGeometry(2, 2);
              shadowGeometry.rotateX(-Math.PI / 2);
              treeShadowMaterial = new THREE.ShaderMaterial({
                depthTest: true,
                depthWrite: false,
                fragmentShader:
                  "varying vec2 v_shadow_coordinate;\\n" +
                  "uniform float u_opacity;\\n" +
                  "void main() {\\n" +
                  "  float radiusSquared = dot(v_shadow_coordinate, v_shadow_coordinate);\\n" +
                  "  if (radiusSquared >= 1.0) discard;\\n" +
                  "  float coverage = 1.0 - smoothstep(0.90, 1.0, radiusSquared);\\n" +
                  "  gl_FragColor = vec4(0.18, 0.21, 0.17, u_opacity * coverage);\\n" +
                  "}\\n",
                side: THREE.DoubleSide,
                toneMapped: false,
                transparent: true,
                uniforms: {u_opacity: {value: treeShadowOpacity}},
                vertexShader:
                  "varying vec2 v_shadow_coordinate;\\n" +
                  "void main() {\\n" +
                  "  v_shadow_coordinate = uv * 2.0 - 1.0;\\n" +
                  "  vec4 instancePosition = instanceMatrix * vec4(position, 1.0);\\n" +
                  "  gl_Position = projectionMatrix * modelViewMatrix * instancePosition;\\n" +
                  "}\\n"
              });
              treeShadowMesh = new THREE.InstancedMesh(
                shadowGeometry,
                treeShadowMaterial,
                maximumTrees
              );
              treeShadowMesh.count = 0;
              treeShadowMesh.frustumCulled = false;
              treeShadowMesh.renderOrder = 1;
              treeGroup.visible = false;
              treeGroup.add(...treeMeshes, treeShadowMesh);
              scene.add(treeGroup);
              renderer = new THREE.WebGLRenderer({
                canvas: map.getCanvas(),
                context: gl
              });
              renderer.autoClear = false;
            }
            sourceSettled = map.isSourceLoaded(sourceId);
            map.on("movestart", handleMoveStart);
            map.on("moveend", handleMoveEnd);
            map.on("sourcedataloading", handleSourceLoading);
            map.on("sourcedata", handleSourceData);
            map.on("tileflow:trees-toggle", handleTreesToggle);
            if (treesEnabled) queueRefresh(true);
            else handleTreesToggle();
          },
          render(_gl, options) {
            if (
              !treesEnabled ||
              !sceneOriginMercator ||
              (activeTreeBackend === "three" ? !treeGroup?.visible : !rawTreesVisible)
            ) return;
            const renderStartedAt = performance.now();
            const meter = sceneOriginMercator.meterInMercatorCoordinateUnits();
            mapMatrix.fromArray(options.defaultProjectionData.mainMatrix);
            sceneMatrix
              .makeTranslation(
                sceneOriginMercator.x,
                sceneOriginMercator.y,
                sceneOriginMercator.z
              )
              .scale(new THREE.Vector3(meter, -meter, meter));
            combinedMatrix.copy(mapMatrix).multiply(sceneMatrix);
            if (activeTreeBackend === "three") {
              camera.projectionMatrix.copy(combinedMatrix);
              renderer.resetState();
              renderer.render(scene, camera);
              treeMetrics.renderCalls = renderer.info.render.calls;
              treeMetrics.renderedTriangles = renderer.info.render.triangles;
            } else {
              rawGl.useProgram(rawProgram);
              rawGl.uniformMatrix4fv(rawMatrixUniform, false, combinedMatrix.elements);
              rawGl.enable(rawGl.DEPTH_TEST);
              rawGl.depthFunc(rawGl.LEQUAL);
              rawGl.depthMask(true);
              rawGl.enable(rawGl.CULL_FACE);
              rawGl.cullFace(rawGl.BACK);
              rawGl.frontFace(rawGl.CCW);
              rawGl.disable(rawGl.BLEND);
              let renderCalls = 0;
              let renderedTriangles = 0;
              for (const resource of rawTreeResources) {
                if (resource.count === 0) continue;
                rawGl.bindVertexArray(resource.vertexArray);
                rawGl.drawElementsInstanced(
                  rawGl.TRIANGLES,
                  resource.indexCount,
                  rawGl.UNSIGNED_INT,
                  0,
                  resource.count
                );
                renderCalls += 1;
                renderedTriangles += (resource.indexCount / 3) * resource.count;
              }
              rawGl.bindVertexArray(null);
              if (rawShadowResource.count > 0) {
                rawGl.useProgram(rawShadowProgram);
                rawGl.uniformMatrix4fv(
                  rawShadowMatrixUniform,
                  false,
                  combinedMatrix.elements
                );
                rawGl.uniform1f(rawShadowOpacityUniform, treeShadowOpacity);
                rawGl.depthMask(false);
                rawGl.disable(rawGl.CULL_FACE);
                rawGl.enable(rawGl.BLEND);
                rawGl.blendEquation(rawGl.FUNC_ADD);
                rawGl.blendFuncSeparate(
                  rawGl.SRC_ALPHA,
                  rawGl.ONE_MINUS_SRC_ALPHA,
                  rawGl.ONE,
                  rawGl.ONE_MINUS_SRC_ALPHA
                );
                rawGl.bindVertexArray(rawShadowResource.vertexArray);
                rawGl.drawArraysInstanced(
                  rawGl.TRIANGLE_FAN,
                  0,
                  4,
                  rawShadowResource.count
                );
                rawGl.bindVertexArray(null);
                rawGl.depthMask(true);
                rawGl.disable(rawGl.BLEND);
                rawGl.enable(rawGl.CULL_FACE);
                renderCalls += 1;
                renderedTriangles += rawShadowResource.count * 2;
              }
              treeMetrics.renderCalls = renderCalls;
              treeMetrics.renderedTriangles = renderedTriangles;
            }
            treeMetrics.renderMilliseconds = performance.now() - renderStartedAt;
          },
          onRemove() {
            clearTimeout(emptyRefreshTimer);
            clearTimeout(refreshTimer);
            map.off("movestart", handleMoveStart);
            map.off("moveend", handleMoveEnd);
            map.off("sourcedataloading", handleSourceLoading);
            map.off("sourcedata", handleSourceData);
            map.off("tileflow:trees-toggle", handleTreesToggle);
            if (!fallbackVisible && map.getLayer(styleLayer.id)) {
              map.setPaintProperty(
                styleLayer.id,
                "circle-opacity",
                fallbackCircleOpacity
              );
              map.setPaintProperty(
                styleLayer.id,
                "circle-stroke-opacity",
                fallbackCircleStrokeOpacity
              );
            }
            for (const treeMesh of treeMeshes) treeMesh.geometry.dispose();
            treeMeshes = [];
            treeShadowMesh?.geometry.dispose();
            treeShadowMesh = undefined;
            treeShadowMaterial?.dispose();
            treeShadowMaterial = undefined;
            treeMaterial?.dispose();
            renderer?.dispose();
            disposeRawTreeResources();
          }
        };
      }

      function addTreeLayerIfConfigured(map, styleLayers) {
        const styleLayer = styleLayers.find(
          (layer) => layer.id === "streets-vegetation-trees"
        );
        if (
          !styleLayer ||
          styleLayer.metadata?.["tileflow:vegetation-mode"] !== "3d" ||
          map.getLayer("tileflow-vegetation-trees-3d")
        ) return;
        if (treeRendererMode === "circle") {
          treeMetrics.treeCount = 0;
          updateTreeStatus("native circles", {
            phase: "configured",
            renderer: treeRendererMode,
            treeCount: 0
          });
          return;
        }
        updateTreeStatus("configured", {phase: "configured", treeCount: 0});
        // Three.js consumes Mercator world coordinates directly. MapLibre's
        // plain custom-layer matrix only supports those coordinates in the
        // Mercator projection; globe requires a projection-aware shader.
        if (map.getProjection().type !== "mercator") {
          map.setProjection({type: "mercator"});
        }
        if (map.getLayer("tileflow-vegetation-trees-3d")) return;
        const styleLayerIndex = styleLayers.findIndex((layer) => layer.id === styleLayer.id);
        const layerAboveTrees = styleLayers[styleLayerIndex + 1]?.id;
        map.addLayer(createTreeLayer(map, styleLayer), layerAboveTrees);
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
        // Landmark custom layers use Mercator world coordinates. Switch here
        // instead of relying on the optional detailed-tree renderer to do it.
        if (map.getProjection().type !== "mercator") {
          map.setProjection({type: "mercator"});
        }
        const firstForegroundLabel = styleLayers.find(
          (layer) =>
            (layer.id.startsWith("streets-label-") &&
              !layer.id.startsWith("streets-label-road-")) ||
            layer.id.startsWith("streets-poi-")
        )?.id;
        const treeLayer = map.getLayer("tileflow-vegetation-trees-3d")
          ? "tileflow-vegetation-trees-3d"
          : map.getLayer("streets-vegetation-trees")
            ? "streets-vegetation-trees"
            : firstForegroundLabel;
        map.addLayer(createLandmarkLayer(map, configLayer, fallbackLayers), treeLayer);
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
          this.map.triggerRepaint();
        }

        update() {
          for (const layer of this.map.getStyle()?.layers || []) {
            const toggle = layer.metadata?.["tileflow:3d-toggle"];
            if (toggle !== "building" && toggle !== "landmark") continue;
            const visibility = this.enabled ? "visible" : "none";
            if (this.map.getLayoutProperty(layer.id, "visibility") !== visibility) {
              this.map.setLayoutProperty(layer.id, "visibility", visibility);
            }
          }
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
          this.map.triggerRepaint();
        }

        update() {
          const treeLayer = this.map.getStyle()?.layers?.find(
            (layer) => layer.id === "streets-vegetation-trees"
          );
          if (treeLayer) {
            const visibility = this.enabled ? "visible" : "none";
            if (this.map.getLayoutProperty(treeLayer.id, "visibility") !== visibility) {
              this.map.setLayoutProperty(treeLayer.id, "visibility", visibility);
            }
          }
          this.button.textContent = this.enabled ? "TREES ON" : "TREES OFF";
          this.button.setAttribute("aria-pressed", String(this.enabled));
          this.button.title = this.enabled ? "Hide trees" : "Show trees";
        }

        onRemove() {
          this.map?.off("styledata", this.update);
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
          const toggleVisibility =
            threeDimensionalToggle === "building" || threeDimensionalToggle === "landmark"
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
        if (isStreetsPreview) {
          threeDimensionalControl = new ThreeDimensionalControl();
          treeControl = new TreeControl();
          map.addControl(threeDimensionalControl, "top-right");
          map.addControl(treeControl, "top-right");
        }
        let ensuringThreeDimensionalLayers;
        const treeRuntimeMinimumZoom = 16;
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
          const needsTrees =
            treesEnabled &&
            treeRendererMode !== "circle" &&
            map.getZoom() >= treeRuntimeMinimumZoom &&
            !map.getLayer("tileflow-vegetation-trees-3d");
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
            !needsTrees &&
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
              if (
                treesEnabled &&
                treeRendererMode !== "circle" &&
                map.getZoom() >= treeRuntimeMinimumZoom
              ) addTreeLayerIfConfigured(map, styleLayers);
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
        });
        map.on("move", () => updateGlobeBackdrop(map));
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
