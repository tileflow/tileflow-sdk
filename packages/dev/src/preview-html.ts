import type {TileflowStyleFontFace} from '@tileflow/core';
import {readBoundedTileflowJsonResponse, readBoundedTileflowResponse} from './bounded-response';
import type {ResolvedTileflowPreview} from './preview';
import {previewSceneClient} from './preview-scene';
import {createPreviewSceneThemes} from './preview-scene-themes';
import {createPreviewStyleReads} from './preview-style-reads';

export function renderTileflowPreviewHtml(
  preview: ResolvedTileflowPreview | undefined,
  basePath: string,
  initialStatus: unknown,
  isSemanticPreview: boolean,
  fontFaces: readonly TileflowStyleFontFace[] = [],
  fitViewport = false,
  controls?: string,
): string {
  const styleUrl = preview
    ? `${basePath}/styles/${preview.mapName}/${preview.themeName}.json${controls ? `?${new URLSearchParams({controls})}` : ''}`
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
      #map { position: relative; }
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
      html[data-inspector-embedded=true] .status { display:none !important; }
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
    <script type="importmap">{"imports":{"three":"${basePath}/__runtime/three.module.js"}}</script>
    <script type="module">
      import * as maplibregl from "${basePath}/__runtime/maplibre-gl.mjs";
      import {createPreviewObserver} from "${basePath}/__runtime/inspector-observer.js";
      import {loadTileflowStyleFonts} from "${basePath}/__runtime/tileflow-browser.js";
      import {attachTileflowHorizonQueries, attachTileflowLabelPlacement} from "${basePath}/__runtime/tileflow-browser.js";
      import {registerTileflowContourProtocol} from "${basePath}/__runtime/tileflow-browser.js";
      import {registerTileflowPmtilesProtocol} from "${basePath}/__runtime/tileflow-browser.js";
      import {attachTileflowNauticalLights, attachTileflowNotices} from "${basePath}/__runtime/tileflow-browser.js";
      import {attachTileflowAtmosphere, tileflowMaxPitch} from "${basePath}/__runtime/tileflow-browser.js";
      import {tileflowCanvasContextAttributes} from "${basePath}/__runtime/tileflow-browser.js";
      import {createTileflowMap3D} from "${basePath}/__runtime/tileflow-browser.js";
      import {readTileflowSunPreset, resolveTileflowSun, tileflowDefaultSunPreset} from "${basePath}/__runtime/tileflow-browser.js";

      maplibregl.setWorkerUrl("${basePath}/__runtime/maplibre-gl-worker.mjs");

      const inspectorObserver = window.parent !== window ? createPreviewObserver() : undefined;
      globalThis.__tileflowInspectorObserver = inspectorObserver;
      if (window.parent !== window) document.documentElement.dataset.inspectorEmbedded = "true";

      const initialStatus = ${JSON.stringify(initialStatus)};
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
      // Benchmarks compare the multisampled canvas with a single-sampled one through this override.
      const mapAntialias = readToggleFromUrl("mapAntialias", true);
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
      let threeDimensionalEnabled = readToggleFromUrl("buildings3d", true);
      let treesEnabled = readToggleFromUrl("trees3d", true);
      const buildingWireframeMetrics = {
        buildingCount: 0,
        refreshMilliseconds: undefined,
        segmentCount: 0,
        truncated: false
      };
      globalThis.__tileflowBuildingWireframeMetrics = buildingWireframeMetrics;
      let THREE;
      let LineMaterial;
      let LineSegments2;
      let LineSegmentsGeometry;
      let threeCoreRuntimePromise;
      let buildingWireframeRuntimePromise;

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

      // Core's 3D scene, as an application mounts it: the map's style describes how its
      // buildings, trees and street lights look, and the controls only show and hide them. The
      // vegetation control hides all trees when off. The preview shows one theme at a
      // time, so the style on screen holds the sun and the design.
      const coreScene = {scene: undefined, shown: undefined, buildingsShown: undefined, animation: "0"};
      const runtimeLayerVisibility = {};
      globalThis.__tileflowPreviewScene = coreScene;
      globalThis.__tileflowRuntimeVisibility = (id, visible) => {
        if (!['tileflow-buildings-3d','tileflow-trees-3d','tileflow-street-lights'].includes(id)) return undefined;
        const previewMap = globalThis.__tileflowPreviewMap;
        if (typeof visible === 'boolean') {
          runtimeLayerVisibility[id] = visible;
          if (previewMap) { mountCoreScene(previewMap); previewMap.triggerRepaint(); }
        }
        return runtimeLayerVisibility[id] !== false;
      };
      // Explicit observation capability: controllers stay private to the preview and expose
      // only their public state/statistics to the parent inspector.
      globalThis.__tileflowInspectModels = () => [...(coreScene.scene?.buildings?.inspectModels?.() || []), ...(coreScene.scene?.vegetation?.inspectModels?.() || [])];
      globalThis.__tileflowDescribeRuntimeLayers = () => {
        const {buildings, vegetation, streetLights} = coreScene.scene ?? {};
        return {
          ...(buildings ? {"tileflow-buildings-3d": {controller:"Buildings 3D", state:{visible:runtimeLayerVisibility["tileflow-buildings-3d"] !== false, shown:coreScene.buildingsShown, scale:buildings.scale}, stats:buildings.stats}} : {}),
          ...(vegetation ? {"tileflow-trees-3d": {controller:"Vegetation", state:{visible:runtimeLayerVisibility["tileflow-trees-3d"] !== false, representation:vegetation.representation}, stats:vegetation.stats}} : {}),
          ...(streetLights ? {"tileflow-street-lights": {controller:"Street lights", state:{visible:runtimeLayerVisibility["tileflow-street-lights"] !== false, mounted:true}, stats:streetLights.stats}} : {})
        };
      };
      const createPreviewStyleReads = ${createPreviewStyleReads.toString()};
      const previewStyleReads = new WeakMap();
      // Style reads for code that runs on every camera move or style event.
      function styleReads(map) {
        let reads = previewStyleReads.get(map);
        if (!reads) {
          reads = createPreviewStyleReads(map);
          previewStyleReads.set(map, reads);
        }
        return reads;
      }
      const createPreviewSceneThemes = ${createPreviewSceneThemes.toString()};
      const coreSceneThemeControllers = new WeakMap();
      function coreSceneThemes(map) {
        let controller = coreSceneThemeControllers.get(map);
        if (!controller) {
          controller = createPreviewSceneThemes(map, metadata =>
            resolveTileflowSun(readTileflowSunPreset(metadata) ?? tileflowDefaultSunPreset));
          coreSceneThemeControllers.set(map, controller);
        }
        return controller;
      }
      let mountingCoreScene = false;
      function mountCoreScene(map) {
        if (mountingCoreScene) return;
        mountingCoreScene = true;
        try {
          const metadata = styleReads(map).metadata() ?? {};
          const treesShown = () => treesEnabled && runtimeLayerVisibility["tileflow-trees-3d"] !== false;
          if (!coreScene.scene) {
            if (!previewSearchParameters.has("trees3d")) {
              treesEnabled = metadata["tileflow:vegetation-display"]?.visible ?? true;
            }
            // The scene mounts what the style declares; street lights belong to the 3D view.
            coreScene.scene = createTileflowMap3D({map, controller: coreSceneThemes(map),
              viewMode: threeDimensionalEnabled ? "3d" : "2d", vegetation: treesShown(),
              transformRequest: previewTransformRequest});
          }
          const scene = coreScene.scene;
          scene.setVegetation(treesShown());
          const instant = {transition: {duration: 0}};
          const animation = previewSearchParameters.get('animation') || '0';
          const duration = animation === 'fade' ? 800 : Math.min(3000, Math.max(0, Number(animation) || 0));
          // Only a change of the controls moves the layers, so a style event does not restart them.
          if (coreScene.shown !== threeDimensionalEnabled || coreScene.animation !== animation) {
            coreScene.shown = threeDimensionalEnabled;
            coreScene.buildingsShown = threeDimensionalEnabled;
            coreScene.animation = animation;
            void (threeDimensionalEnabled ? scene.show({transition: {duration, mode: animation === "fade" ? "fade" : "grow"}}) : scene.hide(instant));
          }
          // The inspector can hide the buildings alone.
          const showBuildings = threeDimensionalEnabled && runtimeLayerVisibility["tileflow-buildings-3d"] !== false;
          if (scene.buildings && coreScene.buildingsShown !== showBuildings) {
            coreScene.buildingsShown = showBuildings;
            void (showBuildings ? scene.buildings.show(instant) : scene.buildings.hide(instant));
          }
          const lightLayer = map.getLayer("tileflow-street-lights");
          const lightRenderer = lightLayer?.implementation || lightLayer;
          if (lightRenderer?.render && !lightRenderer.__previewVisibility) {
            const render = lightRenderer.render;
            lightRenderer.render = function(...args) {
              if (runtimeLayerVisibility["tileflow-street-lights"] !== false) return render.apply(this,args);
            };
            lightRenderer.__previewVisibility = true;
          }
        } finally {mountingCoreScene = false;}
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
          this.update();
          writeToggleStateToUrl();
          this.map.fire("tileflow:3d-toggle", {enabled: this.enabled});
          mountCoreScene(this.map);
          this.map.triggerRepaint();
        }

        update() {
          const reads = styleReads(this.map);
          for (const layer of reads.layers()) {
            const toggle = layer.metadata?.["tileflow:3d-toggle"];
            if (toggle !== "building" && toggle !== "landmark") continue;
            // Core's 3D buildings stand in for the compiled extrusion where the style describes them.
            const replaced = toggle === "building" && reads.metadata()?.["tileflow:buildings"];
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
          if (this.map.isStyleLoaded()) mountCoreScene(this.map);
          this.enabled = treesEnabled;
          this.button.textContent = this.enabled ? "TREES ON" : "TREES OFF";
          this.button.setAttribute("aria-pressed", String(this.enabled));
          this.button.title = this.enabled ? "Hide vegetation" : "Show vegetation";
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
        const reads = styleReads(map);
        const vegetationLayers = reads.metadata()?.["tileflow:vegetation-display"]?.flatLayers;
        for (const layer of reads.layers()) {
          if (layer.type === "symbol" && map.getLayoutProperty(layer.id, "text-field") !== undefined) {
            const hideLabels = !visibleLayerGroups.has("labels");
            if (hideLabels && !defaultLayerTextField.has(layer.id)) {
              defaultLayerTextField.set(
                layer.id,
                map.getLayoutProperty(layer.id, "text-field")
              );
            }
            const restoreText = !hideLabels && defaultLayerTextField.has(layer.id);
            const textField = hideLabels ? "" : defaultLayerTextField.get(layer.id);
            if (restoreText) defaultLayerTextField.delete(layer.id);
            if (
              (hideLabels || restoreText) &&
              !previewLayoutValuesEqual(
                map.getLayoutProperty(layer.id, "text-field"),
                textField
              )
            ) {
              map.setLayoutProperty(layer.id, "text-field", textField);
            }
          }
          // The shared vegetation controller owns every flat representation.
          if (vegetationLayers?.some((entry) => entry.id === layer.id.split("::")[0])) continue;
          const groups = previewLayerGroups(layer);
          const hideLayer = groups.some((group) => !visibleLayerGroups.has(group));
          // Group controls only own the properties they mask. Ordinary style events must
          // preserve temporary Inspector edits, including visibility and label text.
          if (hideLayer && !defaultLayerVisibility.has(layer.id)) {
            defaultLayerVisibility.set(layer.id, map.getLayoutProperty(layer.id, "visibility") || "visible");
          }
          if (!hideLayer && !defaultLayerVisibility.has(layer.id)) continue;
          const threeDimensionalToggle = layer.metadata?.["tileflow:3d-toggle"];
          const authoredVisibility = defaultLayerVisibility.get(layer.id);
          if (!hideLayer) defaultLayerVisibility.delete(layer.id);
          const styleMetadata = reads.metadata() ?? {};
          // Core's 3D buildings and trees stand in for compiled extrusions and flat trees.
          const replacedByCore =
            threeDimensionalToggle === "building" && styleMetadata["tileflow:buildings"];
          const toggleVisibility = replacedByCore
            ? "none"
            : threeDimensionalToggle === "building" || threeDimensionalToggle === "landmark"
              ? (threeDimensionalEnabled ? "visible" : "none")
              : authoredVisibility;
          const visibility = hideLayer
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

      function previewTransformRequest(url) {
        try {
          return new URL(url, location.href).hostname === "dev-tiles.tileflow.dev"
            ? {credentials: "include", url}
            : {url};
        } catch {
          return {url};
        }
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
          canvasContextAttributes: tileflowCanvasContextAttributes({antialias: mapAntialias}),
          collectResourceTiming: mapBenchmarkEnabled || Boolean(inspectorObserver),
          container: "map",
          maxPitch: tileflowMaxPitch,
          style: styleUrl,
          transformRequest: previewTransformRequest,
          ...resolveInitialMapOptions(previewMapOptions)
        });
        globalThis.__tileflowPreviewMap = map;
        attachTileflowNotices(map);
        attachTileflowNauticalLights(map);
        attachTileflowAtmosphere(map);
        attachTileflowLabelPlacement(map);
        attachTileflowHorizonQueries(map);
        inspectorObserver?.attach(map);
        installMapBenchmark(map);
        if (window.parent === window) map.addControl(new maplibregl.NavigationControl(), "top-right");
        let threeDimensionalControl;
        let treeControl;
        if (isSemanticPreview) {
          threeDimensionalControl = new ThreeDimensionalControl();
          treeControl = new TreeControl();
          map.addControl(threeDimensionalControl, "top-right");
          map.addControl(treeControl, "top-right");
          // Embedded Inspector owns the common Controls sidebar. Keep the controls mounted
          // for their renderer lifecycle and message bridge, but remove duplicate buttons.
          if (window.parent !== window) {
            threeDimensionalControl.container.hidden = true;
            treeControl.container.hidden = true;
          }
        }
        // Inspector has a shared theme selector in its Controls panel; keep the map-level
        // cycling button for standalone previews only.
        if (previewThemes.length > 1 && window.parent === window) map.addControl(new ThemeControl(), "top-right");
        let ensuringThreeDimensionalLayers;
        const ensureThreeDimensionalLayers = () => {
          if (ensuringThreeDimensionalLayers) return ensuringThreeDimensionalLayers;
          const buildingWireframeConfigLayer = styleReads(map).layers().find(
            (layer) => layer.metadata?.["tileflow:building-wireframe"] === true
          );
          const needsBuildingWireframe =
            buildingWireframeConfigLayer &&
            threeDimensionalEnabled &&
            styleLayerIsVisibleAtZoom(buildingWireframeConfigLayer, map.getZoom()) &&
            !map.getLayer("tileflow-buildings-wireframe-3d");
          if (!needsBuildingWireframe) return;
          ensuringThreeDimensionalLayers = loadBuildingWireframeRuntime()
            .then(() => {
              const styleLayers = map.getStyle()?.layers || [];
              const buildingWireframeConfigLayer = styleLayers.find(
                (layer) => layer.metadata?.["tileflow:building-wireframe"] === true
              );
              if (
                buildingWireframeConfigLayer &&
                threeDimensionalEnabled &&
                styleLayerIsVisibleAtZoom(buildingWireframeConfigLayer, map.getZoom())
              ) {
                addBuildingWireframeLayerIfConfigured(map, styleLayers);
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
          mountCoreScene(map);
          treeControl?.update();
          writeCameraToUrl(map);
          ensureThreeDimensionalLayers();
        });
        map.on("moveend", () => writeCameraToUrl(map));
        ${previewSceneClient}
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
      // Embedded previews share their host's stream. Two streams per tab can exhaust Chrome's
      // six HTTP/1 connections and leave even local module/font requests waiting indefinitely.
      let unsubscribePreviewStatus;
      try {
        if (window.parent !== window) unsubscribePreviewStatus = window.parent.__tileflowInspectorHost?.subscribePreviewStatus?.(window, applyStatus);
      } catch { /* Other embedders keep the standalone stream. */ }
      if (unsubscribePreviewStatus) {
        addEventListener("beforeunload", unsubscribePreviewStatus);
      } else {
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
