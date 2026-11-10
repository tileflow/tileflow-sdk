#!/usr/bin/env bash
# Runs every plan (region × label reservation) in a fresh app process on the booted iOS
# simulator and/or the running Android emulator, and collects the results.
#   scripts/run-matrix.sh <results dir> <ios|android> <graphs dir> <region>...
# Each region needs <graphs dir>/<region>/graph.tar. LABELS="default small" by default.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="$1"; platform="$2"; graphs="$3"; shift 3
labels="${LABELS:-default small}"
repeats="${REPEATS:-5}"
mkdir -p "$out"
adb="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"

case "$platform" in
  ios)
    device="${IOS_DEVICE:-booted}"
    bundle=dev.tileflow.spike.valhalla
    container="$(xcrun simctl get_app_container "$device" "$bundle" data)"
    for region in "$@"; do
      mkdir -p "$container/Documents/graphs/$region"
      # A clone on APFS: no extra disk.
      [ -f "$container/Documents/graphs/$region/graph.tar" ] ||
        cp -c "$graphs/$region/graph.tar" "$container/Documents/graphs/$region/graph.tar"
      for l in $labels; do
        name="$region-$l.json"
        node "$here/bench/make-plan.mjs" --region "$region" --labels "$l" --repeats "$repeats" \
          --keep-answers --archive "$container/Documents/graphs/$region/graph.tar" > "$container/Documents/$name"
        rm -f "$container/Documents/$name.result.json"
        xcrun simctl terminate "$device" "$bundle" 2>/dev/null || true
        xcrun simctl launch "$device" "$bundle" -plan "$container/Documents/$name" > /dev/null
        for _ in $(seq 1 240); do
          [ -f "$container/Documents/$name.result.json" ] && break
          sleep 1
        done
        cp "$container/Documents/$name.result.json" "$out/ios-$name"
        echo "ios $region $l done"
      done
    done ;;
  android)
    pkg=dev.tileflow.spike.valhalla
    files="/data/data/$pkg/files"
    "$adb" root > /dev/null; sleep 1
    owner="$("$adb" shell stat -c %u "/data/data/$pkg" | tr -d '\r')"
    for region in "$@"; do
      if [ -z "$("$adb" shell ls "$files/graphs/$region/graph.tar" 2>/dev/null)" ]; then
        "$adb" shell mkdir -p "$files/graphs/$region"
        "$adb" push "$graphs/$region/graph.tar" "$files/graphs/$region/graph.tar" > /dev/null
      fi
      for l in $labels; do
        name="$region-$l.json"
        node "$here/bench/make-plan.mjs" --region "$region" --labels "$l" --repeats "$repeats" \
          --keep-answers --archive "$files/graphs/$region/graph.tar" > "$out/.plan.json"
        "$adb" push "$out/.plan.json" "$files/$name" > /dev/null
        "$adb" shell "chown -R $owner:$owner $files; rm -f $files/$name.result.json"
        "$adb" shell am force-stop "$pkg"
        # Drop the guest page cache so the first route reads the graph from storage.
        "$adb" shell "sync; echo 3 > /proc/sys/vm/drop_caches"
        "$adb" shell am start -n "$pkg/.MainActivity" --es plan "$name" > /dev/null
        for _ in $(seq 1 300); do
          [ -n "$("$adb" shell ls "$files/$name.result.json" 2>/dev/null)" ] && break
          sleep 1
        done
        "$adb" shell cat "$files/$name.result.json" > "$out/android-$name"
        echo "android $region $l done"
      done
    done
    rm -f "$out/.plan.json" ;;
  *) echo "unknown platform $platform" >&2; exit 2 ;;
esac
