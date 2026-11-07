import {defineMap} from '@tileflow/core';
import {outdoors} from './src/index';

const viewport = {width: 1280, height: 800, dpr: 1} as const;

/** Source-linked Outdoors preview: high mountains, a national park and a sparsely mapped range. */
export default defineMap({
  id: 'outdoors-workbench',
  name: 'Outdoors',
  version: 1,
  extends: outdoors,
  scenes: {
    chamonix: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.5},
      viewport,
    },
    'chamonix-trails': {
      theme: 'light',
      camera: {type: 'center', center: [6.835, 45.925], zoom: 14.5},
      viewport,
    },
    'chamonix-night': {
      theme: 'dark',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.5},
      viewport,
    },
    yosemite: {
      theme: 'light',
      camera: {type: 'center', center: [-119.56, 37.74], zoom: 13},
      viewport,
    },
    'yosemite-dusk': {
      theme: 'dusk',
      camera: {type: 'center', center: [-119.573, 37.73], zoom: 14},
      viewport,
    },
    paine: {
      theme: 'light',
      camera: {type: 'center', center: [-73, -50.95], zoom: 12},
      viewport,
    },
  },
});
