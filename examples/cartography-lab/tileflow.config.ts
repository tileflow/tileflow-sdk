import {
  buildings,
  defineTileflow,
  labels,
  poi,
  roads,
  streets,
  type TileflowRoadClassStyle,
  type TileflowTextStyle,
  transit,
  zoom,
} from '@tileflow/core';

type WidthStops = readonly (readonly [number, number])[];

function casingStops(widths: WidthStops): WidthStops {
  return widths.map(
    ([level, width]) => [level, width + Math.min(10, Math.max(1.5, width * 0.22))] as const,
  );
}

function cityRoadStyle(color: string, widths: WidthStops): TileflowRoadClassStyle {
  const fill = {
    cap: 'round' as const,
    color,
    join: 'round' as const,
    opacity: 1,
    width: zoom.linear(widths),
  };
  const casing = {
    cap: 'round' as const,
    color: '#FFFFFF',
    join: 'round' as const,
    opacity: 0.96,
    width: zoom.linear(casingStops(widths)),
  };

  return {
    surface: {casing, fill},
    bridge: {
      casing,
      fill: {...fill, color: '#A9B8C8'},
    },
    tunnel: {
      casing: {...casing, opacity: 0.72},
      fill: {...fill, color: '#BCC8D4', opacity: 0.82},
    },
  };
}

function roadLabelStyle(major: boolean): TileflowTextStyle {
  return {
    color: major ? '#FFFFFF' : '#5E6B78',
    font: [major ? 'Noto Sans Bold' : 'Noto Sans Regular'],
    haloBlur: 0.4,
    haloColor: major ? '#718397' : '#FFFFFF',
    haloWidth: major ? 1.2 : 2,
    padding: 2,
    size: zoom.linear([
      [13, 10.5],
      [16, 13],
      [18, major ? 16 : 15],
      [20, major ? 18 : 17],
    ]),
    spacing: major ? 190 : 230,
  };
}

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
        background: '#F6F7F5', // Hex: #RGB | #RGBA | #RRGGBB | #RRGGBBAA.
        land: '#F7F7F5', // Hex color.
        water: '#83D8EA', // Hex color.
        park: '#BDEBCF', // Hex color.
        building: '#EEF1F5', // Hex color.
        road: '#F8F9FB', // Hex color.
        roadMajor: '#B4C2D0', // Hex color.
        roadCasing: '#FFFFFF', // Hex color.
        boundary: '#C5CCD4', // Hex color.
        text: '#3F4B57', // Hex color.
        textMuted: '#687786', // Hex color.
        textHalo: '#FFFFFF', // Hex color.
      },
      modules: {
        hydro: {
          // Optional keys: ferry, label, water, waterway.
          label: '#43869A', // Hex color.
          water: '#83D8EA', // Hex color.
          waterway: '#65B9CE', // Hex color.
        },
        labels: {
          // Optional keys: country, halo, muted, neighborhood, poi, primary, road,
          // settlement, water.
          country: '#3F4B57', // Hex color.
          halo: '#FFFFFF', // Hex color.
          neighborhood: '#687786', // Hex color.
          road: '#5E6B78', // Hex color.
          settlement: '#3F4B57', // Hex color.
          water: '#43869A', // Hex color.
        },
        landcover: {
          // Optional keys: grass, ice, park, protected, sand, wood.
          grass: '#CBEBD5', // Hex color.
          park: '#BDEBCF', // Hex color.
          protected: '#C5E8D1', // Hex color.
          sand: '#F1E8D0', // Hex color.
          wood: '#B9DFC7', // Hex color.
        },
        landuse: {
          // Optional keys: cemetery, civic, commercial, industrial, residential.
          cemetery: '#D4E8D9', // Hex color.
          civic: '#F3F5F7', // Hex color.
          commercial: '#FFF8EC', // Hex color.
          industrial: '#F1F2F3', // Hex color.
          residential: '#F6F7F8', // Hex color.
        },
        poi: {
          // Optional keys: coffee, culture, education, food, halo, health, icon,
          // label, lodging, services, shopping, transit.
          coffee: '#A8612D', // Hex color.
          culture: '#7A58A6', // Hex color.
          food: '#B45C25', // Hex color.
          label: '#455564', // Hex color.
          shopping: '#2B79D0', // Hex color.
          transit: '#466F97', // Hex color.
        },
        roads: {
          // Optional keys: bridge, casing, ferry, minor, motorway, path, primary,
          // rail, secondary, trunk, tunnel.
          bridge: '#A9B8C8', // Hex color.
          casing: '#FFFFFF', // Hex color.
          minor: '#F8F9FB', // Hex color.
          motorway: '#AAB9C9', // Hex color.
          path: '#E5EAEE', // Hex color.
          primary: '#B4C2D0', // Hex color.
          rail: '#A6AFB8', // Hex color.
          secondary: '#D4DCE4', // Hex color.
          trunk: '#AFBECD', // Hex color.
          tunnel: '#BCC8D4', // Hex color.
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
          detail: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          hierarchy: 'clear', // 'subtle' | 'clear' | 'strong'.
          outline: 'strong', // 'none' | 'subtle' | 'strong'.
          weight: 'regular', // 'thin' | 'regular' | 'bold'.
          oneWayMarkers: true, // true | false.
          extras: {
            paths: true, // true | false.
          },
          classes: {
            motorway: cityRoadStyle('#AAB9C9', [
              [10, 2],
              [14, 8],
              [16, 18],
              [17, 31],
              [19, 72],
              [22, 220],
            ]),
            trunk: cityRoadStyle('#AFBECD', [
              [10, 1.8],
              [14, 7.5],
              [16, 17],
              [17, 29],
              [19, 68],
              [22, 205],
            ]),
            primary: cityRoadStyle('#B4C2D0', [
              [10, 1.5],
              [14, 7],
              [16, 16],
              [17, 27],
              [19, 62],
              [22, 190],
            ]),
            secondary: cityRoadStyle('#D4DCE4', [
              [11, 1.2],
              [14, 5.5],
              [16, 12],
              [17, 21],
              [19, 48],
              [22, 150],
            ]),
            tertiary: cityRoadStyle('#E1E6EB', [
              [12, 1],
              [14, 4],
              [16, 10],
              [17, 17],
              [19, 38],
              [22, 120],
            ]),
            minor: cityRoadStyle('#F8F9FB', [
              [13, 1],
              [15, 5],
              [16, 8],
              [17, 13],
              [19, 30],
              [22, 90],
            ]),
            service: cityRoadStyle('#F8F9FB', [
              [14, 0.7],
              [16, 5],
              [17, 9],
              [19, 20],
              [22, 60],
            ]),
            track: cityRoadStyle('#EEF1F3', [
              [14, 0.5],
              [16, 3],
              [17, 5],
              [19, 12],
              [22, 36],
            ]),
            path: cityRoadStyle('#E5EAEE', [
              [14, 0.4],
              [16, 2],
              [17, 3],
              [19, 7],
              [22, 20],
            ]),
          },
        }),
        transit: transit({
          rail: {
            color: '#A6AFB8',
            minZoom: 12,
            opacity: 0.56,
            width: zoom.linear([
              [12, 0.5],
              [16, 1.2],
              [18, 2],
            ]),
          },
          railHatching: {
            color: '#F7F8F9',
            dash: [1, 2.5],
            minZoom: 13,
            opacity: 0.8,
            width: zoom.linear([
              [13, 0.3],
              [17, 0.8],
              [19, 1.2],
            ]),
          },
          serviceRail: {
            color: '#B8C0C8',
            minZoom: 14,
            opacity: 0.42,
            width: zoom.linear([
              [14, 0.4],
              [17, 1],
              [19, 1.6],
            ]),
          },
        }),
        buildings: buildings({
          mode: 'flat', // 'flat' | '3d'.
          fill: {color: '#EEF1F5', minZoom: 13, opacity: 0.92},
          outline: {color: '#D6DCE3', minZoom: 14, opacity: 0.9, width: 0.8},
        }),
        labels: labels({
          language: 'local', // 'auto' | 'local' | 'en' | another language field suffix.
          places: 'all', // 'none' | 'major' | 'all'.
          roads: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          water: 'all', // 'none' | 'major' | 'all'.
          styles: {
            roads: {
              motorway: roadLabelStyle(true),
              trunk: roadLabelStyle(true),
              primary: roadLabelStyle(true),
              secondary: roadLabelStyle(false),
              tertiary: roadLabelStyle(false),
              minor: roadLabelStyle(false),
              service: roadLabelStyle(false),
              track: roadLabelStyle(false),
              path: roadLabelStyle(false),
            },
          },
        }),
        poi: poi({
          // Built-ins: food, coffee, culture, transit, shopping, lodging, health,
          // education, services; custom safe category IDs are also accepted.
          categories: [
            'food',
            'coffee',
            'culture',
            'transit',
            'shopping',
            'lodging',
            'health',
            'education',
            'services',
          ],
          color: 'category', // 'uniform' | 'category'.
          density: 'dense', // 'sparse' | 'balanced' | 'dense'.
          icons: false, // false | true | 'essential' | 'full'; non-false needs an icon set/sprite.
          labels: 'full', // 'none' | 'minimal' | 'balanced' | 'full'.
          minZoom: 15, // Number from 0 through 24.
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
        zoom: 17, // 0..24; optional bearing -180..180 and pitch 0..85.
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
