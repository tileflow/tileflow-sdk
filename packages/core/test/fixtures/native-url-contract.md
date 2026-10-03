# Check native URL resolution

`native-url-contract.mjs` is a network-free test fixture for the installed `@tileflow/core/native`
entrypoint. It checks manifest identity, references owned by manifests/styles/TileJSON, tile and
glyph placeholders, normalized hostnames and the existing URL policy. It is not a URL parser,
polyfill, manifest loader or map renderer. It makes no global assignments and has no imports.

After building Core from the SDK root, run the Node regression:

```sh
pnpm --filter @tileflow/core exec tsx --test test/native-runtime-url.test.ts
```

The regression runs isolated child processes. The Node URL cases establish the existing contract;
the React Native URL cases expose the incompatible ambient implementation. They must remain failing
until a portable product resolver implements that same contract. Do not skip them, invert their
expectations or replace the product resolver with a test resolver.

`react-native-083-url.mjs` adapts the constructor and string accessors from the pinned React Native
source identified in its header, with the MIT notice retained. Its scope is the URL API read by
Core. It omits Blob integration, Flow syntax and unused methods; it is not a replacement for testing
React Native itself. Only the Node regression installs it, inside its isolated child process.

## Run the fixture on Hermes

Use an existing, independently built React Native application with Hermes and install the exact
Core tarball being qualified. Verify that Metro resolves `@tileflow/core/native` to the installed
package's `dist/native.js`, not workspace source or a test alias. Do not change the app's URL global
or install `react-native-083-url.mjs` in the application. Record any pre-existing URL polyfill.

Copy only `native-url-contract.mjs` next to a module in that application, then invoke:

```js
import * as native from '@tileflow/core/native';
import {checkNativeUrlContract} from './native-url-contract.mjs';

const origins = ['http://127.0.0.1:8765', 'http://10.0.2.2:8765'];
const reports = origins.map((origin) => ({origin, cases: checkNativeUrlContract(native, origin)}));
console.log(JSON.stringify(reports));
if (reports.some(({cases}) => cases.some(({passed}) => !passed))) {
  throw new Error('Native URL contract failed.');
}
```

Execute this module in Hermes on both iOS and Android, not in remote debugging with another engine.
Both origins are test strings; no server or network permissions are required. Retain the report,
Core tarball integrity/commit, React Native version, OS and engine identity. All 22 cases per origin
must pass. Node results do not establish Hermes acceptance, and these URL checks do not establish
rendering, manifest loading or mobile SDK availability.
