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

/** Internal native boundary. Package import is inert; only a mounted system theme subscribes. */
export function observeNativeAppearance(
  selection: AppearanceSelection,
  listener: (state: AppearanceState) => void,
): () => void {
  return observer.subscribe(selection, listener);
}
