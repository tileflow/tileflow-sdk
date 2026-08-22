import type {ResolvedTileflowPreview} from './index';

export function renderTileflowPreviewHtml(
  preview: ResolvedTileflowPreview | undefined,
  basePath: string,
  initialStatus: unknown,
  isStreetsPreview: boolean,
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
    <script type="importmap">{"imports":{"three":"${basePath}/__runtime/three.module.js"}}</script>
    <script type="module">
      const initialStatus = ${JSON.stringify(initialStatus)};
      const initialGeneration = initialStatus.generation;
      const badge = document.getElementById("badge");
      const status = document.getElementById("status");
      const previewLabel = ${JSON.stringify(preview?.label)};
      const styleUrl = ${JSON.stringify(styleUrl)};
      const previewMapOptions = ${JSON.stringify(mapOptions)};
      const isStreetsPreview = ${JSON.stringify(isStreetsPreview)};
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
      let THREE;
      let GLTFLoader;
      let MeshoptDecoder;
      let threeCoreRuntimePromise;
      let landmarkRuntimePromise;

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

      function loadLandmarkRuntime() {
        if (!landmarkRuntimePromise) {
          landmarkRuntimePromise = Promise.all([
            loadThreeCoreRuntime(),
            import("${basePath}/__runtime/three-addons/loaders/GLTFLoader.js"),
            import("${basePath}/__runtime/three-addons/libs/meshopt_decoder.module.js")
          ]).then(([, gltfLoaderModule, meshoptDecoderModule]) => {
            GLTFLoader = gltfLoaderModule.GLTFLoader;
            MeshoptDecoder = meshoptDecoderModule.MeshoptDecoder;
          });
        }
        return landmarkRuntimePromise;
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
          const startedAt = performance.now();
          const response = await fetch(url, {cache: "no-store", credentials});
          if (!response.ok) throw new Error("Tile comparison request failed (" + response.status + "): " + url);
          const encodedHeaderValue =
            response.headers.get("x-tileflow-compressed-bytes") ||
            response.headers.get("content-length");
          const encodedHeader = encodedHeaderValue === null
            ? undefined
            : Number(encodedHeaderValue);
          const bytes = await response.arrayBuffer();
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
          const contract = await contractResponse.json();
          const remoteTileJsonUrl = options.remoteTileJson || contract.remoteTileJson;
          if (!remoteTileJsonUrl) throw new Error("No remote TileJSON comparison target is configured.");
          const remoteTileJsonResponse = await fetch(remoteTileJsonUrl, {
            cache: "no-store",
            credentials: "include"
          });
          if (!remoteTileJsonResponse.ok) {
            throw new Error("Remote TileJSON request failed (" + remoteTileJsonResponse.status + ").");
          }
          const remoteTileJson = await remoteTileJsonResponse.json();
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
        const projection = map.getProjection().type;
        const container = map.getContainer?.();
        if (!container) return;
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
        let scene;
        let sceneElevation;
        let sceneOriginMercator;
        let camera;
        let renderer;
        let treeGroup;
        let treeMaterial;
        let treeMeshes = [];
        let activeTreeBackend = treeBackendMode;
        let rawGl;
        let rawProgram;
        let rawMatrixUniform;
        let rawTreeResources = [];
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
        const barkColor = new THREE.Color(0x929b7b);
        const broadleafPalette = [
          new THREE.Color(0x7fa97b),
          new THREE.Color(0x8bb08c),
          new THREE.Color(0xa9c995),
          new THREE.Color(0xb0d1aa)
        ];
        const coniferPalette = [
          new THREE.Color(0x5d966b),
          new THREE.Color(0x76aa7d),
          new THREE.Color(0x91bd94)
        ];

        function addGeometryPart(parts, geometry, partPosition, partScale, rotation, color) {
          const partMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(...partPosition),
            rotation,
            new THREE.Vector3(...partScale)
          );
          geometry.applyMatrix4(partMatrix);
          const facetedGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
          facetedGeometry.computeVertexNormals();
          const positions = facetedGeometry.getAttribute("position").array;
          const normals = facetedGeometry.getAttribute("normal").array;
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
          if (facetedGeometry !== geometry) facetedGeometry.dispose();
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
            new THREE.CylinderGeometry(tipRadius, baseRadius, 1, radialSegments),
            [center.x, center.y, center.z],
            [1, direction.length(), 1],
            branchRotation,
            barkColor
          );
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

        function createBroadleafTreeGeometry(variant, simple) {
          const parts = [];
          const trunkTop = variant === 0 ? [0.012, 0.5, -0.004] : [-0.014, 0.49, 0.01];
          addTaperedBranchPart(
            parts,
            [0, 0, 0],
            trunkTop,
            0.09 + variant * 0.004,
            0.052 + variant * 0.002,
            6
          );

          const branchTargets = variant === 0
            ? [
                [-0.22, 0.72, 0.02],
                [0, 0.79, -0.025],
                [0.22, 0.71, -0.015],
                [0.015, 0.69, 0.17]
              ]
            : [
                [-0.2, 0.71, 0.015],
                [0.06, 0.68, 0.08],
                [0.27, 0.72, -0.025],
                [0.05, 0.78, -0.08]
              ];
          const branchCount = branchTargets.length;
          for (let branch = 0; branch < branchCount; branch += 1) {
            addTaperedBranchPart(
              parts,
              [trunkTop[0] * 0.55, 0.35 + branch * 0.025, trunkTop[2] * 0.55],
              branchTargets[branch],
              0.05 - branch * 0.004,
              0.026 - branch * 0.002,
              6
            );
          }

          const openCrownLayout = [
            {position: [-0.02, 0.86, -0.04], scale: [0.46, 0.16, 0.39]},
            {position: [-0.22, 0.8, 0.04], scale: [0.44, 0.16, 0.37]},
            {position: [0.22, 0.79, -0.05], scale: [0.47, 0.17, 0.39]},
            {position: [-0.29, 0.69, 0.03], scale: [0.42, 0.18, 0.36]},
            {position: [0.01, 0.69, 0.18], scale: [0.52, 0.2, 0.42]},
            {position: [0.28, 0.68, 0.01], scale: [0.44, 0.18, 0.37]},
            {position: [0, 0.76, -0.21], scale: [0.48, 0.17, 0.39]},
            {position: [-0.15, 0.64, 0.14], scale: [0.4, 0.16, 0.34]},
            {position: [0.16, 0.64, 0.12], scale: [0.41, 0.16, 0.35]},
            {position: [0.08, 0.88, 0.13], scale: [0.4, 0.15, 0.34]}
          ];
          const clusteredCrownLayout = [
            {position: [-0.24, 0.78, 0.02], scale: [0.52, 0.42, 0.47]},
            {position: [0, 0.72, 0.12], scale: [0.32, 0.27, 0.32]},
            {position: [0.1, 0.59, -0.08], scale: [0.46, 0.36, 0.42]},
            {position: [0.29, 0.76, -0.01], scale: [0.43, 0.34, 0.4]},
            {position: [0.01, 0.84, -0.05], scale: [0.4, 0.32, 0.38]},
            {position: [0.19, 0.74, 0.18], scale: [0.35, 0.3, 0.34]}
          ];
          const crownLayout = variant === 0 ? openCrownLayout : clusteredCrownLayout;
          const lobeCount = simple ? (variant === 0 ? 9 : 5) : crownLayout.length;
          const crownColorPattern = variant === 0
            ? [3, 2, 1, 0, 2, 0, 1, 1, 2, 3]
            : [1, 2, 0, 1, 3, 2];
          for (let lobe = 0; lobe < lobeCount; lobe += 1) {
            const lobeShape = crownLayout[lobe];
            const foliageGeometry = variant === 0
              ? new THREE.SphereGeometry(0.5, 8, 3)
              : new THREE.IcosahedronGeometry(0.5, simple ? 0 : 1);
            addGeometryPart(
              parts,
              foliageGeometry,
              lobeShape.position,
              lobeShape.scale,
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(
                  ((lobe % 3) - 1) * 0.07,
                  variant * 0.41 + lobe * 0.37,
                  (((lobe + variant) % 3) - 1) * 0.09
                )
              ),
              broadleafPalette[crownColorPattern[lobe]]
            );
          }
          return mergeGeometryParts(parts);
        }

        function createConiferTreeGeometry(variant, simple) {
          const parts = [];
          addTaperedBranchPart(
            parts,
            [0, 0, 0],
            [variant === 0 ? 0.006 : -0.006, 0.4, 0],
            0.075,
            0.04,
            6
          );
          const tierCount = simple ? 2 : 3;
          for (let tier = 0; tier < tierCount; tier += 1) {
            const progress = tier / (tierCount - 1);
            const tierDiameter = simple ? 0.92 - progress * 0.25 : 0.96 - progress * 0.34;
            const tierHeight = simple ? 0.55 - progress * 0.1 : 0.48 - progress * 0.12;
            addGeometryPart(
              parts,
              new THREE.ConeGeometry(0.5, 1, simple ? 6 : 9),
              [0, simple ? 0.5 + progress * 0.25 : 0.5 + progress * 0.27, 0],
              [tierDiameter, tierHeight, tierDiameter],
              new THREE.Quaternion().setFromAxisAngle(yAxis, variant * 0.6 + tier * 0.24),
              coniferPalette[(variant + tier) % coniferPalette.length]
            );
          }
          return mergeGeometryParts(parts);
        }

        function createTreeGeometries() {
          const simple = treeRendererMode === "simple";
          return [
            createBroadleafTreeGeometry(0, simple),
            createBroadleafTreeGeometry(1, simple),
            createConiferTreeGeometry(0, simple),
            createConiferTreeGeometry(1, simple)
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
              "layout(location=4) in vec2 a_instance_scale;\\n" +
              "layout(location=5) in vec2 a_instance_rotation;\\n" +
              "uniform mat4 u_matrix;\\n" +
              "out vec3 v_color;\\n" +
              "void main() {\\n" +
              "  vec2 horizontal = a_position.xz * a_instance_scale.x;\\n" +
              "  vec2 rotated = vec2(\\n" +
              "    horizontal.x * a_instance_rotation.x - horizontal.y * a_instance_rotation.y,\\n" +
              "    horizontal.x * a_instance_rotation.y + horizontal.y * a_instance_rotation.x\\n" +
              "  );\\n" +
              "  vec2 normalHorizontal = vec2(\\n" +
              "    a_normal.x * a_instance_rotation.x - a_normal.z * a_instance_rotation.y,\\n" +
              "    a_normal.x * a_instance_rotation.y + a_normal.z * a_instance_rotation.x\\n" +
              "  );\\n" +
              "  vec3 mapNormal = normalize(vec3(normalHorizontal.x, normalHorizontal.y, a_normal.y));\\n" +
              "  float light = 0.68 + max(dot(mapNormal, normalize(vec3(-0.35, -0.5, 0.78))), 0.0) * 0.42;\\n" +
              "  v_color = a_color * light;\\n" +
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
          gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 28, 0);
          gl.vertexAttribDivisor(3, 1);
          gl.enableVertexAttribArray(4);
          gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 28, 12);
          gl.vertexAttribDivisor(4, 1);
          gl.enableVertexAttribArray(5);
          gl.vertexAttribPointer(5, 2, gl.FLOAT, false, 28, 20);
          gl.vertexAttribDivisor(5, 1);
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
          rawProgram = undefined;
          rawMatrixUniform = undefined;
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

        function resolveTreeState(feature, key, lng, lat, treeElevation) {
          const cached = treeStateCache.get(key);
          if (cached) return cached;
          const variation = stableUnit(key, 1);
          const height = Math.min(
            32,
            numberProperty(feature.properties, heightField) ?? 6 + variation * 7
          );
          const crownDiameter = Math.min(
            20,
            numberProperty(feature.properties, crownField) ??
              height * (0.62 + stableUnit(key, 2) * 0.18)
          );
          return rememberTreeState(key, {
            conifer: isConifer(feature.properties),
            crownDiameter,
            height,
            lat,
            lng,
            treeElevation
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

        function isConifer(properties) {
          const leafType = String(properties?.[leafTypeField] ?? "").toLowerCase();
          if (leafType.includes("needle")) return true;
          const botanicalName = [properties?.[genusField], properties?.[speciesField]]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return /(?:^| )(?:abies|cedrus|cupressus|juniperus|picea|pinus|taxus)(?: |$)/.test(
            botanicalName
          );
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
          for (const {feature, key, lat, lng} of visibleTrees) {
            const treeState = resolveTreeState(
              feature,
              key,
              lng,
              lat,
              terrainElevationAt(lng, lat)
            );
            const {
              conifer,
              crownDiameter,
              height,
              lat: treeLat,
              lng: treeLng,
              treeElevation
            } = treeState;
            const treePosition = localTreePosition(treeLng, treeLat, treeElevation);
            const rotation = stableUnit(key, 3) * Math.PI * 2;
            const variantIndex = (conifer ? 2 : 0) + Math.floor(stableUnit(key, 101) * 2);
            if (activeTreeBackend === "three") {
              crownRotation.setFromAxisAngle(yAxis, rotation);
              position.copy(treePosition);
              scale.set(crownDiameter, height, crownDiameter);
              matrix.compose(position, crownRotation, scale);
              treeMeshes[variantIndex].setMatrixAt(variantCounts[variantIndex], matrix);
            } else {
              rawInstanceValues[variantIndex].push(
                treePosition.x,
                treePosition.y,
                treePosition.z,
                crownDiameter,
                height,
                Math.cos(rotation),
                Math.sin(rotation)
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
            }
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
              scene.add(new THREE.HemisphereLight(0xf2fff0, 0x7c806d, 2.5));
              const sunlight = new THREE.DirectionalLight(0xfff7df, 1.15);
              sunlight.position.set(-2, -3, 6);
              scene.add(sunlight);
              treeGroup = new THREE.Group();
              treeMaterial = new THREE.MeshLambertMaterial({
                flatShading: true,
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
              treeGroup.visible = false;
              treeGroup.add(...treeMeshes);
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

      function createLandmarkLayer(map, configLayer) {
        const manifestUrl = configLayer.metadata?.["tileflow:landmark-manifest-url"];
        const {minzoom: landmarkMinimumZoom, maxzoom: landmarkMaximumZoom} =
          styleLayerZoomRange(configLayer);
        const abortController = new AbortController();
        const loaded = new Map();
        const loading = new Map();
        const activeLandmarkIds = new Set();
        let cacheClock = 0;
        let camera;
        let renderer;
        let scene;
        let group;
        let sceneOriginMercator;
        let sceneElevation = 0;
        let manifest;
        const mapMatrix = new THREE.Matrix4();
        const sceneMatrix = new THREE.Matrix4();

        function overlapsViewport(bounds) {
          const viewport = map.getBounds();
          return !(
            bounds[2] < viewport.getWest() ||
            bounds[0] > viewport.getEast() ||
            bounds[3] < viewport.getSouth() ||
            bounds[1] > viewport.getNorth()
          );
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

        function unloadLandmark(id) {
          const entry = loaded.get(id);
          if (!entry) return;
          disposeModel(entry.model);
          loaded.delete(id);
          landmarkState.loaded = [...loaded.keys()];
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
          return selected.model;
        }

        function loadLandmark(landmark, modelUrl) {
          const cached = loaded.get(landmark.id);
          if (cached?.modelUrl === modelUrl) {
            cached.lastUsed = ++cacheClock;
            cached.model.visible = activeLandmarkIds.has(landmark.id);
            return;
          }
          if (cached) {
            // Keep the previous LOD visible until its replacement has loaded.
            cached.lastUsed = ++cacheClock;
            cached.model.visible = activeLandmarkIds.has(landmark.id);
          }
          if (loading.get(landmark.id) === modelUrl) return;
          loading.set(landmark.id, modelUrl);
          landmarkState.loading = [...loading.keys()];
          const loader = new GLTFLoader();
          loader.setMeshoptDecoder(MeshoptDecoder);
          loader.setWithCredentials(true);
          loader.load(
            modelUrl,
            (gltf) => {
              if (loading.get(landmark.id) !== modelUrl) {
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
              const model = gltf.scene;
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
                modelUrl
              });
              landmarkState.errors = landmarkState.errors.filter(
                (item) => item.id !== landmark.id
              );
              landmarkState.loaded = [...loaded.keys()];
              group.add(model);
              enforceCacheLimit();
              map.triggerRepaint();
            },
            undefined,
            (error) => {
              if (loading.get(landmark.id) !== modelUrl) return;
              loading.delete(landmark.id);
              landmarkState.loading = [...loading.keys()];
              landmarkState.errors = [
                ...landmarkState.errors.filter((item) => item.id !== landmark.id),
                {id: landmark.id, message: String(error)}
              ];
              console.warn("Tileflow landmark failed to load", landmark.id, error);
            }
          );
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
          enforceCacheLimit();
          map.triggerRepaint();
        }

        function normalizeManifest(candidate) {
          if (
            candidate?.schemaVersion !== 1 ||
            typeof candidate.id !== "string" ||
            !candidate.id ||
            !Array.isArray(candidate.landmarks) ||
            !Number.isFinite(candidate.minzoom) ||
            candidate.minzoom < 0 ||
            candidate.minzoom > 24 ||
            !Number.isInteger(candidate.maximumVisibleModels) ||
            candidate.maximumVisibleModels < 1 ||
            candidate.maximumVisibleModels > 64
          ) throw new Error("invalid landmark manifest");
          const maximumCachedModels = candidate.maximumCachedModels === undefined
            ? Math.min(128, Math.max(candidate.maximumVisibleModels, candidate.maximumVisibleModels * 2))
            : candidate.maximumCachedModels;
          if (
            !Number.isInteger(maximumCachedModels) ||
            maximumCachedModels < candidate.maximumVisibleModels ||
            maximumCachedModels > 128
          ) throw new Error("invalid landmark cache limit");
          const ids = new Set();
          const landmarks = candidate.landmarks.map((landmark) => {
            if (
              typeof landmark?.id !== "string" ||
              !landmark.id ||
              ids.has(landmark.id) ||
              !Array.isArray(landmark.center) ||
              landmark.center.length !== 2 ||
              !landmark.center.every(Number.isFinite) ||
              !Array.isArray(landmark.bounds) ||
              landmark.bounds.length !== 4 ||
              !landmark.bounds.every(Number.isFinite) ||
              (landmark.priority !== undefined && !Number.isFinite(landmark.priority))
            ) throw new Error("invalid landmark entry");
            ids.add(landmark.id);
            const models = [];
            if (typeof landmark.model === "string" && landmark.model) {
              models.push({
                minzoom: candidate.minzoom,
                model: new URL(landmark.model, manifestUrl).toString()
              });
            }
            if (landmark.lods !== undefined && !Array.isArray(landmark.lods)) {
              throw new Error("invalid landmark LODs");
            }
            for (const lod of landmark.lods ?? []) {
              if (
                !Number.isFinite(lod?.minzoom) ||
                lod.minzoom < candidate.minzoom ||
                lod.minzoom > 24 ||
                typeof lod.model !== "string" ||
                !lod.model
              ) throw new Error("invalid landmark LOD");
              models.push({
                minzoom: lod.minzoom,
                model: new URL(lod.model, manifestUrl).toString()
              });
            }
            models.sort(
              (left, right) =>
                left.minzoom - right.minzoom ||
                (left.model < right.model ? -1 : left.model > right.model ? 1 : 0)
            );
            if (new Set(models.map((model) => model.minzoom)).size !== models.length) {
              throw new Error("duplicate landmark LOD zoom");
            }
            if (models.length === 0 || models[0].minzoom > candidate.minzoom) {
              throw new Error("landmark requires a base model");
            }
            return {
              bounds: landmark.bounds,
              center: landmark.center,
              id: landmark.id,
              models,
              priority: landmark.priority ?? 0
            };
          });
          return {...candidate, landmarks, maximumCachedModels};
        }

        async function loadManifest() {
          try {
            const response = await fetch(manifestUrl, {
              credentials: "include",
              signal: abortController.signal
            });
            if (!response.ok) throw new Error("HTTP " + response.status);
            const candidate = await response.json();
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
            map.off("moveend", refresh);
            map.off("tileflow:3d-toggle", refresh);
            for (const entry of loaded.values()) disposeModel(entry.model);
            loaded.clear();
            renderer?.dispose();
          }
        };
      }

      function addLandmarkLayerIfConfigured(map, styleLayers) {
        const configLayer = styleLayers.find(
          (layer) => layer.metadata?.["tileflow:landmark-manifest-url"]
        );
        if (!configLayer || map.getLayer("tileflow-landmarks-3d")) return;
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
        map.addLayer(createLandmarkLayer(map, configLayer), treeLayer);
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
          this.enabled = !this.enabled;
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
          this.enabled = !this.enabled;
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

      if (styleUrl) {
        // Dense vector tiles finish in bursts with multiple workers, causing several
        // bucket uploads in one frame. One worker keeps navigation smooth; benchmarks
        // can still compare up to three workers through the explicit URL override.
        const mapWorkerCount = mapWorkerCountOverride ?? 1;
        maplibregl.setWorkerCount?.(mapWorkerCount);
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
        installMapBenchmark(map);
        map.addControl(new maplibregl.NavigationControl(), "top-right");
        if (isStreetsPreview) {
          map.addControl(new ThreeDimensionalControl(), "top-right");
          map.addControl(new TreeControl(), "top-right");
        }
        let ensuringThreeDimensionalLayers;
        const treeRuntimeMinimumZoom = 16;
        const ensureThreeDimensionalLayers = () => {
          if (ensuringThreeDimensionalLayers) return ensuringThreeDimensionalLayers;
          const currentStyleLayers = map.getStyle()?.layers || [];
          const landmarkConfigLayer = currentStyleLayers.find(
            (layer) => layer.metadata?.["tileflow:landmark-manifest-url"]
          );
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
          if (!needsTrees && !needsLandmarks) return;
          ensuringThreeDimensionalLayers = (needsLandmarks
            ? loadLandmarkRuntime()
            : loadThreeCoreRuntime())
            .then(async () => {
              const styleLayers = map.getStyle()?.layers || [];
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
                await loadLandmarkRuntime();
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
