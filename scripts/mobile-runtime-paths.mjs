import path from 'node:path';

/**
 * Whether `file` lies inside `directory`. Compares with the platform's own separators and roots,
 * so Windows paths (`D:\repo\packages\core\src\native.ts`) work as POSIX ones do.
 */
export function isWithin(directory, file, paths = path) {
  const rest = paths.relative(directory, file);
  return (
    rest !== '' && rest !== '..' && !rest.startsWith(`..${paths.sep}`) && !paths.isAbsolute(rest)
  );
}
