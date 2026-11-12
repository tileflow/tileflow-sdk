import {type ComponentProps, createRef, lazy} from 'react';
import type {Map as MapLibreMap} from 'maplibre-gl';
import type {TileflowMapError, TileflowThemeController} from '@tileflow/core/browser';
import type {TileflowAnnotation} from '@tileflow/interactions';
import {Map, type MapAnnotationProps, type MapProps, type TileflowMapHandle} from '../src/index';

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

// `onError` receives a stable code and an `Error`, in interactive and image mode.
const reported = (
  <Map
    onError={({code, error}) => {
      const stable: TileflowMapError['code'] = code;
      return [stable, error.message];
    }}
    source={{map: 'main'}}
  />
);
const reportedImage = (
  <Map mode="image" onError={(event) => event.error.name} source={{map: 'main'}} />
);
// @ts-expect-error a code outside the stable set is not an error code.
const unknownCode: TileflowMapError['code'] = 'other';

// A `ref` gives the MapLibre map and the theme controller, with either overload and any annotation type.
const handle = createRef<TileflowMapHandle>();
const withRef = <Map ref={handle} source={{map: 'main'}} />;
const withRefAndAnnotations = (
  <Map<TileflowAnnotation<Property>>
    annotations={properties}
    ref={handle}
    renderPopup={({annotation}) => annotation.data!.title}
    source={{map: 'main'}}
  />
);
const withRefAndInteractions = <Map interactions={[]} ref={handle} source={{map: 'main'}} />;
function useHandle() {
  const map: MapLibreMap | null | undefined = handle.current?.getMap();
  const controller: TileflowThemeController | null | undefined =
    handle.current?.getThemeController();
  return [map, controller];
}
// @ts-expect-error a ref to anything else is not a map handle.
const wrongRef = <Map ref={createRef<HTMLDivElement>()} source={{map: 'main'}} />;

void [withRef, withRefAndAnnotations, withRefAndInteractions, useHandle, wrongRef];

void [
  inferredPopup,
  bindingPopup,
  wrappedPopup,
  camera,
  fitted,
  reported,
  reportedImage,
  unknownCode,
];

// Tools that read a component's props, such as `lazy` and `ComponentProps`, see every prop shape.
const LazyMap = lazy(() => import('../src/index').then((module) => ({default: module.Map})));
const lazyMap = <LazyMap source={{map: 'main'}} theme="dawn" zoom={15} onLoad={() => {}} />;
const lazyImage = <LazyMap mode="image" source={{map: 'main'}} />;
const lazyInteractions = <LazyMap interactions={[]} ref={handle} source={{map: 'main'}} />;
const readProps = (props: MapProps): ComponentProps<typeof Map> => props;
// @ts-expect-error image mode takes no interactions, through `lazy` too.
const lazyImageInteractions = <LazyMap interactions={[]} mode="image" source={{map: 'main'}} />;

void [lazyMap, lazyImage, lazyInteractions, readProps, lazyImageInteractions];
