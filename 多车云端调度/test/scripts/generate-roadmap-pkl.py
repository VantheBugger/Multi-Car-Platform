#!/usr/bin/env python3

import argparse
import json
import math
import pickle

import networkx as nx


def node_key(node):
    return (round(float(node["x"]), 6), round(float(node["y"]), 6), 0.0)


def edge_weight(source, target):
    return math.hypot(target[0] - source[0], target[1] - source[1])


def main():
    parser = argparse.ArgumentParser(description="Generate planner roadmap pickle from web road graph JSON.")
    parser.add_argument("--graph", required=True, help="Path to road_graph_V1.json")
    parser.add_argument("--output", required=True, help="Output pickle path")
    args = parser.parse_args()

    with open(args.graph, "r", encoding="utf-8") as f:
      data = json.load(f)

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])
    if not nodes or not edges:
      raise SystemExit("road graph is empty")

    graph_directed = bool(data.get("directed")) or any(
      bool(edge.get("directed")) for edge in edges
    )
    graph = nx.DiGraph() if graph_directed else nx.Graph()
    index = {}
    for node in nodes:
      key = node_key(node)
      index[node["id"]] = key
      graph.add_node(key, pos=key)

    for edge in edges:
      source = index.get(edge.get("source"))
      target = index.get(edge.get("target"))
      if source is None or target is None or source == target:
        continue

      graph.add_edge(source, target, weight=edge_weight(source, target))
      edge_directed = bool(data.get("directed")) or bool(edge.get("directed"))
      if graph_directed and not edge_directed:
        graph.add_edge(target, source, weight=edge_weight(target, source))

    with open(args.output, "wb") as f:
      pickle.dump(graph, f, protocol=pickle.HIGHEST_PROTOCOL)

    xs = [node[0] for node in graph.nodes()]
    ys = [node[1] for node in graph.nodes()]
    print({
      "ok": True,
      "output": args.output,
      "nodeCount": graph.number_of_nodes(),
      "edgeCount": graph.number_of_edges(),
      "directed": graph.is_directed(),
      "bounds": {
        "minX": min(xs),
        "maxX": max(xs),
        "minY": min(ys),
        "maxY": max(ys),
      },
    })


if __name__ == "__main__":
    main()
