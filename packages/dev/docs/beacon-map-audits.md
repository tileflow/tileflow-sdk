# Beacon map audits

Open `tileflow preview`, select **Beacon**, choose **Desktop** or **Mobile** and
**Active tour** (default), **Quick check** or **All zooms**, then **Run audit**. The report includes 48 checks grouped into Rendering (9), Loading
(8), Legibility (8), Accessibility (8), Cartography (7) and Integrity (8). Expand a result for its
measured value, target, evidence and suggested fix. Findings open Layers, Tiles or Debug. **Copy
context for agent** copies the bounded report; it does not upload it.

## Scope and restoration

Active tour follows a deterministic route through the current view, London, New York, Tokyo,
Nairobi and São Paulo. Each location has an overview and a detailed view, with zoom, bearing and
pitch changes within the map's camera limits. Destinations outside explicit map bounds are skipped
and listed in coverage. The current theme stays active; this route does not cover every theme.

The tour has a 60-second budget: up to 55 seconds for navigation and sampling, with the remainder
reserved for diagnostics. Each stop measures a 1.2-second flight, waits up to two seconds for tiles,
then samples up to 2.4 seconds of continuous settled repaints. On a responsive map the run usually
takes 45–60 seconds. Slow loading can exhaust the budget: remaining views are explicitly unmeasured,
not passed. Synchronous analysis and restoration may add a small overhead. Reduced-motion settings
replace flights with jumps; the report does not claim an animated navigation measurement then.

**Tour measurements** lists the actual camera, moving/settled p95 frame intervals, sample counts and
readiness for each view. A p95 requires at least 30 intervals; coverage flags fewer than 60 settled
intervals. A view that did not finish loading before sampling receives no settled performance score.
The rendering check uses the worst qualifying per-view p95, so a slow location is not hidden by an
average across fast locations. Long stalls are retained. These measurements include browser
scheduling and other work on the machine, rather than isolated GPU execution time.

Quick check samples the current camera and concrete theme for about three seconds. It is useful
for static style checks and a short settled rendering sample. All zooms visits each integer zoom
from 0 through 22 within map limits at the same geographic centre, for every registered palette and
time-of-day variant. It waits up to five seconds for readiness and samples 150 ms per view. This
exhaustive scope can take several minutes; it is not the one-minute navigation benchmark. Use
**New audit** from a result to change scope or viewport.

Desktop uses an actual 1280×800 CSS iframe viewport; Mobile uses 390×844. The iframe is scaled to
fit the workspace. CPU, GPU and network are those of the current computer: this is not phone
hardware emulation. No cache clearing, network throttling or cold navigation occurs.

Camera, viewport, pixel ratio, overlays and scene are restored after completion or cancellation.
Moving the map interrupts the audit and keeps the user's camera. Leaving Beacon cancels the run.
A map replacement invalidates the run. Reports and preview changes stay local and in memory.

## Measurements and limits

- **Rendering:** inter-render p95 during continuous repaints (moving and settled windows for Active tour), native overdraw samples (saturating at
  8 passes), eligible layer count, intercepted WebGL draw calls, CPU placement time, data-driven
  paint-rule count, custom-renderer CPU submission time, and an observable GPU allocation estimate.
  CPU submission is not GPU execution time. Readbacks and feature inspection are outside the frame
  sample. GPU memory excludes inaccessible allocations; a low estimate is informational.
- **Loading:** unused source-layer MVT message bytes, original map-load event time, individual tile
  sizes when exposed, view readiness, per-view transfer and request counts, compression and cache
  observations. PMTiles archive ranges are not individual tile sizes. Resource Timing cannot prove
  Cache-Control policy. Cached audit views are not a fresh visitor estimate.
- **Legibility:** observed text-placement rejections, line-label candidates, nearby repeated label
  anchors, minimum evaluated size, approximate density, halos, configured line curvature and
  requested language-field coverage. Rejections can result from collisions, offscreen placement or
  line fit; the report does not pretend to know the renderer's exact rejection cause.
- **Accessibility:** sampled text contrast in current/night/other themes, color-vision simulation
  heuristics, static non-text contrast, categorical color-only rules, the system motion preference,
  and sampled label retention after temporarily setting the real canvas ratio to 3×. Contrast uses
  evaluated colors and supported flat fill/halo backgrounds. Raster, 3D and unresolved backgrounds
  are excluded. This is diagnostic evidence, not accessibility certification.
- **Cartography:** enabled zoom-range gaps, potential abrupt layer entry, road and place hierarchy
  heuristics, adjacent-zoom size changes, unchanged eligible-layer counts and sampled fill coverage.
  Naming-based hierarchy checks explicitly identify their inferred roles and exclude unmatched IDs.
- **Integrity:** missing icon references, actual theme coverage, hidden-layer source residency,
  cached missing glyphs, unresolved expressions, locally unmatched filters, style-spec validation
  and retained runtime/resource errors. Resident data is bounded; zero local matches does not mean
  a filter never matches globally.

Samples are bounded to 4,000 rendered query results, 100 labels and 64 resident vector tiles per
view; feature expression checks use up to 24 candidates per layer. Geometry is discarded after
observation. All-zoom style snapshots are shared per theme. Custom renderer and private MapLibre
observations are version-isolated and can be unavailable on unsupported renderers.

## Scores and useful comparisons

Category scores average checks with a measured score. Overall score averages measured categories.
Informational and unavailable checks are excluded; an unmeasured category shows **—**. For numeric
budgets, meeting the displayed target scores 100; exceeding it by up to 1.5× scores 70, by up to 2×
scores 45, and beyond that scores 0. Minimum targets invert the ratio. Diagnostic findings may use
review scores rather than numeric budgets. A high score does not establish global map quality.

Repeat with the same view, scope, device, cache conditions and browser load when comparing changes.
Review the evidence before acting on a warning. Copying findings supplies an agent with concrete
layer IDs, camera context, measured values, coverage limits and suggested investigation steps.

## Reproducible reports and future automation

Reports use `version: 3` and identify the deterministic tour as `protocol: "active-tour-v1"`.
Scenarios carry stable IDs, location, actual camera, theme, frame sample counts, p95, long-frame
fraction, maximum frame interval, readiness and observed network transfer. `plannedViews` and
`budgetExhausted` distinguish completed coverage from a partial run. Camera, viewport, DPR, duration
and warnings accompany the scores. Change the protocol identifier when its itinerary or sampling
rules change. There is no CI runner or GitHub integration in this feature.

For future comparisons, keep protocol, map revision, initial view, browser/device, viewport, theme,
DPR and cache conditions fixed. A single one-minute run is a diagnostic sample; repeated runs on a
controlled worker are needed before setting regression gates. The tour does not clear caches,
emulate mobile hardware, or prove worldwide coverage from six locations.
