import {Linking, Pressable, View} from 'react-native';

export function CatalogBranding() {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Visit Tileflow"
      onPress={() => {
        void Linking.openURL('https://tileflow.dev/').catch(() => undefined);
      }}
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        pointerEvents="none"
        style={{
          width: 30,
          height: 30,
          padding: 3,
          borderRadius: 4,
          backgroundColor: 'rgba(255,255,255,0.9)',
          shadowColor: '#000',
          shadowOffset: {width: 0, height: 1},
          shadowOpacity: 0.22,
          shadowRadius: 3,
          elevation: 2,
        }}
      >
        {[
          [0, 0],
          [6, 0],
          [3, 6],
          [9, 6],
          [6, 12],
          [12, 12],
        ].map(([x, y]) => (
          <View
            key={`${x}:${y}`}
            style={{
              position: 'absolute',
              left: 3 + x * 1.5,
              top: 3 + y * 1.5,
              width: 6,
              height: 6,
              backgroundColor: '#252525',
            }}
          />
        ))}
      </View>
    </Pressable>
  );
}
