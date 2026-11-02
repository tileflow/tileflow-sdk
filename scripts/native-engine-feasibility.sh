#!/usr/bin/env bash
# Runs the native engine feasibility checks on a booted emulator against the fixture map server
# on port 18682, then copies their receipts and pictures to $NATIVE_ENGINE_RESULTS.
set -uo pipefail
results=${NATIVE_ENGINE_RESULTS:-${RUNNER_TEMP:-/tmp}/native-engine}
mkdir -p "$results"
echo "System image: $(adb shell getprop ro.build.fingerprint | tr -d '\r')"
adb reverse tcp:18682 tcp:18682
adb logcat -c
test=dev.tileflow.sdk.nativeengine.NativeEngineFeasibilityTest
checks="$test#mapViewDrawsTheExpectedPixels,$test#pitchStopsAtTheEngineMaximum,$test#hostedMapLoadsOnlineThroughTheTransport,$test#hostedMapLoadsFromItsPackInAirplaneMode"
status=0
(cd "$(dirname "$0")/../platforms/android" &&
  ./gradlew :tileflow:connectedDebugAndroidTest --console=plain \
    -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true \
    "-Pandroid.testInstrumentationRunnerArguments.class=$checks") || status=$?
adb pull /sdcard/Android/data/dev.tileflow.sdk.test/files/native-engine "$results" || true
adb shell dumpsys SurfaceFlinger | grep -m1 'GLES:' > "$results/gles.txt" || true
adb logcat -d > "$results/logcat.txt" || true
exit "$status"
