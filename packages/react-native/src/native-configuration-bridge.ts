import {NativeModules} from 'react-native';
import {createHostedNativeBindingResolver} from './hosted-binding';
import {createNativeConfigurationReader} from './native-configuration-reader';

// Constructing this reader does not look up the module or read native configuration.
// The only shared value is application data. Each factory call owns a separate resolver.
const applicationConfiguration = createNativeConfigurationReader(
  () => NativeModules.TileflowNativeConfiguration,
);

export function createReactNativeHostedBindingResolver() {
  return createHostedNativeBindingResolver(applicationConfiguration.read);
}
