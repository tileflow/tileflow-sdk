#!/usr/bin/env python3
"""Measure installed split bytes and a local Streets render on one connected device."""

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import shlex
import statistics
import subprocess
import time


MODULE = Path(__file__).resolve().parent
FLAVORS = ("empty", "mapsx", "servs")
PACKAGE = "dev.tileflow.measure"
ACTIVITY = f"{PACKAGE}.MeasurementActivity"
TAG = "TileflowMeasure"


def command(*args):
    return subprocess.check_output([str(arg) for arg in args], text=True).strip()


def adb(*args):
    return command("adb", *args)


def shell(*args):
    return adb("shell", shlex.join(map(str, args)))


def installed_apks(flavor):
    package = f"{PACKAGE}.{flavor}"
    paths = [
        Path(line.removeprefix("package:"))
        for line in shell("pm", "path", package).splitlines()
    ]
    apks = {path.name: path for path in paths}
    if "base.apk" not in apks:
        raise RuntimeError(f"Could not verify installed APKs for {package}")
    if flavor != "empty" and "split_config.arm64_v8a.apk" not in apks:
        raise RuntimeError(f"Could not verify the arm64 split for {package}")
    return apks


def splits(bundletool, output):
    def bundle(*args):
        return command("java", "-jar", bundletool, *args)

    spec = output / "device.json"
    bundle("get-device-spec", f"--output={spec}")
    device = json.loads(spec.read_text())
    if device["supportedAbis"][0] != "arm64-v8a":
        raise RuntimeError("The measurement requires an arm64-v8a device")

    sizes = {}
    for flavor in FLAVORS:
        aab = (
            MODULE / "build" / "outputs" / "bundle" / f"{flavor}Release"
            / f"benchmark-{flavor}-release.aab"
        )
        apks = output / f"{flavor}.apks"
        bundle("build-apks", f"--bundle={aab}", f"--output={apks}", f"--device-spec={spec}")
        estimate = bundle("get-size", "total", f"--apks={apks}", f"--device-spec={spec}")
        (output / f"{flavor}-download.csv").write_text(estimate + "\n")
        download = next(csv.DictReader(estimate.splitlines()))

        bundle("install-apks", f"--apks={apks}")
        paths = installed_apks(flavor)
        installed = {name: int(shell("stat", "-c", "%s", path)) for name, path in paths.items()}

        code_dir = paths["base.apk"].parent
        code_usage = subprocess.run(
            ["adb", "shell", shlex.join(("du", "-sk", str(code_dir)))],
            capture_output=True, text=True,
        )
        code_usage_kib = int(code_usage.stdout.split()[0]) if code_usage.returncode == 0 else None
        sizes[flavor] = {
            "bundleSha256": hashlib.sha256(aab.read_bytes()).hexdigest(),
            "downloadMinBytes": int(download["MIN"]),
            "downloadMaxBytes": int(download["MAX"]),
            "installedBytes": sum(installed.values()),
            "installedSplits": installed,
            "codeDirectoryDiskKiB": code_usage_kib,
        }

    return {
        "bundletool": bundle("version"),
        "sizes": sizes,
        "deltaFromEmpty": {
            flavor: {
                key: sizes[flavor][key] - sizes["empty"][key]
                for key in ("downloadMinBytes", "downloadMaxBytes", "installedBytes")
            }
            for flavor in ("mapsx", "servs")
        },
    }


def logcat():
    return adb("logcat", "-b", "main", "-d", "-v", "threadtime", "-v", "monotonic", "-s", f"{TAG}:I", "*:S")


def marker(logs, event, run):
    for line in logs.splitlines():
        match = re.search(
            rf"^\[?\s*(\d+\.\d+)\s+\d+\s+\d+\s+[IWE]\s+{TAG}\s*:\s+"
            rf"{event} {re.escape(run)}(?:\s|$)",
            line,
        )
        if match:
            return float(match.group(1))
    return None


def wait_marker(event, run, timeout=25):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        logs = logcat()
        timestamp = marker(logs, event, run)
        if timestamp is not None:
            return timestamp
        if any(marker(logs, failure, run) is not None for failure in ("ERROR", "MAP_FAILED")):
            break
        time.sleep(0.15)
    raise RuntimeError(f"Missing {event} {run}\n{logs[-6000:]}")


def launch(flavor, run, manifest, coords, motion=False):
    package = f"{PACKAGE}.{flavor}"
    args = ["am", "start", "-W", "-n", f"{package}/{ACTIVITY}", "--es", "run", run]
    if manifest:
        args += ["--es", "manifest", manifest]
    for key, value in zip(("longitude", "latitude", "zoom"), coords):
        args += ["--es", key, value]
    if motion:
        args += ["--ez", "motion", "true"]
    started = adb(
        "shell", f"{shlex.join(['log', '-t', TAG, f'BEGIN {run}'])} && {shlex.join(args)}"
    )
    if "Status: ok" not in started:
        raise RuntimeError(started)

    rendered = wait_marker("EMPTY_DRAWN" if flavor == "empty" else "USEFUL", run)
    return round((rendered - wait_marker("BEGIN", run)) * 1000)


def close(flavor, run):
    package = f"{PACKAGE}.{flavor}"
    shell("am", "start", "--activity-single-top", "-n", f"{package}/{ACTIVITY}",
          "--ez", "finish", "true")
    wait_marker("DESTROY", run)


def memory(package, output):
    raw = shell("dumpsys", "meminfo", package)
    output.write_text(raw + "\n")
    match = re.search(r"TOTAL PSS:\s+(\d+)\s+TOTAL RSS:\s+(\d+)", raw)
    if not match:
        raise RuntimeError(f"No process memory totals for {package}")
    return {"pssKiB": int(match.group(1)), "rssKiB": int(match.group(2))}


def frame_intervals(logs, run):
    groups = {}
    for segment, start, end, values in re.findall(
        rf"MOTION {re.escape(run)} (pan|zoom) \d+ (\d+) (\d+) ([0-9,]+)", logs
    ):
        frames = list(map(int, values.split(",")))
        intervals = [(b - a) / 1_000_000 for a, b in zip(frames, frames[1:])]
        if len(intervals) < 2:
            raise RuntimeError(f"Too few renderer samples in {segment}")
        groups.setdefault(segment, []).append({
            "frames": len(frames), "seconds": (int(end) - int(start)) / 1e9,
            "intervalsMs": intervals,
        })

    if {kind: len(segments) for kind, segments in groups.items()} != {"pan": 6, "zoom": 6}:
        raise RuntimeError("The run did not record all pan and zoom segments")
    summary = {}
    for kind, segments in groups.items():
        intervals = sorted(t for segment in segments for t in segment["intervalsMs"])
        summary[kind] = {
            "segments": segments,
            "samples": len(intervals),
            "p50Ms": statistics.median(intervals),
            "p95Ms": intervals[math.ceil(0.95 * len(intervals)) - 1],
            "fps": sum(s["frames"] for s in segments) / sum(s["seconds"] for s in segments),
        }
    return summary


def performance(output, manifest, coords, repeats):
    token = str(time.time_ns())
    launches = {"empty": [], "mapsx": []}
    memory_samples = {"empty": [], "mapsx": []}
    for index in range(repeats):
        for flavor in launches:
            package = f"{PACKAGE}.{flavor}"
            if shell("pm", "clear", package) != "Success":
                raise RuntimeError(f"Could not clear the benchmark package {package}")
            cold = f"{token}-{flavor}-cold-{index}"
            warm = f"{token}-{flavor}-warm-{index}"
            cold_ms = launch(flavor, cold, manifest, coords)
            time.sleep(5)
            memory_samples[flavor].append(memory(package, output / f"{flavor}-{index}-meminfo.txt"))
            cold_pid = shell("pidof", package)
            close(flavor, cold)
            warm_ms = launch(flavor, warm, manifest, coords)
            if not cold_pid or shell("pidof", package) != cold_pid:
                raise RuntimeError("The process restarted during a warm launch")
            close(flavor, warm)
            launches[flavor].append({"coldMs": cold_ms, "warmMs": warm_ms})
            print(f"{flavor} {index + 1}/{repeats}: cold={cold_ms}ms warm={warm_ms}ms", flush=True)

    run = f"{token}-motion"
    launch("mapsx", run, manifest, coords, motion=True)
    wait_marker("MOTION_DONE", run, timeout=50)
    logs = logcat()
    (output / "logcat.txt").write_text(logs + "\n")
    close("mapsx", run)
    rss = {
        flavor: statistics.median(sample["rssKiB"] for sample in samples)
        for flavor, samples in memory_samples.items()
    }
    return {
        "camera": dict(zip(("longitude", "latitude", "zoom"), map(float, coords))),
        "manifest": manifest,
        "launches": launches,
        "memorySamples": memory_samples,
        "rssDeltaKiB": rss["mapsx"] - rss["empty"],
        "rendererMotion": frame_intervals(logs, run),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New output directory")
    parser.add_argument("--bundletool", type=Path, help="Bundletool all-in-one JAR. Builds and installs split APKs.")
    parser.add_argument("--manifest", help="Streets native manifest URL. Runs performance measurements.")
    parser.add_argument("--longitude", default="-3.7")
    parser.add_argument("--latitude", default="40.42")
    parser.add_argument("--zoom", default="16")
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()
    if not (args.bundletool or args.manifest) or args.repeats < 1:
        parser.error("Provide --bundletool or --manifest and at least one repetition")

    args.output.mkdir(parents=True)
    checkout = command("git", "-C", MODULE, "rev-parse", "HEAD")
    device = {key: shell("getprop", key) for key in (
        "ro.build.fingerprint", "ro.product.model", "ro.product.cpu.abilist",
        "ro.build.version.release", "ro.build.version.sdk",
    )}
    device["graphics"] = [line for line in shell("dumpsys", "SurfaceFlinger").splitlines() if "GLES:" in line]
    device["display"] = [shell("wm", "size"), shell("wm", "density")]
    result = {"checkoutRevision": checkout, "device": device}
    if args.bundletool:
        result.update(splits(args.bundletool.resolve(), args.output))
    result["installedApkSha256"] = {
        flavor: {name: shell("sha256sum", path).split()[0]
                 for name, path in installed_apks(flavor).items()}
        for flavor in (FLAVORS if args.bundletool else ("empty", "mapsx"))
    }
    (args.output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
    if args.manifest:
        coords = (args.longitude, args.latitude, args.zoom)
        result.update(performance(args.output, args.manifest, coords, args.repeats))
    (args.output / "results.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
