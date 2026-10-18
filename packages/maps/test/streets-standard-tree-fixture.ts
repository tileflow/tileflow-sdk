/**
 * Independent, dated observations from the official Standard playground.
 * Values and screenshot digests come from captured pixels, never Streets source.
 * Keep this evidence fixed when recalibrating authored tree materials.
 */
export const standardTreeReference = {
  capturedOn: '2026-10-18',
  timezone: 'Europe/Madrid',
  source: 'https://docs.mapbox.com/playground/standard-style/',
  style: 'mapbox://styles/mapbox/standard',
  camera: {
    zoom: 19.16,
    center: [-3.71106, 40.4004],
    bearing: 21.6,
    pitch: 60,
  },
  screenshot: {
    width: 1975,
    height: 1377,
    format: 'jpeg',
  },
  configuration: {
    show3dObjects: true,
    show3dTrees: true,
    show3dBuildings: true,
    showPointOfInterestLabels: false,
    showRoadLabels: false,
    showTransitLabels: false,
    showHdRoads: true,
  },
  sampling: {
    patches: {
      bark: [
        {
          id: 'foreground-left',
          center: [510, 1306],
          radius: [1, 2],
        },
        {
          id: 'foreground-round',
          center: [663, 1314],
          radius: [1, 2],
        },
        {
          id: 'foreground-small',
          center: [810, 1327],
          radius: [1, 2],
        },
        {
          id: 'foreground-middle',
          center: [962, 1324],
          radius: [1, 2],
        },
        {
          id: 'foreground-right',
          center: [1113, 1327],
          radius: [1, 2],
        },
        {
          id: 'right-street-near',
          center: [1413, 1191],
          radius: [1, 2],
        },
        {
          id: 'right-street-edge',
          center: [1552, 1206],
          radius: [1, 2],
        },
        {
          id: 'right-street-middle',
          center: [1358, 1030],
          radius: [1, 2],
        },
      ],
      crown: [
        {
          id: 'foreground-rounded-left',
          center: [380, 1241],
          radius: [2, 2],
        },
        {
          id: 'foreground-broadleaf-left',
          center: [523, 1246],
          radius: [2, 2],
        },
        {
          id: 'foreground-rounded-middle',
          center: [657, 1259],
          radius: [2, 2],
        },
        {
          id: 'foreground-rounded-cluster',
          center: [881, 1265],
          radius: [2, 2],
        },
        {
          id: 'foreground-rounded-right',
          center: [974, 1251],
          radius: [2, 2],
        },
        {
          id: 'foreground-broadleaf-right',
          center: [1130, 1233],
          radius: [2, 2],
        },
        {
          id: 'right-street-rounded-near',
          center: [1554, 1147],
          radius: [2, 2],
        },
        {
          id: 'right-street-rounded-middle',
          center: [1327, 851],
          radius: [2, 2],
        },
      ],
    },
    method:
      'Manually selected interior trunk and predominantly sunlit crown facets in default/day, reusing exactly the same coordinates in every lighting/palette combination. Take each patch median, then the median across patches.',
    jpegUncertaintyPerChannel: 2,
    limitation:
      'These are rendered display RGB observations, not authored material colors. Geometry, normal orientation, shadowing and model palette variation differ between renderers. They support broad material regression guards and browser comparisons; a passing unit test does not prove pixel equivalence.',
  },
  observations: {
    'default-dawn': {
      sha256: 'd5419789c1bfda67c8fc3f647a8aa5264233fc3901fb409fe5ece1eb14081542',
      bark: {
        median: [153, 152, 123],
        min: [147, 147, 115],
        max: [166, 163, 134],
      },
      crown: {
        median: [156, 178, 134],
        min: [151, 166, 123],
        max: [188, 202, 149],
      },
    },
    'default-day': {
      sha256: '2aa97f3205d4b0beb09b96b470dd9b06c7b02818c739472ce8d25e610367dc5f',
      bark: {
        median: [163, 173, 150],
        min: [158, 171, 138],
        max: [172, 177, 161],
      },
      crown: {
        median: [170, 202, 166],
        min: [158, 197, 150],
        max: [177, 211, 178],
      },
    },
    'default-dusk': {
      sha256: '452ac6fee7b4cb242d8b5aa356dac1f4d35f2921e2175e1020124702dacbf5e5',
      bark: {
        median: [78, 71, 64],
        min: [57, 53, 54],
        max: [83, 76, 69],
      },
      crown: {
        median: [73, 79, 65],
        min: [50, 58, 61],
        max: [87, 89, 75],
      },
    },
    'default-night': {
      sha256: 'b088437049c088d33edf79788bd2e2d55e1dbacc98996a11db8f46e6d5a8d156',
      bark: {
        median: [14, 22, 31],
        min: [9, 15, 28],
        max: [23, 27, 35],
      },
      crown: {
        median: [26, 36, 42],
        min: [22, 31, 36],
        max: [32, 41, 46],
      },
    },
    'faded-dawn': {
      sha256: 'c33b241277e04964ab1b1430fa851dec4e2427fd7a2fb867ed7fd48a4caf915a',
      bark: {
        median: [170, 171, 151],
        min: [165, 166, 143],
        max: [187, 188, 160],
      },
      crown: {
        median: [178, 198, 160],
        min: [170, 184, 156],
        max: [210, 227, 182],
      },
    },
    'faded-day': {
      sha256: '9404eee7d5d4b80139fb9d5333aa5b8f70247d63a1f04efa3c9204c810c7cbc5',
      bark: {
        median: [182, 188, 173],
        min: [177, 187, 163],
        max: [188, 191, 180],
      },
      crown: {
        median: [189, 214, 188],
        min: [182, 211, 176],
        max: [198, 224, 197],
      },
    },
    'faded-dusk': {
      sha256: '7b7e5ab980c95673a8a63f77e5f52256c5e0d8fb36762c8bc1dcc47f6021b112',
      bark: {
        median: [99, 100, 94],
        min: [82, 82, 84],
        max: [102, 103, 103],
      },
      crown: {
        median: [97, 106, 98],
        min: [74, 88, 91],
        max: [109, 117, 106],
      },
    },
    'faded-night': {
      sha256: '573cb715f1669406e67c3735639f72842ed10f1f993325b17aabedbff91d3805',
      bark: {
        median: [29, 36, 54],
        min: [20, 27, 47],
        max: [40, 48, 60],
      },
      crown: {
        median: [46, 58, 68],
        min: [38, 51, 60],
        max: [54, 69, 76],
      },
    },
    'monochrome-dawn': {
      sha256: 'aa47d9566f7aa6027218be9bfb3e2ff242f3aebd1a75e68294f0baff383649a5',
      bark: {
        median: [168, 168, 168],
        min: [166, 166, 166],
        max: [179, 179, 179],
      },
      crown: {
        median: [193, 193, 193],
        min: [178, 178, 178],
        max: [211, 211, 211],
      },
    },
    'monochrome-day': {
      sha256: '1a532b01c3382d665c17c0c7637e43c172bd1a67c3ad003f05e4c871cebc0ce3',
      bark: {
        median: [190, 190, 190],
        min: [188, 188, 188],
        max: [194, 194, 194],
      },
      crown: {
        median: [212, 212, 212],
        min: [209, 209, 209],
        max: [220, 220, 220],
      },
    },
    'monochrome-dusk': {
      sha256: '580ab8af8595695bcf82e637ed039129574bf59763fd490c04e7cd78fe70ef68',
      bark: {
        median: [50, 50, 50],
        min: [47, 47, 47],
        max: [53, 53, 53],
      },
      crown: {
        median: [62, 62, 62],
        min: [60, 60, 60],
        max: [67, 67, 67],
      },
    },
    'monochrome-night': {
      sha256: 'ac0a5ff7a4c61b434bcdc43684b969bf90bd58fc4ee56af64857b430d1a216f2',
      bark: {
        median: [11, 11, 11],
        min: [7, 7, 7],
        max: [16, 16, 16],
      },
      crown: {
        median: [20, 20, 20],
        min: [17, 17, 17],
        max: [23, 23, 23],
      },
    },
  },
} as const;
