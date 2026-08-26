import type {TileflowAnnotation, TileflowInteractionState} from '@tileflow/interactions';
import {Map, type MapProps} from '../src/index';

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
  {mode: 'image', imageUrl: '/maps/main.png', source: {kind: 'maplibre', style: mapStyle}},
] satisfies MapProps[];

// @ts-expect-error every map has one explicit delivery source.
const missingSource: MapProps = {};
// @ts-expect-error legacy top-level map is not a source.
const legacyMap: MapProps = {map: 'main'};
// @ts-expect-error config compilation is not available in browser wrappers.
const legacyConfig: MapProps = {config: {}};
const mixedSource: MapProps = {
  // @ts-expect-error source branches cannot be combined.
  source: {kind: 'maplibre', map: 'main', style: mapStyle},
};

const component: typeof Map = Map;

type Property = {
  price: number;
  title: string;
};

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
  source: {kind: 'maplibre' as const, style: mapStyle},
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
  source: {kind: 'maplibre' as const, style: mapStyle},
} satisfies MapProps<(typeof propertyAnnotations)[number]>;

const semanticRequiresGeneralContext = {
  annotations: propertyAnnotations,
  interactions: poiInteractions,
  // @ts-expect-error semantic bindings require narrowing the general interaction context.
  renderPopup: ({annotation}) => annotation.data.title,
  source: {kind: 'maplibre' as const, style: mapStyle},
} satisfies MapProps<(typeof propertyAnnotations)[number]>;

// @ts-expect-error annotations and legacy markers are mutually exclusive.
const mixedAnnotationInputs: MapProps = {
  annotations: propertyAnnotations,
  markers: [{coordinates: [-3.7, 40.4] as [number, number], id: 'legacy-madrid'}],
  source: {kind: 'maplibre', style: mapStyle},
};

// @ts-expect-error controlled and uncontrolled interaction state are mutually exclusive.
const mixedInteractionStateInputs: MapProps = {
  defaultInteractionState: interactionState,
  interactionState,
  source: {kind: 'maplibre', style: mapStyle},
};

// @ts-expect-error image mode cannot mount annotation interactions.
const imageAnnotations: MapProps = {
  annotations: propertyAnnotations,
  mode: 'image',
  source: {kind: 'maplibre', style: mapStyle},
};

// @ts-expect-error image mode cannot mount semantic interactions.
const imageInteractions: MapProps = {
  interactions: poiInteractions,
  mode: 'image',
  source: {kind: 'maplibre', style: mapStyle},
};

// @ts-expect-error image mode cannot expose interaction state or render callbacks.
const imageInteractionState: MapProps = {
  interactionState,
  mode: 'image',
  renderPopup: () => null,
  source: {kind: 'maplibre', style: mapStyle},
};

void [
  annotatedProps,
  annotationOnlyProps,
  validProps,
  missingSource,
  legacyMap,
  legacyConfig,
  mixedSource,
  component,
  mixedAnnotationInputs,
  mixedInteractionStateInputs,
  imageAnnotations,
  imageInteractions,
  imageInteractionState,
  semanticRequiresGeneralContext,
];
