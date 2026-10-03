import type {TileflowInteractionBinding} from '@tileflow/interactions';
import type {
  NativePoiQueryOperation,
  NativePoiQueryRequest,
  NativePoiStyleLease,
} from '../src/native-interaction-poi';

export const touch = Object.freeze({
  inputModality: 'touch' as const,
  point: [10, 20] as const,
  coordinate: [1, 2] as const,
});
export const poiBinding: TileflowInteractionBinding = {
  id: 'places',
  target: {kind: 'semantic-feature', domain: 'poi'},
  popup: {content: {kind: 'field', field: 'feature.properties.name'}},
};
export function poiStyle() {
  const layers = [
    {
      layerId: 'food-label',
      source: 'world',
      sourceLayer: 'poi',
      category: 'food-drink',
      representation: 'label',
      priority: 30,
      anchor: 'pointer-coordinate',
    },
    {
      layerId: 'food-icon',
      source: 'world',
      sourceLayer: 'poi',
      category: 'food-drink',
      representation: 'icon',
      priority: 20,
      anchor: 'pointer-coordinate',
    },
    {
      layerId: 'hotel',
      source: 'world',
      sourceLayer: 'poi',
      category: 'lodging',
      representation: 'combined',
      priority: 10,
      anchor: 'pointer-coordinate',
    },
  ];
  return {
    version: 8,
    sources: {world: {type: 'vector'}},
    layers: [
      ...layers.map((layer) => ({
        id: layer.layerId,
        type: 'symbol',
        source: layer.source,
        'source-layer': layer.sourceLayer,
      })),
      {id: 'undeclared', type: 'symbol', source: 'world', 'source-layer': 'poi'},
    ],
    metadata: {
      'tileflow:interaction-manifest': {
        version: 2,
        domains: {
          poi: {
            fields: {
              category: 'category',
              filterRank: 'filter_rank',
              icon: 'icon',
              name: 'name',
              sizeRank: 'size_rank',
              type: 'type',
            },
            identity: 'maplibre-feature-id-if-present',
            deduplication: {
              identity: ['source', 'source-layer', 'feature-id'],
              representationPriority: ['combined', 'icon', 'label', 'marker'],
            },
            hitTesting: {frequency: 'animation-frame', order: 'rendered-topmost'},
            layers,
          },
        },
      },
    },
  };
}
export function poiFeature(
  id: unknown = 1,
  layer = 'food-icon',
  properties: unknown = {name: 'Cafe', category: 'food-drink'},
) {
  return {id, layer: {id: layer}, source: 'world', sourceLayer: 'poi', properties};
}
export function queryFixture(style: unknown = poiStyle()) {
  const requests: NativePoiQueryRequest[] = [];
  let current = true;
  let features: unknown = [];
  let implementation: ((request: NativePoiQueryRequest) => NativePoiQueryOperation) | undefined;
  let cancellations = 0;
  const lease: NativePoiStyleLease = {
    style,
    isCurrent: () => current,
    query(request) {
      requests.push(request);
      return implementation
        ? implementation(request)
        : {
            result: Promise.resolve({request, features}),
            cancel() {
              cancellations++;
            },
          };
    },
  };
  return {
    lease,
    requests,
    setFeatures(value: unknown) {
      features = value;
    },
    setQuery(value: (request: NativePoiQueryRequest) => NativePoiQueryOperation) {
      implementation = value;
    },
    retire() {
      current = false;
    },
    get cancellations() {
      return cancellations;
    },
  };
}
export function barrier<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}
