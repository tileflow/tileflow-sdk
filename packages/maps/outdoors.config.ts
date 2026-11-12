import {defineMap} from '@tileflow/core';
import {outdoors} from './src/index';

const viewport = {width: 1280, height: 800, dpr: 1} as const;

/** Repeatable Outdoors views across regions, scales, light presets and screen sizes. */
export default defineMap({
  id: 'outdoors-workbench',
  name: 'Outdoors',
  version: 1,
  extends: outdoors,
  scenes: {
    world: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 0, pitch: 0},
      viewport,
    },
    country: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 5, pitch: 0},
      viewport,
    },
    'region-contours': {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 8.5, pitch: 0},
      viewport,
    },
    valley: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 10.5, pitch: 0},
      viewport,
    },
    detail: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 16, pitch: 0},
      viewport,
    },
    near: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 18, pitch: 0},
      viewport,
    },
    maximum: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 22, pitch: 0},
      viewport,
    },
    'tilt-30': {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.5, pitch: 30},
      viewport,
    },
    'tilt-60': {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.5, pitch: 60},
      viewport,
    },
    chamonix: {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.5},
      viewport,
    },
    'chamonix-3d': {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.2, pitch: 52, bearing: -25},
      viewport,
    },
    'chamonix-dawn': {
      theme: 'dawn',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.2, pitch: 52, bearing: -25},
      viewport,
    },
    'chamonix-mobile': {
      theme: 'light',
      camera: {type: 'center', center: [6.87, 45.92], zoom: 12.2, pitch: 48, bearing: -25},
      viewport: {width: 390, height: 844, dpr: 1},
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
    pyrenees: {
      theme: 'light',
      camera: {type: 'center', center: [0.015, 42.665], zoom: 12.8, pitch: 48, bearing: -15},
      viewport,
    },
    regional: {
      theme: 'light',
      camera: {type: 'center', center: [9.1, 42.2], zoom: 7.5},
      viewport,
    },
    madrid: {
      theme: 'light',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 14},
      viewport,
    },
  },
});
