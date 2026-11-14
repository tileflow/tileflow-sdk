import {
  Camera,
  MapView,
  type MapViewRef,
  TileflowOfflineStore,
  TileflowOfflineSwitch,
} from '@tileflow/react-native';
import {useEffect, useRef, useState} from 'react';
import {Platform, Text, View} from 'react-native';
import {createLineBackgroundControl} from './LineBackgroundControl';

const origin = process.env.EXPO_PUBLIC_TILEFLOW_FIXTURE_ORIGIN ?? 'http://127.0.0.1:18645';
const control = createLineBackgroundControl(origin, Platform.OS);
const mapId = 'map_offlinefixture01';
const source = {mapId};
const cases = [
  ...[false, true].flatMap((dark) =>
    [12, 14, 16].map((zoom, index) => ({
      theme: `line-backed-${dark ? 'dark' : 'light'}`,
      zoom,
      pitch: (index + (dark ? 1 : 0)) % 2 ? 45 : 0,
      offline: false,
    })),
  ),
  ...['light', 'dark'].map((theme) => ({
    theme: `line-plain-${theme}`,
    zoom: 14,
    pitch: 0,
    offline: false,
  })),
  ...['light', 'dark'].map((theme) => ({
    theme: `line-backed-${theme}`,
    zoom: 14,
    pitch: 0,
    offline: true,
  })),
];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Opt-in real Fabric qualification; the local capture runner acknowledges each visible case. */
export default function LineBackgroundProof() {
  const map = useRef<MapViewRef>(null);
  const load = useRef<{id: number; resolve(): void; reject(error: Error): void} | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [status, setStatus] = useState('Preparing line backgrounds');
  const bounds = useRef({width: 0, height: 0});
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await control.report({ready: false, done: false, error: null, ack: -1});
      for (let next = 0; next < cases.length && !cancelled; next++) {
        const current = cases[next]!;
        if (current.offline && !cases[next - 1]?.offline) {
          if (await TileflowOfflineStore.region('line-background-proof'))
            await TileflowOfflineStore.removeRegion('line-background-proof');
          await TileflowOfflineStore.loadRegion('line-background-proof', {
            geometry: {
              type: 'boundingBox',
              west: -3.705,
              south: 40.416,
              east: -3.695,
              north: 40.424,
            },
            content: {type: 'hosted', mapId, themes: ['line-backed-light', 'line-backed-dark']},
            minZoom: 13,
            maxZoom: 15,
          });
          const deadline = Date.now() + 60_000;
          for (;;) {
            const region = await TileflowOfflineStore.region('line-background-proof');
            if (region?.state === 'complete') break;
            if (region?.state === 'failed' || Date.now() > deadline)
              throw new Error(`Offline download: ${region?.error?.code ?? region?.state}`);
            await delay(100);
          }
          TileflowOfflineSwitch.setNetworkEnabled(false);
        }
        const loaded = new Promise<void>((resolve, reject) => {
          load.current = {id: next, resolve, reject};
        });
        setStatus(
          `${current.offline ? 'Offline' : 'Online'} · ${current.theme} · z${current.zoom} · pitch ${current.pitch}`,
        );
        setIndex(next);
        await Promise.race([
          loaded,
          delay(30_000).then(() => {
            throw new Error('Map load timeout');
          }),
        ]);
        await delay(750);
        const camera = {center: await map.current!.getCenter(), zoom: await map.current!.getZoom()};
        if (Math.abs(camera.zoom - current.zoom) > 0.02)
          throw new Error('Camera did not reach the requested zoom');
        await control.report({
          index: next,
          ...current,
          ready: true,
          contentReady: true,
          camera,
          bounds: bounds.current,
        });
        await control.waitForCapture(next, () => cancelled);
        await control.report({ready: false});
      }
      TileflowOfflineSwitch.setNetworkEnabled(true);
      if (!cancelled) {
        setStatus('Line backgrounds complete');
        await control.report({done: true});
      }
    })().catch(async (error: unknown) => {
      TileflowOfflineSwitch.setNetworkEnabled(true);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      await control.report({error: message, ready: false});
    });
    return () => {
      cancelled = true;
      TileflowOfflineSwitch.setNetworkEnabled(true);
    };
  }, []);
  const current = index === null ? undefined : cases[index];
  return (
    <View style={{flex: 1, backgroundColor: '#fff'}}>
      <Text style={{paddingTop: 48, paddingHorizontal: 8, paddingBottom: 8}}>{status}</Text>
      {current && (
        <MapView
          key={index}
          ref={map}
          source={source}
          theme={current.theme}
          style={{flex: 1}}
          onLayout={({nativeEvent}) => {
            bounds.current = nativeEvent.layout;
          }}
          onDidFinishLoadingMap={() => {
            if (load.current?.id === index) load.current.resolve();
          }}
          onMapLoadingError={(event) => {
            if (load.current?.id === index) load.current.reject(new Error(JSON.stringify(event)));
          }}
        >
          <Camera
            defaultSettings={{
              centerCoordinate: [-3.7, 40.42],
              zoomLevel: current.zoom,
              pitch: current.pitch,
            }}
          />
        </MapView>
      )}
    </View>
  );
}
