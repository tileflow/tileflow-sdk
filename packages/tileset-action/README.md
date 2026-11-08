# Tileflow tileset action

Builds a PMTiles tileset from GeoJSON, CSV, Shapefile, GeoPackage, KML or GPX data and publishes it
to Tileflow from a GitHub workflow. Use it to refresh a tileset on a schedule, or whenever its data changes.

## Set it up

1. Create a Team data API key and store it as a repository secret named `TILEFLOW_API_KEY`.
2. Copy this workflow to `.github/workflows/tileflow-tileset.yml`.
3. Replace `COMMIT_SHA` with a full commit of this action, and `CLI_VERSION` with the exact version
   of a `tileflow` release that includes `tileset build`.

```yaml
name: Publish stores tileset

on:
  push:
    branches: [main]
    paths: [data/stores.geojson]
  schedule:
    - cron: '0 5 * * 1'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: tileflow-tileset-stores

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - id: tileset
        uses: tileflow/tileflow-sdk/packages/tileset-action@COMMIT_SHA
        with:
          source: data/stores.geojson
          tileset-id: stores
          api-key: ${{ secrets.TILEFLOW_API_KEY }}
          tileflow-version: CLI_VERSION
          attribution: Store data © Example
          rank-by: revenue
          include: name,revenue
      - run: echo "Published version $VERSION ($PUBLICATION)"
        env:
          VERSION: ${{ steps.tileset.outputs.version }}
          PUBLICATION: ${{ steps.tileset.outputs.publication }}
```

Republishing unchanged data reports `unchanged` and creates no new version.

## Choose a source

`source` is a path relative to `working-directory`, an absolute path, or an `https://` URL.

A URL must return one file. Provide a Shapefile as a `.zip`. The file name in the URL sets the format
and the default layer name, so set `format` and `layer` when the URL has no useful name. If the URL
holds a token, such as a presigned link, pass it from a secret. The action logs URLs without their
query strings, but GitHub prints step inputs unless they are secrets.

The action doesn't handle cloud storage credentials. To read from S3, download the file in an earlier
step and pass its path:

```yaml
- uses: aws-actions/configure-aws-credentials@COMMIT_SHA
  with:
    role-to-assume: arn:aws:iam::123456789012:role/read-map-data
    aws-region: eu-west-1
- run: aws s3 cp s3://example-bucket/parcels.zip "$RUNNER_TEMP/parcels.zip"
- uses: tileflow/tileflow-sdk/packages/tileset-action@COMMIT_SHA
  with:
    source: ${{ runner.temp }}/parcels.zip
    tileset-id: parcels
    api-key: ${{ secrets.TILEFLOW_API_KEY }}
    tileflow-version: CLI_VERSION
    source-crs: EPSG:25830
    reproject: true
```

## Build without publishing

Set `publish: false` to build the archive and upload it as a workflow artifact, kept for 14 days. The
action then needs no key or tileset ID, so it can check data changes in a pull request:

```yaml
- uses: tileflow/tileflow-sdk/packages/tileset-action@COMMIT_SHA
  with:
    source: data/stores.geojson
    publish: false
    tileflow-version: CLI_VERSION
```

## Inputs and outputs

| Input                                                                                           | Meaning                                                                   |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `source`                                                                                        | Required. Local path or `https://` URL                                    |
| `tileset-id`, `api-key`                                                                         | Required to publish                                                       |
| `publish`                                                                                       | `true` by default. `false` uploads an artifact instead                    |
| `tileflow-version`                                                                              | Exact CLI version. When empty, uses the `tileflow` package in the project |
| `source-crs`, `reproject`, `maxzoom`, `rank-by`, `include`, `layer`, `input-layer`, `zip-entry` | Same as the matching `tileflow tileset build` options                     |
| `format`, `lon-column`, `lat-column`                                                            | For files that the build can't identify on its own                        |
| `name`, `attribution`                                                                           | Tileset display name and data attribution                                 |
| `team`                                                                                          | Shown in the run notice only. The API key selects the Team                |

[`action.yml`](./action.yml) lists every input.

| Output        | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| `path`        | Absolute path of the PMTiles archive                      |
| `id`          | Published tileset ID. Empty when `publish` is `false`     |
| `version`     | Published version number. Empty when `publish` is `false` |
| `publication` | `changed` or `unchanged`. Empty when `publish` is `false` |

## Security

- Only the publish step receives the key, through its environment. The CLI install, the download and
  the build never see it.
- `tileflow-version` must be an exact version, so a new release can't run in a job that holds your
  key.
- Publishing fails on `pull_request` and `pull_request_target`, so unreviewed data can't replace a
  live tileset.
- Downloads use `https://` only, including every redirect.

## Next steps

Read the [`tileset build` reference](https://github.com/tileflow/tileflow-sdk/blob/main/packages/cli/REFERENCE.md)
for formats, CRS rules and limits, and the [documentation](https://tileflow.dev/docs).
