# Mobile offline regions contract

The Swift and Kotlin SDKs plan offline regions in native code, independently of the renderer. This
document describes what exists today: region geometry and its tile cover, the Hosted pack client,
planning and estimates, and the per-device limit. Storing packs, downloading them in the background
and serving them to the map through the native transport are not implemented yet; the types below
are shaped so they can build on them. Source of truth: `platforms/ios/Sources/Tileflow/Offline/` and
`platforms/android/tileflow/src/main/java/dev/tileflow/sdk/offline/`.

## Public API

Following Mapbox's offline API, a region is an area plus load options (themes and zooms), and an
application estimates a region before downloading it. Only the area is public today; load
options, estimates, the pack client and the device limit stay internal until regions can be stored
and downloaded, so their shape can still change with the store.

| Swift                                                     | Kotlin                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `TileflowOfflineGeometry.boundingBox(_:)`                 | `TileflowOfflineGeometry.BoundingBox(box)`                         |
| `TileflowOfflineGeometry.polygon(_:)`                     | `TileflowOfflineGeometry.Polygon(ring)`                            |
| `TileflowOfflineGeometry.corridor(line:width:)`           | `TileflowOfflineGeometry.Corridor(line, width)`                    |
| `validate()`, `tileCount(zoom:)`, `tileCount(zoomRange:)` | `validate()`, `tileCount(zoom)`, `tileCount(zoomRange)`            |
| `TileflowOfflineError` (`code`, `context`, `retryAfter`)  | `TileflowOfflineException` (`code`, `context`, `retryAfterMillis`) |

Neither platform exposes renderer or WebView types.

## Regions and tile cover

- A **bounding box** may cross the antimeridian: as in GeoJSON, a west edge greater than the east
  edge does, and the region downloads as two packs.
- A **polygon** is one ring of 3 to 255 distinct positions, open or closed, without holes. A ring
  that crosses itself covers its even-odd interior.
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
  one day). Cancelling the calling task or coroutine cancels the request.
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
whether it is billable and whether it is public. Public resources, such as landmarks, mobile
discovery and the profile manifest, are fetched without the grant and count toward nothing.

An estimate reports the resource, billable and public counts, exact bytes, tiles per source and the
map views a download is billed: one per started 1,000 billable resources. Given the resources a
device already holds, it counts only the others, since an update revalidates stored resources
without billing them.

For a self-hosted style, the estimate counts the cover at each source's zooms, optionally stopping a
source before its deepest zoom. Bytes stay unknown, since a TileJSON does not list tile sizes, and
nothing is billed.

## Per-device limit

The API limits each pack to the plan's `maxPackResources`: 10,000 billable resources on Free and
50,000 on paid plans. The SDK keeps the same limit for the device's total. A download is accepted
unless it would leave the device holding more billable resources than the limit; it states what the
device holds, what the download adds that the device does not hold yet, and what it makes unneeded,
such as the previous version of the pack it updates. A download that does not grow the total is
accepted even above the limit, so a lower limit never stops updates. Access ending never deletes
or encrypts a downloaded pack; it only stops updates.
