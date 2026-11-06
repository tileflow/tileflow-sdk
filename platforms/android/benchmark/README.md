# Android Release benchmark

Connect one arm64 Android device. Use Android SDK Platform 36, JDK 21 with a JDK 17 Gradle
toolchain, Python 3.9+, adb and the [Bundletool](https://developer.android.com/tools/bundletool)
all-in-one JAR. For performance, serve a native Streets build with tiles containing visible
buildings at the starting camera. Use `adb reverse` to expose a loopback server to the device.

From `platforms/android`:

```sh
./gradlew -PtileflowBenchmark :benchmark:bundleEmptyRelease :benchmark:bundleMapsxRelease :benchmark:bundleServsRelease
adb reverse tcp:18645 tcp:18645
python3 benchmark/measure.py --output /tmp/tileflow-android-benchmark \
  --bundletool /path/to/bundletool-all.jar \
  --manifest http://127.0.0.1:18645/native/manifest.json
```

Pass `--longitude`, `--latitude` and `--zoom` to change the starting camera. Pass only
`--bundletool` for the size and install step or only `--manifest` to reuse the installed apps.
The command clears data in the benchmark apps. Keep the device awake and unlocked.

- Size uses the same arm64-only, R8-optimized app shell for all three variants. The map app
  opens Streets. The services variant additionally references geocoding, routing, isochrones,
  elevation and GeoIP entry points. Bundletool estimates the compressed download. Installed size
  sums the sizes of the APKs reported by `pm path`. The receipt hashes each installed APK.
- Launch time starts at a device log marker just before `am start` and ends when the map reports
  a rendered building and PixelCopy confirms a populated map surface. Cold launches clear app
  data. Warm launches recreate the Activity in the same process.
- Memory uses `dumpsys meminfo` five seconds after the first useful frame or the empty shell's
  first draw. The result compares the median idle process RSS across the two variants.
- One motion run alternates six 1.5-second pans and six zooms. Frame intervals and FPS use the renderer's
  frame-start callbacks. Run on the target physical device to evaluate device performance.
