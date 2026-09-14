import {Appearance} from 'react-native';
import {
  type AppearanceSelection,
  type AppearanceState,
  createAppearanceObserver,
} from './appearance';

// Constructing the broker does not read Appearance or create a native subscription.
const observer = createAppearanceObserver({
  getColorScheme: () => Appearance.getColorScheme(),
  addChangeListener: (listener) => Appearance.addChangeListener(listener),
});

/** Internal native boundary. Not imported or exported by the type-only package entry. */
export function observeNativeAppearance(
  selection: AppearanceSelection,
  listener: (state: AppearanceState) => void,
): () => void {
  return observer.subscribe(selection, listener);
}
