# Map design diagnostics

Open **Diagnostics** in Map DevTools to investigate a map's rules, visual resources and current-view
composition. The list groups findings under **Readability**, **Style**, **Assets** and **Performance**.
**Problem** means a confirmed configuration or resource failure. **Review** means an observed
situation may be intentional. Counts refer to grouped findings, not quality scores.

## Check the map

Style observations refresh after changes settle. **Check view** explicitly collects samples from
the current map and briefly profiles drawing work. It does not navigate to other cities, change the
camera, compile themes or save edits. Changing the map or leaving the panel cancels pending work.
Expensive renderer observations are not repeated continuously while editing colors or dragging.

The initial detectors cover invalid style rules, broken references and zoom ranges, unresolved
icons, verifiable text contrast, large layer stacks, potentially repeated rules and drawing work.
Findings group affected layers and keep bounded examples. A missing image must remain unresolved
after loading; images with a working fallback are not missing resources. An empty viewport or a
layer outside its zoom range does not by itself create a global problem.

Text contrast is checked only where the evaluated text and opaque halo make the color pair
verifiable. This is not a measurement of all pixels behind a label or certification that a map is
readable. Unavailable evaluation context does not become a passing observation. Size thresholds,
absence of halos and ordinary collision rejection do not establish design defects.

Performance findings are review indications. A style layer, a queried feature, a draw call and an
overdraw pass measure different things. Layer stacks are grouped by compiler provenance when it is
available; unknown ownership is not inferred from names. Equivalent drawing rules may be deliberate
casings, shadows or blending, so they are never automatically removed. Counts and short CPU samples
do not attribute GPU cost to an individual layer or establish a universal performance grade.

Native overdraw is observed only when the renderer and scene permit a meaningful measurement.
Custom rendering, terrain, sky, globe projection or active debug modes can make it unavailable. The native sample saturates
at eight passes, so an eight-pass observation is a lower bound. Sampling temporarily enables the
native debug rendering and restores it; open **Debug** explicitly to keep an overlay visible.

Drawing-work sampling requests repaints for approximately 650 ms and requires at least ten complete
frames. Compatible native overdraw sampling has a separate two-second limit. A median of at least
1,000 draw submissions, or at least 25% of sampled pixels reaching eight passes, creates a review
finding. These are disclosed review triggers, not universal limits. Label evaluation and retained
examples are capped; reading the style and querying rendered features still depend on map size.
Detailed rule checks inspect at most 2,000 non-internal layers, while stack counts include the
whole style. Contrast sampling retains up to 5,000 symbol candidates, evaluates at most 200 of
them and keeps up to 40 eligible examples. Coverage limits remain available in the copied report.

## Investigate a finding

Expand a row to read its evidence and limitations. **Open rule** selects the layer and focuses the
related paint, layout or filter declaration. **Show on map** uses the finding's observed context;
asset and overdraw actions open the corresponding inspection tools. Available actions depend on
the evidence. Preview changes remain temporary and share Undo/Redo and Reset all changes.

Findings retain the map revision and camera in which they were observed. Moving away is not proof
that a problem was fixed. Old view evidence is marked stale until checked again. Local dismissals
apply to a case fingerprint; changing the relevant evidence makes it reviewable again. Incomplete
checks and missing renderer capabilities are included in the copied report.

**Copy findings** and each finding's copy action include structured evidence, conditions and
temporary edits. Context is sanitized, bounded and reports omissions. Nothing is sent to an agent
automatically. The output is diagnostic evidence, not a benchmark or release certification.

## Explain a layer's visibility

Select a layer in **Layers**, then open **Diagnosis**. It shows declared visibility,
zoom eligibility, source state and viewport-query observations. With an actual selected feature it
also evaluates its filter and relevant zero-size or zero-opacity rules. A zero component does not
prove the whole layer is invisible: a circle stroke or another symbol component may still draw.
Unknown expression context and geometry-dependent filters remain unavailable. Query matches do
not establish final pixel visibility, depth or occlusion.

## Compatibility

The tab persists as `tab=diagnostics`. Previous `tab=beacon` links open the new panel. The former
Beacon scoring and tour interface is retired; its historical report scores are not comparable to
Diagnostics findings. Network infrastructure, platform regressions and broad map quality remain
separate concerns from these author-facing checks.
