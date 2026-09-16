import type {TileflowAnnotation} from '@tileflow/interactions';
import TileflowMap, {
  configureTileflowMapLibre,
  TileflowMap as NamedTileflowMap,
  type TileflowMapAnnotationSnippet,
  type TileflowMapInteractionSnippet,
  type TileflowMapLibreConfiguration,
  type TileflowMapProps,
} from '../src/index.js';

const source = {map: 'main'};
const mapLibreConfiguration = {
  workerUrl: '/assets/maplibre-gl-worker.mjs',
} satisfies TileflowMapLibreConfiguration;
configureTileflowMapLibre(mapLibreConfiguration);
// @ts-expect-error workerUrl is required.
configureTileflowMapLibre({});

const validProps = [
  {source},
  {source: {manifestUrl: 'https://cdn.example.test/manifest.json', map: 'main'}},
  {source, theme: 'system'},
  {imageUrl: 'https://cdn.example.test/map.png', mode: 'image', source},
] satisfies TileflowMapProps[];

// @ts-expect-error every map has one explicit delivery source.
const missingSource: TileflowMapProps = {};
// @ts-expect-error top-level map is not a source.
const flattenedMap: TileflowMapProps = {map: 'main'};
// @ts-expect-error config compilation is not available in browser bindings.
const configInput: TileflowMapProps = {config: {}};
const rendererInput: TileflowMapProps = {
  // @ts-expect-error Renderer style input is not a Tileflow source.
  source: {map: 'main', style: '/style.json'},
};
const discriminatorInput: TileflowMapProps = {
  // @ts-expect-error A Tileflow source has no renderer discriminator.
  source: {map: 'main', kind: 'tileflow'},
};

type PropertyAnnotation = TileflowAnnotation<{name: string}>;
declare const markerSnippet: TileflowMapAnnotationSnippet<PropertyAnnotation>;
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
  source,
  tooltip: overlaySnippet,
} satisfies TileflowMapProps<PropertyAnnotation>;

// @ts-expect-error controlled and default interaction states are mutually exclusive.
const mixedInteractionState: TileflowMapProps = {
  defaultInteractionState: {popup: null},
  interactionState: {popup: null},
  source,
};

// @ts-expect-error image mode excludes live annotations.
const imageAnnotations: TileflowMapProps = {
  annotations: [],
  mode: 'image',
  source,
};

// @ts-expect-error image mode excludes semantic interactions.
const imageInteractions: TileflowMapProps = {
  interactions: [],
  mode: 'image',
  source,
};

// @ts-expect-error image mode excludes interaction state.
const imageInteractionState: TileflowMapProps = {
  interactionState: {popup: null},
  mode: 'image',
  source,
};

// @ts-expect-error image mode excludes custom interaction snippets.
const imageSnippet: TileflowMapProps<PropertyAnnotation> = {
  mode: 'image',
  popup: overlaySnippet,
  source,
};

// @ts-expect-error image mode excludes interaction callbacks.
const imageCallback: TileflowMapProps = {
  mode: 'image',
  onInteractionDiagnostic: (_diagnostic: unknown) => undefined,
  source,
};

const namedComponent: typeof TileflowMap = NamedTileflowMap;

void [
  validProps, missingSource, flattenedMap, configInput, rendererInput, discriminatorInput,
  interactionProps, mixedInteractionState, imageAnnotations, imageInteractions,
  imageInteractionState, imageSnippet, imageCallback, namedComponent,
];
