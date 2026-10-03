import {StrictMode, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {
  type MapCameraProps,
  type MapSource,
  type MapThemeSelection,
  type MapView,
  Map as TileflowMap,
} from '../src/index';

type Observation = Readonly<{
  map: 'first' | 'second';
  kind: 'load' | 'readiness' | 'renderer-error' | 'source-error' | 'theme' | 'view';
  status?: 'loading' | 'ready' | 'error';
}>;
type Slot = Readonly<{
  key: string;
  map: Observation['map'];
  source: MapSource;
  theme?: MapThemeSelection;
  view?: MapView;
}>;

type Snapshot = Readonly<{slots: readonly Slot[]}>;

// Source-checkout development harness, deliberately excluded from package
// exports and tsup entries. The public Map owns every private native lifecycle.
export function createAdmissionHarness(input: {
  firstSource: MapSource;
  secondSource: MapSource;
  replacementSource: MapSource;
  firstTheme?: MapThemeSelection;
  secondTheme?: MapThemeSelection;
  initialView?: MapView;
  observe: (event: Observation) => void;
}) {
  if (!__DEV__) throw new Error('The mounted Map harness requires a development host.');
  let active = true;
  let sequence = 2;
  let snapshot: Snapshot = Object.freeze({
    slots: Object.freeze([
      Object.freeze({
        key: 'first-1',
        map: 'first' as const,
        source: input.firstSource,
        theme: input.firstTheme,
        ...(input.initialView ? {view: input.initialView} : {}),
      }),
      Object.freeze({
        key: 'second-1',
        map: 'second' as const,
        source: input.secondSource,
        theme: input.secondTheme,
      }),
    ]),
  });
  const listeners = new Set<() => void>();
  const publish = (slots: readonly Slot[]) => {
    if (!active) return;
    snapshot = Object.freeze({slots: Object.freeze(slots.map((slot) => Object.freeze(slot)))});
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        /* Harness observers do not own mounted Map state. */
      }
    }
  };
  const report = (event: Observation) => {
    try {
      input.observe(Object.freeze(event));
    } catch {
      /* Harness observations never own component lifecycle. */
    }
  };
  function updateFirst(change: (slot: Slot) => Slot) {
    const first = snapshot.slots.find((slot) => slot.map === 'first');
    if (!active || !first) throw new Error('The first mounted Map is not available.');
    publish(snapshot.slots.map((slot) => (slot === first ? change(first) : slot)));
  }
  function Screen() {
    const current = useSyncExternalStore(
      (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      () => snapshot,
      () => snapshot,
    );
    return (
      <StrictMode>
        <View style={{flex: 1}}>
          {current.slots.map((slot) => {
            const camera: MapCameraProps = slot.view
              ? {
                  view: slot.view,
                  onViewChange(event) {
                    if (!active) return;
                    updateFirst((currentFirst) =>
                      currentFirst.map === slot.map
                        ? {...currentFirst, view: event.view}
                        : currentFirst,
                    );
                    report({map: slot.map, kind: 'view'});
                  },
                }
              : {};

            return (
              <TileflowMap
                key={slot.key}
                source={slot.source}
                theme={slot.theme}
                testID={`tileflow-mounted-${slot.map}`}
                style={{flex: 1}}
                {...camera}
                onLoad={() => report({map: slot.map, kind: 'load'})}
                onReadinessChange={(event) =>
                  report({map: slot.map, kind: 'readiness', status: event.status})
                }
                onThemeChange={() => report({map: slot.map, kind: 'theme'})}
                onError={(event) =>
                  report({
                    map: slot.map,
                    kind: event.type === 'source-error' ? 'source-error' : 'renderer-error',
                  })
                }
              />
            );
          })}
        </View>
      </StrictMode>
    );
  }
  return Object.freeze({
    Screen,
    setFirstTheme(theme: MapThemeSelection | undefined) {
      updateFirst((slot) => ({...slot, theme}));
    },
    replaceFirstSource(source: MapSource) {
      updateFirst((slot) => ({...slot, key: `first-${++sequence}`, source}));
    },
    updateFirstSource(source: MapSource) {
      updateFirst((slot) => ({...slot, source}));
    },
    setFirstView(view: MapView) {
      updateFirst((slot) => ({...slot, view}));
    },
    removeFirst() {
      if (!active) return;
      publish(snapshot.slots.filter((slot) => slot.map !== 'first'));
    },
    restoreFirst() {
      if (!active || snapshot.slots.some((slot) => slot.map === 'first')) return;
      publish([
        Object.freeze({
          key: `first-${++sequence}`,
          map: 'first' as const,
          source: input.replacementSource,
          theme: input.firstTheme,
          ...(input.initialView ? {view: input.initialView} : {}),
        }),
        ...snapshot.slots,
      ]);
    },
    stop() {
      if (!active) return;
      active = false;
      snapshot = Object.freeze({slots: Object.freeze([])});
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          /* Teardown remains deterministic. */
        }
      }
      listeners.clear();
    },
  });
}
