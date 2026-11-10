#!/usr/bin/env bash
# Builds the Valhalla 3.9.1 library (libvalhalla.a) with only what an on-device router needs:
# no services, HTTP, tools, data tools, Python or Node bindings, GeoTIFF or LZ4.
# Needs scripts/build-protobuf.sh first. Usage: scripts/build-valhalla.sh [ios-sim|android]...
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
build="$here/.build"
src="$build/valhalla"
ndk="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/27.1.12297006}"
boost_dir="${BOOST_DIR:-$(brew --prefix boost)/lib/cmake/Boost-1.92.0}"
jobs="${JOBS:-8}"
build_type="${BUILD_TYPE:-Release}"

# Valhalla finds zlib through pkg-config; both platforms ship zlib in their system image.
write_zlib_pc() {
  mkdir -p "$1"
  cat > "$1/zlib.pc" <<EOF
Name: zlib
Description: system zlib
Version: 1.2.13
Libs: -lz
Cflags:
EOF
}

flags="-ffunction-sections -fdata-sections -fvisibility=hidden -fvisibility-inlines-hidden"
common=(
  -DCMAKE_BUILD_TYPE="$build_type"
  -DBUILD_SHARED_LIBS=OFF
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON
  -DENABLE_TOOLS=OFF -DENABLE_DATA_TOOLS=OFF -DENABLE_SERVICES=OFF -DENABLE_HTTP=OFF
  -DENABLE_PYTHON_BINDINGS=OFF -DENABLE_NODE_BINDINGS=OFF -DENABLE_TESTS=OFF
  -DENABLE_CCACHE=OFF -DENABLE_GEOTIFF=OFF -DENABLE_LZ4=OFF 
  -DENABLE_SINGLE_FILES_WERROR=OFF -DLOGGING_LEVEL=WARN
  -DBoost_DIR="$boost_dir"
  -DProtobuf_PROTOC_EXECUTABLE="$build/protobuf-host/install/bin/protoc"
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH
  -DCMAKE_PROJECT_INCLUDE="$here/cmake/host-protoc.cmake"
)

for t in "${@:-ios-sim android}"; do
  out="$build/valhalla-$t"
  pc="$out/pkgconfig"
  write_zlib_pc "$pc"
  export PKG_CONFIG_LIBDIR="$pc" PKG_CONFIG_PATH=""
  pb="$build/protobuf-$t/install"
  case "$t" in
    ios-sim)
      cmake -S "$src" -B "$out/build" "${common[@]}" \
        -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator \
        -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET="${IOS_DEPLOYMENT_TARGET:-16.4}" \
        -DCMAKE_CXX_FLAGS="$flags" -DCMAKE_C_FLAGS="$flags" \
        -DProtobuf_DIR="$pb/lib/cmake/protobuf" -DCMAKE_PREFIX_PATH="$pb" \
        -DCMAKE_INSTALL_PREFIX="$out/install" ;;
    android)
      cmake -S "$src" -B "$out/build" "${common[@]}" \
        -DCMAKE_TOOLCHAIN_FILE="$ndk/build/cmake/android.toolchain.cmake" \
        -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static \
        -DCMAKE_CXX_FLAGS="$flags" -DCMAKE_C_FLAGS="$flags" \
        -DProtobuf_DIR="$pb/lib/cmake/protobuf" -DCMAKE_PREFIX_PATH="$pb" \
        -DCMAKE_FIND_ROOT_PATH="$pb" \
        -DCMAKE_INSTALL_PREFIX="$out/install" ;;
    *) echo "unknown target $t" >&2; exit 2 ;;
  esac
  cmake --build "$out/build" -j "$jobs" --target valhalla
done
