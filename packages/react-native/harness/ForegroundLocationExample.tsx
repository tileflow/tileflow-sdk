import {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {AppState, Pressable, Text, View} from 'react-native';
import {
  type MapSource,
  type MapThemeSelection,
  type MapView,
  Map as TileflowMap,
} from '../src/index';
import {
  type ApplicationForegroundLocationAdapter,
  type ApplicationForegroundLocationState,
  type ApplicationLocationAnnotation,
  createForegroundLocationController,
  foregroundLocationAnnotations,
  recenterForegroundLocationView,
} from './foreground-location-recipe';

export type ForegroundLocationExampleProps = Readonly<{
  adapter: ApplicationForegroundLocationAdapter;
  source: MapSource;
  initialView: MapView;
  theme?: MapThemeSelection;
}>;

function statusText(state: ApplicationForegroundLocationState): string {
  if (state.status === 'idle') return 'Location is off';
  if (state.status === 'requesting') return 'Requesting location permission';
  if (state.status === 'granted-precise')
    return state.fix ? 'Precise location available' : 'Waiting for precise location';
  if (state.status === 'granted-approximate')
    return state.fix ? 'Approximate location available' : 'Waiting for approximate location';
  if (state.status === 'denied') return 'Location permission denied';
  if (state.status === 'revoked') return 'Location permission revoked';
  return 'Location unavailable';
}

/**
 * Source-checkout recipe only. The application injects the permission/provider adapter and owns
 * every status control below; @tileflow/react-native contributes only Map, camera and annotation
 * primitives. This file is excluded from package exports and packed runtime files.
 */
export function ForegroundLocationExample({
  adapter,
  source,
  initialView,
  theme,
}: ForegroundLocationExampleProps) {
  const controller = useMemo(
    () => createForegroundLocationController(adapter, AppState.currentState === 'active'),
    [adapter],
  );
  const location = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [view, setView] = useState<MapView>(() => initialView);
  const annotations = foregroundLocationAnnotations(location);
  const canRecenter =
    (location.status === 'granted-precise' || location.status === 'granted-approximate') &&
    location.fix !== null;

  useEffect(() => {
    controller.setForeground(AppState.currentState === 'active');
    const unmount = controller.mount();
    const subscription = AppState.addEventListener('change', (state) => {
      controller.setForeground(state === 'active');
    });
    return () => {
      subscription.remove();
      unmount();
    };
  }, [controller]);

  return (
    <View style={{flex: 1}}>
      <TileflowMap<ApplicationLocationAnnotation>
        source={source}
        theme={theme}
        style={{flex: 1}}
        view={view}
        onViewChange={(event) => setView(event.view)}
        annotations={annotations}
      />
      <View style={{position: 'absolute', left: 16, right: 16, bottom: 16, gap: 8}}>
        <Text accessibilityLiveRegion="polite">{statusText(location)}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={location.status === 'requesting'}
          onPress={() => {
            void controller.requestPermission();
          }}
        >
          <Text>Use my location</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Moves the map immediately to the latest application-owned location fix"
          disabled={!canRecenter}
          onPress={() => {
            // This recipe deliberately uses an immediate controlled-view update and no animation.
            // A new fix never changes the camera by itself, including under reduced-motion settings.
            setView((current) => recenterForegroundLocationView(current, location));
          }}
        >
          <Text>Recenter</Text>
        </Pressable>
      </View>
    </View>
  );
}
