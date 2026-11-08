# CLI reference

Detailed contracts for the `tileflow` CLI. Start with the
[README](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/README.md) to install it.
For step-by-step guides, see the [Tileflow documentation](https://tileflow.dev/docs).

This reference ships with the package. Use the copy included in your installed release for
version-specific behavior; the GitHub `main` branch can contain unreleased changes.

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

| Format                    | Detected from                                                | Notes                                                                  |
| ------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| GeoJSON                   | `.geojson`, `.json`                                          | FeatureCollection, Feature or geometry. Streamed.                      |
| Newline-delimited GeoJSON | `.ndjson`, `.geojsonl`, `.geojsons`, `.geojsonseq`, `.jsonl` | One Feature or geometry per line; RFC 8142 separators are accepted.    |
| CSV                       | `.csv`, `.tsv`                                               | UTF-8 with a header row. Comma, semicolon, tab or pipe delimited.      |
| Shapefile                 | `.shp`, or `.zip` holding one                                | Reads `.dbf`, `.prj` and `.cpg` beside it. Z and M values are ignored. |

Pass `--format csv|geojson|geojsonseq|shapefile` when the extension is misleading. A zip with several
Shapefiles needs `--zip-entry <path>` to choose one. Other formats inside a zip are not read. Other formats, such as GeoPackage, KML or FlatGeobuf, are not supported.

CSV coordinate columns are found by name: `lon`, `lng`, `long`, `longitude`, `lat`, `latitude`, in
any case. Use `--lon-column` and `--lat-column` for anything else. Columns are typed as a whole, so a
value like `01234` keeps a whole column as text, and empty cells are omitted from the feature.

### Coordinate reference systems

The build never guesses a CRS and never reprojects without `--reproject`:

```sh
npx tileflow tileset build ./data/parcels.shp --reproject --json
npx tileflow tileset build ./data/sites.csv --lon-column x --lat-column y --source-crs EPSG:25830 --reproject --json
```

| Input                              | Treated as                                                  |
| ---------------------------------- | ----------------------------------------------------------- |
| GeoJSON without a `crs` member     | WGS84 longitude and latitude, as RFC 7946 requires          |
| GeoJSON with a WGS84 `crs` member  | WGS84                                                       |
| GeoJSON with another `crs` member  | Refused. Restate it with `--source-crs`, plus `--reproject` |
| CSV with standard or named columns | WGS84. Any other coordinates fail the range check           |
| CSV with no recognizable columns   | Refused until you name the columns                          |
| Shapefile with a WGS84 `.prj`      | WGS84                                                       |
| Shapefile with another `.prj`      | Refused until you add `--reproject`                         |
| Shapefile without a `.prj`         | Refused until you pass `--source-crs`                       |

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

Every coordinate is range-checked after any conversion. The first coordinate outside longitude
±180 or latitude ±90 stops the build and names the feature, row or record. This catches most, but not
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
| `--zip-entry <path>`   | The `.shp` to read from a zip holding several                    |
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

| Code                                        | Meaning                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `TF_TILESET_BUILD_INPUT_MISSING`            | The input file does not exist                          |
| `TF_TILESET_BUILD_INPUT_INVALID`            | Malformed data or zip; names the feature or row        |
| `TF_TILESET_BUILD_FORMAT_UNSUPPORTED`       | Unknown extension or MultiPatch Shapefile              |
| `TF_TILESET_BUILD_ZIP_ENTRY_INVALID`        | Zip has no `.shp`, several, or not the one named       |
| `TF_TILESET_BUILD_RANK_INVALID`             | `--rank-by` has no numeric values, or is missing       |
| `TF_TILESET_BUILD_EMPTY`                    | No usable features                                     |
| `TF_TILESET_BUILD_CRS_UNKNOWN`              | The input does not state its CRS                       |
| `TF_TILESET_BUILD_CRS_NOT_WGS84`            | Stated CRS needs `--reproject`                         |
| `TF_TILESET_BUILD_CRS_UNREADABLE`           | `--source-crs` or the declared CRS could not be parsed |
| `TF_TILESET_BUILD_DATUM_UNSUPPORTED`        | No known shift from the datum to WGS84                 |
| `TF_TILESET_BUILD_COORDINATES_OUT_OF_RANGE` | Coordinates are not WGS84 after any conversion         |
| `TF_TILESET_BUILD_CSV_COLUMNS`              | Coordinate columns are missing or ambiguous            |
| `TF_TILESET_BUILD_FIELD_CONFLICT`           | Two field names collide after renaming                 |
| `TF_TILESET_BUILD_FIELDS_INVALID`           | `--include` and `--exclude` were combined              |
| `TF_TILESET_BUILD_TOO_MANY_FIELDS`          | More than 512 fields; use `--include`                  |
| `TF_TILESET_BUILD_LAYER_INVALID`            | The layer name is not valid                            |
| `TF_TILESET_BUILD_ZOOM_INVALID`             | Zooms are out of range or reversed                     |
| `TF_TILESET_BUILD_OUTPUT_EXISTS`            | The output exists; pass `--force`                      |
| `TF_TILESET_BUILD_OUTPUT_INVALID`           | The output equals the input, or its folder is missing  |
| `TF_TILESET_BUILD_TILE_TOO_LARGE`           | A tile cannot fit without losing features              |
| `TF_TILESET_BUILD_TOO_MANY_TILES`           | More than 16 million tile entries; lower `--maxzoom`   |
| `TF_TILESET_BUILD_ARCHIVE_TOO_LARGE`        | The archive exceeds the publishable 8 GB               |
| `TF_TILESET_BUILD_DISK_FULL`                | Not enough free disk space                             |

### Limits

Features are spooled to disk rather than held in memory; a 5 million point, 777 MB GeoJSON file peaked
under 600 MB. A single very large feature must fit in memory on its own. Temporary files sit beside the
output and are removed on exit, including Ctrl-C. Allow free space of about twice the input, or three times the uncompressed Shapefile for a zip. Tiling
runs on one thread, with compression on the thread pool, so plan for up to a minute per million simple
features.

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
