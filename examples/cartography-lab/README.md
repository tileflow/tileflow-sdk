# Tileflow cartography lab

This is the SDK's shared map-design workbench. `editorial-city` is a recipe built from the OSM
basemap, an `editorial` theme, and semantic modules; it is not a separate basemap or a runtime
preset.

![Editorial City in central Madrid](test/visual-baselines/madrid-neighborhood.png)

The four committed scenes exercise one style across a city overview, a dense neighborhood, a
waterfront, and a mobile viewport. The OSM archive revision, renderer, and hosted Noto Sans weights
are explicit so visual evidence has a stable identity.

## Work on the map

From the SDK root, start the default map preview:

```sh
pnpm dev:cartography
```

Select an exact review scene when the viewport and camera matter:

```sh
pnpm dev:cartography --scene madrid-neighborhood
pnpm dev:cartography --scene barcelona-waterfront
```

Edit `tileflow.config.ts`. Valid generations reload automatically. Invalid edits preserve the last
valid preview and show bounded diagnostics. Scene preview uses the committed CSS dimensions;
deterministic DPR and pixel evidence remain the responsibility of capture.

## Review and accept a change

Capture every scene while iterating:

```sh
pnpm capture:cartography
```

Compare fresh pixels without changing the approved baselines:

```sh
pnpm visual:cartography
```

The scenes use versioned but remote resources. The comparison reports exact changes and warnings
for review, but the default lab command does not turn remote pixel inequality into a failing CI
gate.

Only after reviewing the generated diff, accept the current render deliberately:

```sh
pnpm visual:cartography:update
```

Keep appearance tokens in `themes.editorial`, visibility and hierarchy in semantic modules, and
raw `layers` overrides as a last resort. When the desired result cannot be expressed semantically,
record the failing scene and before/after evidence, then add the smallest renderer-aware SDK
primitive in the same pull request.
