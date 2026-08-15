import {defineTileflow, labels, poi, roads, streets} from '@tileflow/core';

export default defineTileflow({
  themes: {
    // Record of reusable theme names.
    editorial: {
      // 'standard' | 'light' | 'dark' | 'minimal' | another project theme name.
      extends: 'light',
      mode: 'light', // 'light' | 'dark'.
      colors: {
        // Optional keys: background, land, water, park, building, road, roadMajor,
        // roadCasing, boundary, text, textMuted, and textHalo.
        background: '#E4DFD4', // Hex: #RGB | #RGBA | #RRGGBB | #RRGGBBAA.
        land: '#F5F2EB', // Hex color.
        water: '#A7CED7', // Hex color.
        park: '#C6D8B7', // Hex color.
        building: '#D6CFC3', // Hex color.
        road: '#FCFBF8', // Hex color.
        roadMajor: '#EBCB8F', // Hex color.
        roadCasing: '#BBB1A1', // Hex color.
        boundary: '#999184', // Hex color.
        text: '#252B2D', // Hex color.
        textMuted: '#626866', // Hex color.
        textHalo: '#FBF9F4', // Hex color.
      },
      modules: {
        hydro: {
          // Optional keys: ferry, label, water, waterway.
          label: '#3F7580', // Hex color.
          water: '#A7CED7', // Hex color.
          waterway: '#79AFBB', // Hex color.
        },
        labels: {
          // Optional keys: country, halo, muted, neighborhood, poi, primary, road,
          // settlement, water.
          country: '#2F3536', // Hex color.
          neighborhood: '#565D5B', // Hex color.
          road: '#525653', // Hex color.
          settlement: '#252B2D', // Hex color.
          water: '#3F7580', // Hex color.
        },
        landcover: {
          // Optional keys: grass, ice, park, protected, sand, wood.
          grass: '#D3DDC0', // Hex color.
          park: '#C6D8B7', // Hex color.
          protected: '#BBD0AC', // Hex color.
          sand: '#E8DCC2', // Hex color.
          wood: '#B8CDAA', // Hex color.
        },
        landuse: {
          // Optional keys: cemetery, civic, commercial, industrial, residential.
          cemetery: '#CDD5C4', // Hex color.
          civic: '#E3DED3', // Hex color.
          commercial: '#E7DAD1', // Hex color.
          industrial: '#DED9D0', // Hex color.
          residential: '#ECE8E0', // Hex color.
        },
        poi: {
          // Optional keys: coffee, culture, education, food, halo, health, icon,
          // label, lodging, services, shopping, transit.
          coffee: '#9A5D35', // Hex color.
          culture: '#775985', // Hex color.
          food: '#A6603D', // Hex color.
          label: '#3D4342', // Hex color.
          shopping: '#8C5E70', // Hex color.
          transit: '#496E8A', // Hex color.
        },
        roads: {
          // Optional keys: bridge, casing, ferry, minor, motorway, path, primary,
          // rail, secondary, trunk, tunnel.
          casing: '#BBB1A1', // Hex color.
          motorway: '#DFAE58', // Hex color.
          primary: '#EBCB8F', // Hex color.
          secondary: '#F1DDB4', // Hex color.
          trunk: '#E5BC70', // Hex color.
        },
      },
      typography: {
        // Any non-empty font family available from the configured glyph endpoint.
        font: 'Noto Sans',
        weight: 'regular', // 'regular' | 'medium' | 'semibold' | 'bold'.
        places: {
          // Domain overrides also accept font; domains: places, roads, water, poi.
          weight: 'bold', // 'regular' | 'medium' | 'semibold' | 'bold'.
        },
      },
    },
  },
  maps: {
    'editorial-city': {
      // Any safe map ID: letters, numbers, underscores, or hyphens.
      name: 'Tileflow Editorial City', // Any non-empty display name.
      basemap: streets(), // streets({variant: 'light' | 'dark'}).
      theme: 'editorial', // 'standard' | 'light' | 'dark' | 'minimal' | project theme name.
      modules: {
        // Optional keys: land, water, roads, transit, aeroways, buildings,
        // boundaries, labels, poi. Object order never controls layer order.
        roads: roads({
          detail: 'streets', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          hierarchy: 'clear', // 'subtle' | 'clear' | 'strong'.
          outline: 'subtle', // 'none' | 'subtle' | 'strong'.
          weight: 'regular', // 'thin' | 'regular' | 'bold'.
          extras: {
            paths: true, // true | false.
          },
        }),
        labels: labels({
          language: 'local', // 'auto' | 'local' | 'en' | another language field suffix.
          places: 'all', // 'none' | 'major' | 'all'.
          roads: 'streets', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          water: 'all', // 'none' | 'major' | 'all'.
        }),
        poi: poi({
          // Built-ins: food, coffee, culture, transit, shopping, lodging, health,
          // education, services; custom safe category IDs are also accepted.
          categories: ['food', 'coffee', 'culture', 'transit', 'shopping'],
          color: 'category', // 'uniform' | 'category'.
          density: 'balanced', // 'sparse' | 'balanced' | 'dense'.
          icons: false, // false | true | 'essential' | 'full'; non-false needs an icon set/sprite.
          labels: 'balanced', // 'none' | 'minimal' | 'balanced' | 'full'.
          minZoom: 13, // Number from 0 through 24.
          placement: {
            coupleIconAndLabel: true, // true | false.
            iconPadding: 3, // Finite number >= 0, in pixels.
            textPadding: 5, // Finite number >= 0, in pixels.
          },
        }),
      },
      view: {
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 14, // Number from 0 through 24; optional bearing is -180..180.
      },
    },
  },
  scenes: {
    'madrid-overview': {
      // Any portable scene ID: letters, numbers, underscores, or hyphens.
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        // Alternative: type 'bounds' with bounds [west, south, east, north].
        type: 'center', // 'center' | 'bounds'.
        center: [-3.7038, 40.4168], // [longitude -180..180, latitude -90..90].
        zoom: 11.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1440, // Integer from 64 through 4096 CSS pixels.
        height: 900, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-neighborhood': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 14.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-close-street': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 16.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-motorway': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.6634, 40.4331], // [longitude -180..180, latitude -90..90].
        zoom: 13.25, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-airport': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.5695, 40.4983], // [longitude -180..180, latitude -90..90].
        zoom: 13, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-transit': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.6892, 40.4065], // [longitude -180..180, latitude -90..90].
        zoom: 15, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-rural-edge': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.763, 40.617], // [longitude -180..180, latitude -90..90].
        zoom: 11.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'barcelona-waterfront': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [2.1894, 41.3786], // [longitude -180..180, latitude -90..90].
        zoom: 13.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 1280, // Integer from 64 through 4096 CSS pixels.
        height: 800, // Integer from 64 through 4096 CSS pixels.
        dpr: 1, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
    'madrid-mobile': {
      map: 'editorial-city', // Any key declared in maps.
      camera: {
        type: 'center', // 'center' | 'bounds'.
        center: [-3.69275, 40.40866], // [longitude -180..180, latitude -90..90].
        zoom: 14.5, // 0..24; optional bearing -180..180 and pitch 0..85.
      },
      viewport: {
        width: 390, // Integer from 64 through 4096 CSS pixels.
        height: 844, // Integer from 64 through 4096 CSS pixels.
        dpr: 2, // 1 | 2; total physical pixels must not exceed 16,777,216.
      },
    },
  },
});
