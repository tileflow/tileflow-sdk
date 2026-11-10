#!/usr/bin/env bash
# Builds protobuf 3.21.12 (the last release without Abseil) three times:
#   host      protoc, used to generate Valhalla's message code
#   ios-sim   libprotobuf-lite.a for the iOS simulator (arm64)
#   android   libprotobuf-lite.a for Android arm64-v8a
# Usage: scripts/build-protobuf.sh [host|ios-sim|android]...
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
build="$here/.build"
src="$build/src/protobuf-3.21.12"
ndk="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/27.1.12297006}"
jobs="${JOBS:-6}"

common=(
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON
  -Dprotobuf_BUILD_TESTS=OFF
  -Dprotobuf_BUILD_SHARED_LIBS=OFF
  -Dprotobuf_WITH_ZLIB=OFF
  -DCMAKE_CXX_STANDARD=17
)

for target in "${@:-host ios-sim android}"; do
  for t in $target; do
    out="$build/protobuf-$t"
    case "$t" in
      host)
        cmake -S "$src" -B "$out/build" "${common[@]}" -Dprotobuf_BUILD_PROTOC_BINARIES=ON \
          -DCMAKE_INSTALL_PREFIX="$out/install" ;;
      ios-sim)
        cmake -S "$src" -B "$out/build" "${common[@]}" -Dprotobuf_BUILD_PROTOC_BINARIES=OFF \
          -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator \
          -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=16.4 \
          -DCMAKE_CXX_FLAGS="-ffunction-sections -fdata-sections" \
          -DCMAKE_INSTALL_PREFIX="$out/install" ;;
      android)
        cmake -S "$src" -B "$out/build" "${common[@]}" -Dprotobuf_BUILD_PROTOC_BINARIES=OFF \
          -DCMAKE_TOOLCHAIN_FILE="$ndk/build/cmake/android.toolchain.cmake" \
          -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static \
          -DCMAKE_CXX_FLAGS="-ffunction-sections -fdata-sections" \
          -DCMAKE_INSTALL_PREFIX="$out/install" ;;
      *) echo "unknown target $t" >&2; exit 2 ;;
    esac
    cmake --build "$out/build" -j "$jobs" --target install
  done
done
