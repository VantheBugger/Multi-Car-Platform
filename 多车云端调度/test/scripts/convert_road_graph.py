#!/usr/bin/env python3
import argparse
import json
import pickle
from pathlib import Path


def as_float(value):
    return float(value)


def load_label_map(path):
    if not path or not path.exists():
        return {}

    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "labels" in data:
        return {str(item["sourceId"]): str(item["label"]) for item in data.get("labels", [])}
    if isinstance(data, dict):
        return {str(key): str(value) for key, value in data.items()}
    return {}


def write_label_map(path, labels):
    if not path:
        return

    output = {
        "description": "UI label mapping for road_graph_V1. Edit label values to change web UI node numbers without changing sourceId.",
        "labels": [
            {
                "sourceId": source_id,
                "label": label,
            }
            for source_id, label in labels
        ],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")


def label_for(source_id, index, label_map):
    return label_map.get(str(source_id), str(index + 1))


def convert_road_graph_editor(data, source_name, coordinate_frame, label_map):
    node_ids = {}
    nodes = []
    for index, (node_id, node_data) in enumerate(data.get("nodes", {}).items()):
        frontend_id = str(node_id)
        node_ids[node_id] = frontend_id
        nodes.append({
            "id": frontend_id,
            "sourceId": str(node_id),
            "label": label_for(node_id, index, label_map),
            "x": as_float(node_data.get("x", 0.0)),
            "y": as_float(node_data.get("y", 0.0)),
            "z": as_float(node_data.get("z", 0.0)),
            "type": node_data.get("type", "normal"),
            "order": index,
        })

    edges = []
    for index, edge in enumerate(data.get("edges", [])):
        source = edge.get("from")
        target = edge.get("to")
        if source not in node_ids or target not in node_ids:
            continue

        edges.append({
            "id": f"e{index}",
            "source": node_ids[source],
            "target": node_ids[target],
            "weight": as_float(edge.get("cost", edge.get("length", 0.0))),
            "length": as_float(edge.get("length", edge.get("cost", 0.0))),
            "speedLimit": as_float(edge.get("speed_limit", 0.0)),
            "roadType": edge.get("road_type", "road"),
            "directed": True,
        })

    return build_output(
        source_name=source_name,
        format_name=data.get("format", "RoadGraphEditor"),
        coordinate_frame=coordinate_frame,
        description="Directed road graph converted from RoadGraphEditor pickle. Edges keep their original from -> to direction.",
        nodes=nodes,
        edges=edges,
        directed=True,
        metadata=data.get("metadata", {}),
    )


def convert_networkx_graph(graph, source_name, coordinate_frame, label_map):
    node_ids = {}
    nodes = []
    for index, (node, data) in enumerate(graph.nodes(data=True)):
        pos = data.get("pos", node)
        source_id = str(node)
        node_id = f"n{index}"
        node_ids[node] = node_id
        nodes.append({
            "id": node_id,
            "sourceId": source_id,
            "label": label_for(source_id, index, label_map),
            "x": as_float(pos[0]),
            "y": as_float(pos[1]),
            "z": as_float(pos[2]) if len(pos) > 2 else 0.0,
        })

    directed = bool(graph.is_directed())
    edges = []
    for index, (source, target, data) in enumerate(graph.edges(data=True)):
        edges.append({
            "id": f"e{index}",
            "source": node_ids[source],
            "target": node_ids[target],
            "weight": as_float(data.get("weight", 0.0)),
            "directed": directed,
        })

    return build_output(
        source_name=source_name,
        format_name="networkx-road-graph",
        coordinate_frame=coordinate_frame,
        description="Road graph converted from NetworkX pickle. Directed graphs preserve source -> target edge direction.",
        nodes=nodes,
        edges=edges,
        directed=directed,
        metadata=getattr(graph, "graph", {}),
    )


def build_output(source_name, format_name, coordinate_frame, description, nodes, edges, directed, metadata=None):
    xs = [node["x"] for node in nodes]
    ys = [node["y"] for node in nodes]
    zs = [node["z"] for node in nodes]

    return {
        "source": source_name,
        "format": format_name,
        "coordinateFrame": coordinate_frame,
        "directed": directed,
        "description": description,
        "metadata": metadata or {},
        "nodeCount": len(nodes),
        "edgeCount": len(edges),
        "bounds": {
            "minX": min(xs) if xs else 0,
            "maxX": max(xs) if xs else 0,
            "minY": min(ys) if ys else 0,
            "maxY": max(ys) if ys else 0,
            "minZ": min(zs) if zs else 0,
            "maxZ": max(zs) if zs else 0,
        },
        "nodes": nodes,
        "edges": edges,
    }


def main():
    parser = argparse.ArgumentParser(description="Convert a NetworkX road graph pickle into frontend JSON.")
    parser.add_argument("input", type=Path, help="Path to road graph .pkl")
    parser.add_argument("output", type=Path, help="Output JSON path")
    parser.add_argument("--coordinate-frame", default="global_s.pcd", help="Coordinate frame label for x/y/z values")
    parser.add_argument("--labels", type=Path, default=None, help="UI label mapping JSON path. Defaults to <output-stem>.labels.json")
    args = parser.parse_args()
    labels_path = args.labels or args.output.with_name(f"{args.output.stem}.labels.json")
    label_map = load_label_map(labels_path)

    with args.input.open("rb") as handle:
        graph = pickle.load(handle)

    if isinstance(graph, dict) and graph.get("format") == "RoadGraphEditor":
        output = convert_road_graph_editor(graph, args.input.name, args.coordinate_frame, label_map)
    else:
        output = convert_networkx_graph(graph, args.input.name, args.coordinate_frame, label_map)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    write_label_map(labels_path, [(node["sourceId"], node["label"]) for node in output["nodes"]])
    print(f"Converted {output['nodeCount']} nodes and {output['edgeCount']} edges to {args.output}")
    print(f"Wrote UI labels to {labels_path}")


if __name__ == "__main__":
    main()
