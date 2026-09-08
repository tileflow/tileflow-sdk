import {
  staticTextCoverageBase64,
  staticTextCoverageMaximumCodePoint,
  staticTextCoveragePointCount,
  staticTextCoverageSha256,
} from './text-coverage.generated';

let coverage: Uint8Array | undefined;

export {staticTextCoveragePointCount, staticTextCoverageSha256};

export function isSupportedStaticTextCodePoint(codePoint: number) {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 0 ||
    codePoint > staticTextCoverageMaximumCodePoint
  ) {
    return false;
  }

  coverage ??= Uint8Array.from(atob(staticTextCoverageBase64), (character) =>
    character.charCodeAt(0),
  );
  return (coverage[codePoint >> 3]! & (1 << (codePoint & 7))) !== 0;
}
