#!/usr/bin/env python3
"""Graph archive measurements for pack design.

  graph-stats.py sizes <graph.tar>
      bytes per hierarchy level, uncompressed and compressed per tile (gzip 6, zstd 19 if
      the zstandard module is present, lzma 6), as a pack would store each tile.
  graph-stats.py subset <graph.tar> <minlon,minlat,maxlon,maxlat> <out.tar>
      writes the tiles of every level that intersect the box, as a pack cut from a larger
      network would carry them.

Valhalla tiles: level 0 is 4 degrees, level 1 is 1 degree, level 2 is 0.25 degrees; a tile
path such as 2/000/756/425.gph names tile id 756425 of its level, numbered row by row from
(-180, -90).
"""
import json
import lzma
import sys
import tarfile
import zlib

try:
    import zstandard
except ImportError:  # optional
    zstandard = None

SIZES = {0: 4.0, 1: 1.0, 2: 0.25}


def tile_box(name):
    parts = name.strip("./").split("/")
    level = int(parts[0])
    tile_id = int("".join(parts[1:]).replace(".gph", ""))
    size = SIZES[level]
    columns = int(360 / size)
    row, column = divmod(tile_id, columns)
    minlon, minlat = -180 + column * size, -90 + row * size
    return level, (minlon, minlat, minlon + size, minlat + size)


def tiles(archive):
    with tarfile.open(archive) as tar:
        for member in tar:
            if member.isfile() and member.name.endswith(".gph"):
                yield member, tar.extractfile(member).read()


def sizes(archive):
    levels = {}
    zc = zstandard.ZstdCompressor(level=19) if zstandard else None
    for member, data in tiles(archive):
        level, _ = tile_box(member.name)
        entry = levels.setdefault(level, {"tiles": 0, "bytes": 0, "gzip6": 0, "lzma6": 0, "zstd19": 0})
        entry["tiles"] += 1
        entry["bytes"] += len(data)
        entry["gzip6"] += len(zlib.compress(data, 6))
        entry["lzma6"] += len(lzma.compress(data, preset=6))
        if zc:
            entry["zstd19"] += len(zc.compress(data))
    total = {key: sum(level[key] for level in levels.values()) for key in ("tiles", "bytes", "gzip6", "lzma6", "zstd19")}
    print(json.dumps({"archive": archive, "levels": levels, "total": total}, indent=2))


def subset(archive, box, out):
    minlon, minlat, maxlon, maxlat = (float(v) for v in box.split(","))
    kept = {}
    with tarfile.open(out, "w", format=tarfile.USTAR_FORMAT) as dest:
        for member, data in tiles(archive):
            level, (a, b, c, d) = tile_box(member.name)
            if a < maxlon and c > minlon and b < maxlat and d > minlat:
                info = tarfile.TarInfo(member.name)
                info.size = len(data)
                info.mtime = member.mtime
                import io
                dest.addfile(info, io.BytesIO(data))
                entry = kept.setdefault(level, {"tiles": 0, "bytes": 0})
                entry["tiles"] += 1
                entry["bytes"] += len(data)
    print(json.dumps({"out": out, "box": box, "levels": kept}, indent=2))


if __name__ == "__main__":
    if sys.argv[1] == "sizes":
        sizes(sys.argv[2])
    elif sys.argv[1] == "subset":
        subset(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        sys.exit(__doc__)
