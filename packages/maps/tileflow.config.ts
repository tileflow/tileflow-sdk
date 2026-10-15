import {defineMap} from '@tileflow/core';
import {streets} from './src/index';

/** Source-linked example for the generic Workbench; map edits reload without publishing. */
export default defineMap({
  id: 'streets-workbench',
  name: 'Streets',
  version: 1,
  extends: streets,
  defaultTheme: 'light',
  view: {center: [-3.70345, 40.417134], zoom: 16.27},
  scenes: {
    madrid: {
      theme: 'light',
      camera: {type: 'center', center: [-3.70345, 40.417134], zoom: 16.27},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    nyc: {
      theme: 'light',
      camera: {type: 'center', center: [-73.97154, 40.73252], zoom: 12.83},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
  },
});
