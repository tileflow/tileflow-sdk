# iOS Release benchmarks

Compare arm64 app size and measure Streets startup, frame cadence and resident memory. Use an
Apple silicon Mac with Xcode, XcodeGen and Python 3. Run from the repository root.

```sh
out="$(mktemp -d /tmp/tileflow-ios.XXXXXXXX)"
scripts/ios-benchmark-prepare.sh "$out/project"
project="$out/project/TileflowBenchmarks.xcodeproj"
```

The prepare script runs XcodeGen. Pass an absolute Swift package directory as its second argument
to measure a packaged SDK.

## App size

```sh
for scheme in Empty Maps MapsAndServices; do
  xcodebuild archive -project "$project" -scheme "$scheme" -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath "$out/device" \
    -archivePath "$out/$scheme.xcarchive" \
    CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES
done
python3 platforms/ios/Benchmarks/measure.py size "$out"
```

`size-receipt.json` compares ZIP bytes and the sum of regular files in each app bundle against
`Empty`. These are local size proxies. For download and installation estimates, export signed
archives with App Thinning and compare the same device variant in all three reports.
[Apple’s app size guide](https://developer.apple.com/documentation/Xcode/reducing-your-app-s-size)

## Streets on the simulator

Boot an arm64 iPhone simulator and copy its UDID. For a local smoke run, start
`node scripts/mobile-fixture-server.mjs` in another terminal after building Core, Dev and Maps.
The built-in Streets scene uses synthetic city tiles. To measure an urban workload and cache
reuse, use a versioned Streets manifest with real tiles around Madrid and cacheable resources.

```sh
device='<simulator-udid>'
manifest='http://127.0.0.1:18645/native/manifest.json'
for scheme in EmptyBenchmark StreetsBenchmark; do
  xcodebuild build -project "$project" -scheme "$scheme" -configuration Release \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$out/sim" \
    CODE_SIGNING_ALLOWED=NO ARCHS=arm64 ONLY_ACTIVE_ARCH=YES
done
python3 platforms/ios/Benchmarks/measure.py simulator --device "$device" \
  --apps "$out/sim/Build/Products/Release-iphonesimulator" \
  --manifest "$manifest" --map streets --output "$out/performance"
```

The runner reinstalls the benchmark apps for each cold run and keeps the Streets install for the
warm relaunch. It records the first full renderer frame with visible buildings, timed from the
app launch delegate and, when available, process creation. During pan and zoom it reports p95
intervals and FPS from renderer completions. Idle and peak sampled RSS are compared with the
empty app. Use a physical iPhone to qualify performance and Instruments to measure display
presentation.
