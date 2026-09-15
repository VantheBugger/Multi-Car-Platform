#!/usr/bin/env python3
"""Translate selected LaTeX paper sources while preserving LaTeX and math verbatim."""

from __future__ import annotations

import json
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path("/mnt/d/platformm_wang_windows")
SRC_ROOT = ROOT / "_jepa_latex"
OUT_ROOT = ROOT / "_jepa_latex_zh_v6"
CACHE_FILE = OUT_ROOT / "translation_cache.json"

MATH_ENVS = {
    "equation", "equation*", "align", "align*", "alignat", "alignat*",
    "gather", "gather*", "multline", "multline*", "displaymath",
    "eqnarray", "eqnarray*", "flalign", "flalign*",
}

# These commands carry identifiers, paths, dimensions, citations, or configuration.
# Their immediate []/{} groups must never be translated.
OPAQUE_COMMANDS = {
    "cite", "citep", "citet", "citealp", "citeauthor", "citeyear", "Cite",
    "ref", "pageref", "autoref", "cref", "Cref", "eqref", "label",
    "url", "path", "href", "hyperref", "includegraphics", "includesvg",
    "input", "include", "bibliography", "bibliographystyle",
    "vspace", "hspace", "vskip", "hskip", "rule", "raisebox",
    "setlength", "addtolength", "resizebox", "scalebox", "rotatebox",
    "color", "textcolor", "cellcolor", "rowcolor", "definecolor",
    "begin", "end", "documentclass", "usepackage", "newcommand", "renewcommand",
    "providecommand", "DeclareMathOperator", "newtheorem", "setcounter",
    "addtocounter", "stepcounter", "setboolean", "fontsize",
}

GROUP_ENVS = {"tabular", "tabularx", "array", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix"}


def balanced_group(text: str, start: int, left: str, right: str) -> int:
    """Return the exclusive end of a balanced group starting at start."""
    if start >= len(text) or text[start] != left:
        return start
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == left:
            depth += 1
        elif ch == right:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def opaque_command_end(text: str, cmd_end: int) -> int:
    """Consume whitespace and all immediately following []/{} groups."""
    i = cmd_end
    while True:
        while i < len(text) and text[i] in " \t":
            i += 1
        if i < len(text) and text[i] == "[":
            i = balanced_group(text, i, "[", "]")
            continue
        if i < len(text) and text[i] == "{":
            i = balanced_group(text, i, "{", "}")
            continue
        return i


def math_end(text: str, start: int) -> int | None:
    if text.startswith("$$", start):
        j = start + 2
        while True:
            j = text.find("$$", j)
            if j < 0:
                return len(text)
            if j == 0 or text[j - 1] != "\\":
                return j + 2
            j += 2
    if text[start] == "$":
        j = start + 1
        while j < len(text):
            if text[j] == "$" and text[j - 1] != "\\":
                return j + 1
            j += 1
        return len(text)
    if text.startswith("\\(", start):
        j = text.find("\\)", start + 2)
        return len(text) if j < 0 else j + 2
    if text.startswith("\\[", start):
        j = text.find("\\]", start + 2)
        return len(text) if j < 0 else j + 2
    return None


def protected_units(
    text: str, protect_group_envs: bool = True, table_mode: bool = False
) -> list[tuple[bool, str]]:
    """Split source into (protected, content) units."""
    out: list[tuple[bool, str]] = []
    plain: list[str] = []

    def flush() -> None:
        if plain:
            out.append((False, "".join(plain)))
            plain.clear()

    i = 0
    n = len(text)
    while i < n:
        # Comments are preserved through end-of-line.
        if text[i] == "%" and (i == 0 or text[i - 1] != "\\"):
            flush()
            j = text.find("\n", i)
            j = n if j < 0 else j + 1
            out.append((True, text[i:j]))
            i = j
            continue

        # Display math environments are copied as one exact unit.
        if text.startswith("\\begin{", i):
            m = re.match(r"\\begin\{([^}]+)\}", text[i:])
            if m and m.group(1) in MATH_ENVS:
                flush()
                env = m.group(1)
                close = "\\end{" + env + "}"
                j = text.find(close, i + m.end())
                j = n if j < 0 else j + len(close)
                out.append((True, text[i:j]))
                i = j
                continue
            if protect_group_envs and m and m.group(1) in GROUP_ENVS:
                flush()
                env = m.group(1)
                close = "\\end{" + env + "}"
                j = text.find(close, i + m.end())
                j = n if j < 0 else j + len(close)
                out.append((True, text[i:j]))
                i = j
                continue

        # Inline/display math delimiters are copied byte-for-byte.
        if text[i] == "$" or text.startswith("\\(", i) or text.startswith("\\[", i):
            j = math_end(text, i)
            if j is not None:
                flush()
                out.append((True, text[i:j]))
                i = j
                continue

        # LaTeX commands themselves are protected. Identifier-bearing commands
        # also consume their immediate arguments.
        if text[i] == "\\":
            flush()
            m = re.match(r"\\([A-Za-z@]+\*?|.)", text[i:], re.S)
            if not m:
                out.append((True, text[i]))
                
                i += 1
                continue
            cmd = m.group(1).rstrip("*")
            j = i + m.end()
            if cmd in OPAQUE_COMMANDS:
                j = opaque_command_end(text, j)
            elif table_mode and cmd not in {"textbf", "textit", "emph", "makecell"}:
                # Table formatting commands may use (lr), [], and {} syntax.
                # Preserve all their arguments; only visible cell prose is translated.
                k = j
                while k < len(text) and text[k] in " \t":
                    k += 1
                if k < len(text) and text[k] == "(":
                    end_paren = text.find(")", k + 1)
                    k = len(text) if end_paren < 0 else end_paren + 1
                j = opaque_command_end(text, k)
            if cmd in {"vskip", "hskip", "vspace", "hspace", "kern", "mkern"}:
                # TeX dimensions may be written as a bare token, e.g.\n+                # ``\\vskip 0.2in``; keep the unit out of translation.
                m_dim = re.match(r"\s*[-+]?\d*\.?\d+\s*(?:pt|pc|in|bp|cm|mm|dd|cc|em|ex)", text[j:])
                if m_dim:
                    j += m_dim.end()
            out.append((True, text[i:j]))
            i = j
            continue

        # Grouping and alignment syntax must remain exactly positioned.
        if text[i] in "{}&~":
            flush()
            out.append((True, text[i]))
            i += 1
            continue

        plain.append(text[i])
        i += 1

    flush()
    return out


def marker(index: int) -> str:
    # Underscore-delimited alphanumeric tokens are retained verbatim by the
    # translation service, including in dense tables.
    return f"___LATEXTOKEN{index:06d}___"


def encode_protected(text: str) -> tuple[str, dict[str, str]]:
    mapping: dict[str, str] = {}
    parts: list[str] = []
    for is_protected, value in protected_units(text):
        if is_protected:
            key = marker(len(mapping))
            mapping[key] = value
            # Separating adjacent tokens prevents the service from coalescing
            # their underscore boundaries in command-dense LaTeX tables.
            parts.append(" " + key + " ")
        else:
            parts.append(value)
    return "".join(parts), mapping


def restore_protected(text: str, mapping: dict[str, str]) -> str:
    # Markers are emitted in source order. Translation may insert one letter in
    # a dense run of table markers (for example CV -> CCV), while retaining the
    # order and count. Positional restoration is therefore safer than guessing
    # from marker spelling.
    expected = list(mapping)
    token_re = re.compile(r"___LATEXTOKEN\d{6}___", re.I)
    found = list(token_re.finditer(text))
    def distance(a: str, b: str) -> int:
        prev = list(range(len(b) + 1))
        for i, ca in enumerate(a, 1):
            cur = [i]
            for j, cb in enumerate(b, 1):
                cur.append(min(cur[-1] + 1, prev[j] + 1, prev[j - 1] + (ca.lower() != cb.lower())))
            prev = cur
        return prev[-1]

    # Align marker sequences, allowing a single dropped or duplicated marker.
    m, n = len(found), len(expected)
    dp = [[10**9] * (n + 1) for _ in range(m + 1)]
    act: list[list[str | None]] = [[None] * (n + 1) for _ in range(m + 1)]
    dp[0][0] = 0
    for i in range(m + 1):
        for j in range(n + 1):
            base = dp[i][j]
            if i < m and j < n:
                cost = distance(found[i].group(0), expected[j])
                if cost <= 2 and base + cost < dp[i + 1][j + 1]:
                    dp[i + 1][j + 1] = base + cost
                    act[i + 1][j + 1] = "match"
            if j < n and base + 5 < dp[i][j + 1]:
                dp[i][j + 1] = base + 5
                act[i][j + 1] = "missing"
            if i < m and base + 5 < dp[i + 1][j]:
                dp[i + 1][j] = base + 5
                act[i + 1][j] = "extra"
    if dp[m][n] < 10**9 and dp[m][n] <= 7:
        ops: list[tuple[str, int | None, int | None]] = []
        i, j = m, n
        while i or j:
            operation = act[i][j]
            if operation == "match":
                ops.append((operation, i - 1, j - 1)); i -= 1; j -= 1
            elif operation == "missing":
                ops.append((operation, None, j - 1)); j -= 1
            elif operation == "extra":
                ops.append((operation, i - 1, None)); i -= 1
            else:
                break
        ops.reverse()
        pieces: list[str] = []
        cursor = 0
        for operation, fi, ej in ops:
            if operation == "match":
                match = found[fi]  # type: ignore[index]
                pieces.append(text[cursor:match.start()])
                pieces.append(mapping[expected[ej]])  # type: ignore[index]
                cursor = match.end()
            elif operation == "missing":
                # Insert a lost LaTeX token immediately before the next output marker.
                next_fi = next((x[1] for x in ops[ops.index((operation, fi, ej)) + 1:] if x[0] == "match"), None)
                if next_fi is None:
                    pieces.append(text[cursor:])
                    cursor = len(text)
                else:
                    match = found[next_fi]
                    pieces.append(text[cursor:match.start()])
                    cursor = match.start()
                pieces.append(mapping[expected[ej]])  # type: ignore[index]
            elif operation == "extra":
                match = found[fi]  # type: ignore[index]
                pieces.append(text[cursor:match.start()])
                cursor = match.end()
        pieces.append(text[cursor:])
        return "".join(pieces)

    # Fallback for occasional spaces inserted inside a marker.
    for key in sorted(mapping, key=len, reverse=True):
        value = mapping[key]
        text = text.replace(key, value)
        spaced = r"\s*".join(map(re.escape, key))
        text = re.sub(spaced, lambda _m, v=value: v, text, flags=re.I)
    leftovers = re.findall(r"___LATEXTOKEN\d{6}___", text, re.I)
    if leftovers or "LATEXTOKEN" in text:
        raise RuntimeError(
            f"Placeholder count changed ({len(found)} vs {len(expected)}); leftovers: {leftovers[:3]}"
        )
    return text


def split_for_api(text: str, max_len: int = 2200) -> list[str]:
    if len(text) <= max_len:
        return [text]
    pieces = re.split(r"(?<=[.!?。！？])\s+|\n(?=\s*[A-Z])", text)
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if not piece:
            continue
        candidate = (current + " " + piece).strip() if current else piece
        if len(candidate) <= max_len:
            current = candidate
            continue
        if current:
            chunks.append(current)
        while len(piece) > max_len:
            cut = piece.rfind(" ", 0, max_len)
            if cut < max_len // 2:
                cut = max_len
            chunks.append(piece[:cut])
            piece = piece[cut:].lstrip()
        current = piece
    if current:
        chunks.append(current)
    return chunks


def google_translate(text: str) -> str:
    params = urllib.parse.urlencode({
        "client": "gtx", "sl": "en", "tl": "zh-CN", "dt": "t", "q": text,
    })
    url = "https://translate.googleapis.com/translate_a/single?" + params
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                data = json.loads(response.read().decode("utf-8"))
            return "".join(part[0] for part in data[0] if part and part[0])
        except Exception as exc:  # pragma: no cover - network retry
            last_error = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Translation request failed: {last_error}")


class Translator:
    def __init__(self) -> None:
        if CACHE_FILE.exists():
            self.cache = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        else:
            self.cache: dict[str, str] = {}
        self.new_items = 0

    def save(self) -> None:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(self.cache, ensure_ascii=False, indent=2), encoding="utf-8")

    def translate_chunk(self, chunk: str) -> str:
        if chunk in self.cache:
            return self.cache[chunk]
        result = google_translate(chunk)
        self.cache[chunk] = result
        self.new_items += 1
        if self.new_items % 10 == 0:
            self.save()
            print(f"  translated {self.new_items} new chunks", flush=True)
        time.sleep(0.12)
        return result

    def translate_block(self, block: str) -> str:
        surrogate, mapping = encode_protected(block)
        visible = re.sub(r"___LATEXTOKEN\d{6}___", "", surrogate)
        # Skip blocks without meaningful English prose.
        if not re.search(r"[A-Za-z]{2,}", visible):
            return block
        chunks = split_for_api(surrogate)
        translated = " ".join(self.translate_chunk(c) for c in chunks)
        return restore_protected(translated, mapping)

    def translate_table(self, text: str) -> str:
        """Translate table labels cell-by-cell, never sending numeric tokens."""
        out: list[str] = []
        for protected, value in protected_units(
            text, protect_group_envs=False, table_mode=True
        ):
            if protected:
                out.append(value)
                continue
            pieces = re.split(r"([-+]?\d+(?:\.\d+)?(?:[kKMB])?)", value)
            for piece in pieces:
                if not re.search(r"[A-Za-z]{2,}", piece):
                    out.append(piece)
                    continue
                # Common model/dataset abbreviations are scholarly identifiers.
                visible_words = re.findall(r"[A-Za-z]+", piece)
                if visible_words and all(w.isupper() or len(w) <= 1 for w in visible_words):
                    out.append(piece)
                else:
                    out.append(self.translate_chunk(piece))
        return "".join(out)

    def _translate_latex_without_tables(self, text: str) -> str:
        # Blank lines define natural LaTeX paragraphs and keep the source stable.
        parts = re.split(r"(\n\s*\n)", text)
        out: list[str] = []
        for idx, part in enumerate(parts):
            if idx % 2 == 1:
                out.append(part)
            else:
                out.append(self.translate_block(part))
        return "".join(out)

    def translate_latex(self, text: str) -> str:
        pattern = re.compile(
            r"(?s)\\begin\{(tabular\*?|tabularx|array|matrix|pmatrix|bmatrix|vmatrix|Vmatrix)\}"
            r".*?\\end\{\1\}"
        )
        out: list[str] = []
        cursor = 0
        for match in pattern.finditer(text):
            out.append(self._translate_latex_without_tables(text[cursor:match.start()]))
            out.append(self.translate_table(match.group(0)))
            cursor = match.end()
        out.append(self._translate_latex_without_tables(text[cursor:]))
        return "".join(out)


def add_chinese_preamble(text: str, anchor: str) -> str:
    insertion = (
        anchor
        + "\n% Chinese typesetting added for the translated edition.\n"
        + "\\usepackage[UTF8,scheme=plain]{ctex}\n"
        + "\\setCJKmainfont{Noto Serif CJK SC}\n"
        + "\\setCJKsansfont{Noto Sans CJK SC}\n"
        + "\\setCJKmonofont{Noto Sans Mono CJK SC}\n"
    )
    return text.replace(anchor, insertion, 1)


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def translate_jepa_vla(tr: Translator) -> Path:
    src = SRC_ROOT / "jepa_vla_src"
    dst = OUT_ROOT / "jepa_vla_zh"
    copy_tree(src, dst)
    path = dst / "preprint.tex"
    text = path.read_text(encoding="utf-8")
    text = add_chinese_preamble(text, "\\documentclass{article}")
    replacements = {
        "JEPA-VLA: Video Predictive Embedding is Needed for VLA Models":
            "JEPA-VLA：VLA 模型需要视频预测嵌入",
        "\\icmlaffiliation{tsinghua}{Tsinghua University}":
            "\\icmlaffiliation{tsinghua}{清华大学}",
        "\\icmlaffiliation{huawei}{Huawei Noah's Ark Lab}":
            "\\icmlaffiliation{huawei}{华为诺亚方舟实验室}",
        "\\icmlkeywords{Machine Learning, ICML}":
            "\\icmlkeywords{机器学习，视觉—语言—动作模型，预测嵌入}",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    start = text.index("\\begin{abstract}")
    prefix, body = text[:start], text[start:]
    print("Translating JEPA-VLA body...", flush=True)
    text = prefix + tr.translate_latex(body)
    path.write_text(text, encoding="utf-8")
    # Existing .bbl lets XeLaTeX render references without rebuilding BibTeX.
    bbl = dst / "preprint.bbl"
    if not bbl.exists() and (src / "preprint.bbl").exists():
        shutil.copy2(src / "preprint.bbl", bbl)
    return dst


def translate_vla_jepa(tr: Translator) -> Path:
    src = SRC_ROOT / "vla_jepa_src"
    dst = OUT_ROOT / "vla_jepa_zh"
    copy_tree(src, dst)

    main = dst / "main.tex"
    text = main.read_text(encoding="utf-8")
    text = add_chinese_preamble(text, "\\documentclass[twocolumn]{galbot}")
    replacements = {
        "VLA-JEPA: Enhancing Vision-Language-Action Model with Latent World Model":
            "VLA-JEPA：利用潜在世界模型增强视觉—语言—动作模型",
        "\\affiliation[1]{University of Science and Technology of China}":
            "\\affiliation[1]{中国科学技术大学}",
        "\\affiliation[2]{Zhongguancun Academy, Beijing, China}":
            "\\affiliation[2]{中关村学院，中国北京}",
        "\\affiliation[3]{Shanghai Jiao Tong University}":
            "\\affiliation[3]{上海交通大学}",
        "\\affiliation[4]{Tsinghua University}":
            "\\affiliation[4]{清华大学}",
        "\\affiliation[5]{Eastern Institute of Technology, Ningbo}":
            "\\affiliation[5]{宁波东方理工大学}",
        "\\affiliation[6]{University of Chinese Academy of Sciences}":
            "\\affiliation[6]{中国科学院大学}",
        "\\affiliation[7]{Nankai University}":
            "\\affiliation[7]{南开大学}",
        "\\contribution[*]{Equal Contribution}":
            "\\contribution[*]{同等贡献}",
        "\\contribution[\\dagger]{Corresponding author}":
            "\\contribution[\\dagger]{通讯作者}",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    start = text.index("\\abstract{")
    prefix, body = text[:start], text[start:]
    print("Translating VLA-JEPA main...", flush=True)
    main.write_text(prefix + tr.translate_latex(body), encoding="utf-8")

    for name in ["1_Intro.tex", "2_RW.tex", "3_Methodology.tex", "4_Experiments.tex", "Appendix.tex"]:
        path = dst / name
        print(f"Translating VLA-JEPA {name}...", flush=True)
        path.write_text(tr.translate_latex(path.read_text(encoding="utf-8")), encoding="utf-8")
    return dst


def main() -> None:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    tr = Translator()
    try:
        translate_jepa_vla(tr)
        translate_vla_jepa(tr)
    finally:
        tr.save()
    print(f"Done. Cache contains {len(tr.cache)} chunks.", flush=True)


if __name__ == "__main__":
    main()
