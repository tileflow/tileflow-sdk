import type {CodegenTypes, HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export type MapEvent = Readonly<{
  instanceId: string;
  type: string;
  payload: string;
}>;

export interface NativeProps extends ViewProps {
  instanceId: string;
  sourceJson: string;
  appearanceJson: string;
  optionsJson: string;
  onMapEvent?: CodegenTypes.DirectEventHandler<MapEvent>;
}

export default codegenNativeComponent<NativeProps>('TileflowMapView') as HostComponent<NativeProps>;
