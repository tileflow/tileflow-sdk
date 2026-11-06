#!/bin/bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || "$1" != /* || -e "$1" ]]; then
  echo "Usage: $0 /new/absolute/project-directory [/absolute/swift-package-directory]" >&2
  exit 2
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"
package="${2:-$repo/platforms/ios}"
if [[ "$package" != /* || ! -f "$package/Package.swift" ]]; then
  echo "Expected the absolute directory of a Tileflow Swift package." >&2
  exit 2
fi

mkdir "$1"
cp "$repo"/platforms/ios/Benchmarks/{App.swift,RenderProbe.swift,project.yml} "$1"
cp "$repo/platforms/ios/Examples/Shared/ExampleSource.swift" "$1"
TILEFLOW_SWIFT_PACKAGE="$package" xcodegen generate --spec "$1/project.yml"
