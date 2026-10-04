import assert from 'node:assert/strict';
import {
  developmentVersion,
  publicPackageNameSet,
  runtimeDependencyGroups,
  validatePublicManifest,
} from '../scripts/release-config.mjs';

/** Validate package metadata in source or after release versions are materialized. */
export function assertPublicWorkspaceManifest(name, manifest) {
  const source = manifest.version === developmentVersion;
  const projected = structuredClone(manifest);

  if (!source)
    for (const group of runtimeDependencyGroups)
      for (const [dependency, range] of Object.entries(projected[group] ?? {})) {
        if (!publicPackageNameSet.has(dependency)) continue;
        assert.ok(range.startsWith('workspace:'), `${name} must retain workspace links.`);
        projected[group][dependency] = range.slice('workspace:'.length);
      }

  validatePublicManifest(name, projected, {source});
}
