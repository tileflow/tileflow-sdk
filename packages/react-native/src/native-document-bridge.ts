import {NativeModules} from 'react-native';
import {createNativeDocumentTransport} from './native-document-wire';

// Application transport capacity is shared; document cancellation belongs to each operation.
// Importing this module does not evaluate NativeModules or start a request.
const transport = createNativeDocumentTransport(() => NativeModules.TileflowNativeDocuments);

export function getNativeDocumentTransport() {
  return transport;
}
