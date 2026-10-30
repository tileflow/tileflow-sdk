#!/usr/bin/env bash
# Runs the Android instrumented suite on a booted emulator against the fixture map server.
# Usage: mobile-android-connected.sh <supported|rejected> [extra Gradle arguments]
# The expectation states whether the image's System WebView meets the SDK minimum; the
# WebView requirement test fails if the installed provider disagrees.
set -euo pipefail
expectation=$1
shift
reports=${MOBILE_ANDROID_REPORTS:-${RUNNER_TEMP:-/tmp}/android-connected}
mkdir -p "$reports"
echo "System image: $(adb shell getprop ro.build.fingerprint | tr -d '\r')"
adb shell dumpsys webviewupdate | tr -d '\r' | grep -m1 'Current WebView package'
if [[ "${RUNNER_OS:-}" == macOS ]]; then
  graphics="$(adb shell dumpsys SurfaceFlinger | tr -d '\r' | grep 'GLES:')"
  echo "$graphics"
  if [[ "$graphics" != *Apple* || "$graphics" == *SwiftShader* ]]; then
    echo 'Android latency tests on macOS require the Apple host GPU.' >&2
    exit 1
  fi
fi
adb reverse tcp:18645 tcp:18645
adb logcat -c
status=0
(cd "$(dirname "$0")/../platforms/android" &&
  ./gradlew :tileflow:connectedDebugAndroidTest --console=plain \
    "-Pandroid.testInstrumentationRunnerArguments.tileflowWebView=$expectation" "$@") || status=$?
adb logcat -d > "$reports/logcat.txt" || true
grep -F 'Tileflow: 200 view annotations,' "$reports/logcat.txt" || true
exit "$status"
