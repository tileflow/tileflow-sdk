import {defineTileflow, labels, osm, poi, roads} from '@tileflow/core';

export default defineTileflow({
  themes: {
    editorial: {
      extends: 'light',
      mode: 'light',
      colors: {
        background: '#E9E5DC',
        land: '#F2EFE8',
        water: '#A9CFD8',
        park: '#C9D8BE',
        building: '#DDD8CE',
        road: '#FBFAF7',
        roadMajor: '#F5E2B8',
        roadCasing: '#C8BFAF',
        boundary: '#AFA79A',
        text: '#343B3D',
        textMuted: '#747B79',
        textHalo: '#F8F6F0',
      },
      modules: {
        hydro: {
          label: '#4F7F8A',
          water: '#A9CFD8',
          waterway: '#83B5C0',
        },
        labels: {
          country: '#454B4B',
          neighborhood: '#6F7472',
          road: '#5F625E',
          settlement: '#343B3D',
          water: '#4F7F8A',
        },
        landcover: {
          grass: '#D8DEC5',
          park: '#C9D8BE',
          protected: '#C2D3B7',
          sand: '#E8DCC2',
          wood: '#BFCFB4',
        },
        landuse: {
          cemetery: '#CDD5C4',
          civic: '#E3DED3',
          commercial: '#E7DAD1',
          industrial: '#DED9D0',
          residential: '#ECE8E0',
        },
        poi: {
          coffee: '#9A5D35',
          culture: '#775985',
          food: '#A6603D',
          label: '#4A4F4E',
          shopping: '#8C5E70',
          transit: '#496E8A',
        },
        roads: {
          casing: '#C8BFAF',
          motorway: '#E9C885',
          primary: '#F0D8A8',
          secondary: '#F5E6C7',
          trunk: '#ECD197',
        },
      },
      typography: {
        font: 'Noto Sans',
        weight: 'regular',
        places: {weight: 'bold'},
      },
    },
  },
  maps: {
    'editorial-city': {
      name: 'Tileflow Editorial City',
      basemap: osm({version: '2026-06-07'}),
      renderer: 'osm-bright',
      theme: 'editorial',
      modules: [
        roads({
          detail: 'streets',
          hierarchy: 'clear',
          outline: 'subtle',
          weight: 'regular',
          extras: {ferry: true, paths: true, rail: true},
        }),
        labels({
          language: 'local',
          places: 'all',
          roads: 'streets',
          water: 'all',
        }),
        poi({
          categories: ['food', 'coffee', 'culture', 'transit', 'shopping'],
          color: 'category',
          density: 'balanced',
          icons: 'essential',
          labels: 'balanced',
          minZoom: 13,
          placement: {coupleIconAndLabel: true, iconPadding: 3, textPadding: 5},
        }),
      ],
      view: {
        center: [-3.69275, 40.40866],
        zoom: 14,
      },
    },
  },
  scenes: {
    'madrid-overview': {
      map: 'editorial-city',
      camera: {type: 'center', center: [-3.7038, 40.4168], zoom: 11.5},
      viewport: {width: 1440, height: 900, dpr: 1},
    },
    'madrid-neighborhood': {
      map: 'editorial-city',
      camera: {type: 'center', center: [-3.69275, 40.40866], zoom: 14.5},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'barcelona-waterfront': {
      map: 'editorial-city',
      camera: {type: 'center', center: [2.1894, 41.3786], zoom: 13.5},
      viewport: {width: 1280, height: 800, dpr: 1},
    },
    'madrid-mobile': {
      map: 'editorial-city',
      camera: {type: 'center', center: [-3.69275, 40.40866], zoom: 14.5},
      viewport: {width: 390, height: 844, dpr: 2},
    },
  },
});
