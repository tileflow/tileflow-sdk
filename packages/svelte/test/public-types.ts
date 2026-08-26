import type {TileflowAnnotation} from '@tileflow/interactions';
import TileflowMap, {
  TileflowMap as NamedTileflowMap,
  type TileflowMapInteractionSnippet,
  type TileflowMapMarkerSnippet,
  type TileflowMapProps,
} from '../src/index.js';

const mapStyle = {layers: [], name: 'Direct', sources: {}, version: 8 as const};

const validProps = [
  {source: {kind: 'tileflow', map: 'main'}},
  {
    source: {
      kind: 'tileflow',
      manifestUrl: 'https://cdn.example.test/manifest.json',
      map: 'main',
    },
  },
  {source: {kind: 'maplibre', style: mapStyle}},
  {source: {kind: 'maplibre', style: '/styles/main.json'}},
  {
    imageUrl: 'https://cdn.example.test/map.png',
    mode: 'image',
    source: {kind: 'tileflow', map: 'main'},
  },
] satisfies TileflowMapProps[];

// @ts-expect-error every map has one explicit delivery source.
const missingSource: TileflowMapProps = {};
// @ts-expect-error legacy top-level map is not a source.
const legacyMap: TileflowMapProps = {map: 'main'};
// @ts-expect-error config compilation is not available in browser wrappers.
const legacyConfig: TileflowMapProps = {config: {}};
const mixedSource: TileflowMapProps = {
  // @ts-expect-error source branches cannot be combined.
  source: {kind: 'maplibre', map: 'main', style: mapStyle},
};

type PropertyAnnotation = TileflowAnnotation<{name: string}>;
declare const markerSnippet: TileflowMapMarkerSnippet<PropertyAnnotation>;
declare const overlaySnippet: TileflowMapInteractionSnippet<PropertyAnnotation>;

const interactionProps = {
  annotations: [
    {
      ariaLabel: 'Madrid',
      coordinate: [-3.7, 40.4],
      data: {name: 'Madrid'},
      id: 'madrid',
      kind: 'marker',
      popup: {content: {kind: 'view', name: 'city-card'}},
    },
  ],
  defaultInteractionState: {popup: null},
  interactions: [
    {
      id: 'poi-details',
      popup: {content: {kind: 'view', name: 'poi-card'}},
      target: {domain: 'poi', kind: 'semantic-feature'},
    },
  ],
  marker: markerSnippet,
  onInteractionEvent(event) {
    if (event.target.kind === 'annotation') void event.target.annotation.data?.name;
  },
  onInteractionStateChange(state) {
    void state.popup;
  },
  popup: overlaySnippet,
  source: {kind: 'tileflow', map: 'main'},
  tooltip: overlaySnippet,
} satisfies TileflowMapProps<PropertyAnnotation>;

// @ts-expect-error annotations and legacy markers are mutually exclusive.
const mixedAnnotations: TileflowMapProps = {
  annotations: [],
  markers: [],
  source: {kind: 'tileflow', map: 'main'},
};

// @ts-expect-error controlled and default interaction states are mutually exclusive.
const mixedInteractionState: TileflowMapProps = {
  defaultInteractionState: {popup: null},
  interactionState: {popup: null},
  source: {kind: 'tileflow', map: 'main'},
};

// @ts-expect-error image mode excludes live annotations.
const imageAnnotations: TileflowMapProps = {
  annotations: [],
  mode: 'image',
  source: {kind: 'tileflow', map: 'main'},
};

// @ts-expect-error image mode excludes semantic interactions.
const imageInteractions: TileflowMapProps = {
  interactions: [],
  mode: 'image',
  source: {kind: 'tileflow', map: 'main'},
};

// @ts-expect-error image mode excludes interaction state.
const imageInteractionState: TileflowMapProps = {
  interactionState: {popup: null},
  mode: 'image',
  source: {kind: 'tileflow', map: 'main'},
};

// @ts-expect-error image mode excludes custom interaction snippets.
const imageSnippet: TileflowMapProps<PropertyAnnotation> = {
  mode: 'image',
  popup: overlaySnippet,
  source: {kind: 'tileflow', map: 'main'},
};

// @ts-expect-error image mode excludes interaction callbacks.
const imageCallback: TileflowMapProps = {
  mode: 'image',
  onInteractionDiagnostic: (_diagnostic: unknown) => undefined,
  source: {kind: 'tileflow', map: 'main'},
};

const namedComponent: typeof TileflowMap = NamedTileflowMap;

void [
  validProps,
  missingSource,
  legacyMap,
  legacyConfig,
  mixedSource,
  interactionProps,
  mixedAnnotations,
  mixedInteractionState,
  imageAnnotations,
  imageInteractions,
  imageInteractionState,
  imageSnippet,
  imageCallback,
  namedComponent,
];
