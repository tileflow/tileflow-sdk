import type {
  TileflowAnnotation,
  TileflowInteractionBinding,
  TileflowInteractionEvent,
  TileflowInteractionState,
} from '@tileflow/interactions';
import {
  configureTileflowMapLibre,
  TileflowMap,
  type TileflowMapLibreConfiguration,
  type TileflowMapProps,
  type TileflowMapSlots,
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

type ComponentProps = InstanceType<typeof TileflowMap>['$props'];
const componentProps: ComponentProps = {source};
// @ts-expect-error The exported Vue component has no renderer discriminator.
const invalidComponentProps: ComponentProps = {source: {map: 'main', kind: 'tileflow'}};

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
  source,
} satisfies TileflowMapProps<PropertyAnnotation>;
const propertyComponentProps: PropertyComponentProps = propertyMapProps;

// @ts-expect-error controlled and default interaction state are mutually exclusive.
const mixedStateProps: TileflowMapProps = {
  defaultInteractionState: interactionState,
  interactionState,
  source,
};
// @ts-expect-error image mode cannot accept live interaction bindings.
const interactiveImageProps: TileflowMapProps = {
  interactions: poiInteractions,
  mode: 'image',
  source,
};
// @ts-expect-error the exported component instance preserves the strict image branch.
const invalidImageComponentProps: ComponentProps = {
  annotations: propertyAnnotations,
  mode: 'image',
  source,
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
  validProps, missingSource, flattenedMap, configInput, rendererInput, mixedStateProps,
  componentProps, invalidComponentProps, invalidImageComponentProps, interactiveImageProps,
  handleInteractionEvent, poiInteractions, propertyMapProps, propertyComponentProps, propertySlots,
];
