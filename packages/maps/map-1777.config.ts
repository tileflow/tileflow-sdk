import {defineMap} from '@tileflow/core';
import {map1777} from './src/index';

/** Source-linked 1777 preview; the 3D control raises its buildings and vegetation. */
export default defineMap({
  id: 'map-1777-workbench',
  name: '1777',
  version: 1,
  extends: map1777,
  view: {center: [-3.7105, 40.4168], zoom: 16.5},
  scenes: {
    namur: {
      theme: 'light',
      camera: {type: 'center', center: [4.865, 50.464], zoom: 16.1},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    countryside: {
      theme: 'light',
      camera: {type: 'center', center: [4.7345, 50.8594], zoom: 15.2},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    dawn: {
      theme: 'dawn',
      camera: {type: 'center', center: [-3.7105, 40.4168], zoom: 16.5},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    dusk: {
      theme: 'dusk',
      camera: {type: 'center', center: [-3.7105, 40.4168], zoom: 16.5},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    night: {
      theme: 'dark',
      camera: {type: 'center', center: [-3.7105, 40.4168], zoom: 16.5},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    madrid: {
      theme: 'light',
      camera: {type: 'center', center: [-3.7105, 40.4168], zoom: 16.5},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    gardens: {
      theme: 'light',
      camera: {type: 'center', center: [-3.684, 40.414], zoom: 16.7},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    botanical: {
      theme: 'light',
      camera: {type: 'center', center: [-3.6909, 40.4115], zoom: 16.8},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'botanical-dawn': {
      theme: 'dawn',
      camera: {type: 'center', center: [-3.6909, 40.4115], zoom: 16.8},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'botanical-dusk': {
      theme: 'dusk',
      camera: {type: 'center', center: [-3.6909, 40.4115], zoom: 16.8},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'botanical-night': {
      theme: 'dark',
      camera: {type: 'center', center: [-3.6909, 40.4115], zoom: 16.8},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    regional: {
      theme: 'light',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 10},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
  },
});
