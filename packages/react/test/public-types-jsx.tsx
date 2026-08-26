import type {TileflowAnnotation} from '@tileflow/interactions';
import {Map} from '../src/index';

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
    source={{kind: 'maplibre', style: {layers: [], name: 'Direct', sources: {}, version: 8}}}
  />
);

void annotationOnlyMap;
