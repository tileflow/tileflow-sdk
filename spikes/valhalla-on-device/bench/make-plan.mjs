#!/usr/bin/env node
// Writes a measurement plan: the routing engine's Valhalla configuration (the pinned image's
// base configuration with the same overrides), pointed at a graph archive on the device, and
// the region's cases as the engine would send them.
//
//   node bench/make-plan.mjs --region madrid-city --archive /device/path/graph.tar \
//     [--labels default|small] [--cache-mb 64] [--repeats 5] > plan.json
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';

const {values} = parseArgs({
  options: {
    region: {type: 'string'},
    archive: {type: 'string'},
    labels: {type: 'string', default: 'default'},
    'cache-mb': {type: 'string', default: '64'},
    repeats: {type: 'string', default: '5'},
    'keep-answers': {type: 'boolean', default: false},
    // Read loose tiles from a directory (heap cache) instead of the mmapped archive.
    'tile-dir': {type: 'string'},
  },
});
const here = new URL('.', import.meta.url);
const base = JSON.parse(readFileSync(new URL('valhalla-base-config.json', here), 'utf8'));
const cases = JSON.parse(readFileSync(new URL('cases.json', here), 'utf8'))[values.region];
if (!cases || !(values.archive || values['tile-dir']))
  throw new Error('--region and --archive are required');

const config = structuredClone(base);
const quiet = {type: 'std_err', color: false};
config.mjolnir = {
  ...config.mjolnir,
  tile_extract: values['tile-dir'] ? '' : values.archive,
  tile_dir: values['tile-dir'] ?? '',
  traffic_extract: '',
  admin: '',
  timezone: '',
  max_cache_size: Number(values['cache-mb']) * 1024 * 1024,
  use_lru_mem_cache: false,
  logging: quiet,
};
config.loki = {...config.loki, actions: ['route'], use_connectivity: false, logging: quiet};
for (const section of ['thor', 'odin', 'meili'])
  config[section] = {...config[section], logging: quiet};
if (values.labels === 'small') {
  // Smaller up-front label reservations; the searches still grow on demand.
  Object.assign(config.thor, {
    max_reserved_labels_count_astar: 50000,
    max_reserved_labels_count_bidir_astar: 50000,
    max_reserved_labels_count_dijkstras: 50000,
    max_reserved_labels_count_bidir_dijkstras: 50000,
    clear_reserved_memory: true,
  });
}

const plan = {
  region: values.region,
  labels: values.labels,
  source: values['tile-dir'] ? 'tile_dir' : 'tile_extract',
  cacheMb: Number(values['cache-mb']),
  repeats: Number(values.repeats),
  config,
  cases: cases.map((c) => ({
    id: c.id,
    keepAnswer: values['keep-answers'],
    // The routing engine's request (apps/routing-engine toValhallaRoute) without options.
    request: {
      locations: [c.from, c.to].map(([lon, lat]) => ({lon, lat})),
      costing: c.costing,
      directions_options: {units: 'kilometers', language: 'en-US'},
    },
  })),
};
process.stdout.write(`${JSON.stringify(plan)}\n`);
