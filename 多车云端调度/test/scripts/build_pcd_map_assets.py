#!/usr/bin/env python3
"""Build browser-friendly map assets from the generated PCD semantic JSON."""

from __future__ import annotations

import argparse
import json
import math
import struct
import zlib
from pathlib import Path


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.strip().lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        rows.extend(pixels[y * stride : (y + 1) * stride])

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(chunk(b"IDAT", zlib.compress(bytes(rows), level=9)))
    png.extend(chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(png))


def set_pixel(pixels: bytearray, width: int, x: int, y: int, rgba: tuple[int, int, int, int]) -> None:
    if x < 0 or y < 0:
        return
    index = (y * width + x) * 4
    if index < 0 or index + 4 > len(pixels):
        return
    pixels[index : index + 4] = bytes(rgba)


def write_assets(semantic_json: Path, output_dir: Path, registration_path: Path, asset_name: str) -> None:
    semantic_map = json.loads(semantic_json.read_text())
    width = int(semantic_map["bounds"]["width"])
    height = int(semantic_map["bounds"]["height"])

    semantic_pixels = bytearray(width * height * 4)
    point_pixels = bytearray(width * height * 4)
    semantic_colors = {
        int(key): hex_to_rgb(value["color"])
        for key, value in semantic_map["semantics"].items()
    }
    max_density = max((cell[3] for cell in semantic_map["cells"]), default=1)

    for ix, iy, semantic, count, _z_min, _z_max in semantic_map["cells"]:
        y = height - iy - 1
        r, g, b = semantic_colors.get(semantic, (100, 116, 139))
        alpha = 214 if semantic >= 2 else 184
        set_pixel(semantic_pixels, width, ix, y, (r, g, b, alpha))

        point_alpha = 170 + int(75 * math.sqrt(count / max_density))
        set_pixel(point_pixels, width, ix, y, (239, 68, 68, min(point_alpha, 245)))
        if count >= 3:
            set_pixel(point_pixels, width, ix + 1, y, (239, 68, 68, max(112, point_alpha // 2)))
            set_pixel(point_pixels, width, ix, y + 1, (239, 68, 68, max(112, point_alpha // 2)))

    semantic_png = output_dir / f"{asset_name}.semantic.png"
    point_png = output_dir / f"{asset_name}.pointcloud.png"
    write_png(semantic_png, width, height, semantic_pixels)
    write_png(point_png, width, height, point_pixels)

    default_center = [39.96295, 116.30423]
    default_rotation = -197.5
    if asset_name == "global_s":
        default_center = [39.96286, 116.304171]
        default_rotation = -360.5
    vehicle_transform = None
    if asset_name == "global_s":
        vehicle_transform = {
            "scale": 4.0,
            "rotationDeg": 0.0,
            "origin": [0, 0],
            "description": "真实小车坐标的显示比例；只影响车辆 marker 的坐标映射，不影响点云图层配准。",
        }

    # Coarse registration to BIT Zhongguancun campus building 6, where official
    # BIT pages list the School of Automation office.
    registration = {
        "name": f"{asset_name}.pcd rough registration",
        "description": f"将 {asset_name}.pcd 粗配准到地图底图；后续可通过页面控制项微调中心、旋转、平移与比例。",
        "center": default_center,
        "zoom": 19,
        "rotationDeg": default_rotation,
        "metersPerPcdMeter": 1.0,
        **({"vehicleTransform": vehicle_transform} if vehicle_transform else {}),
        "bounds": {
            "southWest": [39.96163, 116.3022],
            "northEast": [39.96427, 116.30626],
        },
        "sourcePcdBounds": semantic_map["bounds"],
        "image": {
            "width": width,
            "height": height,
            "pointCloud": f"/maps/{asset_name}.pointcloud.png",
            "semantic": f"/maps/{asset_name}.semantic.png",
        },
        "localToLatLng": {
            "type": "linear_bounds_fit",
            "xMapsWestToEast": True,
            "yMapsSouthToNorth": True,
        },
        "references": [
            "https://www.bit.edu.cn/gbxxgk/xydy_sjb/dlwz_sjb/index.htm",
            "https://ac.bit.edu.cn/index.htm",
        ],
    }
    registration_path.parent.mkdir(parents=True, exist_ok=True)
    registration_path.write_text(json.dumps(registration, ensure_ascii=False, indent=2))

    print(f"Wrote {semantic_png}")
    print(f"Wrote {point_png}")
    print(f"Wrote {registration_path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("semantic_json", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("registration_json", type=Path)
    parser.add_argument("--asset-name", default=None)
    args = parser.parse_args()
    asset_name = args.asset_name or args.semantic_json.name.removesuffix(".semantic.json")
    write_assets(args.semantic_json, args.output_dir, args.registration_json, asset_name)


if __name__ == "__main__":
    main()
