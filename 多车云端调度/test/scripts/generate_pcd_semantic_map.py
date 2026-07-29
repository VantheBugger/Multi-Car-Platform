#!/usr/bin/env python3
"""Convert a binary_compressed PCD point cloud into a compact 2D semantic map.

The generated JSON is intentionally simple so the browser can draw it without
having to decompress or parse PCD data at runtime.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path


def lzf_decompress(payload: bytes, expected_size: int) -> bytes:
    """Decompress the LZF block used by PCL binary_compressed PCD files."""
    ip = 0
    output = bytearray()

    while ip < len(payload):
        ctrl = payload[ip]
        ip += 1

        if ctrl < 32:
            length = ctrl + 1
            output.extend(payload[ip : ip + length])
            ip += length
            continue

        length = ctrl >> 5
        ref = len(output) - ((ctrl & 0x1F) << 8) - 1
        if length == 7:
            length += payload[ip]
            ip += 1

        ref -= payload[ip]
        ip += 1
        length += 2

        if ref < 0:
            raise ValueError("Invalid LZF reference while decompressing PCD")

        for _ in range(length):
            output.append(output[ref])
            ref += 1

    if len(output) != expected_size:
        raise ValueError(
            f"Unexpected decompressed size: got {len(output)}, expected {expected_size}"
        )

    return bytes(output)


def parse_header(header: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in header.splitlines():
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition(" ")
        values[key] = value.strip()
    return values


def read_xyz(path: Path) -> tuple[list[float], list[float], list[float], dict[str, str]]:
    raw = path.read_bytes()
    marker = b"DATA "
    marker_at = raw.index(marker)
    data_at = raw.index(b"\n", marker_at) + 1
    header_text = raw[:data_at].decode("ascii", errors="replace")
    header = parse_header(header_text)

    fields = header.get("FIELDS", "").split()
    if fields[:3] != ["x", "y", "z"]:
        raise ValueError(f"Only x y z PCD fields are supported, got: {fields}")

    points = int(header["POINTS"])
    data_format = header.get("DATA")

    if data_format == "binary_compressed":
        compressed_size, decompressed_size = struct.unpack_from("<II", raw, data_at)
        compressed = raw[data_at + 8 : data_at + 8 + compressed_size]
        data = lzf_decompress(compressed, decompressed_size)

        float_block = "<" + "f" * points
        xs = list(struct.unpack_from(float_block, data, 0))
        ys = list(struct.unpack_from(float_block, data, 4 * points))
        zs = list(struct.unpack_from(float_block, data, 8 * points))
        return xs, ys, zs, header

    if data_format != "binary":
        raise ValueError(f"Only DATA binary or binary_compressed PCD files are supported, got: {data_format}")

    sizes = [int(value) for value in header["SIZE"].split()]
    counts = [int(value) for value in header.get("COUNT", " ".join(["1"] * len(sizes))).split()]
    point_step = sum(size * count for size, count in zip(sizes, counts))
    offsets = []
    offset = 0
    for size, count in zip(sizes, counts):
        offsets.append(offset)
        offset += size * count

    x_offset, y_offset, z_offset = offsets[:3]
    payload = raw[data_at:]
    expected_size = points * point_step
    if len(payload) < expected_size:
        raise ValueError(f"PCD binary payload is too short: got {len(payload)}, expected {expected_size}")

    xs = []
    ys = []
    zs = []
    for index in range(points):
        base = index * point_step
        xs.append(struct.unpack_from("<f", payload, base + x_offset)[0])
        ys.append(struct.unpack_from("<f", payload, base + y_offset)[0])
        zs.append(struct.unpack_from("<f", payload, base + z_offset)[0])

    return xs, ys, zs, header


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[int((len(ordered) - 1) * q)]


def build_semantic_map(source: Path, resolution: float) -> dict:
    xs, ys, zs, header = read_xyz(source)
    points = [
        (x, y, z)
        for x, y, z in zip(xs, ys, zs)
        if math.isfinite(x) and math.isfinite(y) and math.isfinite(z)
    ]

    x_values = [p[0] for p in points]
    y_values = [p[1] for p in points]
    z_values = [p[2] for p in points]
    min_x = math.floor(min(x_values) / resolution) * resolution
    max_x = math.ceil(max(x_values) / resolution) * resolution
    min_y = math.floor(min(y_values) / resolution) * resolution
    max_y = math.ceil(max(y_values) / resolution) * resolution
    min_z = min(z_values)
    max_z = max(z_values)

    ground_z = percentile(z_values, 0.08)
    elevated_z = percentile(z_values, 0.72)
    high_z = percentile(z_values, 0.9)

    cells: dict[tuple[int, int], list[float]] = {}
    for x, y, z in points:
        ix = int((x - min_x) // resolution)
        iy = int((y - min_y) // resolution)
        key = (ix, iy)
        if key not in cells:
            cells[key] = [1, z, z]
        else:
            cells[key][0] += 1
            cells[key][1] = min(cells[key][1], z)
            cells[key][2] = max(cells[key][2], z)

    encoded_cells = []
    semantic_counts = {"ground": 0, "low_obstacle": 0, "structure": 0, "dense_obstacle": 0}
    for (ix, iy), (count, z_min, z_max) in cells.items():
        vertical_span = z_max - z_min
        if count >= 18 or vertical_span >= 3.0 or z_max >= high_z:
            semantic = 3
            semantic_counts["dense_obstacle"] += 1
        elif z_max >= elevated_z or vertical_span >= 1.1:
            semantic = 2
            semantic_counts["structure"] += 1
        elif z_max >= ground_z + 0.6:
            semantic = 1
            semantic_counts["low_obstacle"] += 1
        else:
            semantic = 0
            semantic_counts["ground"] += 1

        encoded_cells.append(
            [
                ix,
                iy,
                semantic,
                int(count),
                round(z_min, 2),
                round(z_max, 2),
            ]
        )

    encoded_cells.sort(key=lambda item: (item[1], item[0]))

    width = int(round((max_x - min_x) / resolution)) + 1
    height = int(round((max_y - min_y) / resolution)) + 1
    total_cells = width * height

    return {
        "source": source.name,
        "format": "pcd-derived-2d-semantic-map",
        "note": "Semantic classes are inferred from point density and z distribution; the source point cloud has no native semantic labels.",
        "resolution": resolution,
        "pointCount": len(points),
        "bounds": {
            "minX": round(min_x, 3),
            "maxX": round(max_x, 3),
            "minY": round(min_y, 3),
            "maxY": round(max_y, 3),
            "minZ": round(min_z, 3),
            "maxZ": round(max_z, 3),
            "width": width,
            "height": height,
        },
        "zBreaks": {
            "ground": round(ground_z, 3),
            "elevated": round(elevated_z, 3),
            "high": round(high_z, 3),
        },
        "semantics": {
            "0": {"name": "candidate_ground", "label": "候选可通行地面", "color": "#d9f99d"},
            "1": {"name": "low_obstacle", "label": "低矮障碍", "color": "#fbbf24"},
            "2": {"name": "structure", "label": "结构/墙体", "color": "#64748b"},
            "3": {"name": "dense_obstacle", "label": "密集障碍/高结构", "color": "#1f2937"},
        },
        "summary": {
            **semantic_counts,
            "observedCells": len(encoded_cells),
            "estimatedFreeCells": max(total_cells - len(encoded_cells), 0),
        },
        "cells": encoded_cells,
        "pcdHeader": header,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--resolution", type=float, default=0.75)
    args = parser.parse_args()

    semantic_map = build_semantic_map(args.source, args.resolution)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(semantic_map, ensure_ascii=False, separators=(",", ":")))
    print(
        f"Wrote {args.output} with {len(semantic_map['cells'])} cells "
        f"from {semantic_map['pointCount']} points"
    )


if __name__ == "__main__":
    main()
