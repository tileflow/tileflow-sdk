/** Runs inside the preview, so MapLibre receives objects from its own JavaScript realm. */
export const previewSceneClient = String.raw`
        let sceneStyleRevision = 0;
        globalThis.__tileflowApplyScene = async (serialized, isCurrent) => {
          const next = JSON.parse(serialized);
          if (next.style) {
            // getStyle() retains renderer instrumentation on sources. It is not authored
            // style-spec input; MapLibre adds it back from the map's timing option.
            delete next.style.collectResourceTiming;
            for (const source of Object.values(next.style.sources || {})) delete source.collectResourceTiming;
            await loadTileflowStyleFonts(next.style, {fontFaces: previewFontFaces});
          }
          if (!isCurrent()) return false;
          const context = map.getCanvas().getContext("webgl2") || map.getCanvas().getContext("webgl");
          if (context?.isContextLost()) throw new Error("The map's graphics context is recovering. Try the change again.");
          if (next.style) {
            // MapLibre ignores metadata-only diffs. A global-state revision also commits the
            // new 3D design metadata, without replacing sources, tiles or custom layers.
            next.style.state = {...next.style.state, "tileflow:preview-revision": ++sceneStyleRevision};
            const layerOrder = map.getLayersOrder();
            map.setStyle(next.style, {diff:true});
            // Custom layers are omitted from the serialized style. A diff can reinsert the
            // surrounding style layers above them, covering 3D with the flat map. Restore
            // their placement before the nearest surviving successor, without remounting.
            let before;
            for (let index = layerOrder.length - 1; index >= 0; index--) {
              const id = layerOrder[index], layer = map.getLayer(id);
              if (!layer) continue;
              if (layer.type === "custom") map.moveLayer(id, before);
              before = id;
            }
          }
          previewSearchParameters.set("animation", String(next.animation));
          previewSearchParameters.delete("trees3d");
          const visibleTrees = map.getStyle()?.metadata?.["tileflow:vegetation-display"]?.visible ?? true;
          threeDimensionalControl?.setEnabled(next.buildings3d);
          treeControl?.setEnabled(visibleTrees);
          mountCoreScene(map);
          treeControl?.update();
          updateGlobeBackdrop(map);
          const url = new URL(location.href);
          url.searchParams.delete("scene");
          url.searchParams.set("map", next.map);
          url.searchParams.set("theme", next.theme);
          if (Object.keys(next.controls).length) url.searchParams.set("controls", JSON.stringify(next.controls));
          else url.searchParams.delete("controls");
          if (next.animation) url.searchParams.set("animation", String(next.animation));
          else url.searchParams.delete("animation");
          history.replaceState(history.state, "", url.href);
          // Read the current camera here; a slow compile must never undo navigation.
          writeCameraToUrl(map);
          map.triggerRepaint();
          return true;
        };
`;
