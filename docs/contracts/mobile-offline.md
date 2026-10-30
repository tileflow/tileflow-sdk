# Mobile offline regions contract

The Swift and Kotlin SDKs download offline regions in native code, independently of the renderer.
This document describes region geometry and its tile cover, the Hosted pack client, planning and
estimates, the per-device limit, the store that downloads, verifies, keeps and updates regions, and
how maps use stored regions without a network. Source of truth: `platforms/ios/Sources/Tileflow/Offline/` and
`platforms/android/tileflow/src/main/java/dev/tileflow/sdk/offline/`.

## Public API

The API follows Mapbox's offline API: a region is an identifier, an area and load options; an
application estimates a region, loads it, lists and observes regions, and pauses, resumes, cancels
or removes them. Loading a stored region again updates it.

| Swift                                                                             | Kotlin                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `TileflowOfflineStore.shared`                                                     | `TileflowOfflineStore.get(context)`                                            |
| `estimateRegion(_:)`                                                              | `estimateRegion(options)`                                                      |
| `loadRegion(id:options:)`                                                         | `loadRegion(id, options)`                                                      |
| `allRegions()`, `region(id:)`                                                     | `allRegions()`, `region(id)`                                                   |
| `pauseRegion(id:)`, `resumeRegion(id:)`, `cancelRegion(id:)`, `removeRegion(id:)` | `pauseRegion(id)`, `resumeRegion(id)`, `cancelRegion(id)`, `removeRegion(id)`  |
| `subscribe(_:)` → `TileflowOfflineSubscription`                                   | `subscribe(handler)` → `TileflowOfflineSubscription`                           |
| `updateRegionMetadata(id:metadata:)`                                              | `updateRegionMetadata(id, metadata)`                                           |
| `handleEventsForBackgroundURLSession(identifier:completionHandler:)`              | (WorkManager; nothing to forward)                                              |
| `TileflowOfflineRegionLoadOptions`                                                | `TileflowOfflineRegionLoadOptions`                                             |
| `TileflowOfflineContent.hosted(mapID:themes:)`, `.manifest(url:map:sources:)`     | `TileflowOfflineContent.Hosted(mapId, themes)`, `.Manifest(url, map, sources)` |
| `TileflowOfflineSwitch.shared.isNetworkEnabled`                                   | `TileflowOfflineSwitch.isNetworkEnabled`                                       |
| `TileflowOfflineTileSource`                                                       | `TileflowOfflineTileSource`                                                    |
| `TileflowOfflineNetworkRestriction` (`none`, `disallowExpensive`)                 | `TileflowOfflineNetworkRestriction` (`NONE`, `DISALLOW_EXPENSIVE`)             |
| `TileflowOfflineRegion` (`DownloadState`, `UpdateState`)                          | `TileflowOfflineRegion` (`DownloadState`, `UpdateState`)                       |
| `TileflowOfflineRegionEvent` (`changed`, `removed`)                               | `TileflowOfflineRegionEvent` (`Changed`, `Removed`)                            |
| `TileflowOfflineRegionEstimate`                                                   | `TileflowOfflineRegionEstimate`                                                |
| `TileflowOfflineGeometry` (`boundingBox`, `polygon`, `corridor(line:width:)`)     | `TileflowOfflineGeometry` (`BoundingBox`, `Polygon`, `Corridor`)               |
| `TileflowOfflineError` (`code`, `context`, `retryAfter`)                          | `TileflowOfflineException` (`code`, `context`, `retryAfterMillis`)             |

Load options hold the geometry, the content, `minZoom` (0), `maxZoom` (15), `terrainMaxZoom` (12),
the network restriction and application metadata. A region reports its download state
(`downloading`, `waiting`, `paused`, `failed`, `complete`), whether a complete version is stored
(`isAvailable`), required and completed resources and bytes, the resources and bytes its download
loaded from the network (after Mapbox's loaded resource count: resources found stored already or
unchanged are completed without being loaded), its billable resources, the error and
retry time of a waiting or failed download, when the stored version completed, and what the last
update check found. Metadata changes in place, through `updateRegionMetadata` or by loading options
that differ only in metadata, without a new version or download. Neither platform exposes renderer
or WebView types. The pack client, the
manifest, the planner and the device limit stay internal.

## Regions and tile cover

- A **bounding box** may cross the antimeridian: as in GeoJSON, a west edge greater than the east
  edge does, and the region downloads as two packs.
- A **polygon** is one ring of 3 to 255 distinct positions, open or closed, without holes. A ring
  that crosses itself covers its even-odd interior, even when its signed areas cancel; a ring whose
  positions all lie on one line is refused as `emptyArea`.
- A **corridor** is the area within half of `width` metres of a line of 2 to 10,000 positions,
  with `width` from 1 to 100,000 metres. Consecutive positions more than 180° of longitude apart
  are refused as crossing the antimeridian.
- Latitudes beyond ±85.051129°, which Web Mercator cannot show, are clamped. Coordinates are
  rounded to six decimals, halves toward positive infinity, exactly as the Tileflow API rounds them.

A tile belongs to a region when the region's outline passes through it (closed tile bounds) or the
centre line of its row lies inside the ring (even-odd), with edges drawn as straight lines in Web
Mercator. This is the cover the Tileflow API plans and admits Hosted packs with; the SDK computes
the same tiles, and the contract tests compare its counts and row ranges with those the API's own
code produces. `tileCount` counts the distinct tiles of a region's packs at a zoom.

### Corridors

A Hosted pack covers one ring of at most 256 positions, while a buffered route is neither small nor
simple in general. The line is simplified by at most a tenth of the half width, then cut into
consecutive pieces; each piece becomes the convex hull of an octagon around each of its positions,
sized at the piece's highest latitude, plus one metre for rounding. The hull therefore contains every
point within the half width of the line. A piece grows while its hull covers at most twice the
corridor's own area, or while the extra area is at most 256 tiles of World's deepest zoom (15). More
area means more tiles; more pieces mean more packs, each of which rounds its billing up to a whole
map view. Both platforms produce the same rings, which a shared fixture pins.

## Zooms

A Hosted region downloads zooms 0 to 15 by default: zoom 15 is World's deepest zoom and has layers
no other zoom has. Deeper zooms, up to 22, overzoom World and Terrain and add only sources that go
deeper, such as Team Tilesets. Terrain stops at zoom 12 unless a region opts in to 13 or 14, which
hold most of a pack's bytes. Each source downloads the pack's zooms clamped to its own range; a
source whose minimum zoom is deeper than the pack's maximum is left out.

## Hosted packs

`POST <API origin>/v1/offline/packs` creates a pack and `POST <API origin>/v1/offline/packs/revalidate`
reports whether it can still be updated.

- Creation sends the map credential in `X-Tileflow-Mobile-Client`, exactly as a Hosted map's session
  start does, with a JSON body of at most 65,536 bytes: the Map ID, the renderer profile
  (`webview-v1`), one to four distinct theme names, the region, the zooms and Terrain's deepest
  zoom. Revalidation sends only `{"grant": …}` and no credential, so a configuration without a map
  credential can still revalidate packs.
- No request carries `Authorization`, cookies or an origin; the API origin follows the
  configuration's rule (HTTPS, or HTTP on a loopback host for local development).
- Requests are never retried. Each refusal is a typed error carrying the API's code as the context's
  `reason`, the HTTP status, the pack `limit` when one applies and the `Retry-After` wait (at most
  one day). Cancelling the calling task or coroutine cancels the request. A creation answer is
  read up to 8 MiB, the service's own bound; 50,000 resources measure about 1.4 MB.
- The pack grant is opaque: it is kept only to download the pack's own resources and to
  revalidate, and descriptions never include it.

| API status and code                                                                      | Swift / Kotlin code                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| 400 `OFFLINE_PACK_INVALID_INPUT`, `OFFLINE_PACK_AUTHORITY_CONFLICT`; 413                 | `rejected` / `REJECTED`                      |
| 401 `MOBILE_CREDENTIAL_INVALID`                                                          | `credentialRejected` / `CREDENTIAL_REJECTED` |
| 401 `OFFLINE_PACK_GRANT_INVALID`, `_EXPIRED`, `_STALE`                                   | `grantRejected` / `GRANT_REJECTED`           |
| 403 `MOBILE_MAP_MISMATCH`, `OFFLINE_PACK_RESOURCE_DENIED`                                | `accessDenied` / `ACCESS_DENIED`             |
| 403 `OFFLINE_PACKS_NOT_INCLUDED`                                                         | `notIncluded` / `NOT_INCLUDED`               |
| 403 `OFFLINE_DOWNLOADS_DISABLED`                                                         | `downloadsDisabled` / `DOWNLOADS_DISABLED`   |
| 404 `OFFLINE_PACK_MAP_NOT_FOUND`, `OFFLINE_PACK_THEME_NOT_FOUND`                         | `notFound` / `NOT_FOUND`                     |
| 409 `OFFLINE_PACK_SUPERSEDED`                                                            | `superseded` / `SUPERSEDED`                  |
| 422 `OFFLINE_PACK_TOO_LARGE` (with `limit`)                                              | `packTooLarge` / `PACK_TOO_LARGE`            |
| 422 `OFFLINE_PACK_NOT_DOWNLOADABLE`                                                      | `notDownloadable` / `NOT_DOWNLOADABLE`       |
| 429 `OFFLINE_DAILY_LIMIT_REACHED`                                                        | `dailyLimitReached` / `DAILY_LIMIT_REACHED`  |
| 429 `COMMERCIAL_MAP_LIMIT_REACHED`, `COMMERCIAL_SPENDING_LIMIT_REACHED`                  | `quotaExceeded` / `QUOTA_EXCEEDED`           |
| 429 `RATE_LIMITED`                                                                       | `rateLimited` / `RATE_LIMITED`               |
| 408, 5xx, 503 `OFFLINE_PACKS_DISABLED`, `_UNAVAILABLE`, `OFFLINE_PACK_GRANT_UNAVAILABLE` | `unavailable` / `UNAVAILABLE`                |
| No HTTP answer                                                                           | `network` / `NETWORK`                        |

A code is trusted only with its documented status; otherwise the status decides, and an unknown
401 is `credentialRejected` when creating a pack and `grantRejected` otherwise. `dailyLimitReached`,
`rateLimited`, `unavailable` and `network` are recoverable without the application changing
anything.

### Manifest checks

Answers ignore members the SDK does not read; document kinds, exclusion reasons and revalidation
reasons stay open strings. Everything the SDK reads is checked:

- the manifest describes exactly the requested pack (Map, profile, sorted themes, canonical region
  and zooms), and its download window is at most one day;
- every resource URL is HTTPS (or loopback HTTP for a local development API), unique, and carries
  no credential;
- a public resource is never billable; hashes are lowercase SHA-256 or null;
- every listed tile lies in the region's cover at its source's zooms, once per source;
- `totals` are the sums of what the manifest lists, and the billable total is within the plan's
  `maxPackResources`.

## Planning and estimates

From a created pack the planner lists every resource (documents, then each source's tiles with the
URL the renderer requests), with exact bytes, the hash when the API knows it before download,
whether it is billable and whether it is public. Public resources, such as landmarks, Team 3D
models at their stable `current.glb` address, mobile discovery and the profile manifest, are
fetched without the grant and count toward nothing. The discovery and profile routes refuse a
request that carries the grant.

An estimate reports the resource, billable and public counts, exact bytes, tiles per source and the
map views a download is billed: one per started 1,000 billable resources. Given the resources a
device already holds, it counts only the others, since an update revalidates stored resources
without billing them.

For a self-hosted style, the estimate counts the cover at each source's zooms, optionally stopping a
source before its deepest zoom. Bytes stay unknown, since a TileJSON does not list tile sizes, and
nothing is billed. The style's sprites and glyph ranges are added when the download reads the style.

A Hosted estimate creates the region's packs, which is free, and counts map views per pack for the
billable resources the device does not hold yet. Loading the same region while at least ten
minutes of the packs' download window remain reuses them instead of creating them again.

## Per-device limit

The API limits each pack to the plan's `maxPackResources`: 10,000 billable resources on Free and
50,000 on paid plans. The SDK keeps the same limit for the device's total. A download is accepted
unless it would leave the device holding more billable resources than the limit; it states what the
device holds, what the download adds that the device does not hold yet, and what it makes unneeded,
such as the previous version of the pack it updates. A download that does not grow the total is
accepted even above the limit, so a lower limit never stops updates. Access ending never deletes
or encrypts a downloaded pack; it only stops updates.

## Store

The store keeps one record per region under `<durable root>/dev.tileflow/offline-v1/` (iOS
Application Support, Android `noBackupFilesDir`), excluded from backups. Resource bodies live in the
resource cache's pinned partition under the transport's own keys: grant resources in the scope of
the pack's API origin and Map, public and self-hosted resources in the shared scope. A resource is
stored once per key and shared by every region version that lists it.

- A record names the version the region serves (`active`), the one downloading (`pending`) and a
  replaced version still being released (`retired`), or a removal in progress. Records are written
  through a temporary file and a rename; each version's created packs (or self-hosted plan) are
  written before the record that refers to them.
- A version's stored resources are appended to its progress log (`<digest> <bytes> <transferred>`
  per line, `transferred` 1 when the download received the body and 0 when it was stored already or
  unchanged,
  synced in batches of 64). A line cut short by a crash is ignored; its resource is requested again
  with `If-None-Match` and answered with a free `304`.
- A version becomes `active` only when every resource is stored and verified, by one record
  replacement. While an update downloads, a changed body of a resource the stored version uses waits
  in the version's staging directory and enters the pinned partition when the update completes, so
  the stored version never mixes in an unfinished update.
- Removing a region, cancelling an update or retiring a replaced version releases only the keys no
  other region version references. The step is recorded first and finished when the store opens
  again after a crash.
- The device's billable total is the number of distinct billable keys across every region's
  versions. Loading a version checks it against the plan's `maxPackResources` before anything
  downloads.

## Downloads

Each region's download is one loop: plan the missing resources, check free space, renew grants
whose window ends within five minutes, download a pass, and act on how the pass ended.

- Each resource is requested at its manifest URL with `X-Tileflow-Offline-Grant` when it needs the
  grant, without it when public, and with `If-None-Match` when a copy is stored. A stored document
  whose SHA-256 is the manifest's is not requested at all. No other header is added.
- A `200` body is stored only when it matches the manifest: its size and SHA-256 (the manifest's,
  else the `ETag`'s) agree either as delivered or, for a body the client decoded, as received on the
  wire. Android reads the raw bytes and checks both size and hash on the wire. iOS `URLSession`
  decodes gzip transparently and never exposes the encoded bytes, so for a decoded body iOS checks
  the wire size (`Content-Length`, which a completed transfer matches) and that the `ETag` names the
  manifest's hash, and relies on TLS for the bytes in between; gzip's own checksum rejects a
  corrupted body. World tiles, the gzip-encoded resources, have no manifest hash in any case. If
  the manifest also listed the decoded size and hash, iOS could check decoded bodies fully; that is
  a possible contract addition, not built. A mismatch is retried twice before the download fails.
- A grant refused as invalid, expired or stale, a superseded style or TileJSON, a resource the
  Map no longer delivers, or a resource refused as outside the pack creates that pack again, at
  most three times per download. Stored resources whose size and hash the new manifest repeats are
  kept.
- Recoverable refusals (`RATE_LIMITED`, the daily limit, unavailability) wait for the service's
  `Retry-After`; a missing network waits with backoff up to five minutes, or until the network
  returns. Other refusals stop the download as `failed` with their typed error; resuming tries
  again.
- Free space is checked before a pass (the remaining Hosted bytes plus a 64 MiB reserve) and after
  every 16 stored resources, as the system reports space it can make available, cached data
  included: iOS `volumeAvailableCapacityForImportantUsage`, which counts purgeable space, and
  Android `StorageManager.getAllocatableBytes`, which counts cached data the system may clear (the
  free space where it cannot answer). When that falls short, the store clears the ambient map
  cache, which maps rebuild as they need, and checks again. Still short, or a write that fails,
  stops the download as `failed` with `insufficientStorage`; what was stored stays.
- On iOS each resource is one background `URLSession` download task, at most 64 at a time, so
  transfers continue while the app is suspended or after the system terminated it. Applications
  forward `application(_:handleEventsForBackgroundURLSession:completionHandler:)` to the store. A
  transfer that finished while no process waited for it is delivered when the download asks for the
  same resource again, and a transfer still running is joined. `disallowExpensive` sets
  `allowsExpensiveNetworkAccess = false` on each request.
- On Android each region's download is unique WorkManager work, requiring a connected network, or
  an unmetered one for `DISALLOW_EXPENSIVE`. WorkManager runs it again after the process ends or the
  constraint returns; a wait longer than a minute ends the work and schedules it for when the wait
  ends.
- A download that was running when the process ended continues when the store is next used, and
  pausing, cancelling and removing stop its transfers.

## Updates

Stored Hosted regions are revalidated when the network returns, and at most once per the service's
interval (one day). A just-completed download counts as checked. `update_available` is reported as
`updateAvailable`; loading the region again creates its packs again and downloads with
`If-None-Match`, so only changed resources are downloaded and billed. `not_updatable` is reported
with the service's reason and stops further checks. Nothing is ever deleted or encrypted because
access ended. Self-hosted regions are not checked; loading them again revalidates every resource.

## Self-hosted regions

A self-hosted region is a map of a versioned manifest you serve, as `TileflowMapSource` names it,
and its tile sources, each a URL template with its own zooms. The download reads the manifest and
every theme style of the map, and stores them with the font files the manifest and styles name
(`tileflow:fontFaces`), the TileJSON and GeoJSON documents their sources name, their sprite sheets
(`.json` and `.png`, 1x and 2x) and every glyph range of the font stacks their symbol layers name
literally, or the renderer's default stack for text without `text-font`. Then it downloads the
cover at each tile source's zooms. Nothing is billed or counted toward the device limit. Sizes are
unknown until downloaded, so a region reports its bytes once complete. A `404` or `204` tile or
glyph range stays absent offline, as it is online. A download stores what it asked for even when
the server marks it `no-store`: downloading a region is the application's explicit request to keep
it.

## Serving stored regions

The transport answers a map's requests from stored regions without a session or grant. One rule,
`OfflineServingRule` on both platforms, decides when; it is the recommended default, pending the
owner's confirmation:

- **With a network**, a Hosted map starts its normal session, billed as any other. Stored pack
  entries only save downloads: each protected request carries its grant and the stored `ETag`, and
  a `304` answers with the stored body. If the session cannot be reached (`sessionUnavailable`), a
  stored region answers instead.
- **Without a network** (the system reports no usable path, iOS `NWPathMonitor`, Android the active
  network's capabilities), a Hosted map serves its protected resources from the packs of its
  stored regions and starts no session; nothing is billed. Public documents (discovery, profile
  manifest, landmarks, Team models) answer from the shared scope as stored copies do when the
  network fails. A protected resource no region holds goes the usual way and fails.
- **With the network switched off** (`TileflowOfflineSwitch`, Mapbox's offline switch), nothing
  reaches the network: every request is answered from stored entries alone, packs and the ambient
  cache, whatever their freshness. A resource neither holds answers at once with status 504, as an
  HTTP cache answers `only-if-cached`, and the map reports it as a `resourceFailed` warning; a
  missing style fails the map. Hosted maps start no session; downloads wait and continue when the
  network is switched on again.

Every store in the process publishes the regions it holds, and maps use the regions of all of them.
Only regions that are complete and available serve: a region still downloading, an update not yet
complete and a region being removed do not. The store publishes the cache paths and regional
credits of the available regions whenever they change; a map that needs them before the store has
opened waits for the store to read its records.

**Attribution.** A map opened from stored packs shows the attribution of the stored release: the
style and TileJSON documents are the release's own, so the renderer shows their attribution as it
does online. Each regional credit the pack's manifest lists (World's `regionalObligations`, with
the boxes that touch the pack) is passed to the renderer, which shows it, linked to its page, only
while one of its boxes intersects the view, and not when a source's attribution already contains
its text.

**When access ends.** A region whose revalidation answers `not_updatable` stops serving: maps no
longer use it and `isAvailable` is false, while its files stay on the device, neither deleted nor
encrypted. One internal switch, `servesRegionsAfterAccessEnds` (Kotlin
`SERVES_REGIONS_AFTER_ACCESS_ENDS`), keeps serving such regions instead; the default awaits the owner
and counsel.

**Backups.** A device is one app installation: nothing stored for offline use is backed up. iOS
excludes the pinned partition (`<Application Support>/dev.tileflow/resources-v1`) and the store's
records (`<Application Support>/dev.tileflow/offline-v1`) from backups; Android keeps both under
`noBackupFilesDir`, which Auto Backup and device transfers skip.

## Tests

- The mobile fixture server (`scripts/mobile-fixture-server.mjs`) also serves a minimal Hosted map,
  `map_offlinefixture01`: session start, discovery and the WebView profile manifest, one versioned
  style with its TileJSON and vector tiles, Hosted offline packs (creation, grant-authorized
  downloads with `ETag` and `304`, revalidation) and counters at `/__fixture/hosted`
  (`scripts/mobile-fixture-hosted.mjs`). A Hosted map on a loopback HTTP API origin loads its
  discovery document over loopback HTTP, as Core accepts it for local development APIs.
- Airplane mode is tested with real rendering on Mac Catalyst (`MapIntegrationTests`) and on an
  Android emulator (`MapOfflineIntegrationTest`): a self-hosted region and a Hosted pack are
  downloaded from the fixture server, then shown with the network switched off, with nothing
  reaching the network and no session; online, the Hosted map starts its session and its stored
  resources revalidate as `304`. Both need the fixture server; Android also needs
  `adb reverse tcp:18645 tcp:18645`.
