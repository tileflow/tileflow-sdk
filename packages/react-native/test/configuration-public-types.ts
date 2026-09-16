import type * as Public from '@tileflow/react-native';

// @ts-expect-error Application configuration is not a public SDK type.
export type PrivateConfiguration = Public.MobileConfiguration;
// @ts-expect-error Configuration diagnostics stay at the internal lifecycle boundary.
export type PrivateConfigurationError = Public.NativeConfigurationError;
// @ts-expect-error Session authority is not exported by the framework component contract.
export type PrivateSession = Public.HostedNativeSessionController;
// @ts-expect-error Native grants are not part of public state.
export type PrivateAuthority = Public.HostedNativeSessionAuthority;
// @ts-expect-error The private source-to-session resolver is not a public runtime API.
export type PrivateResolver = typeof Public.createHostedNativeBindingResolver;
// @ts-expect-error The private native module reader is not a public runtime API.
export type PrivateReader = typeof Public.createNativeConfigurationReader;
// @ts-expect-error No application-level JS setter is introduced.
export type PrivateSetter = typeof Public.configureTileflowMobile;
// @ts-expect-error No public Hosted client is introduced.
export type PrivateClient = typeof Public.createTileflowMobileClient;
// @ts-expect-error No competing React provider is introduced.
export type PrivateProvider = typeof Public.TileflowProvider;

const source = {map: 'streets', manifestUrl: 'https://maps.example.test/manifest.json'};
const valid: Public.MapProps = {source, theme: 'system'};
const credential: Public.MapProps = {
  source,
  // @ts-expect-error Credentials are native application configuration, not props.
  credential: 'placeholder',
};
const origin: Public.MapProps = {
  source,
  // @ts-expect-error The approved origin is not a component override.
  apiOrigin: 'https://api.example.test',
};
const configuration: Public.MapProps = {
  source,
  // @ts-expect-error There is no alternate per-Map configuration path.
  configuration: {},
};
void [valid, credential, origin, configuration];
