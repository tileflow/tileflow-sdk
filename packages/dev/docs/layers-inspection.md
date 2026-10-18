# Layers inspection

Open the local preview and select **Layers**. The panel inspects the current map without changing its
authored style. **By module** groups physical layers using compiler contributions; shared layers retain
every owner. **Draw order** lists the renderer's public layer sequence, latest draw calls first.
Custom runtime layers are included even though they are absent from Style JSON. DevTools overlays
are excluded. Unknown ownership is labeled **Unattributed**, rather than guessed from an ID.

Press **I** or the element-picker icon and click an element on the map. Its layer becomes selected in
Layers and **Rules**, the first detail tab, opens with values evaluated for the picked feature. The
picked feature is a snapshot from that click; changing the layer or artifact/scene revision clears it.
Inspect no longer has a separate top-level tab. Legacy `tab=inspect` links resolve to Layers.

Enable **Visible only** beside the organization buttons to hide hidden/out-of-zoom layers and vector
layers with no rendered features in the current viewport. The filter combines with search and both
organization modes, and refreshes after camera movement, style changes and tile loading. One viewport
query serves the whole list after a 250 ms pause. During movement the last result remains stable;
failed queries do not classify layers as empty. Custom, raster and background layers remain listed
when their visibility cannot be measured; explicit hidden runtime state is excluded. This is a
rendered-feature filter, not a measurement of final pixels, transparency or occlusion.

Search by ID, semantic target, module, type, source or source-layer. Click anywhere on a row, or use
Up/Down and Home/End from a focused row. Selection stays in Layers and is retained in the `layer` URL
parameter. If a selected ID disappears, its detail shows that absence and keeps the ID for when it
returns. The Layers tab remains in the existing `tab=layers` parameter.

## Read the evidence

Open **Diagnosis** in the selected layer's detail tabs. With a picked feature or a
Data sample, it explains the filter result and any evaluated zero-size or zero-opacity components.
A zero component is not proof that the whole layer is invisible. Diagnostics findings can open a
specific paint, layout or filter declaration directly in Rules, highlighting its row.

- **Diagnosis** reports presence, declared visibility, the inclusive minimum/exclusive maximum zoom
  range, source loading, shared source tiles and viewport-query observations. Pixel visibility,
  occlusion, transparency and depth are explicitly unmeasured. Later draw calls do not necessarily
  cover every earlier layer. Runtime 3D controllers report only the state and statistics they expose.
- **Rules** shows paint and layout values inline, without expandable rows, alongside their zoom,
  feature, feature-state, global-state and image dependencies. Values use the current zoom and the
  picked feature or selected data sample. Edit a value and press Enter or leave the field to preview
  it; color pickers update live while open. Enumerations and booleans use selectors. Invalid values
  show an error and leave the map unchanged. Edits override the entire physical layer across zooms,
  including when a picked feature supplied the evaluated value. Each modified rule has a reset
  button that restores its original expression or renderer default. Paint checkboxes temporarily
  remove a declaration from the renderer so its default applies. The disabled row stays visible and
  crossed out, showing its retained value at the current view; re-enabling restores the exact saved
  expression or override. Toggles share edit history and appear in copied context. Implicit defaults
  cannot be disabled; edit one to create an explicit rule first. **Undo** and **Redo** beside the
  three-dot menu share the temporary style history. **Reset all changes** in that menu restores
  temporary style and geometry edits and clears their history. Reload clears temporary edits;
  config, source data and build artifacts stay unchanged. Filters remain read-only. Copy context includes the raw rules and temporary edits.
  Evaluation does not reproduce placement, transitions or final pixel colors.
- **Data** queries only the selected layer after the viewport settles. At most 80 returned fragments
  are retained; the renderer's query itself may return more. Fragments can duplicate logical features
  across tile boundaries or world copies. Zero results are not proof that a filter excluded all data.
  Unsupported custom/raster/background queries are unavailable, not zero. Choose an actual sample
  to inspect its properties, or use **Use for rules** to evaluate that fragment in Rules. Inline
  source data is excluded from source details.
- **Origin** preserves sidecar owners, targets, slots and operations. Semantic module paths do not
  establish exact source-file or line provenance; token paths appear only if explicitly supplied.

## Follow a layer through the map

Hover or keyboard-focus a layer row to highlight its sampled geometry live in the current map view.
Click a row to keep that layer highlighted. Hovering another row temporarily replaces the highlight;
leaving restores the clicked layer, or clears the preview when no row was clicked. Closing the panel
clears both previews. Hover and click work with the element-picker mode on or off. The camera stays unchanged. The preview refreshes when map movement settles or source tiles
change, even when the hovered layer differs from the selected layer. Hover is coalesced over 80 ms;
queries are cached for the current view. There is no separate **Highlight on map** button.

Overlays retain at most 30 fragments and 25,000 vertices. They use separate scratch sources and never
change original paint, layout, source data or feature state. A highlight outlines queried geometry;
it is not a reconstruction of glyphs, symbols or 3D meshes. Hidden, out-of-zoom, custom and raster
layers without queryable rendered geometry report that limitation instead of moving the camera.

**Tiles** inspects tiles grouped by source. Tile costs belong to the shared source, not to a
single style layer. Sprite and font links in Rules open Assets. Other inspection tabs remain usable
while compilation or tile loading continues; obsolete scheduled measurements are discarded.

## Give an agent context

**Copy context** opens a frozen preview in Markdown or JSON. Add an optional investigation question,
then copy it. The packet includes the selected ID, map/theme, generation, scene revision, camera,
viewport, rules, provenance, diagnostic evidence, source, runtime state, recent changes and temporary
edits. It retains at most eight feature property samples, excludes their geometries and inline source
data, removes credentials and query strings from source URLs, and reports projection omissions.
Nothing is sent to an agent automatically.

While Layers is active, the same observation replaces stale feature selection in the local
`tileflow inspect session --url http://127.0.0.1:3333 --json` context. The CLI applies an additional
bounded projection and reports omitted paths. Temporary edits are observations; capture commands
still use the compiled map rather than reproducing scratch edits.
