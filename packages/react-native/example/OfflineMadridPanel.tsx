import {
  type OfflineRegion,
  TileflowOfflineStore,
  TileflowOfflineSwitch,
} from '@tileflow/react-native';
import {useEffect, useRef, useState} from 'react';
import {Button, ScrollView, StyleSheet, Switch, Text, View} from 'react-native';

const regionId = 'expo-offline-madrid';

type Props = {
  mapId: string;
  disabled: boolean;
  onOpen(): Promise<unknown>;
};

export function OfflineMadridPanel({mapId, disabled, onOpen}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [region, setRegion] = useState<OfflineRegion | null>(null);
  const [network, setNetwork] = useState(TileflowOfflineSwitch.isNetworkEnabled);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    let changed = false;
    const subscription = TileflowOfflineStore.subscribe((event) => {
      if (event.type === 'changed' && event.region.id === regionId) {
        changed = true;
        setRegion(event.region);
      } else if (event.type === 'removed' && event.id === regionId) {
        changed = true;
        setRegion(null);
      }
    });

    void TileflowOfflineStore.region(regionId).then((stored) => {
      if (!active.current) return;
      if (!changed) setRegion(stored);
      // Reopening the app must also reopen the downloaded map in airplane mode.
      if (stored?.isAvailable) void onOpen().catch(report);
    }, report);

    return () => {
      active.current = false;
      subscription.remove();
    };
  }, [onOpen]);

  useEffect(() => {
    setNetwork(TileflowOfflineSwitch.isNetworkEnabled());
  }, [disabled]);

  function report(value: unknown) {
    if (active.current) setError(value instanceof Error ? value.message : String(value));
  }

  async function run(action: () => Promise<unknown>) {
    if (working || disabled) return;
    setWorking(true);
    setError('');
    try {
      await action();
      const stored = await TileflowOfflineStore.region(regionId);
      if (active.current) setRegion(stored);
    } catch (failure) {
      report(failure);
    } finally {
      if (active.current) setWorking(false);
    }
  }

  const busy = working || disabled;
  const downloading = region?.state === 'downloading' || region?.state === 'waiting';
  const size = ((region?.completedResourceBytes ?? 0) / 1_000_000).toFixed(2);
  const total = region?.requiredResourceBytes;

  return (
    <View style={styles.panel}>
      <Button
        title={expanded ? 'Hide offline Madrid' : 'Offline Madrid'}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <ScrollView style={styles.details}>
          <Text>Central Madrid · z13–15 · day and night</Text>
          <Text testID="offline-state">State: {region?.state ?? 'not downloaded'}</Text>
          <Text>
            Resources: {region?.completedResourceCount ?? 0}/{region?.requiredResourceCount ?? 0}
          </Text>
          <Text>
            Size: {size} MB{total === undefined ? '' : ` / ${(total / 1_000_000).toFixed(2)} MB`}
          </Text>
          <Text>
            Expires: {region?.expiresAt ? new Date(region.expiresAt).toLocaleString() : '—'} (
            {region?.expiryState?.type ?? '—'})
          </Text>
          <View style={styles.row}>
            <Text>SDK network</Text>
            <Switch
              accessibilityLabel="SDK network"
              value={network}
              disabled={busy}
              onValueChange={(enabled) => {
                try {
                  TileflowOfflineSwitch.setNetworkEnabled(enabled);
                  // The native setter may still be queued when a synchronous getter runs.
                  setNetwork(enabled);
                } catch (failure) {
                  report(failure);
                }
              }}
            />
          </View>
          <View style={styles.row}>
            <Button
              title="Download"
              disabled={busy || downloading || !network}
              onPress={() =>
                void run(() =>
                  TileflowOfflineStore.loadRegion(regionId, {
                    geometry: {
                      type: 'boundingBox',
                      west: -3.715,
                      south: 40.41,
                      east: -3.685,
                      north: 40.43,
                    },
                    content: {type: 'hosted', mapId, themes: ['day', 'night']},
                    minZoom: 13,
                    maxZoom: 15,
                    terrainMaxZoom: 12,
                    metadata: {name: 'Central Madrid'},
                  }),
                )
              }
            />
            <Button
              title="Pause"
              disabled={busy || !downloading}
              onPress={() => void run(() => TileflowOfflineStore.pauseRegion(regionId))}
            />
            <Button
              title="Resume"
              disabled={busy || !region || downloading || region.state === 'complete' || !network}
              onPress={() => void run(() => TileflowOfflineStore.resumeRegion(regionId))}
            />
            <Button
              title="Delete"
              disabled={busy || !region}
              onPress={() => void run(() => TileflowOfflineStore.removeRegion(regionId))}
            />
          </View>
          <Button
            title="Open downloaded map"
            disabled={busy || !region?.isAvailable}
            onPress={() => void run(onOpen)}
          />
          {!!region?.error && <Text selectable>{region.error.code}</Text>}
          {!!error && <Text selectable>{error}</Text>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {paddingHorizontal: 12},
  details: {maxHeight: 250},
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
