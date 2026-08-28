import assert from 'node:assert/strict';
import test from 'node:test';
import type {TileflowVisualReviewDocument} from '@tileflow/capture';
import {
  renderTileflowVisualCompareReport,
  tileflowVisualCompareReportLimits,
  type TileflowVisualCompareReportRow,
} from '../src/visual-compare-report';

test('visual compare report is deterministic, offline, escaped, and sorted by zoom', () => {
  const rows = [row(12, '</script><img src=x>'), row(4, 'right')];
  const report = renderTileflowVisualCompareReport({
    generatedBy: 'Tileflow CLI',
    rows,
    title: 'A < B & "safe"',
  });
  const repeated = renderTileflowVisualCompareReport({
    generatedBy: 'Tileflow CLI',
    rows,
    title: 'A < B & "safe"',
  });

  assert.equal(repeated, report);
  assert.ok(report.endsWith('\n'));
  assert.match(report, /data:image\/png;base64,/u);
  assert.doesNotMatch(report, /https?:\/\//u);
  assert.doesNotMatch(report, /script-src 'unsafe-inline'/u);
  assert.match(report, /script-src 'sha256-[A-Za-z0-9+/=]+'/u);
  assert.match(report, /button type="button" data-mode="side"/u);
  assert.match(report, /button type="button" data-mode="wipe"/u);
  assert.match(report, /button type="button" data-mode="overlay"/u);
  assert.match(report, /button type="button" data-mode="blink"/u);
  assert.ok(report.indexOf('id="zoom-4"') < report.indexOf('id="zoom-12"'));
  assert.match(report, /A &lt; B &amp; &quot;safe&quot;/u);
  assert.doesNotMatch(report, /<\/script><img src=x>/u);
  assert.match(report, /\\u003c\/script\\u003e\\u003cimg src=x\\u003e/u);
});

test('visual compare report labels ratios as changed-pixel percentages', () => {
  const comparable = row(8, 'right');
  comparable.review = {
    ...comparable.review,
    exact: {changedPixels: 1, totalPixels: 8, ratio: 0.125},
    perceptual: {changedPixels: 2, totalPixels: 8, ratio: 0.25, threshold: 0.1},
  } as unknown as TileflowVisualReviewDocument;
  const unavailable = row(9, 'right');
  unavailable.review = {
    ...unavailable.review,
    status: 'data-mismatch',
    dataMatch: false,
    exact: null,
    perceptual: null,
  } as unknown as TileflowVisualReviewDocument;
  const report = renderTileflowVisualCompareReport({
    generatedBy: 'Tileflow CLI',
    rows: [comparable, unavailable],
    title: 'Changed pixels',
  });

  assert.match(report, /<span>Exact: 12\.5% changed · Perceptual: 25% changed<\/span>/u);
  assert.match(report, /Pixel change metrics unavailable/u);
  assert.match(report, /Identities and changed-pixel metrics/u);
  assert.match(report, /Data mismatch/u);
  assert.doesNotMatch(report, /12\.5% exact|25% perceptual/u);

  const metadataSource = report.match(
    /<script id="tileflow-review" type="application\/json">([^<]+)<\/script>/u,
  )?.[1];
  assert.ok(metadataSource);
  const metadata = JSON.parse(metadataSource) as {
    rows: Array<{
      review: {exact: {ratio: number} | null; perceptual: {ratio: number} | null};
    }>;
  };
  assert.equal(metadata.rows[0]?.review.exact?.ratio, 0.125);
  assert.equal(metadata.rows[0]?.review.perceptual?.ratio, 0.25);
  assert.equal(metadata.rows[1]?.review.exact, null);
  assert.equal(metadata.rows[1]?.review.perceptual, null);
});

test('visual compare report rejects unbounded or ambiguous input', () => {
  assert.throws(
    () => renderTileflowVisualCompareReport({generatedBy: 'CLI', rows: [], title: 'review'}),
    /at least one row/u,
  );
  assert.throws(
    () =>
      renderTileflowVisualCompareReport({
        generatedBy: 'CLI',
        rows: Array.from({length: tileflowVisualCompareReportLimits.maximumRows + 1}, (_, zoom) =>
          row(zoom, 'right'),
        ),
        title: 'review',
      }),
    /bounded row limit/u,
  );
  assert.throws(
    () =>
      renderTileflowVisualCompareReport({
        generatedBy: 'CLI',
        rows: [row(2, 'first'), row(2, 'second')],
        title: 'review',
      }),
    /unique finite values/u,
  );
  assert.throws(
    () =>
      renderTileflowVisualCompareReport({
        generatedBy: 'CLI',
        rows: [row(2, 'right\nlabel')],
        title: 'review',
      }),
    /right\.label is invalid/u,
  );
  assert.throws(
    () =>
      renderTileflowVisualCompareReport({
        generatedBy: 'CLI',
        rows: [
          {
            ...row(2, 'right'),
            left: {
              ...row(2, 'right').left,
              png: new Uint8Array(tileflowVisualCompareReportLimits.maximumEmbeddedPngBytes + 1),
            },
          },
        ],
        title: 'review',
      }),
    /embedded PNG limit/u,
  );
});

function row(zoom: number, rightLabel: string): TileflowVisualCompareReportRow {
  return {
    cameraLabel: '-3.7038, 40.4168',
    left: {label: 'left', map: 'historic', theme: 'paper', png: new Uint8Array([1, 2])},
    review: reviewDocument(zoom),
    right: {
      label: rightLabel,
      map: 'modern',
      theme: 'light',
      png: new Uint8Array([3, 4]),
    },
    zoom,
  };
}

function reviewDocument(zoom: number): TileflowVisualReviewDocument {
  return {
    schemaVersion: 1,
    kind: 'style-review',
    status: 'comparable',
    left: {scene: {name: `left-${zoom}`}},
    right: {scene: {name: `right-${zoom}`}},
    frameMatch: true,
    dimensionsMatch: true,
    rendererMatch: true,
    dataMatch: true,
    exact: {changedPixels: 0, totalPixels: 1, ratio: 0},
    perceptual: {changedPixels: 0, totalPixels: 1, ratio: 0, threshold: 0.1},
    meanAbsoluteChannelDifference: 0,
    warnings: [],
  } as unknown as TileflowVisualReviewDocument;
}
