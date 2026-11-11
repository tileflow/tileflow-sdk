import type {TileflowAnnotation} from '@tileflow/interactions';
import {Map, type MapAnnotationProps} from '../src/index';

type Property = Readonly<{
  price: number;
  title: string;
}>;

const properties = [
  {
    ariaLabel: 'Apartment in Madrid',
    coordinate: [-3.7, 40.4],
    data: {price: 320_000, title: 'Apartment in Madrid'},
    id: 'property-42',
    kind: 'marker',
    popup: {content: {kind: 'view', name: 'property-card'}},
  },
] satisfies readonly TileflowAnnotation<Property>[];

export function PropertyCard({close, property}: {close: () => void; property: Property}) {
  return (
    <button type="button" onClick={close}>
      {property.title}
    </button>
  );
}

const annotationOnlyMap = (
  <Map
    annotations={properties}
    renderPopup={({annotation, close}) => <PropertyCard property={annotation.data} close={close} />}
    source={{map: 'main'}}
    vegetation={false}
    viewMode="3d"
  />
);

void annotationOnlyMap;

// A popup view written inline gets its parameter types from the props, with or without a generic.
const inferredPopup = (
  <Map<TileflowAnnotation<Property>>
    annotations={properties}
    renderMarker={({annotation, state}) => (
      <span data-active={state?.selected || state?.hovered || state?.focused}>
        {annotation.data?.title}
      </span>
    )}
    renderPopup={({annotation, close}) => (
      <PropertyCard property={annotation.data!} close={close} />
    )}
    source={{map: 'main'}}
  />
);

// With interactions a view may belong to a map feature, so the context is a union to narrow.
const bindingPopup = (
  <Map
    interactions={[
      {
        id: 'poi-card',
        popup: {content: {kind: 'view', name: 'poi-card'}},
        target: {domain: 'poi', kind: 'semantic-feature'},
      },
    ]}
    renderPopup={(context) =>
      'annotation' in context ? context.annotation.id : context.target.kind
    }
    source={{map: 'main'}}
  />
);

// A wrapper that takes the annotation props keeps that inference.
function MapWrapper<TAnnotation extends TileflowAnnotation>(
  props: MapAnnotationProps<TAnnotation>,
) {
  return <Map<TAnnotation> {...props} />;
}
const wrappedPopup = (
  <MapWrapper<TileflowAnnotation<Property>>
    annotations={properties}
    renderPopup={({annotation, close}) => (
      <PropertyCard property={annotation.data!} close={close} />
    )}
    source={{map: 'main'}}
  />
);

const camera = (
  <Map
    bounds={[-4, 40, -3, 41]}
    fitBoundsOptions={{duration: 600, maxZoom: 14, padding: {bottom: 8, left: 8, right: 8, top: 8}}}
    navigationControl={{position: 'bottom-left', showCompass: false}}
    source={{map: 'main'}}
  />
);
const fitted = (
  <Map annotations={properties} fitAnnotations navigationControl={false} source={{map: 'main'}} />
);

void [inferredPopup, bindingPopup, wrappedPopup, camera, fitted];
