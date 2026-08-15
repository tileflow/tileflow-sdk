import {
  buildings,
  defineTileflow,
  expression,
  labels,
  land,
  poi,
  roads,
  streets,
  type TileflowRoadClassStyle,
  type TileflowSymbolStyle,
  transit,
  zoom,
} from '@tileflow/core';

type WidthStops = readonly (readonly [number, number])[];

function scaleStops(widths: WidthStops, scale: number): WidthStops {
  return widths.map(([level, width]) => [level, width * scale] as const);
}

function roadWidth(widths: WidthStops, oneWayScale: number, casing = false) {
  const renderedWidth = (width: number, scale: number) =>
    width * scale + (casing ? Math.max(2, width * 0.14) : 0);

  if (oneWayScale === 1) {
    return zoom.linear(widths.map(([level, width]) => [level, renderedWidth(width, 1)] as const));
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
        renderedWidth(width, oneWayScale),
        renderedWidth(width, 1),
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
    opacity: 1,
    width: roadWidth(widths, oneWayScale, true),
  };

  return {
    surface: {casing, fill},
    bridge: {casing, fill},
    tunnel: {
      casing: {
        ...casing,
        dash: [3, 2],
        opacity: 0.86,
        width: roadWidth(tunnelWidths, oneWayScale, true),
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

function roadLabelStyle(major: boolean): TileflowSymbolStyle {
  return {
    placement: 'line',
    priority: major ? 90 : 50,
    spacing: major ? 175 : 215,
    text: {
      color: major ? '#FFFFFF' : '#5E6B78',
      font: 'Noto Sans',
      haloBlur: 0.4,
      haloColor: major ? '#718397' : '#FFFFFF',
      haloWidth: major ? 1.2 : 2,
      padding: 2,
      size: zoom.linear([
        [12, major ? 10.5 : 10],
        [15, major ? 13 : 12],
        [17, major ? 16 : 14.5],
        [19, major ? 18 : 16.5],
      ]),
      weight: major ? 'bold' : 'regular',
    },
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
        background: '#F6F7F7', // Hex: #RGB | #RGBA | #RRGGBB | #RRGGBBAA.
        land: '#F7F8F7', // Hex color.
        water: '#83D8EA', // Hex color.
        park: '#B9EACB', // Hex color.
        building: '#FFF9EE', // Hex color.
        road: '#D9E2E9', // Hex color.
        roadMajor: '#A9BACB', // Hex color.
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
          grass: '#B9EACB', // Hex color.
          park: '#B9EACB', // Hex color.
          protected: '#B9EACB', // Hex color.
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
          minor: '#D9E2E9', // Hex color.
          motorway: '#9FB2C4', // Hex color.
          path: '#E5EAEE', // Hex color.
          primary: '#AABCCD', // Hex color.
          rail: '#A6AFB8', // Hex color.
          secondary: '#BBC9D5', // Hex color.
          trunk: '#A5B7C8', // Hex color.
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
          background: {color: '#F7F8F7', opacity: 1},
          landcover: {
            farmland: {fill: {color: '#DCE9CF', opacity: 1}},
            grass: {fill: {color: '#B9EACB', opacity: 1}},
            ice: {fill: {color: '#F4FAFC', opacity: 1}},
            park: {fill: {color: '#B9EACB', opacity: 1}},
            protected: {fill: {color: '#B9EACB', opacity: 1}},
            sand: {fill: {color: '#F1E8D0', opacity: 1}},
            scrub: {fill: {color: '#CEE7CD', opacity: 1}},
            wood: {fill: {color: '#B7DFC5', opacity: 1}},
          },
          landuse: {
            cemetery: {fill: {color: '#D4E8D9', opacity: 1}},
            civic: {fill: {color: '#F3F5F7', opacity: 1}},
            commercial: {fill: {color: '#FFF8EC', opacity: 1}},
            industrial: {fill: {color: '#F1F2F3', opacity: 1}},
            railway: {fill: {color: '#F3F3F2', opacity: 1}},
            residential: {fill: {color: '#F7F8F7', opacity: 1}},
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
            // Optional keys: construction, expressway, indoor, official, ramp, unpaved.
            // Treatments accept enabled, widthScale, surface, tunnel, and bridge;
            // phases accept color, opacity, dash, blur, gapWidth, offset, and width.
            construction: {
              surface: {
                casing: {color: '#D79A56', dash: [1.5, 1], opacity: 0.9},
                fill: {color: '#F4D4A4', dash: [1.5, 1], opacity: 0.96},
              },
            },
            expressway: {widthScale: 1.06}, // Finite number > 0.
            indoor: {
              surface: {
                casing: {dash: [1, 1], opacity: 0.3},
                fill: {dash: [1, 1], opacity: 0.45},
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
            // Optional keys: access, bicycle, foot, horse, toll. A key styles explicit
            // restrictions for that mode without exposing OpenMapTiles field names.
            access: {
              surface: {
                casing: {color: '#B7A5AA', dash: [1, 1], opacity: 0.72},
                fill: {color: '#E3D7DA', dash: [1, 1], opacity: 0.8},
              },
            },
            toll: {
              surface: {casing: {color: '#B9ACC9', opacity: 0.95}},
            },
          },
          // Optional exact keys: '0', '0+', '1', '1+', '2', '2+', '3', '3+', '4', '5', '6'.
          // Values use the same treatment shape as modifiers and restrictions.
          mountainBike: {
            '4': {surface: {fill: {dash: [2, 1], opacity: 0.72}}},
            '5': {surface: {fill: {dash: [1.5, 1], opacity: 0.62}}},
            '6': {surface: {fill: {dash: [1, 1], opacity: 0.52}}},
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
              fill: {color: '#FBFCFD', minZoom: 13, opacity: 1},
              outline: {color: '#CDD7E0', minZoom: 13, opacity: 1, width: 1},
            },
          },
          classes: {
            // Optional semantic targets: motorway, trunk, primary, secondary,
            // tertiary, minor, service, track, pathway, footway, cycleway,
            // steps, pedestrian. Each accepts surface, tunnel, bridge, enabled.
            motorway: cityRoadStyle('#9FB2C4', '#FFFFFF', [
              [10, 2.8],
              [12, 5],
              [14, 10],
              [16, 18],
              [17, 31],
              [19, 72],
              [22, 220],
            ]),
            trunk: cityRoadStyle('#A5B7C8', '#FFFFFF', [
              [10, 2.4],
              [12, 4.5],
              [14, 9],
              [16, 16],
              [17, 25],
              [19, 58],
              [22, 170],
            ]),
            primary: cityRoadStyle('#AABCCD', '#FFFFFF', [
              [10, 1.8],
              [12, 4],
              [14, 8],
              [16, 14],
              [17, 22],
              [19, 48],
              [22, 140],
            ]),
            secondary: cityRoadStyle('#BBC9D5', '#FFFFFF', [
              [11, 1.6],
              [13, 4.5],
              [14, 6],
              [16, 10],
              [17, 16],
              [19, 36],
              [22, 105],
            ]),
            tertiary: cityRoadStyle('#CAD4DD', '#FFFFFF', [
              [12, 1.4],
              [14, 4.5],
              [16, 8],
              [17, 12],
              [19, 26],
              [22, 82],
            ]),
            minor: cityRoadStyle('#D9E2E9', '#FFFFFF', [
              [12.5, 0.8],
              [14, 2.5],
              [15, 4.5],
              [16, 6.5],
              [17, 9],
              [19, 21],
              [22, 60],
            ]),
            service: cityRoadStyle('#E7ECF0', '#FFFFFF', [
              [14, 1],
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
              '#F7F9FA',
              [
                [14, 1.2],
                [17, 7],
                [19, 20],
                [22, 52],
              ],
              {casingColor: '#CDD7E0'},
            ),
          },
        }),
        transit: transit({
          rail: {
            surface: {
              color: '#A6AFB8',
              minZoom: 12,
              opacity: 0.56,
              width: zoom.linear([
                [12, 0.5],
                [16, 1.2],
                [18, 2],
              ]),
            },
            bridge: {
              color: '#A6AFB8',
              minZoom: 12,
              opacity: 0.56,
              width: zoom.linear([
                [12, 0.5],
                [16, 1.2],
                [18, 2],
              ]),
            },
            tunnel: {visible: false},
          },
          railHatching: {
            surface: {
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
            bridge: {
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
            tunnel: {visible: false},
          },
          serviceRail: {
            surface: {
              color: '#B8C0C8',
              minZoom: 14,
              opacity: 0.42,
              width: zoom.linear([
                [14, 0.4],
                [17, 1],
                [19, 1.6],
              ]),
            },
            bridge: {
              color: '#B8C0C8',
              minZoom: 14,
              opacity: 0.42,
              width: zoom.linear([
                [14, 0.4],
                [17, 1],
                [19, 1.6],
              ]),
            },
            tunnel: {visible: false},
          },
        }),
        buildings: buildings({
          mode: 'flat', // 'flat' | '3d'.
          flat: {
            fill: {color: '#FFF9EE', minZoom: 13, opacity: 1},
            outline: {color: '#E5DED2', minZoom: 14, opacity: 0.82, width: 0.55},
          },
        }),
        labels: labels({
          language: 'local', // 'auto' | 'local' | 'en' | another language field suffix.
          places: 'all', // 'none' | 'major' | 'all'.
          roads: 'all', // 'none' | 'highways' | 'major' | 'streets' | 'all'.
          shields: 'all', // 'none' | 'major' | 'all'.
          junctions: true, // true | false.
          water: 'all', // 'none' | 'major' | 'all'.
          styles: {
            places: {
              // Broad place names hand over to streets and POIs as the user zooms in.
              continent: {maxZoom: 5},
              country: {maxZoom: 8},
              state: {maxZoom: 11},
              city: {
                maxZoom: 14,
                priority: 100,
                text: {
                  color: '#3F4B57',
                  haloColor: '#FFFFFF',
                  haloWidth: 2,
                  size: zoom.linear([
                    [7, 12],
                    [12, 18],
                  ]),
                  weight: 'bold',
                },
              },
              town: {maxZoom: 15},
              village: {maxZoom: 16},
              neighborhood: {
                maxZoom: 16.5,
                priority: 65,
                text: {haloColor: '#FFFFFF', haloWidth: 1.8, padding: 8},
              },
              other: {maxZoom: 16},
            },
            junctions: {
              // Exit references are useful at street scale but overwhelm city overviews.
              minZoom: 15,
              placement: 'point',
              text: {
                color: '#405264',
                font: 'Noto Sans',
                haloColor: '#FFFFFF',
                haloWidth: 2,
                size: 10,
                weight: 'bold',
              },
            },
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
            shields: {
              default: {
                minZoom: 9,
                placement: 'line',
                spacing: 280,
                text: {
                  color: '#405264',
                  font: 'Noto Sans',
                  haloColor: '#FFFFFF',
                  haloWidth: 2,
                  padding: 3,
                  size: 10,
                  weight: 'bold',
                },
              },
              // Optional `networks` record applies exact overrides by data-network value.
            },
            water: {
              // Small urban fountains share the generic water-name bucket in this
              // dataset, so their labels yield to roads and landmarks at city zooms.
              other: {maxZoom: 13},
              line: {minZoom: 13},
              waterway: {minZoom: 14},
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
            'major-transit',
            'shopping',
            'lodging',
            'health',
            'education',
            'services',
          ],
          classMapping: {
            // Avoid treating every tram and bus stop as a city-scale landmark.
            'major-transit': ['railway', 'station', 'subway'],
          },
          color: 'category', // 'uniform' | 'category'.
          density: 'balanced', // 'sparse' | 'balanced' | 'dense'.
          icons: false, // false | true | 'essential' | 'full'; non-false needs an icon set/sprite.
          labels: 'balanced', // 'none' | 'minimal' | 'balanced' | 'full'.
          minZoom: 12.5, // Number from 0 through 24.
          placement: {
            coupleIconAndLabel: false, // true | false.
            iconPadding: 3, // Finite number >= 0, in pixels.
            textPadding: 8, // Finite number >= 0, in pixels.
          },
          styles: {
            // Important orientation landmarks arrive first; everyday businesses wait
            // until street zooms. Rank filtering keeps dense centres readable.
            culture: {
              minZoom: 12.5,
              priority: 95,
              marker: {
                color: '#7656A5',
                radius: zoom.linear([
                  [12.5, 3],
                  [17, 5],
                ]),
                strokeColor: '#FFFFFF',
                strokeWidth: 1.5,
              },
              text: {
                color: '#7656A5',
                haloColor: '#FFFFFF',
                haloWidth: 1.6,
                size: zoom.linear([
                  [12.5, 10],
                  [17, 12],
                ]),
                weight: 'bold',
              },
            },
            'major-transit': {
              minZoom: 12.5,
              priority: 100,
              marker: {
                color: '#466F97',
                radius: zoom.linear([
                  [12.5, 3],
                  [17, 5],
                ]),
                strokeColor: '#FFFFFF',
                strokeWidth: 1.5,
              },
              text: {
                color: '#466F97',
                haloColor: '#FFFFFF',
                haloWidth: 1.7,
                size: zoom.linear([
                  [12.5, 10],
                  [17, 12.5],
                ]),
                weight: 'bold',
              },
            },
            lodging: {
              minZoom: 14,
              priority: 75,
              marker: {
                color: '#C54D9B',
                radius: zoom.linear([
                  [14, 2.5],
                  [17, 4.5],
                ]),
                strokeColor: '#FFFFFF',
                strokeWidth: 1.5,
              },
              text: {color: '#738B9A', haloColor: '#FFFFFF', haloWidth: 1.5},
            },
            education: {
              minZoom: 14.5,
              priority: 65,
              text: {color: '#6D8493', haloColor: '#FFFFFF', haloWidth: 1.5},
            },
            health: {
              minZoom: 15,
              priority: 70,
              text: {color: '#8C7387', haloColor: '#FFFFFF', haloWidth: 1.5},
            },
            shopping: {
              minZoom: 15,
              priority: 55,
              marker: {
                color: '#2B79D0',
                radius: zoom.linear([
                  [15, 2.5],
                  [17, 4],
                ]),
                strokeColor: '#FFFFFF',
                strokeWidth: 1.25,
              },
              text: {color: '#2B79D0', haloColor: '#FFFFFF', haloWidth: 1.4},
            },
            services: {
              minZoom: 15.5,
              priority: 55,
              text: {color: '#607887', haloColor: '#FFFFFF', haloWidth: 1.4},
            },
            food: {
              minZoom: 15.5,
              priority: 50,
              marker: {
                color: '#D46B2C',
                radius: zoom.linear([
                  [15.5, 2.5],
                  [17, 4],
                ]),
                strokeColor: '#FFFFFF',
                strokeWidth: 1.25,
              },
              text: {color: '#B45C25', haloColor: '#FFFFFF', haloWidth: 1.4},
            },
            coffee: {
              minZoom: 17,
              priority: 40,
              text: {color: '#A8612D', haloColor: '#FFFFFF', haloWidth: 1.4},
            },
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
    'madrid-center': {
      map: 'editorial-city',
      camera: {
        type: 'center',
        center: [-3.7038, 40.4168],
        zoom: 14.25,
      },
      viewport: {
        width: 1440,
        height: 900,
        dpr: 1,
      },
    },
    'madrid-sol-close': {
      map: 'editorial-city',
      camera: {
        type: 'center',
        center: [-3.70379, 40.41695],
        zoom: 16.5,
      },
      viewport: {
        width: 1440,
        height: 900,
        dpr: 1,
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
