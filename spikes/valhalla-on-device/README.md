# Valhalla on device (measurement spike)

Exploratory code, not part of any package. It builds Valhalla 3.9.1 as a static library for the
iOS simulator (arm64) and Android (arm64-v8a) with only what the `route` action needs, links it
into two minimal test apps, and measures binary size, route latency, memory and start-up over
graph archives built with the Tileflow routing network configuration.

Nothing here is published, and nothing in `packages/` or `platforms/` depends on it.

## What is built

- **protobuf 3.21.12** (the last release without Abseil): `protoc` for the host and
  `libprotobuf-lite.a` for each target.
- **Valhalla 3.9.1** (`libvalhalla.a`) with services, HTTP, tools, data tools, Python and Node
  bindings, GeoTIFF and LZ4 turned off. The remaining dependencies are zlib from the system and
  Boost headers (no compiled Boost libraries). iOS needs a deployment target of 16.3 or later:
  Valhalla formats floating-point numbers with `std::format`.
- **`native/tf_valhalla`**: a C surface over Valhalla's actor (`tf_router_create`,
  `tf_router_route`) and the measurement harness both apps call (`tf_bench_run`).
- **`ios/`**: an XcodeGen project with `ValhallaBench` and `BaselineBench`, the same app without
  Valhalla, for the size comparison.
- **`android/`**: one app with two flavours, `valhalla` and `baseline`.

## Running it

Requirements: Xcode with an iOS simulator runtime, the Android NDK 27.1, CMake, pkg-config,
Boost headers (`brew install boost pkgconf`), XcodeGen, Node.js and Docker (for the server
comparison). Keep at least 15 GB free; everything is written under `.build/`.

```sh
scripts/build-protobuf.sh host ios-sim android
scripts/build-valhalla.sh ios-sim android

# Wrapper libraries
cmake -S native -B .build/tf-ios-sim -DTF_TARGET=ios-sim -DBOOST_INCLUDE="$(brew --prefix boost)/include" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=16.4 && cmake --build .build/tf-ios-sim
cmake -S native -B .build/tf-android -DTF_TARGET=android -DBOOST_INCLUDE="$(brew --prefix boost)/include" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE="$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26 -DANDROID_STL=c++_static && cmake --build .build/tf-android

# Apps
(cd ios && xcodegen generate && xcodebuild -project ValhallaSpike.xcodeproj -scheme ValhallaBench \
  -configuration Release -sdk iphonesimulator -arch arm64 -derivedDataPath ../.build/ios-dd build)
mkdir -p .build/jniLibs/arm64-v8a
llvm-strip -o .build/jniLibs/arm64-v8a/libtf_valhalla.so .build/tf-android/libtf_valhalla.so
(cd android && ./gradlew assembleValhallaRelease assembleBaselineRelease)
```

Graph archives (`graph.tar`) come from the routing network builder. Install the apps, boot a
simulator and an emulator, then run every plan in a fresh process:

```sh
scripts/run-matrix.sh .build/results ios <graphs dir> <region>...
scripts/run-matrix.sh .build/results android <graphs dir> <region>...
```

`bench/cases.json` holds the routes of each region and `bench/make-plan.mjs` turns them into
plans: the pinned image's base Valhalla configuration (`bench/valhalla-base-config.json`, from
`valhalla_build_config`) with the routing engine's overrides, a 64 MiB tile cache, and either
Valhalla's default label reservations or small ones (`--labels small`). `--tile-dir` reads
loose tiles instead of the archive. `bench/graph-stats.py` measures compressed tile sizes and
cuts an archive down to the tiles that intersect a box.

## What a result holds

For each plan: the router's creation time, and per case the first (cold) and median warm wall
time, thread CPU time, route length and maneuvers, and memory after the call. iOS memory is the
task's physical footprint and its peak (what the system's memory limit counts); Android memory
is `/proc/self/status` (`RssAnon`, `RssFile`, `VmHWM`). On Android the guest page cache is
dropped before each plan, and `loadLibraryMs` times `System.loadLibrary`.

Simulator and emulator timings come from the host's CPU and storage. They show orders of
magnitude, not device numbers.
