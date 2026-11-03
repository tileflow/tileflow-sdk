import {
  configuredServices,
  type OfflineRegion,
  type OfflineRegionLoadOptions,
  TileflowGeoIP,
  TileflowOfflineStore,
  TileflowOfflineSwitch,
  TileflowSearch,
} from '@tileflow/react-native';
import {useCallback, useEffect, useState} from 'react';
import {Button, SafeAreaView, ScrollView, StyleSheet, Text, View} from 'react-native';

// The Hosted map of scripts/mobile-fixture-server.mjs. Point TILEFLOW_API_ORIGIN at that server,
// and set any TILEFLOW_MAP_CREDENTIAL, before prebuild.
const fixtureMap = 'map_offlinefixture01';
const region: OfflineRegionLoadOptions = {
  geometry: {type: 'boundingBox', west: -3.705, south: 40.416, east: -3.695, north: 40.424},
  content: {type: 'hosted', mapId: fixtureMap, themes: ['day']},
  minZoom: 13,
  maxZoom: 15,
  metadata: {name: 'Puerta del Sol'},
};
const selfTest = process.env.EXPO_PUBLIC_TILEFLOW_SELF_TEST === '1';

function describe(region: OfflineRegion) {
  return `${region.id}: ${region.state}, ${region.completedPackCount}/${region.requiredPackCount} packs, ${region.isAvailable ? 'available' : 'not available'}`;
}

/**
 * Downloads the fixture region, waits for it through region events, then switches the network
 * off and checks that the region stays available. The result is shown as one JSON line.
 */
async function runSelfTest(): Promise<Record<string, unknown>> {
  const events: string[] = [];
  await TileflowOfflineStore.removeRegion('self-test').catch(() => undefined);
  const complete = new Promise<OfflineRegion>((resolve, reject) => {
    const subscription = TileflowOfflineStore.subscribe((event) => {
      if (event.type !== 'changed' || event.region.id !== 'self-test') return;
      events.push(event.region.state);
      if (event.region.state === 'complete') {
        subscription.remove();
        resolve(event.region);
      } else if (event.region.state === 'failed') {
        subscription.remove();
        reject(new Error(`download failed: ${event.region.error?.code}`));
      }
    });
  });
  const estimate = await TileflowOfflineStore.estimateRegion(region);
  await TileflowOfflineStore.loadRegion('self-test', region);
  const downloaded = await complete;
  TileflowOfflineSwitch.setNetworkEnabled(false);
  try {
    const stored = await TileflowOfflineStore.region('self-test');
    return {
      ok: stored?.isAvailable === true && !TileflowOfflineSwitch.isNetworkEnabled(),
      services: configuredServices(),
      estimate: {packCount: estimate.packCount, billable: estimate.billableResourceCount},
      packs: downloaded.completedPackCount,
      events: [...new Set(events)],
      offlineAvailable: stored?.isAvailable,
      metadata: stored?.options.metadata,
    };
  } finally {
    TileflowOfflineSwitch.setNetworkEnabled(true);
  }
}

export default function App() {
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<string>(selfTest ? 'running' : 'idle');
  const log = useCallback(
    (line: string) => setLines((previous) => [line, ...previous].slice(0, 40)),
    [],
  );
  const attempt = useCallback(
    (name: string, work: () => Promise<unknown>) => () => {
      work().then(
        (value) => log(`${name}: ${JSON.stringify(value).slice(0, 400)}`),
        (error: Error & {code?: string}) =>
          log(`${name} failed: ${error.code ?? ''} ${error.message}`),
      );
    },
    [log],
  );

  useEffect(() => {
    const subscription = TileflowOfflineStore.subscribe((event) =>
      log(event.type === 'changed' ? describe(event.region) : `${event.id}: removed`),
    );
    return () => subscription.remove();
  }, [log]);

  useEffect(() => {
    if (!selfTest) return;
    runSelfTest().then(
      (value) => setResult(JSON.stringify(value)),
      (error: Error & {code?: string}) =>
        setResult(JSON.stringify({ok: false, code: error.code, message: error.message})),
    );
  }, []);

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>Tileflow for React Native</Text>
      <Text testID="self-test-result" style={styles.result}>
        TILEFLOW_SELF_TEST {result}
      </Text>
      <View style={styles.buttons}>
        <Button title="Services" onPress={() => log(JSON.stringify(configuredServices()))} />
        <Button title="Locate" onPress={attempt('GeoIP', () => TileflowGeoIP.locate())} />
        <Button
          title="Geocode"
          onPress={attempt('Geocode', () =>
            TileflowSearch.geocode({query: 'Puerta del Sol', limit: 1}),
          )}
        />
      </View>
      <View style={styles.buttons}>
        <Button
          title="Estimate"
          onPress={attempt('Estimate', () => TileflowOfflineStore.estimateRegion(region))}
        />
        <Button
          title="Download"
          onPress={attempt('Load', () => TileflowOfflineStore.loadRegion('madrid', region))}
        />
        <Button
          title="Regions"
          onPress={attempt('Regions', async () =>
            (await TileflowOfflineStore.allRegions()).map(describe),
          )}
        />
        <Button
          title="Remove"
          onPress={attempt('Remove', () => TileflowOfflineStore.removeRegion('madrid'))}
        />
      </View>
      <ScrollView style={styles.log}>
        {lines.map((line, index) => (
          <Text key={index} style={styles.line}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, padding: 16},
  title: {fontSize: 20, fontWeight: '600', marginVertical: 12},
  result: {fontFamily: 'Menlo', fontSize: 11, marginBottom: 12},
  buttons: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8},
  log: {flex: 1, marginTop: 8},
  line: {fontFamily: 'Menlo', fontSize: 11, marginBottom: 4},
});
