#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageColor, ImageDraw, ImageFilter, ImageFont


@dataclass(frozen=True)
class SceneSpec:
    slug: str
    start_node: str
    goal_node: str
    title: str


SCENES = (
    SceneSpec(
        slug="scene_west_to_east",
        start_node="G5_01",
        goal_node="G7_08",
        title="West to East Crossing",
    ),
    SceneSpec(
        slug="scene_northwest_to_east",
        start_node="G1_04",
        goal_node="G7_05",
        title="Northwest to East Corridor",
    ),
    SceneSpec(
        slug="scene_southwest_to_northeast",
        start_node="G6_15",
        goal_node="G2_12",
        title="Southwest to Northeast Diagonal",
    ),
)


def parse_args() -> argparse.Namespace:
    script_dir = Path(__file__).resolve().parent
    repo_dir = script_dir.parent
    default_output = repo_dir.parent / "paper_cloud_fleet_plus" / "figures"
    return argparse.ArgumentParser(
        description="Generate clean paper-ready map scene screenshots from local map assets."
    ).parse_args(namespace=argparse.Namespace(output_dir=default_output))


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def hex_rgba(value: str, alpha: int) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(value)
    return (r, g, b, alpha)


def pcd_to_pixel(x: float, y: float, bounds: dict, width: int, height: int) -> tuple[float, float]:
    min_x = bounds["minX"]
    max_x = bounds["maxX"]
    min_y = bounds["minY"]
    max_y = bounds["maxY"]
    px = (x - min_x) / (max_x - min_x) * (width - 1)
    py = (max_y - y) / (max_y - min_y) * (height - 1)
    return px, py


def draw_vehicle(draw: ImageDraw.ImageDraw, center: tuple[float, float], angle_deg: float) -> None:
    cx, cy = center
    body_w = 64
    body_h = 36
    nose = 16
    shadow = [
        (cx - body_w / 2 + 3, cy - body_h / 2 + 6),
        (cx + body_w / 2 + 3, cy - body_h / 2 + 6),
        (cx + body_w / 2 + nose + 3, cy + 6),
        (cx + body_w / 2 + 3, cy + body_h / 2 + 6),
        (cx - body_w / 2 + 3, cy + body_h / 2 + 6),
    ]
    draw.rounded_rectangle(
        (cx - body_w / 2 + 3, cy - body_h / 2 + 6, cx + body_w / 2 + 3, cy + body_h / 2 + 6),
        radius=10,
        fill=(15, 23, 42, 60),
    )
    draw.polygon(shadow[:3] + shadow[3:], fill=(15, 23, 42, 35))

    body = [
        (cx - body_w / 2, cy - body_h / 2),
        (cx + body_w / 2, cy - body_h / 2),
        (cx + body_w / 2 + nose, cy),
        (cx + body_w / 2, cy + body_h / 2),
        (cx - body_w / 2, cy + body_h / 2),
    ]
    draw.polygon(body, fill="#14b8a6", outline="white")
    draw.line(
        [(cx - body_w / 4, cy), (cx + body_w / 2 + nose - 10, cy)],
        fill="white",
        width=4,
    )
    draw.ellipse((cx - 16, cy - 7, cx - 4, cy + 5), fill="#0f172a")
    draw.ellipse((cx + 10, cy - 7, cx + 22, cy + 5), fill="#0f172a")
    draw.arc(
        (cx - 54, cy - 54, cx + 54, cy + 54),
        start=angle_deg - 36,
        end=angle_deg + 36,
        fill="#14b8a6",
        width=5,
    )


def draw_goal(draw: ImageDraw.ImageDraw, center: tuple[float, float]) -> None:
    cx, cy = center
    draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill=(255, 255, 255, 215))
    draw.ellipse((cx - 20, cy - 20, cx + 20, cy + 20), outline="#dc2626", width=5)
    draw.line((cx - 12, cy, cx + 12, cy), fill="#dc2626", width=4)
    draw.line((cx, cy - 12, cx, cy + 12), fill="#dc2626", width=4)
    flag = [(cx + 10, cy - 26), (cx + 10, cy - 56), (cx + 36, cy - 48), (cx + 10, cy - 40)]
    draw.line((cx + 10, cy - 26, cx + 10, cy - 58), fill="#7f1d1d", width=4)
    draw.polygon(flag, fill="#ef4444")


def draw_scene(scene: SceneSpec, base: Image.Image, road_graph: dict, bounds: dict, scale: int) -> Image.Image:
    width, height = base.size
    canvas = base.copy()
    overlay = Image.new("RGBA", canvas.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)

    node_map = {node["id"]: node for node in road_graph["nodes"]}
    edge_color = hex_rgba("#0f766e", 160)
    node_fill = hex_rgba("#ffffff", 190)
    node_outline = hex_rgba("#0f766e", 160)

    for edge in road_graph["edges"]:
        source = node_map.get(edge["source"])
        target = node_map.get(edge["target"])
        if not source or not target:
            continue
        p1 = pcd_to_pixel(source["x"], source["y"], bounds, width, height)
        p2 = pcd_to_pixel(target["x"], target["y"], bounds, width, height)
        draw.line((p1, p2), fill=edge_color, width=4)

    for node in road_graph["nodes"]:
        px, py = pcd_to_pixel(node["x"], node["y"], bounds, width, height)
        draw.ellipse((px - 3, py - 3, px + 3, py + 3), fill=node_fill, outline=node_outline, width=1)

    start = node_map[scene.start_node]
    goal = node_map[scene.goal_node]
    start_pos = pcd_to_pixel(start["x"], start["y"], bounds, width, height)
    goal_pos = pcd_to_pixel(goal["x"], goal["y"], bounds, width, height)

    dx = goal["x"] - start["x"]
    dy = goal["y"] - start["y"]
    angle_deg = 0.0
    if dx or dy:
        import math
        angle_deg = math.degrees(math.atan2(-dy, dx))

    draw_vehicle(draw, start_pos, angle_deg)
    draw_goal(draw, goal_pos)

    pill_w = 228
    pill_h = 46
    pill_x = 24
    pill_y = 24
    draw.rounded_rectangle(
        (pill_x, pill_y, pill_x + pill_w, pill_y + pill_h),
        radius=16,
        fill=(255, 255, 255, 228),
        outline=(15, 23, 42, 18),
        width=1,
    )
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 22)
        sub_font = ImageFont.truetype("DejaVuSans.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
        sub_font = ImageFont.load_default()
    draw.text((pill_x + 16, pill_y + 10), scene.title, fill="#0f172a", font=font)
    draw.text(
        (pill_x + 16, pill_y + 28),
        f"Start {start['label']}   Goal {goal['label']}",
        fill="#334155",
        font=sub_font,
    )

    canvas = Image.alpha_composite(canvas, overlay)
    canvas = canvas.resize((width * scale, height * scale), Image.Resampling.LANCZOS)
    canvas = canvas.filter(ImageFilter.UnsharpMask(radius=1.2, percent=110, threshold=2))
    return canvas


def build_base_map(maps_dir: Path) -> Image.Image:
    semantic = Image.open(maps_dir / "global_s.semantic.png").convert("RGBA")
    point_cloud = Image.open(maps_dir / "global_s.pointcloud.png").convert("RGBA")

    base = Image.blend(semantic, point_cloud, alpha=0.38)
    veil = Image.new("RGBA", base.size, (255, 255, 255, 38))
    return Image.alpha_composite(base, veil)


def build_contact_sheet(images: list[tuple[str, Image.Image]]) -> Image.Image:
    if not images:
        raise ValueError("No images to compose.")
    card_gap = 36
    label_h = 44
    cols = 1
    widths = [img.width for _, img in images]
    heights = [img.height for _, img in images]
    sheet_w = max(widths) + card_gap * 2
    sheet_h = sum(heights) + len(images) * label_h + card_gap * (len(images) + 1)
    sheet = Image.new("RGBA", (sheet_w, sheet_h), "#f8fafc")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 24)
    except OSError:
        font = ImageFont.load_default()

    y = card_gap
    for name, image in images:
        x = (sheet_w - image.width) // 2
        draw.rounded_rectangle(
            (x - 8, y - 8, x + image.width + 8, y + image.height + 8),
            radius=10,
            fill=(255, 255, 255, 255),
            outline=(148, 163, 184, 120),
            width=1,
        )
        sheet.alpha_composite(image, (x, y))
        draw.text((x, y + image.height + 12), name, fill="#0f172a", font=font)
        y += image.height + label_h + card_gap
    return sheet


def main() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    maps_dir = script_dir.parent / "dist" / "maps"
    output_dir = Path(args.output_dir)
    ensure_dir(output_dir)

    road_graph = load_json(maps_dir / "road_graph_V1.json")
    semantic_meta = load_json(maps_dir / "global_s.semantic.json")
    bounds = semantic_meta["bounds"]
    base_map = build_base_map(maps_dir)

    rendered = []
    for scene in SCENES:
        image = draw_scene(scene, base_map, road_graph, bounds, scale=4)
        output_path = output_dir / f"{scene.slug}.png"
        image.save(output_path)
        rendered.append((scene.slug, image))
        print(f"saved {output_path}")

    sheet = build_contact_sheet(rendered)
    contact_sheet_path = output_dir / "scene_contact_sheet.png"
    sheet.save(contact_sheet_path)
    print(f"saved {contact_sheet_path}")


if __name__ == "__main__":
    main()
