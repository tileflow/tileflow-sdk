import type {MapProps as NativeMapProps} from '@maplibre/maplibre-react-native';
import type {
  MapBaseProps,
  MapErrorEvent,
  MapInitialViewInputs,
  MapLoadEvent,
  MapOptions,
  MapReadinessChangeEvent,
  MapRef,
  MapSource,
  MapSourceState,
  MapThemeChangeEvent,
  MapView,
} from '@tileflow/react-native';
import type {ReactNode, Ref} from 'react';
import type {ViewProps} from 'react-native';
import type {
  TileflowNativeInitialView,
  TileflowNativeInitialViewOptions,
  TileflowNativeSource,
} from '@tileflow/core/native';

function acceptsProps(value: MapBaseProps): void {
  void value;
}
function acceptsOptions(value: MapOptions): void {
  void value;
}
function acceptsView(value: MapView): void {
  void value;
}

const source = {
  map: 'streets',
  manifestUrl: 'https://maps.example.test/native/manifest.json',
} as const;

export function acceptsExistingCoreContracts(
  input: TileflowNativeSource,
  view: TileflowNativeInitialView,
  inputs: TileflowNativeInitialViewOptions,
  ref: Ref<MapRef>,
  children: ReactNode,
  style: ViewProps['style'],
): void {
  const sameSource: MapSource = input;
  const sameView: MapView = view;
  const sameInputs: MapInitialViewInputs = inputs;
  void sameSource;
  void sameInputs;
  acceptsView(sameView);
  acceptsProps({source, theme: 'system', children, style, testID: 'map', ref});
  acceptsProps({source, mapOptions: {dragPan: true, touchZoom: false, scaleBar: true}});
  const options: Pick<NativeMapProps, 'dragPan' | 'touchZoom' | 'compass'> = {dragPan: true};
  acceptsOptions(options);
}

// Compile-only calls against the built public entry.
// @ts-expect-error The source is required.
acceptsProps({});
// @ts-expect-error A native manifest URL is explicit.
acceptsProps({source: {map: 'streets'}});
// @ts-expect-error Renderer discriminators are not public source fields.
acceptsProps({source: {...source, kind: 'tileflow'}});
// @ts-expect-error Arbitrary renderer styles are not Tileflow Map sources.
acceptsProps({source: {style: 'https://maps.example.test/style.json'}});
// @ts-expect-error Style inputs belong to Tileflow.
acceptsProps({source, mapStyle: 'https://maps.example.test/style.json'});
// @ts-expect-error MapBaseProps does not include the separate camera contract.
acceptsProps({source, view: {zoom: 10}});
// @ts-expect-error MapBaseProps does not include the separate camera contract.
acceptsProps({source, initialView: {zoom: 10}});
// @ts-expect-error Hosted/session interfaces are private.
acceptsProps({source, client: {}});
// @ts-expect-error Mobile credentials are application configuration, not component props.
acceptsProps({source, credential: 'invalid'});
// @ts-expect-error Tileflow annotation APIs are not part of this contract.
acceptsProps({source, annotations: []});
// @ts-expect-error The component owns its container.
acceptsOptions({container: 'map'});
// @ts-expect-error The component owns mapStyle.
acceptsOptions({mapStyle: 'https://maps.example.test/style.json'});
// @ts-expect-error Alternate style inputs are prohibited.
acceptsOptions({styleURL: 'https://maps.example.test/style.json'});
// @ts-expect-error Request interception is not a map option.
acceptsOptions({transformRequest: (url: string) => url});
// @ts-expect-error Request headers are not a map option.
acceptsOptions({requestHeaders: {authorization: 'invalid'}});
// @ts-expect-error Style lifecycle belongs to Tileflow.
acceptsOptions({onDidFinishLoadingStyle: () => undefined});
// @ts-expect-error Frame lifecycle belongs to Tileflow.
acceptsOptions({onDidFinishRenderingFrameFully: () => undefined});
// @ts-expect-error Camera observations belong to Tileflow.
acceptsOptions({onRegionDidChange: () => undefined});
const optionsWithOwnedLifecycle = {dragPan: true, onDidFailLoadingMap: () => undefined};
// @ts-expect-error Forbidden lifecycle keys remain forbidden on an existing variable.
acceptsOptions(optionsWithOwnedLifecycle);

export function consumesState(state: MapSourceState | undefined, ref: MapRef): void {
  const observed = ref.getSourceState();
  void observed;
  // @ts-expect-error No renderer or camera mutation escape hatch is exposed.
  ref.setCamera({zoom: 8});
  if (state?.status === 'ready') {
    const name: string = state.map;
    const scheme: 'dark' | 'light' = state.theme.colorScheme;
    void name;
    void scheme;
    // @ts-expect-error Ready identity has no renderer discriminator.
    void state.kind;
    // @ts-expect-error Diagnostics do not disclose URLs or style bodies.
    void state.source;
  } else if (state?.status === 'error') {
    const kind: 'terminal' | 'cancelled' = state.error.kind;
    void kind;
    // @ts-expect-error A safe diagnostic is not an exception with a remote message.
    void state.error.message;
  }
}

export function handlesEvents(
  load: MapLoadEvent,
  error: MapErrorEvent,
  readiness: MapReadinessChangeEvent,
  theme: MapThemeChangeEvent,
): void {
  const name: string = load.selection.theme.name;
  void name;
  // @ts-expect-error Selections contain Tileflow identity, not a renderer discriminator.
  void load.selection.kind;
  if (error.type === 'source-error') {
    const field: string = error.error.field;
    void field;
  } else {
    // @ts-expect-error Renderer failures contain no raw exception.
    void error.error;
  }
  if (theme.phase === 'ready') {
    const current: string = theme.currentTheme.name;
    void current;
  }
  const status: 'loading' | 'ready' | 'error' = readiness.status;
  void status;
  acceptsProps({
    source,
    onLoad: (event) => {
      void event.selection;
    },
    onError: (event) => {
      void event.type;
    },
    onReadinessChange: (event) => {
      void event.status;
    },
    onThemeChange: (event) => {
      void event.phase;
    },
  });
  // @ts-expect-error onLoad receives a safe event, not a native map ref.
  acceptsProps({source, onLoad: (_map: NativeMapProps) => undefined});
}
