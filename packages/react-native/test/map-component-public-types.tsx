import {Layer, VectorSource} from '@maplibre/maplibre-react-native';
import {
  Map,
  type MapProps,
  type MapRef,
  type MapThemeBlend,
  type MapThemeTransition,
} from '@tileflow/react-native';
import {createRef, type ReactElement} from 'react';

const source = {map: 'main', manifestUrl: 'https://maps.example.test/manifest.json'};
const ref = createRef<MapRef>();
const props: MapProps = {
  source,
  theme: 'system',
  initialView: {center: [-3.7, 40.4], zoom: 12},
};
const map: ReactElement = (
  <Map {...props} ref={ref} style={{flex: 1}} testID="map" mapOptions={{dragPan: true}} />
);
void map;
const controlled = (
  <Map
    source={source}
    view={{center: [0, 0], zoom: 2, bearing: 0, pitch: 0}}
    onViewChange={() => undefined}
  />
);
void controlled;
// Theme motion: a cross-fade for theme changes and a blend shown instead of `theme`.
const transition: MapThemeTransition = {duration: 450};
const blend: MapThemeBlend = {themes: ['night', 'dusk', 'day'], position: 1.25};
const motion = (
  <Map source={source} theme="light" themeTransition={transition} themeBlend={blend} />
);
void motion;
// @ts-expect-error A transition only has a duration.
<Map source={source} themeTransition={{duration: 450, easing: 'linear'}} />;
// @ts-expect-error A blend position is a number.
<Map source={source} themeBlend={{themes: ['night', 'day'], position: '0.5'}} />;
// Existing upstream source/layer primitives remain children, not another Tileflow source mode.
const composition = (
  <Map source={source}>
    <VectorSource id="external" tiles={['https://outside.example.test/{z}/{x}/{y}.pbf']}>
      <Layer id="external-line" type="line" source-layer="roads" />
    </VectorSource>
  </Map>
);
void composition;
// @ts-expect-error Native source descriptors require the explicit manifest URL.
<Map source={{map: 'main'}} />;
// @ts-expect-error The obsolete renderer discriminator is rejected.
<Map source={{...source, kind: 'tileflow'}} />;
// @ts-expect-error Tileflow owns the style input.
<Map source={source} mapStyle="https://outside.example.test/style.json" />;
// @ts-expect-error Mobile credentials are application configuration, not props.
<Map source={source} credential="invalid" />;
// @ts-expect-error Controlled mode requires the callback and complete view.
<Map source={source} view={{zoom: 2}} />;
// @ts-expect-error Native renderer callbacks remain private.
<Map source={source} mapOptions={{onDidFinishLoadingStyle() {}}} />;
// @ts-expect-error Raw MapLibre handles are never exposed by Tileflow's safe ref.
ref.current?.getViewState();
// @ts-expect-error No imperative camera API is added to the safe ref.
ref.current?.setStop({zoom: 10});
