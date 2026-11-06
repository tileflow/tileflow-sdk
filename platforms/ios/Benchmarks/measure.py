"""Collect iOS Release archive sizes or paired Streets simulator measurements."""

import argparse
import hashlib
import json
import math
from pathlib import Path
import plistlib
import statistics
import subprocess
import time


def run(*args, cwd=None, check=True):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=check).stdout.strip()


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, values):
    path.write_text(json.dumps(values, indent=2) + "\n", encoding="utf-8")


def archive_sizes(output):
    measurements = {}
    for name in ("Empty", "Maps", "MapsAndServices"):
        app = output / f"{name}.xcarchive/Products/Applications/{name}.app"
        archive = output / f"{name}.zip"
        if archive.exists():
            raise FileExistsError(archive)
        run("zip", "-9", "-q", "-r", "-y", str(archive), app.name, cwd=app.parent)
        files = {
            str(path.relative_to(app)): path.stat().st_size
            for path in sorted(app.rglob("*"))
            if path.is_file() and not path.is_symlink()
        }
        binaries = {}
        for binary in (app / name, app / "Frameworks/MapLibre.framework/MapLibre"):
            if not binary.is_file():
                continue
            archs = run("xcrun", "lipo", "-archs", binary)
            build = run("xcrun", "vtool", "-show-build", binary)
            if archs != "arm64" or "platform IOS\n" not in build:
                raise ValueError(f"Expected an iOS device arm64 binary: {binary}")
            binaries[str(binary.relative_to(app))] = {
                "sha256": sha256(binary), "architectures": archs, "build": build,
            }
        measurements[name] = {
            "zipBytes": archive.stat().st_size,
            "appRegularFileBytes": sum(files.values()),
            "zipSha256": sha256(archive),
            "files": files,
            "binaries": binaries,
        }

    empty = measurements["Empty"]
    for row in measurements.values():
        row["deltaZipBytes"] = row["zipBytes"] - empty["zipBytes"]
        row["deltaAppRegularFileBytes"] = row["appRegularFileBytes"] - empty["appRegularFileBytes"]
    write_json(output / "size-receipt.json", measurements)


def install(simulator, app):
    bundle = plistlib.loads((app / "Info.plist").read_bytes())["CFBundleIdentifier"]
    if bundle != f"dev.tileflow.benchmark.{app.stem}":
        raise ValueError(f"Expected a benchmark app: {app}")
    run("xcrun", "simctl", "uninstall", simulator, bundle, check=False)
    run("xcrun", "simctl", "install", simulator, app)
    return bundle


def capture(simulator, bundle, output, label, app_args, request_log):
    container = run("xcrun", "simctl", "get_app_container", simulator, bundle, "data")
    data = Path(container) / "Documents/measurement.json"
    data.unlink(missing_ok=True)
    request_offset = request_log.stat().st_size if request_log else 0
    launch_at = time.time()
    launched = run(
        "xcrun", "simctl", "launch", "--terminate-running-process",
        f"--stdout={output / (label + '.stdout')}", f"--stderr={output / (label + '.stderr')}",
        simulator, bundle, *app_args,
    )
    try:
        deadline = time.monotonic() + 65
        while not data.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        if not data.exists():
            raise RuntimeError(f"{label} timed out: {launched}")
        values = json.loads(data.read_text(encoding="utf-8"))
        values["launchCommandAt"] = launch_at
        values["launchResult"] = launched
        if request_log:
            with request_log.open("rb") as stream:
                stream.seek(request_offset)
                (output / f"{label}.requests").write_bytes(stream.read())
        write_json(output / f"{label}.json", values)
        if "error" in values:
            raise RuntimeError(f"{label}: {values}")
        if label == "warm-1":
            run("xcrun", "simctl", "io", simulator, "screenshot", output / "streets.png")
    finally:
        run("xcrun", "simctl", "terminate", simulator, bundle, check=False)
    return values


def simulator_measurements(args):
    args.output.mkdir()
    baseline_app = args.apps / "EmptyBenchmark.app"
    map_app = args.apps / "StreetsBenchmark.app"
    digests = {
        str(binary.relative_to(args.apps)): sha256(binary)
        for binary in (
            baseline_app / "EmptyBenchmark", map_app / "StreetsBenchmark",
            map_app / "Frameworks/MapLibre.framework/MapLibre",
        )
    }

    rows = []
    for pair in range(1, args.pairs + 1):
        baseline = capture(
            args.device, install(args.device, baseline_app), args.output, f"baseline-{pair}",
            ["--measure"], None,
        )["residentBytes"]
        bundle = install(args.device, map_app)
        for state in ("cold", "warm"):
            values = capture(
                args.device, bundle, args.output, f"{state}-{pair}",
                ["--manifest", args.manifest, "--map", args.map, "--feature-attribute", args.attribute],
                args.request_log,
            )
            intervals = sorted(values.pop("frameIntervalsMs"))
            peak = max(values.pop("motionResidentBytes"))
            values.update(
                state=state, pair=pair, baselineBytes=baseline,
                frameIntervalP95Ms=intervals[math.ceil(len(intervals) * 0.95) - 1],
                rendererFramesPerSecond=1000 / statistics.mean(intervals),
                idleDeltaBytes=values["residentBytes"] - baseline,
                peakMotionDeltaBytes=peak - baseline,
                hostCommandToUsefulMs=1000 * (values["firstUsefulFrameAt"] - values["launchCommandAt"]),
            )
            rows.append(values)
            print(
                state, pair, values["firstUsefulFrameMs"], values["frameIntervalP95Ms"],
                values["rendererFramesPerSecond"], values["idleDeltaBytes"],
                values["peakMotionDeltaBytes"], flush=True,
            )
    write_json(args.output / "summary.json", {
        "simulator": args.device, "manifest": args.manifest, "map": args.map,
        "requiredAttribute": args.attribute, "simulatorAppBinariesSha256": digests, "measurements": rows,
    })


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    size = commands.add_parser("size", help="Compare the three arm64 .xcarchive bundles")
    size.add_argument("archives", type=lambda path: Path(path).resolve())
    simulator = commands.add_parser("simulator", help="Run paired cold and warm simulator launches")
    simulator.add_argument("--device", required=True)
    simulator.add_argument("--apps", type=Path, required=True)
    simulator.add_argument("--manifest", required=True)
    simulator.add_argument("--map", default="streets")
    simulator.add_argument("--attribute", default="render_height")
    simulator.add_argument("--pairs", type=int, default=3)
    simulator.add_argument("--request-log", type=Path)
    simulator.add_argument("--output", type=lambda path: Path(path).resolve(), required=True)
    args = parser.parse_args()
    if args.command == "size":
        archive_sizes(args.archives)
    else:
        simulator_measurements(args)


if __name__ == "__main__":
    main()
