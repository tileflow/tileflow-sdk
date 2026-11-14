import {readFileSync} from 'node:fs';

// Deliberately fixed placement and explicit pack entries: this is a renderer proof,
// not World placement or the production offline resource planner.
export function createTreeProofFixture(base) {
  if (process.env.TILEFLOW_TREE_PROOF !== '1') return undefined;
  const model = `${base}/base/${'a'.repeat(64)}/models/streets-tree-round-near`;
  const bytes = readFileSync(
    new URL(
      '../packages/maps/assets/streets/tree-models/models/streets-tree-round-near',
      import.meta.url,
    ),
  );
  const longitude = -3.7,
    latitude = 40.42;
  const coordinate = (east, north) => [
    longitude + east / (111319.4908 * Math.cos((latitude * Math.PI) / 180)),
    latitude + north / 111319.4908,
  ];
  const style = {
    version: 8,
    metadata: {'tileflow:colorScheme': 'light', 'tileflow:nativeDegradations': []},
    light: {anchor: 'map', position: [1.5, 210, 50], intensity: 0.4},
    sources: {
      building: {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                coordinate(-16, -12),
                coordinate(16, -12),
                coordinate(16, 12),
                coordinate(-16, 12),
                coordinate(-16, -12),
              ],
            ],
          },
        },
      },
    },
    layers: [
      {id: 'ground', type: 'background', paint: {'background-color': '#e9e6dd'}},
      {
        id: 'proof-building',
        type: 'fill-extrusion',
        source: 'building',
        paint: {
          'fill-extrusion-color': '#ad8070',
          'fill-extrusion-height': 18,
          'fill-extrusion-opacity': 1,
        },
      },
    ],
  };
  return {
    styles: {'tree-proof': style},
    model,
    entries: [{name: model, contentType: 'application/vnd.tileflow.tree-model', body: bytes}],
    body: (url) => (url === model ? bytes : null),
  };
}
