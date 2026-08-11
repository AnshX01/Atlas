"""
Text chunking utility for Atlas.

This module provides a robust context-aware tokenizer and chunker for splitting
large Markdown, HTML, and plain text into overlapping token windows. It uses
standard libraries (html.parser) and avoids brittle regexes to ensure context
is preserved flawlessly.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser


class ContextualHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.blocks: list[str] = []
        self.current_headers: dict[int, str] = {}
        self.current_text: list[str] = []

        self.header_tags = {'h1': 1, 'h2': 2, 'h3': 3, 'h4': 4, 'h5': 5, 'h6': 6}
        self.block_tags = {'p', 'div', 'br', 'li', 'tr', 'table', 'article', 'section', 'blockquote', 'ul', 'ol'}
        self.current_tag: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.current_tag = tag
        if tag in self.block_tags or tag in self.header_tags:
            self.flush_text()

    def handle_endtag(self, tag: str) -> None:
        if tag in self.block_tags or tag in self.header_tags:
            self.flush_text()
            self.current_tag = None

    def handle_data(self, data: str) -> None:
        data = data.strip()
        if not data:
            return

        if self.current_tag in self.header_tags:
            level = self.header_tags[self.current_tag]
            self.current_headers = {k: v for k, v in self.current_headers.items() if k < level}
            self.current_headers[level] = data
        else:
            self.current_text.append(data)

    def flush_text(self) -> None:
        if self.current_text:
            text = " ".join(self.current_text).strip()
            self.current_text = []
            if not text:
                return

            context = " > ".join([self.current_headers[k] for k in sorted(self.current_headers.keys())])
            if context:
                self.blocks.append(f"[{context}]\n{text}")
            else:
                self.blocks.append(text)


def parse_markdown_to_blocks(text: str) -> list[str]:
    blocks: list[str] = []
    lines = text.split('\n')
    in_code_block = False
    current_headers: dict[int, str] = {}
    current_block: list[str] = []

    def flush_block() -> None:
        if current_block:
            block_text = "\n".join(current_block).strip()
            current_block.clear()
            if not block_text:
                return
            context = " > ".join(current_headers[k] for k in sorted(current_headers.keys()))
            if context:
                blocks.append(f"[{context}]\n{block_text}")
            else:
                blocks.append(block_text)

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            current_block.append(line)
            continue

        if not in_code_block and stripped.startswith("#"):
            parts = stripped.split(" ", 1)
            if len(parts) == 2 and all(c == '#' for c in parts[0]):
                flush_block()
                level = len(parts[0])
                title = parts[1].strip()
                current_headers = {k: v for k, v in current_headers.items() if k < level}
                current_headers[level] = title
                continue

        if not in_code_block and not stripped:
            flush_block()
        else:
            current_block.append(line)

    flush_block()
    return blocks


def is_html(text: str) -> bool:
    return bool(re.search(r"<\s*(html|body|div|p|h1|h2|h3|h4|h5|h6|table|ul|li|section|article)[^>]*>", text, re.IGNORECASE))


def chunk_text(
    text: str,
    max_tokens: int = 500,
    overlap: int = 50,
) -> list[str]:
    """Split *text* into overlapping token-window chunks.

    Tokenization strategy: split on whitespace. Each resulting element is
    counted as one token. Chunks are formed context-aware by parsing HTML
    or Markdown, preserving headers and block layouts, then splitting to
    fit within max_tokens.
    """
    if not text or not text.strip():
        return []

    safe_overlap = overlap if 0 < overlap < max_tokens else 0

    if is_html(text):
        parser = ContextualHTMLParser()
        parser.feed(text)
        parser.flush_text()
        blocks = parser.blocks
    else:
        blocks = parse_markdown_to_blocks(text)

    if not blocks:
        blocks = [text]

    chunks: list[str] = []
    current_chunk_words: list[str] = []

    for block in blocks:
        block_words = block.split()

        if len(current_chunk_words) + len(block_words) <= max_tokens:
            current_chunk_words.extend(block_words)
        else:
            if current_chunk_words:
                chunks.append(" ".join(current_chunk_words))
                current_chunk_words = current_chunk_words[-safe_overlap:] if safe_overlap > 0 else []

            start = 0
            while start < len(block_words):
                space_left = max_tokens - len(current_chunk_words)
                end = start + space_left
                slice_words = block_words[start:end]
                current_chunk_words.extend(slice_words)

                if len(current_chunk_words) == max_tokens:
                    chunks.append(" ".join(current_chunk_words))
                    current_chunk_words = current_chunk_words[-safe_overlap:] if safe_overlap > 0 else []

                start = end

    if current_chunk_words and len(current_chunk_words) > safe_overlap:
        chunks.append(" ".join(current_chunk_words))

    # Edge case: if we had some words but they were fewer or equal to safe_overlap and chunks is empty,
    # we still want to output it if it's the only text we processed.
    if current_chunk_words and not chunks:
        chunks.append(" ".join(current_chunk_words))

    return chunks
