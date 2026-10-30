// Independent public Standard reference: evaluated from the dated style and its LUTs,
// never imported by runtime themes. Colors retain trilinear LUT precision.
// Full derivation: .tileflow/captures/standard-lighting-2026-10-18/reference-lighting.json
export const standardLightingReference = {
  source: 'https://api.mapbox.com/styles/v1/mapbox/standard',
  retrievedAt: '2026-10-17T22:53:41.963947+00:00',
  styleModified: '2026-10-08T14:57:51.547Z',
  styleJsonSha256: '478b22c5c3af8931ef13eae5674149b6dbb9d5552dc75c2d52a344535c565346',
  renderer: {
    library: 'Mapbox GL JS',
    version: '3.28.1',
    commit: '29a082c40985763b038163d555f9305cb39233ad',
    versionSource: 'https://docs.mapbox.com/playground/assets/js/mapboxgl.f299101b.js',
  },
  directionSemantics: '[azimuthDegreesClockwiseFromNorth, polarDegreesFromZenith]',
  evaluatedAtZoom: 19.16,
  minimumZoomForTheseValues: 14,
  lut: {
    faded: {
      pngSha256: '7a8e413cd93a9c29a85f47e582ab8a67cf650ebbe3bf70a3cbdf52a6de837981',
      width: 1024,
      height: 32,
      blackRGB: [0, 0, 0],
    },
    monochrome: {
      pngSha256: '53bfe53cf4df60fc8723278ef37e9014efa5a2de679cebc22797523ef104d9ba',
      width: 1024,
      height: 32,
      blackRGB: [53, 53, 53],
    },
  },
  lights: {
    'default-dawn': {
      direction: [120, 50],
      directional: {
        rawColor: 'hsl(33, 98%, 77%)',
        rgb: [254.0, 202.0, 139.0],
        intensity: 0.5,
      },
      ambient: {
        rawColor: 'hsl(28, 98%, 93%)',
        rgb: [255.0, 236.0, 220.0],
        intensity: 0.75,
      },
      shadowIntensity: 1,
    },
    'default-day': {
      direction: [180, 20],
      directional: {
        rawColor: 'hsl(0, 0%, 100%)',
        rgb: [255.0, 255.0, 255.0],
        intensity: 0.2,
      },
      ambient: {
        rawColor: 'hsl(0, 0%, 100%)',
        rgb: [255.0, 255.0, 255.0],
        intensity: 0.8,
      },
      shadowIntensity: 1,
    },
    'default-dusk': {
      direction: [240, 80],
      directional: {
        rawColor: 'hsl(30, 98%, 76%)',
        rgb: [254.0, 194.0, 134.0],
        intensity: 0.2,
      },
      ambient: {
        rawColor: 'hsl(228, 27%, 29%)',
        rgb: [54.0, 62.0, 94.0],
        intensity: 0.8,
      },
      shadowIntensity: 0.85,
    },
    'default-night': {
      direction: [270, 20],
      directional: {
        rawColor: 'hsl(225, 15%, 29%)',
        rgb: [63.0, 68.0, 85.0],
        intensity: 0.5,
      },
      ambient: {
        rawColor: 'hsl(217, 100%, 11%)',
        rgb: [0.0, 22.0, 56.0],
        intensity: 0.5,
      },
      shadowIntensity: 0.5,
    },
    'faded-dawn': {
      direction: [120, 50],
      directional: {
        rawColor: 'hsl(33, 98%, 77%)',
        rgb: [252.513725, 222.937729, 169.273879],
        intensity: 0.5,
      },
      ambient: {
        rawColor: 'hsl(28, 98%, 93%)',
        rgb: [254.0, 244.681815, 235.980392],
        intensity: 0.75,
      },
      shadowIntensity: 1,
    },
    'faded-day': {
      direction: [180, 20],
      directional: {
        rawColor: 'hsl(0, 0%, 100%)',
        rgb: [255.0, 255.0, 255.0],
        intensity: 0.2,
      },
      ambient: {
        rawColor: 'hsl(0, 0%, 100%)',
        rgb: [255.0, 255.0, 255.0],
        intensity: 0.8,
      },
      shadowIntensity: 1,
    },
    'faded-dusk': {
      direction: [240, 80],
      directional: {
        rawColor: 'hsl(30, 98%, 76%)',
        rgb: [252.513725, 217.250027, 164.945083],
        intensity: 0.2,
      },
      ambient: {
        rawColor: 'hsl(228, 27%, 29%)',
        rgb: [87.776471, 97.427724, 126.419608],
        intensity: 0.8,
      },
      shadowIntensity: 0.85,
    },
    'faded-night': {
      direction: [270, 20],
      directional: {
        rawColor: 'hsl(225, 15%, 29%)',
        rgb: [97.815686, 102.955556, 118.333333],
        intensity: 0.5,
      },
      ambient: {
        rawColor: 'hsl(217, 100%, 11%)',
        rgb: [2.0, 38.117647, 86.886275],
        intensity: 0.5,
      },
      shadowIntensity: 0.5,
    },
    'monochrome-dawn': {
      direction: [120, 40],
      directional: {
        rawColor: 'hsl(33, 98%, 77%)',
        rgb: [226.147143, 226.147143, 226.147143],
        intensity: 0.35,
      },
      ambient: {
        rawColor: 'hsl(28, 98%, 93%)',
        rgb: [245.703576, 245.703576, 245.703576],
        intensity: 0.75,
      },
      shadowIntensity: 1,
    },
    'monochrome-day': {
      direction: [180, 20],
      directional: {
        rawColor: 'hsl(0, 0%, 100%)',
        rgb: [255.0, 255.0, 255.0],
        intensity: 0.2,
      },
      ambient: {
        rawColor: 'hsl(0, 0%, 100%)',
        rgb: [255.0, 255.0, 255.0],
        intensity: 0.85,
      },
      shadowIntensity: 1,
    },
    'monochrome-dusk': {
      direction: [240, 30],
      directional: {
        rawColor: 'hsl(30, 0%, 50%)',
        rgb: [163.817309, 163.817309, 163.817309],
        intensity: 0.15,
      },
      ambient: {
        rawColor: 'hsl(228, 27%, 29%)',
        rgb: [126.294118, 126.294118, 126.294118],
        intensity: 0.1,
      },
      shadowIntensity: 0.85,
    },
    'monochrome-night': {
      direction: [270, 20],
      directional: {
        rawColor: 'hsl(0, 0%, 0%)',
        rgb: [53.0, 53.0, 53.0],
        intensity: 0.25,
      },
      ambient: {
        rawColor: 'hsl(217, 100%, 0%)',
        rgb: [53.0, 53.0, 53.0],
        intensity: 0,
      },
      shadowIntensity: 0.5,
    },
  },
} as const;
