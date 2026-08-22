import {
  boundaries,
  buildings,
  defineTileflow,
  labels,
  land,
  openMapTiles,
  poi,
  roads,
  streets,
  type TileflowSymbolStyle,
  transit,
  vectorTiles,
  water,
  zoom,
} from '@tileflow/core';

const developmentTilesRevision = 'dev-spain-v8-20260818';
const developmentTilesAttribution =
  '© OpenMapTiles, © OpenStreetMap contributors, © ESA WorldCover, © Overture Maps Foundation';

const roadLabel = {
  placement: 'line',
  spacing: 260,
  text: {
    color: '#6E7D84',
    haloColor: '#F7F9F9',
    haloWidth: 1.4,
    size: zoom.linear([
      [12, 11],
      [16, 14],
    ]),
  },
} as const satisfies TileflowSymbolStyle;

export default defineTileflow({
  themes: {
    uber: {
      extends: 'light',
      mode: 'light',
      colors: {
        background: '#EDF1F2',
        land: '#EDF1F2',
        water: '#A9D0E5',
        park: '#A8DA7D',
        building: '#E2E7E9',
        road: '#FFFFFF',
        roadMajor: '#F4D66F',
        roadCasing: '#CFD8DC',
        boundary: '#CED7DA',
        text: '#566970',
        textMuted: '#7D8D93',
        textHalo: '#F7F9F9',
      },
      modules: {
        buildings: {
          fill: '#E2E7E9',
          outline: '#D4DCDF',
        },
        hydro: {
          label: '#638DA4',
          water: '#A9D0E5',
          waterway: '#91BED5',
        },
        labels: {
          country: '#566970',
          halo: '#F7F9F9',
          muted: '#84939A',
          neighborhood: '#738991',
          poi: '#657980',
          primary: '#566970',
          road: '#6E7D84',
          settlement: '#566970',
          water: '#638DA4',
        },
        landcover: {
          grass: '#B4E18C',
          ice: '#F8FAFA',
          park: '#A8DA7D',
          protected: '#B8E092',
          sand: '#F1E8C8',
          wood: '#A9D784',
        },
        landuse: {
          cemetery: '#C3DFAD',
          civic: '#E7ECEE',
          commercial: '#EAEDEF',
          industrial: '#E4E8EA',
          residential: '#EDF1F2',
        },
        poi: {
          label: '#657980',
        },
        roads: {
          bridge: '#FFFFFF',
          casing: '#CFD8DC',
          minor: '#FFFFFF',
          motorway: '#F4D66F',
          path: '#D7E0E2',
          primary: '#FFFFFF',
          rail: '#C4CED2',
          secondary: '#FFFFFF',
          trunk: '#F4D66F',
          tunnel: '#E2E8EA',
        },
      },
      typography: {
        font: 'Noto Sans',
        weight: 'regular',
        places: {weight: 'regular'},
        roads: {weight: 'regular'},
      },
    },
  },
  maps: {
    uber: {
      name: 'Tileflow Uber-inspired Streets',
      basemap: streets({variant: 'light'}),
      data: vectorTiles({
        attribution: developmentTilesAttribution,
        revision: developmentTilesRevision,
        schema: openMapTiles(),
        url: `https://dev-tiles.tileflow.dev/tiles/dev/tiles.json?archiveVersion=${developmentTilesRevision}`,
      }),
      theme: 'uber',
      modules: {
        boundaries: boundaries({enabled: false}),
        buildings: buildings({
          mode: 'flat',
          flat: {
            fill: {color: '#E2E7E9', minZoom: 12, opacity: 0.72},
            outline: {color: '#D4DCDF', minZoom: 14, opacity: 0.48, width: 0.6},
          },
        }),
        labels: labels({
          junctions: false,
          language: 'en',
          places: 'all',
          roads: 'all',
          shields: 'major',
          water: 'all',
          styles: {
            places: {
              city: {
                text: {
                  color: '#53666D',
                  haloColor: '#F7F9F9',
                  haloWidth: 1.5,
                  size: zoom.linear([
                    [8, 13],
                    [14, 20],
                  ]),
                },
              },
              neighborhood: {
                text: {
                  color: '#748A92',
                  haloColor: '#F7F9F9',
                  haloWidth: 1.25,
                  letterSpacing: 0.08,
                  size: zoom.linear([
                    [12, 10],
                    [16, 15],
                  ]),
                  transform: 'uppercase',
                },
              },
            },
            roads: {
              motorway: roadLabel,
              trunk: roadLabel,
              primary: roadLabel,
              secondary: roadLabel,
              tertiary: roadLabel,
              minor: roadLabel,
              service: {...roadLabel, minZoom: 14},
            },
            shields: {
              default: {
                minZoom: 10,
                placement: 'line',
                spacing: 340,
                text: {
                  color: '#53666D',
                  haloColor: '#F7F9F9',
                  haloWidth: 1.6,
                  padding: 3,
                  size: 9,
                  weight: 'bold',
                },
              },
            },
          },
        }),
        land: land({
          background: {color: '#EDF1F2', opacity: 1},
          landcover: {
            grass: {fill: {color: '#B4E18C', opacity: 0.92}},
            park: {fill: {color: '#A8DA7D', opacity: 0.94}},
            protected: {fill: {color: '#B8E092', opacity: 0.9}},
            scrub: {fill: {color: '#C5E3AA', opacity: 0.88}},
            wood: {fill: {color: '#A9D784', opacity: 0.92}},
          },
          landuse: {
            civic: {fill: {color: '#E7ECEE', opacity: 0.82}},
            commercial: {fill: {color: '#EAEDEF', opacity: 0.82}},
            industrial: {fill: {color: '#E4E8EA', opacity: 0.84}},
            railway: {fill: {color: '#E5E9EB', opacity: 0.82}},
            residential: {fill: {color: '#EDF1F2', opacity: 1}},
          },
        }),
        poi: poi({
          categories: ['culture', 'education', 'food', 'health', 'services', 'shopping', 'transit'],
          color: 'uniform',
          density: 'dense',
          icons: false,
          labels: 'full',
          minZoom: 12,
          placement: {coupleIconAndLabel: false, textPadding: 4},
        }),
        roads: roads({
          detail: 'all',
          extras: {paths: true},
          hierarchy: 'subtle',
          modifiers: {
            expressway: {widthScale: 1.06},
            ramp: {widthScale: 0.72},
            unpaved: {
              surface: {
                casing: {dash: [2, 1], opacity: 0.5},
                fill: {dash: [2, 1], opacity: 0.64},
              },
            },
          },
          oneWayMarkers: false,
          outline: 'strong',
          restrictions: {
            access: {
              surface: {
                casing: {dash: [1.5, 1], opacity: 0.42},
                fill: {dash: [1.5, 1], opacity: 0.5},
              },
            },
          },
          serviceTypes: {
            alley: {widthScale: 0.8},
            driveway: {widthScale: 0.72},
            parkingAisle: {widthScale: 0.6},
          },
          weight: 'regular',
          widthScale: {
            motorway: 1.08,
            trunk: 1.04,
            primary: 1,
            secondary: 0.95,
            tertiary: 0.92,
            minor: 0.9,
            service: 0.82,
          },
        }),
        transit: transit({
          rail: {
            bridge: {color: '#B8C4C8', minZoom: 10, opacity: 0.44, width: 0.8},
            surface: {color: '#B8C4C8', minZoom: 10, opacity: 0.44, width: 0.8},
            tunnel: {color: '#B8C4C8', minZoom: 10, opacity: 0.25, width: 0.8},
          },
          railHatching: {
            bridge: {
              color: '#F6F8F8',
              dash: [1, 2],
              minZoom: 12,
              opacity: 0.8,
              width: 0.4,
            },
            surface: {
              color: '#F6F8F8',
              dash: [1, 2],
              minZoom: 12,
              opacity: 0.8,
              width: 0.4,
            },
            tunnel: {visible: false},
          },
          serviceRail: {
            bridge: {color: '#C4CED2', minZoom: 13, opacity: 0.36, width: 0.6},
            surface: {color: '#C4CED2', minZoom: 13, opacity: 0.36, width: 0.6},
            tunnel: {visible: false},
          },
        }),
        water: water({
          bodies: {fill: {color: '#A9D0E5', opacity: 1}},
          waterways: {
            canal: {color: '#91BED5', opacity: 0.9, width: 1},
            river: {color: '#91BED5', opacity: 0.9, width: 1.5},
            stream: {color: '#91BED5', opacity: 0.82, width: 0.8},
          },
        }),
      },
      view: {
        center: [-118.326, 34.057],
        zoom: 11.4,
      },
    },
  },
  scenes: {
    'uber-la': {
      map: 'uber',
      camera: {
        type: 'center',
        center: [-118.326, 34.057],
        zoom: 11.4,
      },
      viewport: {width: 800, height: 612, dpr: 1},
      target: {kind: 'application', path: '/la', captureId: 'uber-la', frame: 'viewport'},
    },
    'uber-nyc': {
      map: 'uber',
      camera: {
        type: 'center',
        center: [-73.963, 40.762],
        zoom: 12.45,
      },
      viewport: {width: 725, height: 638, dpr: 1},
      target: {kind: 'application', path: '/nyc', captureId: 'uber-nyc', frame: 'viewport'},
    },
  },
});
