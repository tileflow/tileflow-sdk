# CLI reference

Detailed contracts for the `tileflow` CLI. Start with the
[README](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) to install it.
For step-by-step guides, see the [Tileflow documentation](https://tileflow.dev/docs).

This reference ships with the package. Use the copy included in your installed release for
version-specific behavior; the GitHub `main` branch can contain unreleased changes.

## geocode

`tileflow geocode <file.csv>` converts addresses to GeoJSON points on an enabled persistent
Search service. Persistent Search is disabled by default. The command requires Node.js 22.13 or
later with `node:sqlite` and a Team credential with `geocoding:read` in `TILEFLOW_API_KEY`.

Use `--address-columns street city postcode` to combine columns in order. The default column is
`address`. Choose the GeoJSON path with `-o`. The CLI estimates shared API units for distinct
remaining addresses and prompts before sending them. `--yes` accepts the estimate. Concurrency
defaults to two requests and accepts one to eight.

At the per-minute Search limit, all workers pause for the indicated wait of up to 120 seconds.
These pauses do not use a row’s retry allowance. After five pauses without a completed lookup,
or a requested wait above 120 seconds, rerun the command to resume. Other transient failures
and rate limits without a retry delay allow two retries with waits of at most 30 seconds.

The GeoJSON preserves source columns and attribution. Pass the printed attribution to
`tileset build --attribution`. The adjacent `.unmatched.csv` lists missing points by CSV line.
Keep the adjacent `.geocode.sqlite` checkpoint private. Repeating the command with the same input,
columns, endpoint and credential reuses completed rows. After an unconfirmed request, review
Team usage before selecting `--retry-unconfirmed`. A repeated request may consume units again.

## tileset build

`tileflow tileset build <input>` turns local vector data into a PMTiles archive ready for
`tileflow tileset publish`. It runs on your machine, needs no account and no extra tools, and sends
nothing anywhere. Success means the archive already passed the validation `publish` applies. Build
output is deterministic: the same input and options produce the same bytes, so republishing unchanged
data reports `unchanged`.

```sh
npx tileflow tileset build ./data/stores.geojson -o ./data/stores.pmtiles --json
```

### Inputs

| Format                    | Detected from                                                | Notes                                                                        |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| GeoJSON                   | `.geojson`, `.json`                                          | FeatureCollection, Feature or geometry. Streamed.                            |
| Newline-delimited GeoJSON | `.ndjson`, `.geojsonl`, `.geojsons`, `.geojsonseq`, `.jsonl` | One Feature or geometry per line; RFC 8142 separators are accepted.          |
| CSV                       | `.csv`, `.tsv`                                               | UTF-8 with a header row. Comma, semicolon, tab or pipe delimited.            |
| Shapefile                 | `.shp`, or `.zip` holding one                                | Reads `.dbf`, `.prj` and `.cpg` beside it. Z and M values are ignored.       |
| GeoPackage                | `.gpkg`                                                      | One feature table. Needs Node.js 22.13 or later. Z and M values are ignored. |
| KML                       | `.kml`, or `.kmz` holding one                                | Placemarks only. Altitude and styles are ignored.                            |
| GPX                       | `.gpx`                                                       | Waypoints, routes and tracks each become a feature.                          |

Pass `--format csv|geojson|geojsonseq|geopackage|gpx|kml|shapefile` when the extension is misleading. A
zip with several Shapefiles, or a KMZ with several KML documents and no `doc.kml`, needs
`--zip-entry <path>` to choose one. Other formats inside a zip are not read. Other formats, such as
FlatGeobuf, are not supported.

CSV coordinate columns are found by name: `lon`, `lng`, `long`, `longitude`, `lat`, `latitude`, in
any case. Use `--lon-column` and `--lat-column` for anything else. Columns are typed as a whole, so a
value like `01234` keeps a whole column as text, and empty cells are omitted from the feature.

A GeoPackage with several feature tables needs `--input-layer <table>`, and the error lists them. The
source-layer name then defaults to that table unless you pass `--layer`. The integer primary key
becomes the feature ID, and attributes keep their SQLite types. BLOB and generated columns are skipped
with a warning. SQL views, curved geometries and the extended GeoPackage binary encoding are not read.
The file is only read, and edits still pending in a write-ahead log are included.

KML features get `name`, `description`, `address`, `phoneNumber`, `timestamp`, `begin`, `end`, and
`folder` for the nearest enclosing Folder, plus every `ExtendedData` value. Values stay text unless a
`Schema` declares a numeric or Boolean type, so `--rank-by` needs a declared numeric field. If an
`ExtendedData` value repeats one of those names, the last one is kept with a warning. A
`MultiGeometry` stays one feature when its parts share a type. Overlays and network links are ignored
with a warning, and remote content is never fetched.

GPX features get `name`, `desc`, `cmt`, `src`, `sym`, `type`, `time`, and the numeric `ele` and
`number`. Elevation and time on individual route and track points are ignored with a warning.

### Coordinate reference systems

The build never guesses a CRS and never reprojects without `--reproject`:

```sh
npx tileflow tileset build ./data/parcels.shp --reproject --json
npx tileflow tileset build ./data/sites.csv --lon-column x --lat-column y --source-crs EPSG:25830 --reproject --json
```

| Input                               | Treated as                                                  |
| ----------------------------------- | ----------------------------------------------------------- |
| GeoJSON without a `crs` member      | WGS84 longitude and latitude, as RFC 7946 requires          |
| GeoJSON with a WGS84 `crs` member   | WGS84                                                       |
| GeoJSON with another `crs` member   | Refused. Restate it with `--source-crs`, plus `--reproject` |
| CSV with standard or named columns  | WGS84. Any other coordinates fail the range check           |
| CSV with no recognizable columns    | Refused until you name the columns                          |
| Shapefile with a WGS84 `.prj`       | WGS84                                                       |
| Shapefile with another `.prj`       | Refused until you add `--reproject`                         |
| Shapefile without a `.prj`          | Refused until you pass `--source-crs`                       |
| GeoPackage layer in WGS84           | WGS84                                                       |
| GeoPackage layer in another CRS     | Refused until you add `--reproject`                         |
| GeoPackage layer with no usable CRS | Refused until you pass `--source-crs`                       |
| KML and GPX                         | WGS84, as both formats define                               |

A GeoPackage layer's CRS comes from `gpkg_spatial_ref_sys`. The reserved `srs_id` values -1 and 0 mean
undefined, so they count as no usable CRS. A row whose `srs_id` differs from its layer stops the build
with `TF_TILESET_BUILD_CRS_MIXED`, unless `--source-crs` states the CRS for every row.

`--source-crs` states what the coordinates are, and overrides anything the file declares. It accepts
`EPSG:4326`, `EPSG:3857`, `EPSG:4258`, `EPSG:4269`, UTM zones on WGS84 (`EPSG:326xx`, `EPSG:327xx`),
ETRS89 (`EPSG:258xx`) or NAD83 (`EPSG:269xx`), a proj string, WKT, or the path to a `.prj` file. Other
EPSG codes need one of the last three forms.

Conversion uses [proj4js](https://github.com/proj4js/proj4js), which applies 3- and 7-parameter datum
shifts but has no grid shifts:

- Datums within about 2 m of WGS84 (ETRS89, RGF93, NAD83, GDA94, GDA2020, NZGD2000, SIRGAS, JGD2000
  and JGD2011) are treated as coincident, with a warning.
- Datums with a known shift convert with that shift. Accuracy is a few metres at best.
- Any other datum, such as NAD27 or ED50 without parameters, fails with
  `TF_TILESET_BUILD_DATUM_UNSUPPORTED` rather than misplacing features by up to hundreds of metres.
  Pass a proj string with `+towgs84=` if you know the shift, or reproject first.

Every coordinate is range-checked after any conversion. The first coordinate more than 0.001° outside
longitude ±180 or latitude ±90 stops the build and names the feature, row or record; anything closer
is moved to the limit and counted in `warnings`. A prime meridian other than Greenwich counts as a
non-WGS84 CRS. This catches most, but not
all, wrong statements: a small projected extent can fall in range, and swapped axes are only caught
past latitude ±90.

To make those visible, whenever you state a CRS or the build converts one, `warnings` says where the
features ended up. Every build also warns if all features sit within 1° of longitude 0, latitude 0.
Human output always prints the bounds, and `--json` reports them as `archive.bounds`.

### Options

| Option                 | Meaning                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `-o, --output <path>`  | Archive path. Defaults to the input name with `.pmtiles`         |
| `--force`              | Replace an existing output                                       |
| `--layer <name>`       | Source-layer name. Defaults to the input file name               |
| `--minzoom <zoom>`     | Lowest zoom to write. Defaults to 0                              |
| `--maxzoom <zoom>`     | Highest zoom to write, up to 16. Chosen from the data by default |
| `--include <fields>`   | Keep only these comma-separated attributes, by source name       |
| `--exclude <fields>`   | Drop these comma-separated attributes, by source name            |
| `--rank-by <field>`    | Thin the lowest values of this numeric attribute first           |
| `--rank-ascending`     | With `--rank-by`, thin the highest values first                  |
| `--zip-entry <path>`   | The `.shp` or `.kml` to read from an archive holding several     |
| `--input-layer <name>` | The feature table to read from a GeoPackage holding several      |
| `--lon-column <name>`  | CSV longitude column                                             |
| `--lat-column <name>`  | CSV latitude column                                              |
| `--source-crs <crs>`   | State the input CRS                                              |
| `--reproject`          | Convert a stated non-WGS84 CRS to WGS84                          |
| `--name <name>`        | Archive display name                                             |
| `--description <text>` | Archive description                                              |
| `--attribution <text>` | Attribution stored in the archive                                |
| `--format <format>`    | Override format detection                                        |
| `--json`               | Print one schema-version-1 JSON document on stdout               |

### Zooms and thinning

The automatic maximum zoom is the lowest that resolves most vertices and keeps the densest tile
manageable, from zoom 10 for points and zoom 4 for lines and polygons, up to zoom 14. `--json` reports
it as `archive.maxzoom` with `archive.maxzoomSource`.

Rings with fewer than three distinct positions and lines with a single position are skipped and
counted in `warnings`. Every other feature reaches the maximum zoom. Below it, tiles stay within about 500 KiB compressed:

- Points that land on the same pixel keep only the first, so sparse areas stay complete while dense
  areas thin out. "First" is input order, or the best value with `--rank-by`. Polygons too small for
  a zoom render as a tiny mark and thin the same way.
- Lines and polygons are simplified to the tile resolution, and lines smaller than that drop out.
- A tile still over budget thins its densest cells further.

Thinning nests: a feature drawn at one zoom is drawn at every higher zoom, so features appear as you
zoom in and do not flicker. A tile can exceed the 500 KiB target to honour this. Only a tile that
would pass 6 MB drops features its parent drew.

`--rank-by` accepts any numeric attribute, whether or not it stays in the tiles. Features without a
number there thin first and are counted in `warnings`; a field with no numbers fails. Features are
written to tiles in rank order, which also gives the best ones first claim on label placement. Ranking
holds about 24 extra bytes per feature in memory.

`zooms[].thinnedFeatures` counts the features left out of tiles at each zoom. It is always zero at the
maximum zoom unless a geometry rounds away there. Zooming past the maximum reuses the last tiles.

A tile at the maximum zoom that would exceed 6 MB fails with `TF_TILESET_BUILD_TILE_TOO_LARGE`, because
keeping it would mean losing features silently. Raise `--maxzoom`, or remove attributes.

### Attributes

Strings, numbers and booleans map directly. Nested objects and arrays become JSON strings, and `null`
is omitted. Field names outside letters, digits, `.`, `_`, `:` and `-` are renamed, with accents
removed and other characters replaced by `_`; `layer.fields` maps each `sourceName` to its `name`, and
a warning lists the change. Two names that collide stop the build. A field with mixed types is
declared `Mixed`. Non-negative integer GeoJSON `id` values become vector tile feature IDs; other ids
are dropped with a warning.

### JSON output

```json
{
  "archive": {
    "addressedTiles": 341,
    "bounds": [-3.9, 40.2, -3.5, 40.6],
    "byteCount": 48211,
    "maxzoom": 10,
    "maxzoomSource": "auto",
    "minzoom": 0,
    "path": "data/stores.pmtiles",
    "tileContents": 341
  },
  "command": "tileset build",
  "crs": {"authority": "format", "label": "GeoJSON (WGS84 by RFC 7946)", "reprojected": false},
  "input": {
    "features": 1200,
    "format": "geojson",
    "geometryTypes": ["Point"],
    "skipped": {"emptyGeometry": 0, "outsideMercator": 0}
  },
  "layer": {
    "fields": [{"name": "name", "sourceName": "name", "type": "String"}],
    "id": "stores"
  },
  "schemaVersion": 1,
  "warnings": [],
  "zooms": [
    {"features": 900, "largestTileBytes": 9120, "thinnedFeatures": 300, "tiles": 1, "zoom": 0}
  ]
}
```

On failure the exit code is 1, stdout is empty, and stderr carries
`{"error": {"code", "message", "path"}, "ok": false, "schemaVersion": 1}`.

| Code                                        | Meaning                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| `TF_TILESET_BUILD_INPUT_MISSING`            | The input file does not exist                                  |
| `TF_TILESET_BUILD_INPUT_INVALID`            | Malformed data, XML, GeoPackage or zip                         |
| `TF_TILESET_BUILD_INPUT_UNSAFE`             | The XML has a DOCTYPE or entity declaration                    |
| `TF_TILESET_BUILD_INPUT_LIMIT`              | The input exceeds a safety limit listed below                  |
| `TF_TILESET_BUILD_FORMAT_UNSUPPORTED`       | Unknown extension, or geometry with no tile equivalent         |
| `TF_TILESET_BUILD_RUNTIME_UNSUPPORTED`      | GeoPackage input needs Node.js 22.13 or later                  |
| `TF_TILESET_BUILD_ZIP_ENTRY_INVALID`        | Archive has no data file, several, or not the one named        |
| `TF_TILESET_BUILD_INPUT_LAYER_INVALID`      | GeoPackage has no feature table, several, or not the one named |
| `TF_TILESET_BUILD_RANK_INVALID`             | `--rank-by` has no numeric values, or is missing               |
| `TF_TILESET_BUILD_EMPTY`                    | No usable features                                             |
| `TF_TILESET_BUILD_CRS_UNKNOWN`              | The input does not state its CRS                               |
| `TF_TILESET_BUILD_CRS_NOT_WGS84`            | Stated CRS needs `--reproject`                                 |
| `TF_TILESET_BUILD_CRS_MIXED`                | GeoPackage rows use a CRS other than their layer's             |
| `TF_TILESET_BUILD_CRS_UNREADABLE`           | `--source-crs` or the declared CRS could not be parsed         |
| `TF_TILESET_BUILD_CRS_UNSUPPORTED`          | Geographic CRS measured in something other than degrees        |
| `TF_TILESET_BUILD_DATUM_UNSUPPORTED`        | No known shift from the datum to WGS84                         |
| `TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE` | Coordinates are not WGS84 after any conversion                 |
| `TF_TILESET_BUILD_CSV_COLUMNS`              | Coordinate columns are missing or ambiguous                    |
| `TF_TILESET_BUILD_FIELD_CONFLICT`           | Two field names collide after renaming                         |
| `TF_TILESET_BUILD_FIELDS_INVALID`           | `--include` and `--exclude` were combined                      |
| `TF_TILESET_BUILD_TOO_MANY_FIELDS`          | More than 512 fields; use `--include`                          |
| `TF_TILESET_BUILD_LAYER_INVALID`            | The layer name is not valid                                    |
| `TF_TILESET_BUILD_ZOOM_INVALID`             | Zooms are out of range or reversed                             |
| `TF_TILESET_BUILD_OUTPUT_EXISTS`            | The output exists; pass `--force`                              |
| `TF_TILESET_BUILD_OUTPUT_INVALID`           | The output equals the input, or its folder is missing          |
| `TF_TILESET_BUILD_TILE_TOO_LARGE`           | A tile cannot fit without losing features                      |
| `TF_TILESET_BUILD_TOO_MANY_TILES`           | More than 16 million tile entries; lower `--maxzoom`           |
| `TF_TILESET_BUILD_ARCHIVE_TOO_LARGE`        | The archive exceeds the publishable 8 GB                       |
| `TF_TILESET_BUILD_DISK_FULL`                | Not enough free disk space                                     |

### Limits

Features are spooled to disk rather than held in memory; a 5 million point, 777 MB GeoJSON file peaked
under 600 MB. A single very large feature must fit in memory on its own. Temporary files sit beside the
output and are removed on exit, including Ctrl-C. Allow free space of about twice the input, or three times the uncompressed Shapefile for a zip. Tiling
runs on one thread, with compression on the thread pool, so plan for up to a minute per million simple
features.

KML and GPX are streamed. A document with a DOCTYPE or entity declaration is refused, because neither
format needs one and it is how entity-expansion attacks work. Only the five predefined XML entities
and numeric character references are decoded. One tag can hold 1 MiB and 256 attributes, elements can
nest 128 levels, and one text value can hold 8 MiB in KML or 1 MiB in GPX. One KML feature can hold
64 MiB of attribute text.

A KMZ is streamed without being extracted. Its KML document can expand to 4 GiB, an archive can hold
65,536 entries, and an entry that inflates past its declared size stops the build.

A GeoPackage is opened read-only and runs none of its own SQL. Tables must be plain tables, so views
and virtual tables are not read. On early Node.js 22 releases, reading a GeoPackage in
write-ahead-log mode can leave `-wal` and `-shm` files beside it. A GeoPackage with a rollback journal
left by an interrupted writer is refused until a tool that can write to it recovers it. One feature
can hold 5 million positions and parts in KML, GPX and GeoPackage.

The build does not merge adjacent polygons at low zooms, cluster points, or join attributes. Polygons
are simplified independently, so neighbours that share a border can show hairline gaps at low zooms.
Thinning does not carry counts for heatmaps. Features crossing the antimeridian must be
split first; a warning flags segments wider than 180°. Web Mercator stops at latitude ±85.05: polygons
and lines are cut there, and points past it are skipped.

For control beyond this, use any tool that writes PMTiles. `tileflow tileset publish` accepts its
output after the same validation.

## tileset publish

Account-backed authorization renews automatically. Hashing reuses a 16 MiB buffer, and up to four parts stream concurrently with reusable buffers.
Administratively disabled uploads return `TF_TILESET_UPLOAD_DISABLED` without retrying. Temporary
service failures retain bounded retries.

## Restore

Deployments are immutable. Restoring one publishes its content again as a new version of the Map, so
the deployment it replaces stays in the history and can be restored in turn:

```bash
npx tileflow deployments list --map-id map_AbCdEfGhIjKlMnOp
npx tileflow deployments restore 12 --map-id map_AbCdEfGhIjKlMnOp
```

Allowed websites are not part of a deployment and do not change. A restore is refused when the data
the version needs has since changed, and the refusal names the source. Your repository still holds
what you replaced, so the next `tileflow deploy` publishes that again unless you revert it.

A tileset keeps its current and previous versions. Restoring swaps them for every Map that uses the
tileset, with no deployment, and restoring again undoes it:

```bash
npx tileflow tileset restore stores --team @acme
```

The restore is refused while an upload to that tileset is in progress, and while a live Map needs
data the previous version lacks. Restore or republish that Map first. An upload that nothing is
still sending can be cleared; it may belong to a teammate or a CI run, so check first:

```bash
npx tileflow tileset upload abort stores --team @acme
```

These commands are written for agents as well as people. With `--json`, a success has a `nextSteps`
array and a failure has `error.code`, `error.message` and `error.nextSteps`. Each step has a
`description` and, when one exists, the exact `command` to run. A failure blocked by an upload also
has `error.upload`, so you can see its state and expiry before aborting it. If a tileset restore
ends with `TF_TILESET_DELIVERY_PENDING`, run the same command again: it finishes the saved restore
and never swaps twice, and reports `outcome: "repaired"`.

## Icon lock commands

The lock commands inspect the `iconSet()` references your config declares. They are the only
commands that resolve `latest`, and the only ones that write the lock. `install` fills in declared
references that have no pin, `update` moves selected references to their current latest revision,
and `pin` selects one exact revision. Every requested reference is resolved before a single
compare-and-swap write of the whole snapshot, so a concurrent writer fails the command instead of
losing its pins. No lock command rewrites `tileflow.config.ts`.
