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
adb reverse tcp:18645 tcp:18645
adb logcat -c
status=0
(cd "$(dirname "$0")/../platforms/android" &&
  ./gradlew :tileflow:connectedDebugAndroidTest --console=plain \
    "-Pandroid.testInstrumentationRunnerArguments.tileflowWebView=$expectation" "$@") || status=$?
adb logcat -d > "$reports/logcat.txt" || true
exit "$status"
