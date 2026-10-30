import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertElevationProfile,
  elevationProfileAt,
  elevationProfileFromLine,
  elevationProfileFromResponse,
  type ElevationProfileSample,
  elevationProfileSeries,
  haversineMeters,
  nearestElevationSample,
  readGpx,
  sliceElevationProfile,
  summarizeElevationProfile,
} from '../src/index';

/** A profile along a meridian, one sample every ~111 m, with the given heights. */
function meridian(heights: (number | null)[]) {
  return elevationProfileFromLine({
    type: 'LineString',
    coordinates: heights.map((height, index) =>
      height === null ? [0, index * 0.001] : [0, index * 0.001, height],
    ),
  });
}

test('distances use great circles on the mean Earth radius', () => {
  assert.equal(Math.round(haversineMeters([0, 0], [0, 1])), 111_195);
  assert.equal(Math.round(haversineMeters([-3.70379, 40.41678], [2.1734, 41.38506])), 505_443);
});

test('summaries follow the Elevation API: climbs past the threshold, grades over 100 m', () => {
  const samples: ElevationProfileSample[] = [
    [0, 0, 100, 0],
    [0, 0, 101, 50],
    [0, 0, 110, 100],
    [0, 0, 111, 150],
    [0, 0, 105, 200],
    [0, 0, 104.5, 250],
    [0, 0, 120, 300],
  ];
  assert.deepEqual(
    summarizeElevationProfile({
      samples,
      lines: [[0, 6]],
      unit: 'meters',
      climbThreshold: 2,
      interval: 50,
    }),
    {
      distance: 300,
      ascent: 25,
      descent: 5,
      minElevation: 100,
      maxElevation: 120,
      startElevation: 100,
      endElevation: 120,
      maxGrade: 15,
      minGrade: -6.5,
    },
  );
});

test('summaries keep lines apart and skip samples without elevation', () => {
  const summary = summarizeElevationProfile({
    samples: [
      [0, 0, 10, 0],
      [0, 0, null, 30],
      [0, 0, 20, 60],
      [0, 0, 500, 60],
      [0, 0, 480, 90],
    ],
    lines: [
      [0, 2],
      [3, 4],
    ],
    unit: 'meters',
    climbThreshold: 0,
    interval: 30,
  });
  assert.equal(summary.ascent, 10);
  assert.equal(summary.descent, 20);
  assert.equal(summary.maxGrade, 16.7);
  assert.equal(summary.minGrade, -66.7);
});

test('a line with altitudes becomes a profile without any request', () => {
  const profile = meridian([100, 110, 130, 120]);
  assert.equal(profile.unit, 'meters');
  assert.equal(profile.interval, null);
  assert.equal(profile.attribution, null);
  assert.deepEqual(profile.lines, [[0, 3]]);
  assert.equal(Math.round(profile.samples[3]![3]), 334);
  assert.equal(profile.summary.ascent, 30);
  assert.equal(profile.summary.descent, 10);
  assert.equal(profile.summary.maxElevation, 130);
  // Positions without an altitude keep a null elevation.
  assert.equal(meridian([100, null, 120]).samples[1]![2], null);
  assert.throws(() => elevationProfileFromLine({type: 'LineString', coordinates: [[200, 0]]}));
});

test('a profile converts to feet and back', () => {
  const feet = convertElevationProfile(meridian([100, 110]), 'feet');
  assert.equal(feet.unit, 'feet');
  assert.equal(Math.round(feet.samples[1]![2]!), 361);
  assert.equal(Math.round(feet.summary.distance), 365);
  const meters = convertElevationProfile(feet, 'meters');
  assert.ok(Math.abs(meters.samples[1]![2]! - 110) < 1e-9);
});

test('a point of the profile is interpolated with its grade and ascent so far', () => {
  const profile = meridian([100, 110, 130, 120]);
  const point = elevationProfileAt(profile, profile.samples[1]![3] / 2)!;
  assert.equal(point.index, 0);
  assert.equal(point.line, 0);
  assert.equal(point.elevation, 105);
  assert.equal(point.position[0], 0);
  assert.ok(Math.abs(point.position[1] - 0.0005) < 1e-12);
  assert.equal(elevationProfileAt(profile, 1e9)!.distance, profile.samples[3]![3]);
  const {grades, ascent, descent} = elevationProfileSeries(profile);
  assert.deepEqual(ascent, [0, 10, 30, 30]);
  assert.deepEqual(descent, [0, 0, 0, 10]);
  // 105.5 m to 119 m over the 100 m centred on the second sample.
  assert.equal(Math.round(grades[1]! * 10) / 10, 13.5);
  assert.equal(elevationProfileSeries(profile), elevationProfileSeries(profile));
});

test('a stretch of the profile has interpolated ends and its own summary', () => {
  const profile = meridian([100, 110, 130, 120]);
  const stretch = sliceElevationProfile(
    profile,
    profile.samples[1]![3] / 2,
    profile.samples[2]![3],
  )!;
  assert.equal(stretch.samples[0]![3], 0);
  assert.equal(stretch.samples[0]![2], 105);
  assert.equal(stretch.samples.at(-1)![2], 130);
  assert.equal(stretch.summary.ascent, 25);
  assert.equal(sliceElevationProfile(profile, 10, 10), null);
});

test('the nearest sample to a position is found by scaled degrees', () => {
  const profile = meridian([100, 110, 130, 120]);
  assert.equal(nearestElevationSample(profile, [0.0001, 0.0021]), 2);
});

test('an Elevation API answer is a profile', () => {
  const profile = elevationProfileFromResponse({
    schemaVersion: 1,
    unit: 'meters',
    dataset: {releaseId: 'mapterhorn-0.0.11', zoom: 12},
    attribution: '© Mapterhorn (https://mapterhorn.com/attribution)',
    usage: {units: 1},
    interval: 30,
    samples: [
      [6.86, 45.83, 1500, 0],
      [6.8601, 45.8303, 1510, 30],
    ],
    lines: [[0, 1]],
    summary: {
      distance: 30,
      ascent: 10,
      descent: 0,
      minElevation: 1500,
      maxElevation: 1510,
      startElevation: 1500,
      endElevation: 1510,
      maxGrade: 33.3,
      minGrade: 33.3,
    },
  });
  assert.equal(profile.interval, 30);
  assert.equal(profile.climbThreshold, 2);
  assert.equal(profile.attribution, '© Mapterhorn (https://mapterhorn.com/attribution)');
});

test('GPX tracks and routes become lines, with elevations where points have them', () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.1" lon="6.4"><name>Not a line</name></wpt>
  <trk>
    <name>Col du Galibier &amp; back</name>
    <trkseg>
      <trkpt lat="45.1609" lon="6.4253"><ele>1519.7</ele><time>2026-07-01T08:00:00Z</time></trkpt>
      <trkpt lon='6.4176' lat='45.1286'><ele> 1900 </ele></trkpt>
      <!-- <trkpt lat="0" lon="0"/> -->
    </trkseg>
    <trkseg><trkpt lat="45.1" lon="6.4"/></trkseg>
  </trk>
  <rte><rtept lat="45.0640" lon="6.4078"/><rtept lat="45.0700" lon="6.4100"/></rte>
</gpx>`;
  assert.deepEqual(readGpx(gpx), {
    name: 'Col du Galibier & back',
    line: {
      type: 'MultiLineString',
      coordinates: [
        [
          [6.4253, 45.1609, 1519.7],
          [6.4176, 45.1286, 1900],
        ],
        [
          [6.4078, 45.064],
          [6.41, 45.07],
        ],
      ],
    },
  });
  assert.throws(() => readGpx('<kml></kml>'), /Not a GPX document/u);
  assert.throws(() => readGpx('<gpx><trk><trkseg></trkseg></trk></gpx>'), /no track or route/u);
  assert.throws(
    () =>
      readGpx(
        '<gpx><trk><trkseg><trkpt lat="95" lon="0"/><trkpt lat="0" lon="0"/></trkseg></trk></gpx>',
      ),
    /invalid point/u,
  );
});
