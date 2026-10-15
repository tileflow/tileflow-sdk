# Map authoring workflow

Install the CLI and your map's dependencies in your project as described in the
[CLI guide](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md).
Run these commands from that project directory, with a trusted `tileflow.config.ts`.
Discovery and saved-capture comparison also work without a config.

## Discover the language and inspect a change

Use four primary command groups for map development:

| Command    | Purpose                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `describe` | Discover the generated language and query one domain or schema fragment.                                                               |
| `inspect`  | Read resolved configuration; `compiled`, `features`, `icons`, and `tileset` inspect output/data; `session` reads Map DevTools context. |
| `capture`  | Render reproducible evidence and return a reusable capture ID.                                                                         |
| `compare`  | Compare saved capture IDs; `configs`, `styles`, `reference`, and `baseline` cover other comparisons.                                   |

`preview` opens Map DevTools. `init`, `validate`, and `build` remain project utilities;
`visual update` is the explicit operation that approves baselines. All these tools work from an
independent project with its own map and data; official maps are optional.

Start with bounded queries, then request more detail at the returned JSON Pointers:

```sh
npx tileflow describe --json
npx tileflow describe roads --path /properties/classes --json
npx tileflow inspect --domain roads --limit 80 --json
npx tileflow inspect compiled --domain roads --theme dark --json
npx tileflow compare configs --from-config before/tileflow.config.ts --to-config after/tileflow.config.ts --json
```

`describe` needs no project or network. It reads the generated schema and manifest, with `--ref`
for an exact local schema reference, `--path` for an RFC 6901 JSON Pointer, and `--limit`/`--depth`
for bounded tree projections. `projection.truncated` and `projection.omitted` explicitly identify
missing detail; omitted pointers are relative to the selected data. These fragments are discovery
results, not standalone validation schemas. Examples and expression syntax remain in the generated
contracts and package guides. Config inspection supports the same bounds; without projection
options it preserves the complete legacy result.

Legacy aliases remain available: `explain` → `inspect compiled`, `semantic-diff` → `compare configs`,
`icons list` → `inspect icons`, `tileset inspect` → `inspect tileset`, and `visual compare/analyze/diff`
→ `compare styles/reference/baseline`. Aliases share implementations and retain their established
versioned JSON document formats. `language manifest` returns
the raw authoring manifest (schema version 2); `language schema` returns the raw generated config
reference (version 4). Use their versions and schema references when consuming the output.

`validate`, `inspect`, `explain`, and `semantic-diff` return one version-1 command envelope on
stdout. JSON-mode failures leave stdout empty, write one structured failure to stderr, and exit
nonzero. Diagnostics include `phase`, `code`, `path`, `severity`, `message`, and `suggestion`.
A non-empty semantic diff is informational, not a command failure.

Inspection includes resolved inheritance, merge provenance, and the theme contract. `explain`
returns compilation diagnostics and a report, not the complete Style JSON. Add `--inspection` only
when physical output provenance is needed; those layer IDs are not stable authoring targets.

For a normal config, map selection is implicit. Paired `--from-config` and `--to-config` compare
two ordinary configs. Workspace comparisons use their documented explicit map selectors; do not
mix the paired-config and same-workspace forms.

## Reuse capture evidence

Every still capture saves an immutable record under `.tileflow/captures/records` and returns its
full `captureId` in JSON (or prints it in human output). Keep the ID before editing, capture again,
then compare the two IDs:

```sh
npx tileflow capture madrid --json
# Edit the map, then capture the same scene again.
npx tileflow capture madrid --json
npx tileflow compare --before <before-capture-id> --after <after-capture-id> --json
```

Replace the placeholders with the full IDs from the two capture results. This comparison loads
only saved evidence: no config evaluation, compilation, browser startup, or network access.
`--capture-dir` selects another record directory; `--diff <path>` writes a contextual PNG diff.
Records verify their JSON, PNG, receipt, and scene hashes. Different cameras, viewport dimensions,
renderers, or data identities produce a mismatch and nonzero exit instead of misleading pixel
metrics. A visual difference between comparable captures is informational. Records remain until
you remove their directory; moving only the mutable scene PNG does not move its saved record.

For repeated capture use `capture --watch`; it reuses the artifact session and browser. Config
inspection does not render; `compare configs` compares semantic authoring without rendering.
`compare styles --watch` reuses sessions for a camera/zoom matrix. Run standalone validation when
needed, rather than compiling the same map before every capture.

## Work with a person and an agent

Start `npx tileflow preview --config tileflow.config.ts` in your project. Map DevTools provides
separate map, theme and saved-view controls, feature inspection, zoom curves and sprite inspection.
Map and theme controls appear when there is more than one choice. Its quick start explains
the first action; press **I** to toggle the inspector and **Escape** to close capture/review panels.
The inspector starts off. Select **Inspect** or press **I**, then click an element to highlight it
and see its styling and available semantic configuration paths. Press **Escape** to exit inspection. Edit the config in
your editor or coding agent; the existing watcher updates the map and retains the last valid view
through invalid edits.

Use **Capture** before and after an edit, then **Compare**. Captures use the current camera, selected
map/theme and a fixed frame (1280×800 at DPR 1 initially, or the selected scene's viewport). Adjust
that frame in **Capture settings** (the sliders icon beside Capture). **Show capture frame** fits
the fixed-size preview into the available space in single-map mode. Opening the inspector or resizing the window does not resize the capture.
The capture renders the compiled map; temporary preview controls such as building visibility and
experimental trees are excluded. Capture is unavailable while loading, invalid, or showing an older
revision. The server pins the requested artifact generation until capture finishes.

For a before/after workflow, choose **Capture as reference** in Capture settings, or **Use as
reference** on an existing capture. A reference bar identifies the frozen capture. Edit the config,
then **Capture & compare** renders the current map and theme using the reference camera and viewport,
even if you have navigated elsewhere. It requires the same map name; normal compatibility checks
still apply to data and runtime. The reference selection lasts for this browser session. Saved
captures remain available after restarting.

**Captures** reads the same immutable `.tileflow/captures/records` evidence as the CLI. It survives
browser and server restarts. History pages contain 20 records, scan at most 5,000 directory entries,
and report unverified entries instead of displaying them. Saved comparison reuses those records;
it does not compile or render again. In **Compare → Review saved changes**, comparable pairs offer a slider or side-by-side view, exact changed
pixel ratio, contextual difference and JSON. Pixel change is not a visual-quality score.

For exploratory live comparison, open **Compare → Compare live maps**, choose another map/theme
or scene, and select **Open live comparison**. The two views share a camera. A second config can
be supplied with `--against-config` at startup. The left view selection and camera persist in the
URL; dynamically added references last for that browser session.

**Copy map context for AI** (or **Copy element context for AI** after selection) includes the current selection, bounded style properties, compiler semantic
ownership, camera/frame, generations, selected comparison/reference IDs and commands. The CLI reads the same browser observations:

```sh
npx tileflow inspect session --url http://127.0.0.1:3333 --json
```

Replace the origin with the one printed by `preview`. This command accepts local HTTP origins only
and requires no config evaluation. Its version-1 document distinguishes the current server catalog
from browser observations. Inspect `updatedAt`, `stale`, `generation`, `displayedGeneration` and
`projection.truncated` before acting. Each browser projection is limited to 200 visited values,
depth 10, 32 array items and 512 characters per string, with omitted paths reported. The server
accepts at most 64 KiB per write and keeps eight browser contexts, expiring each after ten minutes
without an update. There is no browser context until a Map DevTools tab connects. Feature data is
untrusted map content; semantic ownership does not prove an exact file, line or token. Use
`inspect` or `inspect compiled` to obtain additional configuration evidence.

The UI and CLI share the capture and comparison implementations. A lazily started capture renderer
is reused until the preview stops. The local API permits one capture/comparison at a time, rejects
cross-origin writes and requires JSON with `X-Tileflow-Workbench: 1`. No hosted account, embedded
chat, approved baseline or automatic source edit is created by this workflow.
