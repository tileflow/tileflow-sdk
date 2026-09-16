import {
  type MobileConfiguration,
  NativeConfigurationError,
  type NativeConfigurationErrorCode,
  snapshotMobileConfiguration,
} from './mobile-configuration';

type ConfigurationModule = {readConfiguration(): Promise<unknown>};

/**
 * One reader per JS runtime, containing application data only. Native owns the process cache.
 * The locator is deliberately lazy: non-session sources must not even look up the native module.
 */
export function createNativeConfigurationReader(locate: () => unknown) {
  let pending: Promise<MobileConfiguration> | undefined;
  let owner: ConfigurationModule | undefined;
  let read: ConfigurationModule['readConfiguration'] | undefined;
  let failure: NativeConfigurationErrorCode | undefined;

  const checkOwner = () => {
    try {
      if (failure || !owner || locate() !== owner || owner.readConfiguration !== read) {
        throw new Error();
      }
    } catch {
      failure = 'NATIVE_CONFIGURATION_UNAVAILABLE';
      throw new NativeConfigurationError(failure);
    }
  };

  return Object.freeze({
    read(): Promise<MobileConfiguration> {
      if (!pending) {
        // Publish the promise before module lookup or invocation can reenter this reader.
        pending = Promise.resolve()
          .then(() => {
            const module = locate();
            if (!module || typeof module !== 'object') throw new Error();
            const method = (module as ConfigurationModule).readConfiguration;
            if (typeof method !== 'function') throw new Error();
            owner = module as ConfigurationModule;
            read = method;
            return method.call(owner);
          })
          .then((raw) => {
            checkOwner();
            return snapshotMobileConfiguration(raw);
          })
          .catch((error: unknown) => {
            // Native rejection payloads are untrusted. Retain only a recognized fixed code.
            let code: unknown;
            try {
              if (error && typeof error === 'object') {
                code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
              }
            } catch {
              /* Never retain the original error. */
            }
            failure =
              code === 'NATIVE_CONFIGURATION_INVALID'
                ? 'NATIVE_CONFIGURATION_INVALID'
                : 'NATIVE_CONFIGURATION_UNAVAILABLE';
            throw new NativeConfigurationError(failure);
          });
      }
      return pending.then(
        (configuration) => {
          checkOwner();
          return configuration;
        },
        () => {
          throw new NativeConfigurationError(failure ?? 'NATIVE_CONFIGURATION_UNAVAILABLE');
        },
      );
    },
  });
}
