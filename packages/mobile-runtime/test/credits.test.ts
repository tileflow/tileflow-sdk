import assert from 'node:assert/strict';
import test from 'node:test';
import {type Credit, creditHtml, visibleCredits} from '../src/credits';

const spain: Credit = {
  id: 'es-ign',
  text: '© IGN España',
  href: 'https://www.ign.es',
  regions: [
    [-9.4, 35.9, 4.4, 43.8],
    [-18.2, 27.6, -13.4, 29.5],
  ],
};
const fiji: Credit = {
  id: 'fj',
  text: 'Fiji',
  href: 'https://example.com/fiji',
  regions: [[177, -19.2, 180, -16]],
};

test('a credit is visible while one of its boxes intersects the view', () => {
  const madrid = {west: -3.8, south: 40.3, east: -3.6, north: 40.5};
  assert.deepEqual(visibleCredits([spain, fiji], madrid), [spain]);
  const canaries = {west: -16, south: 28, east: -15, north: 29};
  assert.deepEqual(visibleCredits([spain], canaries), [spain]);
  const paris = {west: 2.2, south: 48.8, east: 2.5, north: 48.9};
  assert.deepEqual(visibleCredits([spain], paris), []);
  // Touching edges count, as the service's own intersection does.
  assert.deepEqual(visibleCredits([spain], {west: 4.4, south: 43.8, east: 5, north: 44}), [spain]);
});

test('views across the antimeridian and wider than the world', () => {
  const across = {west: 178, south: -18, east: 182, north: -17};
  assert.deepEqual(visibleCredits([fiji, spain], across), [fiji]);
  const west = {west: -183, south: -18, east: -179, north: -17};
  assert.deepEqual(visibleCredits([fiji], west), [fiji]);
  const world = {west: -200, south: -80, east: 200, north: 80};
  assert.deepEqual(visibleCredits([spain, fiji], world), [spain, fiji]);
});

test('credit text and links are escaped', () => {
  assert.equal(
    creditHtml({...spain, text: '<b>A & B</b>', href: 'https://a.test/?x=1&y=2'}),
    '<a href="https://a.test/?x=1&amp;y=2" target="_blank" rel="noopener">&lt;b&gt;A &amp; B&lt;/b&gt;</a>',
  );
});
