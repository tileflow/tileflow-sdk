import path from 'node:path';

type PathBoundaryApi = {
  isAbsolute(path: string): boolean;
  relative(from: string, to: string): string;
  resolve(...paths: string[]): string;
  sep: string;
};

export function isPathWithin(root: string, candidate: string): boolean {
  return isPathWithinWith(path, root, candidate);
}

export function isPathWithinWith(
  pathApi: PathBoundaryApi,
  root: string,
  candidate: string,
): boolean {
  const relativePath = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate));
  return (
    relativePath === '' ||
    (!pathApi.isAbsolute(relativePath) &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${pathApi.sep}`))
  );
}
