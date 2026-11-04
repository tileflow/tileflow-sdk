#!/usr/bin/env bash
# Runs the Android instrumented suite on a booted emulator against the fixture map server.
# Usage: mobile-android-connected.sh <supported|rejected> [extra Gradle arguments]
# The expectation states whether the image's System WebView meets the SDK minimum; the
# WebView requirement test fails if the installed provider disagrees.
set -euo pipefail
# Gradle needs JDK 17. Hosted runners default to a newer JDK and name 17 in JAVA_HOME_17_X64, a
# runner variable that the workflow's env context does not carry.
if [ -n "${JAVA_HOME_17_X64:-}" ]; then export JAVA_HOME="$JAVA_HOME_17_X64"; fi
expectation=$1
shift
reports=${MOBILE_ANDROID_REPORTS:-${RUNNER_TEMP:-/tmp}/android-connected}
mkdir -p "$reports"
echo "System image: $(adb shell getprop ro.build.fingerprint | tr -d '\r')"
adb shell dumpsys webviewupdate | tr -d '\r' | grep -m1 'Current WebView package'
graphics="$(adb shell dumpsys SurfaceFlinger | tr -d '\r' | grep 'GLES:')"
echo "$graphics"
if [[ "${TILEFLOW_ANDROID_REQUIRE_GPU:-0}" == 1 ]]; then
  if echo "$graphics" | grep -Eiq 'SwiftShader|llvmpipe|lavapipe|software'; then
    echo 'The strict annotation benchmark requires hardware graphics.' >&2
    exit 1
  fi
fi
adb shell wm size
adb shell wm density
adb reverse tcp:18645 "tcp:${TILEFLOW_FIXTURE_PORT:-18645}"
adb logcat -c
# Hosted emulators draw with a software GPU too slowly for the timing budgets of these WebView
# map tests; they run on local emulators and devices, and go with the WebView engine.
skipped=()
if [ "${TILEFLOW_HOSTED_EMULATOR:-}" = "true" ]; then
  timed=(
    dev.tileflow.sdk.CameraIntegrationTest#movementsAnswerWithHowTheyEnded
    dev.tileflow.sdk.MapIntegrationTest#eventLevelsCameraReasonsAndLargeContentOverTheDataChannel
  )
  skipped=("-Pandroid.testInstrumentationRunnerArguments.notClass=$(IFS=,; echo "${timed[*]}")")
fi
status=0
(cd "$(dirname "$0")/../platforms/android" &&
  ./gradlew :tileflow:connectedDebugAndroidTest --console=plain \
    "-Pandroid.testInstrumentationRunnerArguments.tileflowWebView=$expectation" \
    ${skipped[@]+"${skipped[@]}"} "$@") || status=$?
adb logcat -d > "$reports/logcat.txt" || true
grep -E 'Tileflow: (200 view annotations,|annotation performance mode)' "$reports/logcat.txt" || true
exit "$status"
