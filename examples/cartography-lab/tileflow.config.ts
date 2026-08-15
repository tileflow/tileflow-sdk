import {
  buildings,
  defineTileflow,
  expression,
  filter,
  labels,
  land,
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

function scaleStops(widths: WidthStops, scale: number): WidthStops {
  return widths.map(([level, width]) => [level, width * scale] as const);
}

function cityRoadStyle(color: string, widths: WidthStops): TileflowRoadClassStyle {
  const tunnelWidths = scaleStops(widths, 0.18);
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
      casing: {
        ...casing,
        opacity: 1,
        width: zoom.linear(casingStops(tunnelWidths)),
      },
      fill: {
        ...fill,
        opacity: 1,
        width: zoom.linear(tunnelWidths),
      },
    },
  };
}

function contextualPathWidth(pedestrian: number, footway: number) {
  return expression<number>(['match', ['get', 'subclass'], ['pedestrian'], pedestrian, footway]);
}

function contextualPathStyle(): TileflowRoadClassStyle {
  const fill = {
    cap: 'round' as const,
    color: expression<string>(['match', ['get', 'subclass'], ['pedestrian'], '#F3F5F7', '#78CDB2']),
    join: 'round' as const,
    opacity: 1,
    width: expression<number>([
      'interpolate',
      ['linear'],
      ['zoom'],
      14,
      contextualPathWidth(1.2, 0.45).value,
      17,
      contextualPathWidth(8, 0.85).value,
      19,
      contextualPathWidth(18, 1.35).value,
      22,
      contextualPathWidth(48, 3).value,
    ]),
  };
  const casing = {
    cap: 'round' as const,
    color: '#FFFFFF',
    join: 'round' as const,
    opacity: expression<number>(['match', ['get', 'subclass'], ['pedestrian'], 1, 0]),
    width: expression<number>([
      'interpolate',
      ['linear'],
      ['zoom'],
      14,
      contextualPathWidth(2.5, 0.45).value,
      17,
      contextualPathWidth(10, 0.85).value,
      19,
      contextualPathWidth(21, 1.35).value,
      22,
      contextualPathWidth(54, 3).value,
    ]),
  };

  return {
    surface: {casing, fill},
    bridge: {casing, fill},
    tunnel: {
      casing: {visible: false},
      fill: {...fill, dash: [2, 2], opacity: 0.55},
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
        park: '#AFEAC5', // Hex color.
        building: '#FFF8EC', // Hex color.
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
          grass: '#AFEAC5', // Hex color.
          park: '#AFEAC5', // Hex color.
          protected: '#AFEAC5', // Hex color.
          sand: '#F1E8D0', // Hex color.
          wood: '#B7DFC5', // Hex color.
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
          primary: '#AEBCCA', // Hex color.
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
        land: land({
          background: {color: '#F7F7F5', opacity: 1},
          landcover: {
            farmland: {color: '#DCE9CF', opacity: 1},
            grass: {color: '#AFEAC5', opacity: 1},
            ice: {color: '#F4FAFC', opacity: 1},
            park: {color: '#AFEAC5', opacity: 1},
            protected: {color: '#AFEAC5', opacity: 1},
            sand: {color: '#F1E8D0', opacity: 1},
            scrub: {color: '#CEE7CD', opacity: 1},
            wood: {color: '#B7DFC5', opacity: 1},
          },
          landuse: {
            cemetery: {color: '#D4E8D9', opacity: 1},
            civic: {color: '#F3F5F7', opacity: 1},
            commercial: {color: '#FFF8EC', opacity: 1},
            industrial: {color: '#F1F2F3', opacity: 1},
            railway: {color: '#F3F3F2', opacity: 1},
            residential: {color: '#F7F7F5', opacity: 1},
          },
        }),
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
            primary: cityRoadStyle('#AEBCCA', [
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
            path: contextualPathStyle(),
          },
        }),
        transit: transit({
          rail: {
            color: '#A6AFB8',
            filter: filter([
              'all',
              ['match', ['get', 'class'], ['rail', 'transit'], true, false],
              ['!', ['has', 'service']],
              ['!=', ['get', 'brunnel'], 'tunnel'],
            ]),
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
            filter: filter([
              'all',
              ['match', ['get', 'class'], ['rail', 'transit'], true, false],
              ['!', ['has', 'service']],
              ['!=', ['get', 'brunnel'], 'tunnel'],
            ]),
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
            filter: filter([
              'all',
              ['==', ['get', 'class'], 'rail'],
              ['has', 'service'],
              ['!=', ['get', 'brunnel'], 'tunnel'],
            ]),
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
          fill: {color: '#FFF8EC', minZoom: 13, opacity: 1},
          outline: {color: '#E7D8BC', minZoom: 14, opacity: 1, width: 0.8},
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
              track: {...roadLabelStyle(false), visible: false},
              path: {
                ...roadLabelStyle(false),
                filter: filter([
                  'all',
                  ['has', 'name'],
                  ['==', ['get', 'class'], 'path'],
                  ['==', ['get', 'subclass'], 'pedestrian'],
                ]),
                minZoom: 15,
              },
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
