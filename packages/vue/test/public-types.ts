import type {
  TileflowAnnotation,
  TileflowInteractionBinding,
  TileflowInteractionEvent,
  TileflowInteractionState,
} from '@tileflow/interactions';
import {TileflowMap, type TileflowMapProps, type TileflowMapSlots} from '../src/index.js';

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

type ComponentProps = InstanceType<typeof TileflowMap>['$props'];
const componentProps: ComponentProps = {
  source: {kind: 'tileflow', map: 'main'},
};
// @ts-expect-error the exported Vue component preserves the source discriminant.
const invalidComponentProps: ComponentProps = {source: {kind: 'maplibre'}};

type Property = {address: string; price: number};
const propertyAnnotations = [
  {
    ariaLabel: 'Apartment in Madrid',
    coordinate: [-3.7, 40.4],
    data: {address: 'Calle Mayor', price: 320_000},
    id: 'property-42',
    kind: 'marker',
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] as const satisfies readonly TileflowAnnotation<Property>[];
type PropertyAnnotation = (typeof propertyAnnotations)[number];
const poiInteractions = [
  {
    id: 'poi-details',
    popup: {content: {kind: 'view', name: 'poi-card'}},
    target: {categories: ['food-drink'], domain: 'poi', kind: 'semantic-feature'},
    tooltip: {content: {field: 'name', fallback: 'Point of interest', kind: 'field'}},
  },
] as const satisfies readonly TileflowInteractionBinding[];
const PropertyTileflowMap = TileflowMap<PropertyAnnotation>;
type PropertyComponentProps = InstanceType<typeof PropertyTileflowMap>['$props'];

const interactionState: TileflowInteractionState = {popup: null};
const propertyMapProps = {
  annotations: propertyAnnotations,
  interactions: poiInteractions,
  interactionState,
  source: {kind: 'tileflow', map: 'main'},
} satisfies TileflowMapProps<PropertyAnnotation>;
const propertyComponentProps: PropertyComponentProps = propertyMapProps;

// @ts-expect-error controlled and default interaction state are mutually exclusive.
const mixedStateProps: TileflowMapProps = {
  defaultInteractionState: interactionState,
  interactionState,
  source: {kind: 'tileflow', map: 'main'},
};
// @ts-expect-error image mode cannot accept live interaction bindings.
const interactiveImageProps: TileflowMapProps = {
  interactions: poiInteractions,
  mode: 'image',
  source: {kind: 'tileflow', map: 'main'},
};
// @ts-expect-error the exported component instance preserves the strict image branch.
const invalidImageComponentProps: ComponentProps = {
  annotations: propertyAnnotations,
  mode: 'image',
  source: {kind: 'tileflow', map: 'main'},
};

const handleInteractionEvent = (event: TileflowInteractionEvent<PropertyAnnotation>) => {
  if (event.target.kind === 'annotation') {
    return event.target.annotation.data.price.toFixed(0);
  } else if (event.target.kind === 'semantic-feature') {
    return event.target.feature.properties.name;
  }
};

const propertySlots: TileflowMapSlots<PropertyAnnotation> = {
  marker: ({annotation}) => annotation.data.price.toFixed(0),
  popup: (context) => {
    if (!('annotation' in context)) return null;
    const {annotation, close} = context;
    annotation.data.address.toUpperCase();
    close();
    return null;
  },
};

void [
  validProps,
  missingSource,
  legacyMap,
  legacyConfig,
  mixedSource,
  mixedStateProps,
  componentProps,
  invalidComponentProps,
  invalidImageComponentProps,
  interactiveImageProps,
  handleInteractionEvent,
  poiInteractions,
  propertyMapProps,
  propertyComponentProps,
  propertySlots,
];
