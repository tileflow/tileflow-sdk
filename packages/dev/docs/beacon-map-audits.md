# Beacon map audits (legacy)

The Beacon scoring and tour interface has been replaced by **Diagnostics**. See
[Map design diagnostics](./map-design-diagnostics.md) for the current workflow. This document
describes historical audit reports; its scores are not comparable with Diagnostics findings.

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

**Tour measurements** lists the actual camera, moving/settled p95 frame intervals, sample counts,
remaining tile wait after navigation, and total readiness including navigation for each view.
Loading scores use the remaining wait, excluding scripted animation; any timed-out view fails
readiness. A p95 requires at least 30 intervals; coverage flags fewer than 60 settled
intervals. A view that did not finish loading before sampling receives no settled performance score.
The rendering check uses the worst qualifying per-view p95, so a slow location is not hidden by an
average across fast locations. Long stalls are retained. These measurements include browser
scheduling and other work on the machine, rather than isolated GPU execution time.

Quick check samples the current camera and concrete theme for about three seconds. It is useful
for static style checks and a short settled rendering sample. All zooms visits each integer zoom
from 0 through 22 within map limits at the same geographic centre, for every registered theme and
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
  anchors, a scored text-size budget, approximate density, halos, configured line curvature and
  requested language-field coverage. Rejections can result from collisions, offscreen placement or
  line fit; the report does not pretend to know the renderer's exact rejection cause.
- **Accessibility:** sampled text contrast in current/night/other themes, color-vision simulation
  heuristics, static non-text contrast, categorical color-only rules, the system motion preference,
  and sampled label retention after temporarily setting the real canvas ratio to 3×. Contrast uses
  evaluated colors and supported flat fill/halo backgrounds. Raster, 3D and unresolved backgrounds
  are excluded. This is diagnostic evidence, not accessibility certification.
- **Cartography:** enabled zoom-range gaps, potential abrupt layer entry, road and place hierarchy
  heuristics, scored size-rule continuity, unchanged eligible-layer counts and sampled fill coverage.
  Naming-based hierarchy checks explicitly identify their inferred roles and exclude unmatched IDs.
- **Integrity:** missing icon references, actual theme coverage, hidden-layer source residency,
  cached missing glyphs, unresolved expressions, locally unmatched filters, style-spec validation
  and retained runtime/resource errors. Resident data is bounded; zero local matches does not mean
  a filter never matches globally.

Samples are bounded to 4,000 rendered query results, 100 labels and 64 resident vector tiles per
view; feature expression checks use up to 24 candidates spread across the bounded source sample per
layer. Filter evidence counts only the candidates actually evaluated. Geometry is discarded after
observation. All-zoom style snapshots are shared per theme. Custom renderer and private MapLibre
observations are version-isolated and can be unavailable on unsupported renderers.

## Scores and useful comparisons

Category scores average checks with a measured score. Overall score averages measured categories.
Informational and unavailable checks are excluded. Legibility and Cartography show a numeric score
when eligible samples exist, together with the specific score basis and sample count. Each currently
has one scored benchmark; its other checks remain diagnostic. Their scores do not assess the entire
visual quality of a map.
A category with no measurable scores shows **—**. For numeric
budgets, meeting the displayed target scores 100; exceeding it by up to 1.5× scores 70, by up to 2×
scores 45, and beyond that scores 0. Minimum targets invert the ratio. Structural counts and cartographic heuristics are explicitly marked **Diagnostic · not scored**.
These include expression counts, rejected candidates, localized name fields, halos, fill coverage
and locally unmatched filters. They remain visible as evidence without asserting a defect.
Error scoring includes only resources and runtime errors observed during the audit, not prior session failures. A high score does not establish global map quality.

The two quality benchmarks use an explicit percentage, rather than the generic budget tiers:

- **Legibility / Text-size budget:** percentage of sampled labels whose evaluated `text-size` is
  at least 10 CSS px. The threshold is a design budget, not an accessibility standard.
  The bounded sample rotates between rendered symbol layers so dense POI layers do not monopolize it.
  Font metrics, formatted section scaling, script, perspective and final glyph rasterization are not measured.
  Unresolved expressions are excluded; their renderer fallback does not count as a passing size.
- **Cartography / Size-rule continuity:** percentage of sampled layer/view size rules without a
  jump exceeding both 1 px and 25% of the smaller size (with a 1 px denominator floor). For line
  width, text size and circle radius, evaluate immediately around the actual zoom stops at
  `stop ± 0.0001`, within the layer and camera zoom bounds. Continuous interpolation and physical
  width scaling pass, even when sizes double between integer zooms. Changes at layer entry/exit,
  filtered-out features and stops with opacity at or below 1% on either side are excluded.
  Each ready view checks up to 128 visible layers, four feature contexts per layer and 128 stops
  per rule. Missing or oversized evaluations are excluded. This measures authored rule continuity,
  not final GPU pixels, label placement or transition animations. Intentional steps can exceed
  the budget and should be reviewed before changing them.

Only views that finished loading contribute to these scores. Each check exports `sample` with
`passed`, `total`, `skipped` and `unit`; category `scoreBasis` identifies what its number represents.
An observed outlier remains a warning even when rounding produces a high percentage. Findings
include the layer and camera, with the exact zoom stop for a size jump. No eligible samples means
unavailable, never an automatic 100. Repeated features in different views are separate observations.

Repeat with the same view, scope, device, cache conditions and browser load when comparing changes.
Review the evidence before acting on a warning. Copying findings supplies an agent with concrete
layer IDs, camera context, measured values, coverage limits and suggested investigation steps.

## Reproducible reports and future automation

Reports use `version: 4`, `scoring: "measured-evidence-v3"` and identify the deterministic tour as `protocol: "active-tour-v1"`.
Scenarios carry stable IDs, location, actual camera, theme, frame sample counts, p95, long-frame
fraction, maximum frame interval, `tileWaitMs` after navigation, end-to-end `readyMs` and observed
network transfer. Policy v2 excludes scripted camera time from loading scores; v1 included it.
Policy v3 adds the sampled text-size and rule-continuity benchmarks described above; v2 left both
categories entirely diagnostic. Old reports retain their original scores and must be rerun to use v3.
`plannedViews` and
`budgetExhausted` distinguish completed coverage from a partial run. Camera, viewport, DPR, duration
and warnings accompany the scores. Change the protocol identifier when its itinerary or sampling
rules change. The scoring policy is versioned separately: do not compare aggregate scores across
policies. The original Active tour itinerary, timing windows and thresholds for measured frame
performance are unchanged. There is no CI runner or GitHub integration in this feature.

For future comparisons, keep protocol, map revision, initial view, browser/device, viewport, theme,
DPR and cache conditions fixed. A single one-minute run is a diagnostic sample; repeated runs on a
controlled worker are needed before setting regression gates. The tour does not clear caches,
emulate mobile hardware, or prove worldwide coverage from six locations.
