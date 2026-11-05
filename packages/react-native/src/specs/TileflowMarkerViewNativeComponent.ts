import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export interface NativeProps extends ViewProps {
  instanceId: string;
  annotationId: string;
  optionsJson: string;
}

export default codegenNativeComponent<NativeProps>(
  'TileflowMarkerView',
) as HostComponent<NativeProps>;
