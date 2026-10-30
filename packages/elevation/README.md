# @tileflow/elevation

Point heights, evenly sampled elevation profiles with their climbs and grades, GPX tracks, and an
elevation profile control for MapLibre GL JS maps. Heights come from the same Terrain release that
Tileflow maps draw as hillshade and 3D terrain, so a profile matches the relief on the map. The
client uses `fetch`; the control imports no MapLibre code and reads no browser global when imported.

> Related packages and guides: [documentation index](https://raw.githubusercontent.com/tileflow/tileflow-sdk/main/llms.txt).

## Install

```sh
npm install @tileflow/elevation@alpha
```

Use Node.js 22, a browser or another runtime with `fetch`. The control needs MapLibre GL JS 6
in the application that shows the map.

Live requests require Tileflow Elevation to be enabled for your Team and a credential with the
Elevation permission. Installing this package does not enable the service or grant access. In a
website or app, use a publishable credential restricted to your origins or apps.

## Read the height of points

<!-- docs:check -->

```ts
import {elevation, elevationBatch} from '@tileflow/elevation';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const [, , montBlanc] = await elevation([6.86514, 45.83264], {apiKey});
console.log(montBlanc); // about 4805 (metres)

const batch = await elevationBatch(
  [
    [-3.70379, 40.41678],
    [35.5, 31.5],
  ],
  {apiKey, unit: 'feet'},
);
console.log(batch.positions, batch.units, batch.attribution);
```

- `elevation(position)` answers `[longitude, latitude, elevation]`.
- `elevationBatch(positions)` answers any number of positions in order. It sends 100 positions per
  request, up to four requests at a time, and adds up their API units.
- `elevationPoints({positions, unit})` is the single request behind them, for 1 to 100 positions,
  with the full answer: `dataset` (the Terrain release and zoom read), `attribution` and `usage`.

`unit` is `meters` (default) or `feet`. A position beyond Web Mercator's latitude limit (±85.0511°)
has a `null` elevation. The open sea is 0.

## Profile a line

<!-- docs:check -->

```ts
import {elevationProfile} from '@tileflow/elevation';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const profile = await elevationProfile(
  {
    line: {
      type: 'LineString',
      coordinates: [
        [6.4253, 45.1609],
        [6.4078, 45.064],
      ],
    },
    interval: 30,
  },
  {apiKey},
);

const {distance, ascent, descent, maxElevation, maxGrade} = profile.summary;
console.log(distance, ascent, descent, maxElevation, maxGrade, profile.usage.units);
for (const [longitude, latitude, height, along] of profile.samples)
  console.log(longitude, latitude, height, along);
```

**Request:** exactly one of

- `line`: a GeoJSON `LineString` or `MultiLineString` geometry, up to 100 lines and 20,000 positions;
  a third coordinate is ignored;
- `polyline`: `{encoded, precision}`, a Google encoded polyline with precision 5 or 6 (default 6),
  as routing engines return it;

and optionally

- `interval`: the sample spacing, 1 m to 1,000 km (default 30 m);
- `maxSamples`: 2 to 1,000 (default 500). A line that would need more samples is sampled at a wider
  interval, which `interval` in the answer reports;
- `climbThreshold`: climbs and drops smaller than this are not counted (default 2 m);
- `unit`: `meters` or `feet`, for every length in the request and the answer.

**Answer:**

- `samples`: `[longitude, latitude, elevation, distance]`, at the start of each line, every
  interval and at its end. Lines are measured and sampled as the map draws them, straight in Web
  Mercator, and their distances continue from one line to the next without the gap between them;
- `lines`: the first and last sample index of each line;
- `summary`: `distance`, `ascent`, `descent`, `minElevation`, `maxElevation`, `startElevation`,
  `endElevation`, and `maxGrade` and `minGrade`, the steepest uphill and downhill grades in percent
  over a run of at least 100 m. Climbs and grades never cross from one line to the next;
- `interval`, `dataset`, `attribution` and `usage`.

## Add heights to GeoJSON lines

<!-- docs:check -->

```ts
import {elevateLineString} from '@tileflow/elevation';

const apiKey = process.env.TILEFLOW_API_KEY;
if (!apiKey) throw new Error('Set TILEFLOW_API_KEY on the server.');

const line = await elevateLineString(
  {
    type: 'LineString',
    coordinates: [
      [6.4253, 45.1609],
      [6.4176, 45.1286],
    ],
  },
  {apiKey},
);
console.log(line.coordinates); // [[6.4253, 45.1609, 1519.7], [6.4176, 45.1286, ...]]
```

`elevateLineString` and `elevateMultiLineString` return copies whose positions carry their height
as a third coordinate, reading every position of the line (one API unit per 100 positions). Use a
profile instead when you need evenly spaced heights: a straight segment over a pass has only two
positions, but a profile samples the whole climb.

## Show a profile on a map

<!-- docs:check -->

```ts
import {Map} from 'maplibre-gl';
import {createTileflowElevationProfile} from '@tileflow/elevation/maplibre';

const map = new Map({container: 'map', style: 'https://example.com/style.json'});
const profile = createTileflowElevationProfile({
  apiKey: 'tf_public_your_publishable_key',
  onSelect: (selection) => console.log(selection?.profile.summary),
});
map.addControl(profile, 'bottom-left');

map.on('load', () => {
  void profile.setData({
    type: 'LineString',
    coordinates: [
      [6.4296, 45.1655],
      [6.4078, 45.0641],
    ],
  });
});
```

The control:

- draws the profile with the summary (distance, ascent, descent, highest point), elevation and
  distance axes, and bands coloured by the mean grade of each stretch of at least 200 m;
- follows the pointer: on the chart it shows distance, elevation, grade and ascent so far and moves
  a point along the line on the map; on the map, pointing near the line moves the chart;
- measures a stretch the reader drags across the chart, highlights it on the map and reports it to
  `onSelect`; `select(from, to)` and `clearSelection()` do the same from code;
- is a keyboard slider: arrow keys move along the profile (Shift for larger steps), Home and End
  jump to its ends, Escape clears the selection and Enter reports the point to `onClick`;
- follows the reader's light or dark setting (`colorScheme`), and `setUnit('imperial')` shows feet
  and miles.

`setData` accepts a GeoJSON `LineString`, `MultiLineString`, `Feature` or `FeatureCollection`
(its lines are joined), GPX text, an Elevation API profile answer, or a profile from the functions
below. A line whose every position already has a height is profiled locally, without any request;
otherwise the control requests a profile with `interval`, `maxSamples` (default 500, so at most five
API units) and `climbThreshold`.

Options:

- `container`: draw the control in your own element, for example below the map, instead of a map
  corner; `height` (default 160 pixels) and `width` (default `360px` in a corner);
- `showLine` (default `true`): draw the line on the map. The hover point and the selection are
  always drawn, in the source and layers prefixed by `idPrefix` (default `tileflow-elevation-profile`),
  which the control adds again after a style change and removes with `map.removeControl`;
- `fitBounds`: fit the map to each new line; `lineColor`; `colorByGrade` (default `true`); `locale`
  for numbers;
- `onHover`, `onClick`, `onSelect`, `onData` and `onError`.

Style it with these custom properties on the control or an ancestor: `--tileflow-elevation-surface`,
`-text`, `-muted`, `-grid`, `-line`, `-fill`, `-accent`, `-selection` and `--tileflow-elevation-font`.
Its root has the class `tileflow-elevation-profile` and the attribute `data-tileflow-elevation-profile`.

## Profile a GPX track without requests

<!-- docs:check -->

```ts
import {elevationProfileFromLine, readGpx} from '@tileflow/elevation/profile';

const gpx = `<gpx version="1.1"><trk><trkseg>
  <trkpt lat="45.0000" lon="6.0000"><ele>1000</ele></trkpt>
  <trkpt lat="45.0010" lon="6.0000"><ele>1020</ele></trkpt>
</trkseg></trk></gpx>`;

const track = readGpx(gpx);
const profile = elevationProfileFromLine(track.line);
console.log(track.name, profile.summary.ascent, profile.summary.distance);
```

`@tileflow/elevation/profile` has the profile functions, the GPX reader and the limits without the
client or its validation library, about 2 KB compressed. `readGpx` reads GPX 1.0 and 1.1 tracks and
routes without a DOM, one line per track segment and per
route, with each point's `<ele>` in metres. `elevationProfileFromLine` measures a line whose positions
may carry heights and summarizes it with the same rules as the API.

More functions work on any profile, local or from the API:

- `elevationProfileAt(profile, distance)`: the interpolated position, elevation, grade and ascent so
  far at a distance;
- `sliceElevationProfile(profile, from, to)`: a stretch with its own summary;
- `elevationProfileSeries(profile)`: the grade and the cumulative ascent and descent at every sample;
- `elevationProfileGrades(profile, run)`: grades over any centred run;
- `convertElevationProfile(profile, 'feet')`, `summarizeElevationProfile(...)`,
  `nearestElevationSample(profile, position)` and `elevationProfileFromResponse(answer)`.

## Usage, limits and errors

Each answer consumes one API unit for every started block of 100 points or samples it returns:
one point or a batch of 100 is 1 unit, a profile of 500 samples is 5. `elevationApiUnits(n)` gives
the units of `n` elevations. A request body is at most 1 MiB.

Failures throw `ElevationError` with `status`, `code` (`ELEVATION_INVALID_REQUEST`,
`ELEVATION_REQUEST_TOO_LARGE`, `ELEVATION_ACCESS_DENIED`, `ELEVATION_ORIGIN_NOT_ALLOWED`,
`ELEVATION_RATE_LIMITED`, `ELEVATION_QUOTA_EXCEEDED`, `ELEVATION_CANCELLED`, `ELEVATION_UNAVAILABLE`
or `ELEVATION_TIMEOUT`), `requestId` and `retryAfterSeconds`. A code is trusted only with the HTTP
status the contract gives it. The client never retries; an aborted `signal` rejects with its reason.
Invalid requests throw before any request is sent.

## Data, accuracy and attribution

Heights are interpolated bilinearly between the four nearest pixels of the Terrain release's tiles,
at its deepest zoom for points, and for profiles at the deepest zoom that keeps the line within a
bounded number of tiles (`dataset.zoom`). Their resolution and vertical accuracy are those of the
release's sources, so they vary by region; surface models include buildings and trees. Show the
answer's `attribution` with the data, as the map shows its own credits.
