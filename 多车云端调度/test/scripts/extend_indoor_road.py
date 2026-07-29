#!/usr/bin/env python3
"""Add the surveyed indoor branch to every deployed road graph copy.

The branch begins at the existing G5 exit and follows the red-marked route
inside the building.  Segment length is kept below one metre for stable path
tracking.  Edges are explicitly stored in both directions; the graph remains
a NetworkX DiGraph and no existing road direction is changed.
"""

import argparse
import json
import math
import pickle
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_GRAPH = ROOT / "public/maps/road_graph_V1.json"
WEB_LABELS = ROOT / "public/maps/road_graph_V1.labels.json"
PICKLE_PATHS = (
    Path("/home/van/real2sim0702/src/path_planner/src/road_graph_web.pkl"),
    Path("/home/van/ros1_newcar_src_launch/src/path_planner/src/road_graph_web.pkl"),
    Path("/home/van/ros1_src0702/src/path_planner/src/road_graph_web.pkl"),
    Path("/home/van/platformm_wang/ros2_vehicle_ws/src/fleet_vehicle/maps/road_graph_web.pkl"),
)

START_ID = "G5_X05_L2_ROAD_EXT"
START = (-0.055, 12.161, 0.0)
END = (26.250, 15.800, 0.0)
MAX_SEGMENT_LENGTH = 1.0
INDOOR_PREFIX = "G5_INDOOR_"


def distance(a, b):
    return math.dist(a, b)


def indoor_points():
    segments = math.ceil(distance(START, END) / MAX_SEGMENT_LENGTH)
    return [
        tuple(START[axis] + (END[axis] - START[axis]) * index / segments for axis in range(3))
        for index in range(1, segments + 1)
    ]


def edge_record(edge_id, source, target, nodes):
    source_node = nodes[source]
    target_node = nodes[target]
    length = distance(
        (source_node["x"], source_node["y"], source_node.get("z", 0.0)),
        (target_node["x"], target_node["y"], target_node.get("z", 0.0)),
    )
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "weight": length,
        "length": length,
        "speedLimit": 0.0,
        "roadType": "indoor_access",
        "directed": True,
    }


def apply_web_graph():
    graph = json.loads(WEB_GRAPH.read_text(encoding="utf-8"))
    nodes = graph["nodes"]
    if any(node["id"].startswith(INDOOR_PREFIX) for node in nodes):
        raise RuntimeError("indoor road is already present in the Web graph")

    node_map = {node["id"]: node for node in nodes}
    if START_ID not in node_map:
        raise RuntimeError(f"Web graph is missing {START_ID}")

    points = indoor_points()
    new_ids = [f"{INDOOR_PREFIX}{index:02d}" for index in range(1, len(points) + 1)]
    for index, (node_id, point) in enumerate(zip(new_ids, points), start=1):
        node = {
            "id": node_id,
            "sourceId": node_id,
            "x": round(point[0], 6),
            "y": round(point[1], 6),
            "z": round(point[2], 6),
            "type": "indoor_access",
            "order": len(nodes),
        }
        nodes.append(node)
        node_map[node_id] = node

    chain = [START_ID, *new_ids]
    next_edge = len(graph["edges"])
    for source, target in zip(chain, chain[1:]):
        graph["edges"].append(edge_record(f"e{next_edge}", source, target, node_map))
        next_edge += 1
        graph["edges"].append(edge_record(f"e{next_edge}", target, source, node_map))
        next_edge += 1

    graph["nodeCount"] = len(nodes)
    graph["edgeCount"] = len(graph["edges"])
    xs = [node["x"] for node in nodes]
    ys = [node["y"] for node in nodes]
    zs = [node.get("z", 0.0) for node in nodes]
    graph["bounds"] = {
        "minX": min(xs), "maxX": max(xs),
        "minY": min(ys), "maxY": max(ys),
        "minZ": min(zs), "maxZ": max(zs),
    }
    WEB_GRAPH.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    labels = json.loads(WEB_LABELS.read_text(encoding="utf-8"))
    label_items = labels.setdefault("labels", [])
    next_label = max(int(item["label"]) for item in label_items if str(item["label"]).isdigit()) + 1
    for index, node_id in enumerate(new_ids):
        label_items.append({"sourceId": node_id, "label": str(next_label + index)})
    WEB_LABELS.write_text(json.dumps(labels, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(points)


def apply_pickle(path, points):
    with path.open("rb") as handle:
        graph = pickle.load(handle)
    if not graph.is_directed():
        raise RuntimeError(f"{path} is not a directed graph")

    start_node = min(graph.nodes, key=lambda node: distance(tuple(node), START))
    if distance(tuple(start_node), START) > 0.01:
        raise RuntimeError(f"{path} is missing the expected indoor-road entrance")
    if any(distance(tuple(node), points[-1]) < 0.01 for node in graph.nodes):
        raise RuntimeError(f"indoor road is already present in {path}")

    chain = [start_node]
    for point in points:
        node = tuple(round(value, 6) for value in point)
        graph.add_node(node, pos=node)
        chain.append(node)
    for source, target in zip(chain, chain[1:]):
        weight = distance(source, target)
        graph.add_edge(source, target, weight=weight)
        graph.add_edge(target, source, weight=weight)

    with path.open("wb") as handle:
        pickle.dump(graph, handle, protocol=pickle.HIGHEST_PROTOCOL)


def main():
    parser = argparse.ArgumentParser(description="Add the indoor road branch to Web and vehicle graphs.")
    parser.add_argument("--apply", action="store_true", help="write the graph extension")
    args = parser.parse_args()
    if not args.apply:
        parser.error("pass --apply to modify the route graphs")

    points = indoor_points()
    count = apply_web_graph()
    for path in PICKLE_PATHS:
        apply_pickle(path, points)
    print(f"Added {count} indoor nodes and {count * 2} directed edges to Web and {len(PICKLE_PATHS)} vehicle graphs.")


if __name__ == "__main__":
    main()
