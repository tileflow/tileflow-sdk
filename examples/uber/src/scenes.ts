export type Coordinate = readonly [number, number];

export type RideVehicle = {
  bearing: number;
  coordinate: Coordinate;
  label?: {
    offset: readonly [number, number];
    text: string;
    tone?: 'blue' | 'dark';
  };
  scale?: number;
};

export type RideScene = {
  center: Coordinate;
  destination: {
    coordinate: Coordinate;
    kind: 'flag' | 'home';
  };
  id: 'uber-la' | 'uber-nyc';
  label: string;
  path: '/la' | '/nyc';
  pickup?: Coordinate;
  route: readonly Coordinate[];
  tripCard?: {
    coordinate: Coordinate;
    destination: string;
    minutes: number;
  };
  vehicles: readonly RideVehicle[];
  zoom: number;
};

export const rideScenes = [
  {
    id: 'uber-la',
    label: 'Los Angeles',
    path: '/la',
    center: [-118.326, 34.057],
    zoom: 11.4,
    route: [
      [-118.438, 34.075],
      [-118.413, 34.071],
      [-118.389, 34.065],
      [-118.364, 34.061],
      [-118.342, 34.052],
      [-118.326, 34.049],
      [-118.308, 34.04],
      [-118.283, 34.039],
    ],
    destination: {coordinate: [-118.283, 34.039], kind: 'flag'},
    vehicles: [
      {
        bearing: 58,
        coordinate: [-118.418, 34.031],
        label: {offset: [-2, -25], text: '2938'},
      },
      {
        bearing: 72,
        coordinate: [-118.408, 34.083],
        label: {offset: [-4, -26], text: '8309', tone: 'blue'},
      },
      {
        bearing: -15,
        coordinate: [-118.252, 34.097],
        label: {offset: [0, -25], text: '4146'},
      },
      {
        bearing: 17,
        coordinate: [-118.3, 34.006],
        label: {offset: [0, -25], text: '9304'},
      },
      {
        bearing: -18,
        coordinate: [-118.235, 34.026],
        label: {offset: [0, -25], text: '2030'},
      },
      {bearing: -55, coordinate: [-118.228, 34.067], scale: 0.9},
    ],
  },
  {
    id: 'uber-nyc',
    label: 'New York',
    path: '/nyc',
    center: [-73.963, 40.762],
    zoom: 12.45,
    route: [
      [-73.958, 40.785],
      [-73.954, 40.779],
      [-73.945, 40.773],
      [-73.942, 40.765],
      [-73.943, 40.759],
      [-73.949, 40.75],
      [-73.956, 40.742],
      [-73.967, 40.737],
      [-73.976, 40.745],
    ],
    destination: {coordinate: [-73.958, 40.785], kind: 'home'},
    pickup: [-73.976, 40.745],
    tripCard: {
      coordinate: [-73.958, 40.785],
      destination: 'Home',
      minutes: 4,
    },
    vehicles: [
      {bearing: 27, coordinate: [-73.962, 40.793]},
      {bearing: 27, coordinate: [-73.954, 40.79]},
      {bearing: 24, coordinate: [-73.947, 40.786]},
      {bearing: 29, coordinate: [-73.94, 40.794]},
      {bearing: -38, coordinate: [-73.962, 40.767], scale: 1.08},
      {bearing: 28, coordinate: [-73.956, 40.763]},
    ],
  },
] as const satisfies readonly RideScene[];

export function sceneFromPath(pathname: string): RideScene {
  return rideScenes.find((scene) => scene.path === pathname) ?? rideScenes[0];
}
