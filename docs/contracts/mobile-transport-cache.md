# Mobile transport and resource cache contract

The Swift and Kotlin SDKs load every map resource through their native transport: the WebView
never fetches a remote URL itself, and there is no local HTTP server. This document describes the
transport's disk cache, which both platforms implement identically. Source of truth:
`platforms/ios/Sources/Tileflow/Transport/` and
`platforms/android/tileflow/src/main/java/dev/tileflow/sdk/transport/`.

## What is stored

- Only `GET` responses with status 200 to requests without `Range` are stored. `HEAD`, range
  requests (PMTiles archives), redirects and failures always go to the network.
- A response whose `Cache-Control` contains `no-store` is never written to disk. Hosted protected
  responses are served with `private, no-store`, so today only public resources are stored.
- `Vary: *` responses are not stored.
- A public response without a lifetime or validator is stored with no freshness: it is refetched
  on every use but can answer when the network fails.
- A protected response, should the platform allow storing one, needs an explicit lifetime
  (`max-age`, `Expires`) or a validator, never gets a heuristic lifetime, is never served stale and
  is read only after the map's Hosted session has admitted the request again.
- Stored headers: `Content-Type`, `ETag`, `Last-Modified`, `Cache-Control`, `Expires`, `Date`,
  `Age` and the `Tileflow-Fair-Use`, `Tileflow-Fair-Use-Notice` and `Tileflow-Protection` headers.
  Grants, credentials, cookies and request headers are never stored. The WebView always receives
  `Cache-Control: no-store`, so the native cache is the only one.

## Freshness and revalidation

Freshness follows RFC 9111 for a private cache: `max-age`, then `Expires` minus `Date`, then, for
public responses with only `Last-Modified`, 10% of its age capped at 24 hours. `Age` is subtracted
and `no-cache` means zero lifetime. A fresh entry is served without the network. A stale entry is
revalidated with `If-None-Match` and `If-Modified-Since`; a `304` refreshes the stored headers. A
network failure (not an HTTP error status) may be answered by a stale public entry for up to
`stale-if-error` seconds, or 30 days when absent, unless the response said `no-cache` or
`must-revalidate`.

## Keys, partitions and layout

A key is the absolute URL plus its scope; its file name is the lowercase hexadecimal SHA-256 of the
URL. Scopes:

| Scope  | Directory     | Reused by                                                                                                           |
| ------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| shared | `shared/`     | Every map and mount in the process (public resources).                                                              |
| grant  | `grant-<id>/` | Maps of one API origin and Map ID; `<id>` is the first 32 hexadecimal characters of SHA-256 of `<origin>\n<mapId>`. |

Each scope is partitioned by resource class, derived from the URL alone so a lookup always finds
what a store placed: `style` (manifests, style JSON, TileJSON), `tiles` (paths ending in
`z/x/y`), `glyphs` (glyph ranges, font files), `sprites`, `models` (glTF, GLB, textures under
`/models/` or `/team-models/`) and `other`.

```
<ambient root>/shared/<class>/<aa>/<sha256(url)>
<ambient root>/grant-<id>/<class>/<aa>/<sha256(url)>
<ambient root>/staging/<store>/<uuid>
<durable root>/pinned/<same relative paths as above>
<durable root>/pinned/staging/<store>/<uuid>
```

`<aa>` is the first two characters of the digest. Ambient root: iOS
`<Caches>/dev.tileflow/resources-v1`, Android `<cacheDir>/dev.tileflow/resources-v1`. Durable root:
iOS `<Application Support>/dev.tileflow/resources-v1` (excluded from backups), Android
`<noBackupFilesDir>/dev.tileflow/resources-v1`.

## Entry format

```
body ‖ metadata JSON ‖ metadata length (UInt32 BE) ‖ format version (UInt32 BE, 1) ‖ "TFC1"
```

Metadata fields: `url`, `status`, `headers`, `responseTime`, `expires`, `staleLimit` (integer
milliseconds since 1970), `bodyLength` and `bodySHA256`. Writers stream the body into their own
`staging/<store>/` directory and rename the finished file into place, so readers see a whole entry
or none. Every read checks the trailer, lengths, URL and body digest; a mismatch deletes the entry
and counts it as dropped. Opening a store removes other stores' staging directories.

## Retention and eviction

- **Ambient** entries share one byte budget across all scopes and classes. The default comes from
  the device profile (64 MiB on low-memory devices, 256 MiB, or 512 MiB with 6 GB of memory or
  more); applications set `TileflowMapCache.maximumBytes`. Writing past the budget evicts the least
  recently used entries until the total is at most 90% of it. Last use is the file modification
  time, refreshed on every read, so the order survives restarts. One entry may use at most an
  eighth of the budget (16 MiB maximum). `TileflowMapCache.clear()` removes all ambient entries and
  discards writes in flight.
- **Pinned** entries use the same keys and format under the durable root. They are consulted
  before ambient entries, are never evicted, never count against the budget and are never removed
  by `clear()`. Their owner, for example a store of downloaded regions, tracks which keys it holds
  and removes them explicitly. A pinned entry is served while fresh, revalidated when stale and
  served stale when the network fails; its owner is responsible for retiring expired content.

## Public API

| Swift                            | Kotlin                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| `TileflowMapCache.maximumBytes`  | `TileflowMapCache.get(context).maximumBytes`                            |
| `await TileflowMapCache.usage()` | `TileflowMapCache.get(context).usage()`                                 |
| `await TileflowMapCache.clear()` | `TileflowMapCache.get(context).clear()`                                 |
| `TileflowDeviceProfile.current`  | `TileflowDeviceProfile.current(context)` / `override(context, profile)` |
