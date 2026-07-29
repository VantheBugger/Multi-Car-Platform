import json
import pickle
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'generate-roadmap-pkl.py'


class GenerateRoadmapTest(unittest.TestCase):
    def generate(self, directed):
        graph_data = {
            'directed': directed,
            'nodes': [
                {'id': 'A', 'x': 0, 'y': 0},
                {'id': 'B', 'x': 1, 'y': 0},
            ],
            'edges': [
                {'source': 'A', 'target': 'B', 'directed': directed},
            ],
        }
        directory = tempfile.TemporaryDirectory()
        root = Path(directory.name)
        source = root / 'graph.json'
        output = root / 'graph.pkl'
        source.write_text(json.dumps(graph_data))
        subprocess.run(
            [sys.executable, str(SCRIPT), '--graph', str(source), '--output', str(output)],
            check=True,
            capture_output=True,
            text=True,
        )
        with output.open('rb') as stream:
            graph = pickle.load(stream)
        directory.cleanup()
        return graph

    def test_directed_json_produces_one_way_digraph(self):
        graph = self.generate(True)
        self.assertTrue(graph.is_directed())
        self.assertEqual(graph.number_of_edges(), 1)
        self.assertTrue(graph.has_edge((0.0, 0.0, 0.0), (1.0, 0.0, 0.0)))
        self.assertFalse(graph.has_edge((1.0, 0.0, 0.0), (0.0, 0.0, 0.0)))

    def test_undirected_json_remains_undirected(self):
        graph = self.generate(False)
        self.assertFalse(graph.is_directed())
        self.assertEqual(graph.number_of_edges(), 1)


if __name__ == '__main__':
    unittest.main()
