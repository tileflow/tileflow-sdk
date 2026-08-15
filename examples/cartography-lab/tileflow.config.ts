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

function scaleStops(widths: WidthStops, scale: number): WidthStops {
  return widths.map(([level, width]) => [level, width * scale] as const);
}

function roadWidth(widths: WidthStops, oneWayScale: number, casingAddition = 0) {
  if (oneWayScale === 1) {
    return zoom.linear(widths.map(([level, width]) => [level, width + casingAddition] as const));
  }

  return expression<number>([
    'interpolate',
    ['linear'],
    ['zoom'],
    ...widths.flatMap(([level, width]) => [
      level,
      [
        'match',
        ['get', 'oneway'],
        [1, -1],
        width * oneWayScale + casingAddition,
        width + casingAddition,
      ],
    ]),
  ]);
}

function cityRoadStyle(
  color: string,
  casingColor: string,
  widths: WidthStops,
  oneWayScale = 1,
): TileflowRoadClassStyle {
  // Tunnels keep most of the road hierarchy instead of collapsing into hairlines.
  // A dashed casing distinguishes the underground segment without hiding its geometry.
  const tunnelWidths = scaleStops(widths, 0.72);
  const fill = {
    cap: 'round' as const,
    color,
    join: 'round' as const,
    opacity: 1,
    width: roadWidth(widths, oneWayScale),
  };
  const casing = {
    cap: 'round' as const,
    color: casingColor,
    join: 'round' as const,
    opacity: 0.96,
    width: roadWidth(widths, oneWayScale, 2),
  };

  return {
    surface: {casing, fill},
    bridge: {casing, fill},
    tunnel: {
      casing: {
        ...casing,
        dash: [3, 2],
        opacity: 0.86,
        width: roadWidth(tunnelWidths, oneWayScale, 2),
      },
      fill: {
        ...fill,
        opacity: 0.74,
        width: roadWidth(tunnelWidths, oneWayScale),
      },
    },
  };
}

function pathRoadStyle(
  color: string,
  widths: WidthStops,
  options: {casingColor?: string; dash?: readonly number[]} = {},
): TileflowRoadClassStyle {
  const fill = {
    cap: 'round' as const,
    color,
    ...(options.dash ? {dash: [...options.dash]} : {}),
    join: 'round' as const,
    opacity: 1,
    width: zoom.linear(widths),
  };
  const casing = options.casingColor
    ? {
        cap: 'round' as const,
        color: options.casingColor,
        join: 'round' as const,
        opacity: 1,
        width: zoom.linear(widths.map(([level, width]) => [level, width + 2] as const)),
      }
    : undefined;

  return {
    surface: {casing: casing ?? {visible: false}, fill},
    bridge: {casing: casing ?? {visible: false}, fill},
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
        roadCasing: '#D5DCE3', // Hex color.
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
          casing: '#D5DCE3', // Hex color.
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
          modifiers: {
            // Optional keys: construction, ramp, unpaved. Treatments accept enabled,
            // widthScale, surface, tunnel, and bridge; phases accept color, opacity,
            // dash, blur, gapWidth, and offset.
            construction: {
              surface: {
                casing: {color: '#D79A56', dash: [1.5, 1], opacity: 0.9},
                fill: {color: '#F4D4A4', dash: [1.5, 1], opacity: 0.96},
              },
            },
            ramp: {widthScale: 0.52}, // Finite number > 0.
            unpaved: {
              surface: {
                casing: {color: '#C4B69B', dash: [1.5, 1], opacity: 0.9},
                fill: {color: '#E7D8BB', dash: [1.5, 1], opacity: 0.96},
              },
            },
          },
          restrictions: {
            // Optional keys: access, bicycle, foot, horse. A key styles explicit
            // restrictions for that mode without exposing OpenMapTiles field names.
            access: {
              surface: {
                casing: {color: '#B7A5AA', dash: [1, 1], opacity: 0.72},
                fill: {color: '#E3D7DA', dash: [1, 1], opacity: 0.8},
              },
            },
          },
          serviceTypes: {
            // Optional keys: alley, crossover, driveway, parkingAisle, yard.
            alley: {widthScale: 0.68},
            crossover: {widthScale: 0.5},
            driveway: {widthScale: 0.58},
            parkingAisle: {widthScale: 0.42},
            yard: {widthScale: 0.55},
          },
          areas: {
            // Polygon pedestrian plazas; line-like pedestrian ways use classes.pedestrian.
            pedestrian: {
              color: '#F1F3F5',
              minZoom: 14,
              opacity: 1,
              outlineColor: '#D5DCE3',
            },
          },
          classes: {
            // Optional semantic targets: motorway, trunk, primary, secondary,
            // tertiary, minor, service, track, pathway, footway, cycleway,
            // steps, pedestrian. Each accepts surface, tunnel, bridge, enabled.
            motorway: cityRoadStyle('#AAB9C9', '#F8FAFC', [
              [10, 2],
              [14, 8],
              [16, 18],
              [17, 31],
              [19, 72],
              [22, 220],
            ]),
            trunk: cityRoadStyle('#AFBECD', '#F8FAFC', [
              [10, 1.8],
              [14, 7],
              [16, 15],
              [17, 24],
              [19, 56],
              [22, 170],
            ]),
            primary: cityRoadStyle(
              '#AEBCCA',
              '#F8FAFC',
              [
                [10, 1.5],
                [14, 6],
                [16, 13],
                [17, 20],
                [19, 46],
                [22, 140],
              ],
              0.58,
            ),
            secondary: cityRoadStyle('#D4DCE4', '#FAFBFC', [
              [11, 1.2],
              [14, 4.5],
              [16, 9],
              [17, 15],
              [19, 34],
              [22, 105],
            ]),
            tertiary: cityRoadStyle('#E1E6EB', '#FAFBFC', [
              [12, 1],
              [14, 3.5],
              [16, 7.5],
              [17, 12],
              [19, 26],
              [22, 82],
            ]),
            minor: cityRoadStyle('#F8F9FB', '#FFFFFF', [
              [13, 1],
              [15, 4],
              [16, 6],
              [17, 8],
              [19, 20],
              [22, 60],
            ]),
            service: cityRoadStyle('#F8F9FB', '#FFFFFF', [
              [14, 0.7],
              [16, 3.5],
              [17, 5.5],
              [19, 13],
              [22, 40],
            ]),
            track: cityRoadStyle('#EEF1F3', '#FFFFFF', [
              [14, 0.5],
              [16, 2],
              [17, 3],
              [19, 7],
              [22, 22],
            ]),
            pathway: pathRoadStyle(
              '#F7F8F9',
              [
                [14, 0.4],
                [17, 1.2],
                [19, 2],
                [22, 4],
              ],
              {casingColor: '#DDE2E7'},
            ),
            footway: pathRoadStyle(
              '#FAFBFC',
              [
                [14, 0.45],
                [17, 1.4],
                [19, 2.3],
                [22, 5],
              ],
              {casingColor: '#D8DEE5'},
            ),
            cycleway: pathRoadStyle(
              '#BDE4D8',
              [
                [14, 0.55],
                [17, 1.5],
                [19, 2.5],
                [22, 5],
              ],
              {casingColor: '#96CFBE'},
            ),
            steps: pathRoadStyle(
              '#D8DEE5',
              [
                [15, 0.55],
                [17, 1.6],
                [19, 2.8],
                [22, 6],
              ],
              {casingColor: '#C9D0D7', dash: [1, 0.75]},
            ),
            pedestrian: pathRoadStyle(
              '#F3F5F7',
              [
                [14, 1.2],
                [17, 9],
                [19, 20],
                [22, 52],
              ],
              {casingColor: '#D5DCE3'},
            ),
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
              pathway: {...roadLabelStyle(false), minZoom: 16, visible: false},
              footway: {...roadLabelStyle(false), minZoom: 16, visible: false},
              cycleway: {...roadLabelStyle(false), minZoom: 16, visible: false},
              steps: {...roadLabelStyle(false), minZoom: 17, visible: false},
              pedestrian: {...roadLabelStyle(false), minZoom: 15},
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
