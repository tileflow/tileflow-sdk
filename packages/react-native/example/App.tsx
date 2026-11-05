import {
  Camera,
  CircleLayer,
  configuredServices,
  GeoJSONSource,
  MapView,
  type MapViewRef,
  type OfflineRegion,
  type OfflineRegionLoadOptions,
  TileflowOfflineStore,
  TileflowOfflineSwitch,
} from '@tileflow/react-native';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Button, SafeAreaView, StyleSheet, Text, View} from 'react-native';

const fixtureOrigin = process.env.EXPO_PUBLIC_TILEFLOW_FIXTURE_ORIGIN ?? 'http://127.0.0.1:18645';
const selfTest = process.env.EXPO_PUBLIC_TILEFLOW_SELF_TEST === '1';
const center: [number, number] = [-3.7, 40.42];
const regionId = 'react-native-map-fixture';
const fixtureMap = 'map_offlinefixture01';
const region: OfflineRegionLoadOptions = {
  geometry: {type: 'boundingBox', west: -3.705, south: 40.416, east: -3.695, north: 40.424},
  content: {type: 'hosted', mapId: fixtureMap, themes: ['day']},
  minZoom: 13,
  maxZoom: 16,
  metadata: {name: 'Native map example'},
};
const shape = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      id: 'example-point',
      properties: {name: 'Fixture point'},
      geometry: {type: 'Point' as const, coordinates: center},
    },
    {
      type: 'Feature' as const,
      id: 'example-nearby',
      properties: {name: 'Nearby fixture point'},
      geometry: {type: 'Point' as const, coordinates: [-3.6996, 40.42]},
    },
  ],
};
const streetsSource = {
  map: 'streets',
  manifestUrl: `${fixtureOrigin}/native/manifest.json`,
  resourceOrigins: [fixtureOrigin, 'https://api.tileflow.dev'],
  allowsLoopbackHttp: true,
};
const hostedSource = {mapId: fixtureMap};

type MapStage = 'streets' | 'hosted' | 'offline';
type SourceRejection = {code: string; context?: unknown};
type ExpectedRejection = {
  id: number;
  resolve(error: SourceRejection): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
type Load = {resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>};
const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function message(value: unknown): string {
  return value instanceof Error ? value.message : JSON.stringify(value);
}

function featureCount(value: unknown): number {
  if (value && typeof value === 'object' && 'features' in value && Array.isArray(value.features))
    return value.features.length;
  throw new Error('The query did not return a FeatureCollection.');
}

async function downloadRegion(): Promise<OfflineRegion> {
  if (await TileflowOfflineStore.region(regionId))
    await TileflowOfflineStore.removeRegion(regionId);
  let subscription: ReturnType<typeof TileflowOfflineStore.subscribe> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const complete = new Promise<OfflineRegion>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The fixture download timed out.')), 120_000);
      subscription = TileflowOfflineStore.subscribe((event) => {
        if (event.type !== 'changed' || event.region.id !== regionId) return;
        if (event.region.state === 'complete') resolve(event.region);
        if (event.region.state === 'failed')
          reject(new Error(`Download failed: ${event.region.error?.code}`));
      });
    });
    // Observe the download before starting it so a fast local response is retained.
    const [downloaded] = await Promise.all([
      complete,
      TileflowOfflineStore.loadRegion(regionId, region),
    ]);
    return downloaded;
  } finally {
    if (timer) clearTimeout(timer);
    subscription?.remove();
  }
}

export default function App() {
  const map = useRef<MapViewRef>(null);
  const nextId = useRef(0);
  const loads = useRef(new Map<number, Load>());
  const warnings = useRef(new Map<number, string[]>());
  const loadEvents = useRef(new Map<number, number>());
  const active = useRef(true);
  const running = useRef(false);
  const restoreNetwork = useRef<(() => void) | null>(null);
  const expectedRejection = useRef<ExpectedRejection | null>(null);
  const [sourceRadius, setSourceRadius] = useState(24);
  const [mounted, setMounted] = useState<{id: number; stage: MapStage} | null>({
    id: 0,
    stage: 'streets',
  });
  const [status, setStatus] = useState<Record<string, unknown>>({stage: 'idle'});
  const [busy, setBusy] = useState(false);

  const mount = useCallback((stage: MapStage) => {
    const id = ++nextId.current;
    warnings.current.set(id, []);
    setSourceRadius(24);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        loads.current.delete(id);
        reject(new Error(`${stage} did not emit onDidFinishLoadingMap.`));
      }, 60_000);
      loads.current.set(id, {resolve, reject, timer});
    });
    setMounted({id, stage});
    return ready.then(() => id);
  }, []);

  const inspect = useCallback(async (expectedCluster?: boolean) => {
    const deadline = Date.now() + 15_000;
    while (active.current && Date.now() < deadline) {
      const view = map.current;
      if (!view) throw new Error('The map was removed.');
      const zoom = await view.getZoom();
      if (Math.abs(zoom - 16) > 0.05) throw new Error(`Unexpected zoom ${zoom}.`);
      const point = await view.getPointInView(center);
      const source = await view.querySourceFeatures('example-points');
      const rendered = await view.queryRenderedFeaturesAtPoint(point, undefined, ['example-dots']);
      const sourceFeatures = featureCount(source);
      const renderedFeatures = featureCount(rendered);
      const clustered = rendered.features.some((feature) => feature.properties?.cluster === true);
      if (
        sourceFeatures > 0 &&
        renderedFeatures > 0 &&
        (expectedCluster === undefined || clustered === expectedCluster)
      )
        return {zoom, sourceFeatures, renderedFeatures, clustered};
      await delay(100);
    }
    throw new Error('The declared GeoJSON point was not queryable.');
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const previousNetwork = TileflowOfflineSwitch.isNetworkEnabled();
    restoreNetwork.current = () => TileflowOfflineSwitch.setNetworkEnabled(previousNetwork);
    let completed = false;
    try {
      const origin = new URL(fixtureOrigin);
      if (!['localhost', '127.0.0.1'].includes(origin.hostname))
        throw new Error('The self-test requires a local fixture server.');
      TileflowOfflineSwitch.setNetworkEnabled(true);
      setStatus({stage: 'streets'});
      const streetsId = await mount('streets');
      const initial = await inspect(false);
      const feature = {sourceID: 'example-points', id: 'example-point'};
      await map.current?.setFeatureState(feature, {selected: true, score: 7.5});
      setStatus({stage: 'updating-source', initial});
      setSourceRadius(80);
      const updated = await inspect(true);
      const stateAfterUpdate = await map.current?.getFeatureState(feature);
      if (stateAfterUpdate?.selected !== true || stateAfterUpdate.score !== 7.5)
        throw new Error('The source update lost feature-state.');

      const rejected = new Promise<SourceRejection>((resolve, reject) => {
        const timer = setTimeout(() => {
          expectedRejection.current = null;
          reject(new Error('The invalid source update was not rejected.'));
        }, 15_000);
        expectedRejection.current = {id: streetsId, resolve, reject, timer};
      });
      setSourceRadius(-1);
      const rejection = await rejected;
      const retained = await inspect(true);
      const stateAfterRejection = await map.current?.getFeatureState(feature);
      if (stateAfterRejection?.selected !== true || stateAfterRejection.score !== 7.5)
        throw new Error('The rejected update lost feature-state.');
      setSourceRadius(80);
      const streets = {initial, updated, retained, rejection, featureState: stateAfterRejection};
      setStatus({stage: 'downloading', streets});
      const downloaded = await downloadRegion();
      await mount('hosted');
      await inspect();
      TileflowOfflineSwitch.setNetworkEnabled(false);
      setMounted(null);
      setStatus({stage: 'ready-to-stop-server', streets, packs: downloaded.completedPackCount});

      let unreachable = false;
      const deadline = Date.now() + 180_000;
      while (active.current && Date.now() < deadline) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2_000);
        let response: Response | undefined;
        try {
          response = await fetch(`${fixtureOrigin}/__fixture/hosted`, {
            signal: controller.signal,
          });
        } catch {
          if (!controller.signal.aborted) {
            unreachable = true;
            break;
          }
        } finally {
          clearTimeout(timeout);
        }
        if (response && !response.ok) throw new Error(`Fixture returned ${response.status}.`);
        await delay(500);
      }
      if (!active.current) throw new Error('The example was removed.');
      if (!unreachable) throw new Error('Stop the fixture server to continue the offline test.');
      setStatus({stage: 'reopening-offline', streets});
      const offlineId = await mount('offline');
      const offline = await inspect();
      const stored = await TileflowOfflineStore.region(regionId);
      const offlineWarnings = warnings.current.get(offlineId) ?? [];
      if (
        !stored?.isAvailable ||
        TileflowOfflineSwitch.isNetworkEnabled() ||
        offlineWarnings.length
      )
        throw new Error(`Offline check failed: ${JSON.stringify(offlineWarnings)}`);
      completed = true;
      setStatus({
        ok: true,
        stage: 'complete',
        streets,
        offline,
        packs: downloaded.completedPackCount,
        offlineAvailable: stored.isAvailable,
        offlineLoadEvents: loadEvents.current.get(offlineId) ?? 0,
        serverUnreachable: unreachable,
        networkEnabled: false,
        warnings: offlineWarnings,
        services: configuredServices(),
      });
    } catch (error) {
      if (active.current) setStatus({ok: false, stage: 'failed', message: message(error)});
    } finally {
      if (!completed) {
        restoreNetwork.current?.();
        restoreNetwork.current = null;
      }
      running.current = false;
      if (active.current) setBusy(false);
    }
  }, [inspect, mount]);

  useEffect(() => {
    active.current = true;
    if (selfTest) void run();
    return () => {
      active.current = false;
      for (const load of loads.current.values()) {
        clearTimeout(load.timer);
        load.reject(new Error('The example was removed.'));
      }
      loads.current.clear();
      const expected = expectedRejection.current;
      if (expected) {
        clearTimeout(expected.timer);
        expected.reject(new Error('The example was removed.'));
        expectedRejection.current = null;
      }
      restoreNetwork.current?.();
      restoreNetwork.current = null;
    };
  }, [run]);

  useEffect(() => {
    if (selfTest) console.log(`TILEFLOW_SELF_TEST ${JSON.stringify(status)}`);
  }, [status]);

  const id = mounted?.id;
  const loaded = () => {
    if (id === undefined) return;
    loadEvents.current.set(id, (loadEvents.current.get(id) ?? 0) + 1);
    const load = loads.current.get(id);
    if (!load) return;
    clearTimeout(load.timer);
    loads.current.delete(id);
    load.resolve();
  };
  const failed = (error: unknown) => {
    if (id === undefined) return;
    const expected = expectedRejection.current;
    if (expected?.id === id) {
      clearTimeout(expected.timer);
      expectedRejection.current = null;
      const detail = error as {code?: unknown; context?: unknown} | null;
      if (detail?.code === 'invalidRequest') {
        expected.resolve({code: detail.code, context: detail.context});
        return;
      }
      expected.reject(new Error(message(error)));
    }
    const load = loads.current.get(id);
    if (load) {
      clearTimeout(load.timer);
      loads.current.delete(id);
      load.reject(new Error(message(error)));
    } else {
      setStatus({ok: false, stage: 'failed', message: message(error)});
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Tileflow native map</Text>
      <Text testID="self-test-result" selectable style={styles.result}>
        TILEFLOW_SELF_TEST {JSON.stringify(status)}
      </Text>
      <View style={styles.buttons}>
        <Button title="Run offline check" disabled={busy} onPress={() => void run()} />
        <Button
          title="Enable network"
          disabled={busy}
          onPress={() => {
            restoreNetwork.current = null;
            TileflowOfflineSwitch.setNetworkEnabled(true);
          }}
        />
      </View>
      {status.stage === 'ready-to-stop-server' && (
        <Text>Stop the fixture server. The map will reopen automatically.</Text>
      )}
      {mounted && (
        <MapView
          key={mounted.id}
          ref={map}
          source={mounted.stage === 'streets' ? streetsSource : hostedSource}
          theme={mounted.stage === 'streets' ? 'light' : 'day'}
          onDidFinishLoadingMap={loaded}
          onMapLoadingError={failed}
          onWarning={(warning: unknown) => {
            const list = warnings.current.get(mounted.id) ?? [];
            list.push(message(warning));
            warnings.current.set(mounted.id, list);
          }}
          style={styles.map}
        >
          <Camera defaultSettings={{centerCoordinate: center, zoomLevel: 16}} />
          <GeoJSONSource
            id="example-points"
            shape={shape}
            cluster
            clusterRadius={sourceRadius}
            clusterMaxZoomLevel={17}
          >
            <CircleLayer id="example-dots" style={{circleRadius: 24, circleColor: '#ff0066'}} />
          </GeoJSONSource>
        </MapView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: '#f5f5f5'},
  title: {fontSize: 20, fontWeight: '600', padding: 12},
  result: {fontSize: 10, fontFamily: 'monospace', paddingHorizontal: 12},
  buttons: {flexDirection: 'row', justifyContent: 'space-around', padding: 8},
  map: {flex: 1},
});
