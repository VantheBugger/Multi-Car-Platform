#!/usr/bin/env python3
"""Compare protected LaTeX/math tokens between source and translated files."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from latex_translate_zh import protected_units  # noqa: E402


def protected_sequence(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return [value for protected, value in protected_units(text) if protected]


def main() -> int:
    for pair in sys.argv[1:]:
        left, right = map(Path, pair.split("::", 1))
        a = protected_sequence(left)
        b = protected_sequence(right)
        print(f"{left.name}: source={len(a)} translated={len(b)}")
        if a != b:
            for i in range(max(len(a), len(b))):
                av = a[i] if i < len(a) else "<missing>"
                bv = b[i] if i < len(b) else "<missing>"
                if av != bv:
                    print(f"  first mismatch #{i}:\n    source={av!r}\n    translated={bv!r}")
                    break
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
