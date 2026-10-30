# Mobile transport and resource cache contract

The Swift and Kotlin SDKs load every map resource through their native transport: the WebView
never fetches a remote URL itself, and there is no local HTTP server. This document describes the
transport, its disk cache and how the embedded runtime starts, which both platforms implement
identically. Source of truth: `platforms/ios/Sources/Tileflow/Transport/` and
`platforms/android/tileflow/src/main/java/dev/tileflow/sdk/transport/`.

## Transport

- One HTTP client per process serves every map, in two lanes that share no connections: map
  resources, with at most 16 requests in flight in the process (first come, first served), and
  session requests, which never wait behind resources. Neither lane follows redirects or stores
  cookies, credentials or responses.
- A successful `GET` body streams to the WebView as it downloads, and is written to the cache at the
  same time when it may be stored. The byte limit (16 MiB per resource) is enforced while streaming.
  Other responses, which Hosted maps may need to react to, are read whole first.
- Stopping a WebView request (WKURLSchemeTask stop, or the WebView closing an intercepted stream)
  cancels the download and frees its slot. Replacing or destroying a renderer cancels only that
  renderer's requests.
- Timeouts: 30 s without progress (or less, when a Hosted grant is about to expire), 120 s for a
  whole resource, and 30 s for a whole session request.

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
  served stale when the network fails; its owner is responsible for retiring expired content. A
  pinned body may hold up to 32 MiB. Downloaded Hosted regions keep their packs beside the cache
  and their public files as pinned entries; a Hosted map without a network is answered from them
  without a session.

## Runtime start-up

The embedded runtime's receipt is read once per process. Its files' SHA-256 digests are verified
once per process on a background thread; the first map creates its WebView meanwhile and loads the
runtime when verification succeeds, or fails with `incompatibleRuntime`. The runtime build reads
Core's `native` entry from source and uses the WebView's standards-conforming `URL` parser instead
of Core's bundled one; `packages/mobile-runtime/size-budget.json` bounds `runtime.js` in CI.

`TileflowMapView.prewarm()` (Kotlin: `prewarm(context)`, on the main thread) starts that
verification, reads the device profile, opens the HTTP client and the cache index, and starts the
WebView's helper processes (Kotlin: loads the WebView provider), so the first map does not pay for
them. Calling it again is cheap.

## Device profiles

`TileflowDeviceProfile` describes the device's memory, low-memory status (Android
`isLowRamDevice`) and a coarse GPU class (iOS: Apple GPU family; Android: media performance class
and memory). It sets the default rendering quality, which caps the pixel ratio at 1.5, 2 or 3, and
the cache budget. Applications replace it before creating maps; `TileflowMapOptions.quality` set
explicitly wins for its map, and nil (the default) follows the profile.

## Extending the store

Code that keeps resources beyond the ambient cache, such as downloaded regions, builds on these
internal types: `ResourceCacheKey(url:scope:)` for the exact key the transport looks up,
`TileflowResourceClass.classify` for the partition, `ResourceCacheStore.writer(for:retention:)` with
`.pinned` to stream an entry in, `ResourceCacheMetadata` for its headers and freshness, and
`removePinned` to retire entries. The process-wide switch `TileflowHTTPClient.isNetworkEnabled`
(Kotlin `TileflowHttpClient.networkEnabled`), public as `TileflowOfflineSwitch`, keeps every request
off the network: only stored entries answer, and a miss answers 504. Range requests are not cached
today.

## Public API

| Swift                            | Kotlin                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| `TileflowMapCache.maximumBytes`  | `TileflowMapCache.get(context).maximumBytes`                            |
| `await TileflowMapCache.usage()` | `TileflowMapCache.get(context).usage()`                                 |
| `await TileflowMapCache.clear()` | `TileflowMapCache.get(context).clear()`                                 |
| `TileflowDeviceProfile.current`  | `TileflowDeviceProfile.current(context)` / `override(context, profile)` |
| `TileflowMapView.prewarm()`      | `TileflowMapView.prewarm(context)`                                      |
