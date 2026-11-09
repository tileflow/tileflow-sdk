// Deterministic GeoJSON FeatureCollections of about 300 MB for the browser tiling measurements.
// Usage: node generate-data.mjs <points|polygons> <output> [megabytes]
import {once} from 'node:events';
import {createWriteStream} from 'node:fs';

const [kind, output, megabytes = '300'] = process.argv.slice(2);
const targetBytes = Number(megabytes) * 1_000_000;

let state = kind === 'points' ? 0x9e3779b9 : 0x7f4a7c15;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
  mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}
const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
const round = (value) => Math.round(value * 1e6) / 1e6;

const categories = ['shop', 'cafe', 'school', 'park', 'office', 'clinic', 'station', 'hotel'];
const cities = Array.from({length: 240}, () => ({
  lon: -170 + random() * 340,
  lat: -55 + random() * 125,
  spread: 0.02 + random() * random() * 0.6,
}));

function place() {
  if (random() < 0.3) return [-170 + random() * 340, -55 + random() * 125];
  const city = cities[Math.floor(random() * cities.length)];
  return [city.lon + gaussian() * city.spread, city.lat + gaussian() * city.spread];
}

function properties(index) {
  return {
    id: index,
    name: `Place ${index.toString(36)}`,
    category: categories[index % categories.length],
    score: Math.round(random() * 1e5) / 100,
    open: index % 3 === 0,
  };
}

function point(index) {
  const [lon, lat] = place();
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [round(lon), round(lat)]},
    properties: properties(index),
  };
}

function polygon(index) {
  const [lon, lat] = place();
  const large = index % 500 === 0;
  const vertices = large ? 800 + Math.floor(random() * 2400) : 6 + Math.floor(random() * 24);
  const radius = large ? 0.05 + random() * 0.4 : 0.00015 + random() * 0.0008;
  const ring = [];
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const angle = (vertex / vertices) * 2 * Math.PI;
    const distance = radius * (0.7 + random() * 0.3);
    ring.push([round(lon + Math.cos(angle) * distance), round(lat + Math.sin(angle) * distance)]);
  }
  ring.push(ring[0]);
  return {
    type: 'Feature',
    geometry: {type: 'Polygon', coordinates: [ring]},
    properties: properties(index),
  };
}

const make = kind === 'points' ? point : polygon;
const stream = createWriteStream(output);
stream.write('{"type":"FeatureCollection","features":[\n');
let bytes = 0;
let index = 0;
while (bytes < targetBytes) {
  const text = `${index === 0 ? '' : ',\n'}${JSON.stringify(make(index))}`;
  bytes += Buffer.byteLength(text);
  index += 1;
  if (!stream.write(text)) await once(stream, 'drain');
}
stream.end('\n]}\n');
await once(stream, 'finish');
console.log(JSON.stringify({kind, features: index, bytes}));
