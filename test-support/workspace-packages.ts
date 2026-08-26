import {mkdir, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));

/** Make an isolated config fixture resolve selected workspace packages like an installed project. */
export async function linkWorkspacePackages(
  cwd: string,
  packageNames: readonly string[] = ['maps'],
): Promise<void> {
  const scope = join(cwd, 'node_modules', '@tileflow');
  await mkdir(scope, {recursive: true});
  for (const packageName of packageNames) {
    await symlink(
      join(workspaceRoot, 'packages', packageName),
      join(scope, packageName),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
}
