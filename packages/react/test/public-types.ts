import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';
import {
  configureTileflowMapLibre,
  Map,
  type MapProps,
  type TileflowMapLibreConfiguration,
} from '../src/index';

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
  {mode: 'image', imageUrl: '/maps/main.png', source},
] satisfies MapProps[];

// @ts-expect-error every map has one explicit delivery source.
const missingSource: MapProps = {};
// @ts-expect-error top-level map is not a source.
const flattenedMap: MapProps = {map: 'main'};
// @ts-expect-error config compilation is not available in browser bindings.
const configInput: MapProps = {config: {}};
const rendererInput: MapProps = {
  // @ts-expect-error Renderer style input is not a Tileflow source.
  source: {map: 'main', style: '/style.json'},
};
const discriminatorInput: MapProps = {
  // @ts-expect-error A Tileflow source has no renderer discriminator.
  source: {map: 'main', kind: 'tileflow'},
};

const component: typeof Map = Map;

type Property = {price: number; title: string};

function PropertyCard({close, property}: {close: () => void; property: Property}) {
  void close;
  return property.title;
}

const propertyAnnotations = [
  {
    ariaLabel: 'Apartment in Madrid',
    coordinate: [-3.7, 40.4] as const,
    data: {price: 320_000, title: 'Apartment in Madrid'},
    id: 'property-42',
    kind: 'marker' as const,
    popup: {content: {kind: 'view' as const, name: 'property-card'}},
  },
] satisfies readonly TileflowAnnotation<Property>[];

const interactionState: TileflowInteractionState = {popup: null};
const poiInteractions = [
  {
    id: 'poi-card',
    popup: {content: {kind: 'view' as const, name: 'poi-card'}},
    target: {domain: 'poi', kind: 'semantic-feature' as const},
    tooltip: {content: {field: 'name', kind: 'field' as const}},
  },
] as const;
const annotationOnlyProps = {
  annotations: propertyAnnotations,
  renderPopup: ({annotation, close}) => PropertyCard({close, property: annotation.data}),
  source,
} satisfies MapProps<(typeof propertyAnnotations)[number]>;
const annotatedProps = {
  annotations: propertyAnnotations,
  interactionState,
  interactions: poiInteractions,
  onInteractionDiagnostic(diagnostic) {
    const code: string = diagnostic.code;
    void code;
  },
  onInteractionEvent(event) {
    if (event.target.kind === 'annotation') {
      const price: number = event.target.annotation.data.price;
      void price;
    } else if (event.target.kind === 'semantic-feature') {
      const name = event.target.feature.properties.name;
      void name;
    }
  },
  onInteractionStateChange(nextState) {
    const popup = nextState.popup;
    void popup;
  },
  renderMarker({annotation}) {
    const price: number = annotation.data.price;
    return price.toLocaleString();
  },
  renderPopup(context) {
    if ('annotation' in context) {
      const title: string = context.annotation.data.title;
      return title;
    }
    if (context.target.kind === 'semantic-feature') {
      return String(context.target.feature.properties.name ?? context.viewName ?? 'POI');
    }
    return null;
  },
  renderTooltip(context) {
    return context.target.kind === 'semantic-feature'
      ? String(context.target.feature.properties.name ?? '')
      : null;
  },
  source,
} satisfies MapProps<(typeof propertyAnnotations)[number]>;

const semanticRequiresGeneralContext = {
  annotations: propertyAnnotations,
  interactions: poiInteractions,
  // @ts-expect-error semantic bindings require narrowing the general interaction context.
  renderPopup: ({annotation}) => annotation.data.title,
  source,
} satisfies MapProps<(typeof propertyAnnotations)[number]>;

// @ts-expect-error controlled and uncontrolled interaction state are mutually exclusive.
const mixedInteractionStateInputs: MapProps = {
  defaultInteractionState: interactionState,
  interactionState,
  source,
};

// @ts-expect-error image mode cannot mount annotation interactions.
const imageAnnotations: MapProps = {
  annotations: propertyAnnotations,
  mode: 'image',
  source,
};

// @ts-expect-error image mode cannot mount semantic interactions.
const imageInteractions: MapProps = {
  interactions: poiInteractions,
  mode: 'image',
  source,
};

// @ts-expect-error image mode cannot expose interaction state or render callbacks.
const imageInteractionState: MapProps = {
  interactionState,
  mode: 'image',
  renderPopup: () => null,
  source,
};

void [
  annotatedProps, annotationOnlyProps, validProps, missingSource, flattenedMap, configInput,
  rendererInput, discriminatorInput, component, mixedInteractionStateInputs, imageAnnotations,
  imageInteractions, imageInteractionState, semanticRequiresGeneralContext,
];
