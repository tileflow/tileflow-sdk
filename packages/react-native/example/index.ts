import {registerRootComponent} from 'expo';
import App from './App';
import LineBackgroundProof from './LineBackgroundProof';

registerRootComponent(
  process.env.EXPO_PUBLIC_TILEFLOW_LINE_PROOF === '1' ? LineBackgroundProof : App,
);
