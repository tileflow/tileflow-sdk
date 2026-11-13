import {Linking, Pressable, Text, View} from 'react-native';

/** The Desfase symbol: six 4-unit tiles on a 16-unit grid. */
const tiles = [
  [0, 0],
  [6, 0],
  [3, 6],
  [9, 6],
  [6, 12],
  [12, 12],
] as const;
/** One symbol unit, in points: the symbol is 12 points wide, as in the web lockup. */
const unit = 0.77;
const halo = 'rgba(0,0,0,0.3)';
const ink = 'rgba(255,255,255,0.9)';

/**
 * The public lockup without a plate: white, with a soft dark halo, so it reads on light and dark
 * styles. The wordmark uses the platform's bold face because a native map loads no Geist outline.
 */
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
        minHeight: 44,
        padding: 10,
        flexDirection: 'row',
        alignItems: 'flex-end',
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          color: ink,
          fontSize: 17,
          fontWeight: '700',
          letterSpacing: -0.6,
          lineHeight: 19,
          textShadowColor: halo,
          textShadowOffset: {width: 0, height: 0},
          textShadowRadius: 2,
        }}
      >
        Tileflow
      </Text>
      <View
        pointerEvents="none"
        style={{width: 16 * unit, height: 16 * unit, marginLeft: 1, marginBottom: 9}}
      >
        {tiles.map(([x, y]) => (
          <View
            key={`${x}:${y}`}
            style={{
              position: 'absolute',
              left: x * unit,
              top: y * unit,
              width: 4 * unit,
              height: 4 * unit,
              backgroundColor: ink,
              shadowColor: '#000',
              shadowOffset: {width: 0, height: 0},
              shadowOpacity: 0.3,
              shadowRadius: 1,
            }}
          />
        ))}
      </View>
    </Pressable>
  );
}
