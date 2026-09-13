# Validate and build native artifacts

Use a project-local CLI version that includes the native artifact selector and a trusted
`tileflow.config.ts`. Follow the [installation instructions](../README.md) first. The following
commands prepare files; they do not install or start a mobile renderer.

```sh
npx tileflow validate --renderer native --target local --json
npx tileflow build --renderer native --target local --out public/tileflow --json
```

`validate` prepares and checks the complete theme family without writing production output.
`build` writes the checked generation beneath `public/tileflow/native`, including a strict version-1
runtime manifest and a separate `native-build.json` record. Serve the complete renderer directory,
not just the style. A failed compatibility check leaves existing output unchanged.

Both commands accept `--renderer web|native`; omission means `web`. Renderer selection is separate
from `--target local|hosted`. Existing `validate --target hosted` continues to perform web Hosted
preflight. Native with `--target hosted` fails with `NATIVE_RENDERER_UNSUPPORTED` before loading the
config or writing files. `build --target hosted` is not publication and is rejected; web Hosted
publication continues to use the existing `deploy` command. This block adds no native Hosted path.

JSON success uses the existing version-1 command envelope. Native results additionally identify
`renderer: 'native'`, `profile: 'native-v1'` and `validation: 'static-artifacts'`. JSON failure writes
one structured envelope to stderr, leaves stdout empty and exits nonzero. Native diagnostics have
safe JSON Pointers, stable codes, severity and suggestions. Unknown renderer names are not echoed.
The ordinary web commands and their default artifact bytes retain their existing behavior.

Native preparation rejects incompatible projections, terrain, browser PMTiles/contour protocols,
missing text providers and unsupported style values rather than degrading them silently. It preserves
shared icon inheritance and independent sprite densities, and maps verified licensed TTF/OTF faces
into native style declarations. See the
[profile contract](https://github.com/tileflow/tileflow-sdk/blob/main/packages/core/docs/native-artifact-profile.md)
and [artifact layout](https://github.com/tileflow/tileflow-sdk/blob/main/packages/dev/docs/native-artifacts.md).

`preview`, `init` and Capture do not gain native behavior from this selector. There is no React Native
package/component, Expo setup, native transport, manifest-fetch runtime or device qualification here.
A passed static check or Chromium capture does not establish Hermes, iOS/Android, Hosted or mobile
availability. Package publication remains the existing separate release process.
