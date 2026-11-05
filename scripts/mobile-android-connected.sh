#!/usr/bin/env bash
# Runs the Android instrumented suite on a booted emulator against the fixture map server.
# Usage: mobile-android-connected.sh [Gradle arguments]
set -euo pipefail
# Gradle needs JDK 17. Hosted runners default to a newer JDK and name 17 in JAVA_HOME_17_X64, a
# runner variable that the workflow's env context does not carry.
if [ -n "${JAVA_HOME_17_X64:-}" ]; then export JAVA_HOME="$JAVA_HOME_17_X64"; fi
reports=${MOBILE_ANDROID_REPORTS:-${RUNNER_TEMP:-/tmp}/android-connected}
mkdir -p "$reports"
echo "System image: $(adb shell getprop ro.build.fingerprint | tr -d '\r')"
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
status=0
(cd "$(dirname "$0")/../platforms/android" &&
  ./gradlew :tileflow:connectedDebugAndroidTest --console=plain "$@") || status=$?
adb logcat -d > "$reports/logcat.txt" || true
grep -E 'Tileflow: (200 view annotations,|annotation performance mode)' "$reports/logcat.txt" || true
exit "$status"
