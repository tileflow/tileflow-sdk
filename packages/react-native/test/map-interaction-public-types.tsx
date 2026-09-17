import * as Native from '@tileflow/react-native';
import {
  Map,
  type MapMarkerRenderContext,
  type MapMarkerRenderer,
  type MapProps,
  type MapRef,
} from '@tileflow/react-native';
import {createRef, type ReactElement} from 'react';
import {Text, View} from 'react-native';
import type {
  TileflowAnnotation,
  TileflowInteractionBinding,
  TileflowInteractionDiagnostic,
  TileflowInteractionEvent,
  TileflowInteractionState,
} from '@tileflow/interactions';

type Place = TileflowAnnotation & {data: {name: string; capacity: number}};
const source = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
const annotations: readonly Place[] = [
  {
    id: 'place',
    kind: 'marker',
    ariaLabel: 'Example place',
    coordinate: [0, 0],
    data: {name: 'Example', capacity: 12},
  },
];
const state: TileflowInteractionState = {popup: null};
const interactions: readonly TileflowInteractionBinding[] = [
  {
    id: 'poi',
    target: {kind: 'semantic-feature', domain: 'poi', categories: ['food-drink']},
    popup: {content: {kind: 'field', field: 'feature.properties.name'}},
  },
];
const renderMarker: MapMarkerRenderer<Place> = (context: MapMarkerRenderContext<Place>) => {
  const name: string = context.annotation.data.name;
  const capacity: number = context.target.annotation.data.capacity;
  // @ts-expect-error Marker composition exposes no native renderer handle.
  void context.nativeMap;
  return (
    <Text>
      {name}: {capacity}
    </Text>
  );
};
const props: MapProps<Place> = {
  source,
  annotations,
  interactions,
  interactionState: state,
  renderMarker,
  onInteractionEvent(event) {
    const portable: TileflowInteractionEvent<Place> = event;
    if (portable.target.kind === 'annotation') {
      const capacity: number = portable.target.annotation.data.capacity;
      void capacity;
      // @ts-expect-error Application data must retain its declared type.
      const invalid: string = portable.target.annotation.data.capacity;
      void invalid;
    }
    // @ts-expect-error Raw native events are private.
    void event.nativeEvent;
  },
  onInteractionStateChange(next) {
    const portable: TileflowInteractionState = next;
    void portable;
  },
  onInteractionDiagnostic(diagnostic) {
    const portable: TileflowInteractionDiagnostic = diagnostic;
    void portable;
  },
};
const explicit: ReactElement = (
  <Map<Place> {...props}>
    <View />
  </Map>
);
const inferred = (
  <Map
    source={source}
    annotations={annotations}
    renderMarker={({annotation}) => {
      const capacity: number = annotation.data.capacity;
      return <Text>{capacity}</Text>;
    }}
  />
);
const uncontrolled = (
  <Map source={source} annotations={annotations} defaultInteractionState={state} />
);
const defaultMarker = <Map source={source} annotations={annotations} />;
void [explicit, inferred, uncontrolled, defaultMarker];

// @ts-expect-error Controlled and uncontrolled state inputs are mutually exclusive.
<Map source={source} interactionState={state} defaultInteractionState={state} />;
// @ts-expect-error Tileflow never renders native selection presentation.
<Map source={source} renderPopup={() => <View />} />;
// @ts-expect-error Tileflow never renders native selection presentation.
<Map source={source} renderTooltip={() => <View />} />;
// @ts-expect-error No selected-content renderer is exposed.
<Map source={source} renderSelection={() => <View />} />;
// @ts-expect-error Map touch handling belongs to Tileflow.
<Map source={source} mapOptions={{onPress() {}}} />;
// @ts-expect-error Renderer lifecycle handling belongs to Tileflow.
<Map source={source} mapOptions={{onDidFinishLoadingStyle() {}}} />;
// @ts-expect-error Credentials are not interaction or Map inputs.
<Map source={source} credential="invalid" />;
const ref = createRef<MapRef>();
<Map source={source} ref={ref} />;
// @ts-expect-error Query handles must never enter the public ref.
ref.current?.queryRenderedFeatures([0, 0]);
// @ts-expect-error The interaction owner remains private.
void Native.createNativeInteractionOwner;
// @ts-expect-error The style lease and native query adapter remain private.
void Native.createNativePoiAdapter;
// @ts-expect-error No selection component is exported.
void Native.Popup;
// @ts-expect-error No selection component is exported.
void Native.Callout;
