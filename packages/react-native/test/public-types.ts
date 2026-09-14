import type {ReactNode, Ref} from 'react';
import type {ViewProps} from 'react-native';
import type {MapProps as NativeMapProps} from '@maplibre/maplibre-react-native';
import type {
  TileflowNativeInitialView,
  TileflowNativeInitialViewOptions,
  TileflowNativeSource,
} from '@tileflow/core/native';
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

function acceptsProps(value: MapBaseProps): void { void value; }
function acceptsOptions(value: MapOptions): void { void value; }
function acceptsView(value: MapView): void { void value; }

const tileflow = {
  kind: 'tileflow', map: 'streets', manifestUrl: 'https://maps.example.test/native/manifest.json',
} as const;
const direct = {kind: 'maplibre', style: 'https://maps.example.test/style.json'} as const;

export function acceptsExistingCoreContracts(
  source: TileflowNativeSource,
  view: TileflowNativeInitialView,
  inputs: TileflowNativeInitialViewOptions,
  ref: Ref<MapRef>,
  children: ReactNode,
  style: ViewProps['style'],
): void {
  const sameSource: MapSource = source;
  const sameView: MapView = view;
  const sameInputs: MapInitialViewInputs = inputs;
  void sameSource;
  void sameInputs;
  acceptsView(sameView);
  acceptsProps({source: tileflow, theme: 'system', children, style, testID: 'map', ref});
  acceptsProps({source: direct, mapOptions: {dragPan: true, touchZoom: false, scaleBar: true}});
  acceptsProps({source: {kind: 'maplibre', style: {version: 8, name: 'Direct', sources: {}, layers: []}}});
  const options: Pick<NativeMapProps, 'dragPan' | 'touchZoom' | 'compass'> = {dragPan: true};
  acceptsOptions(options);
}

// These are compile-only calls against the built public entry, not a component fixture.
// @ts-expect-error The source is required.
acceptsProps({});
// @ts-expect-error A native manifest URL is explicit.
acceptsProps({source: {kind: 'tileflow', map: 'streets'}});
// @ts-expect-error Direct sources have no Tileflow theme.
acceptsProps({source: direct, theme: 'dark'});
// @ts-expect-error Styles must come through the discriminated source.
acceptsProps({source: tileflow, mapStyle: 'https://maps.example.test/style.json'});
// @ts-expect-error Core view composition is not a controlled-camera prop contract.
acceptsProps({source: tileflow, view: {zoom: 10}});
// @ts-expect-error Initial-versus-controlled camera ownership is not frozen here.
acceptsProps({source: tileflow, initialView: {zoom: 10}});
// @ts-expect-error Hosted/session interfaces are not part of this contract.
acceptsProps({source: tileflow, client: {}});
// @ts-expect-error Annotation interfaces are not frozen here.
acceptsProps({source: tileflow, annotations: []});
// @ts-expect-error The wrapper owns its container.
acceptsOptions({container: 'map'});
// @ts-expect-error The wrapper owns mapStyle.
acceptsOptions({mapStyle: 'https://maps.example.test/style.json'});
// @ts-expect-error Alternate style inputs are prohibited.
acceptsOptions({styleURL: 'https://maps.example.test/style.json'});
// @ts-expect-error Request interception is not a map option.
acceptsOptions({transformRequest: (url: string) => url});
// @ts-expect-error Request headers are not a map option.
acceptsOptions({requestHeaders: {authorization: 'secret'}});
// @ts-expect-error Style lifecycle belongs to Tileflow.
acceptsOptions({onDidFinishLoadingStyle: () => undefined});
// @ts-expect-error Frame lifecycle belongs to Tileflow.
acceptsOptions({onDidFinishRenderingFrameFully: () => undefined});
// @ts-expect-error View callbacks need a separate controlled-camera contract.
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
    if (state.kind === 'tileflow') {
      const name: string = state.map;
      const scheme: 'dark' | 'light' = state.theme.colorScheme;
      void name;
      void scheme;
    } else {
      // @ts-expect-error Direct snapshots do not fabricate a theme.
      const theme = state.theme;
      void theme;
    }
    // @ts-expect-error Diagnostics do not disclose URLs or style bodies.
    const source = state.source;
    void source;
  } else if (state?.status === 'error') {
    const kind: 'terminal' | 'cancelled' = state.error.kind;
    void kind;
    // @ts-expect-error A safe diagnostic is not an exception with a remote message.
    const message = state.error.message;
    void message;
  }
}

export function handlesEvents(
  load: MapLoadEvent,
  error: MapErrorEvent,
  readiness: MapReadinessChangeEvent,
  theme: MapThemeChangeEvent,
): void {
  if (load.selection.kind === 'tileflow') {
    const name: string = load.selection.theme.name;
    void name;
  }
  if (error.type === 'source-error') {
    const field: string = error.error.field;
    void field;
  } else {
    // @ts-expect-error Renderer failures contain no raw exception.
    const cause = error.error;
    void cause;
  }
  if (theme.phase === 'ready') {
    const current: string = theme.currentTheme.name;
    void current;
  }
  const status: 'loading' | 'ready' | 'error' = readiness.status;
  void status;
  acceptsProps({source: tileflow, onLoad: (event) => { void event.selection; },
    onError: (event) => { void event.type; },
    onReadinessChange: (event) => { void event.status; },
    onThemeChange: (event) => { void event.phase; }});
  // @ts-expect-error onLoad receives a safe event, not a native map ref.
  acceptsProps({source: tileflow, onLoad: (_map: NativeMapProps) => undefined});
}
