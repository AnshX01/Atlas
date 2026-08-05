"""
Text chunking utility for Atlas.

This module provides a simple whitespace-based tokenization approach for splitting
large text into overlapping windows. Each whitespace-separated token is treated as
approximately one token (1 word ≈ 1 token). This is an approximation — real
subword tokenizers (e.g., BPE) produce different token counts, but this approach
is fast, dependency-free, and accurate enough for retrieval chunk sizing.
"""

from __future__ import annotations


def chunk_text(
    text: str,
    max_tokens: int = 500,
    overlap: int = 50,
) -> list[str]:
    """Split *text* into overlapping token-window chunks.

    Tokenization strategy: split on whitespace. Each resulting element is
    counted as one token. Chunks are formed by sliding a window of
    *max_tokens* words across the token list with a stride of
    ``max_tokens - overlap``, producing consecutive chunks that share
    *overlap* words with their neighbours.

    Args:
        text: The input text to chunk.
        max_tokens: Maximum number of words (tokens) per chunk. Defaults to 500.
        overlap: Number of words shared between adjacent chunks. Defaults to 50.
            Must be less than *max_tokens*; if not, treated as 0.

    Returns:
        A list of string chunks. Returns ``[]`` for empty or whitespace-only
        input. Returns ``[text]`` when the total word count is at or below
        *max_tokens*.
    """
    if not text or not text.strip():
        return []

    words = text.split()

    if len(words) <= max_tokens:
        return [text]

    # Guard against degenerate overlap values
    safe_overlap = overlap if 0 < overlap < max_tokens else 0
    step = max_tokens - safe_overlap

    chunks: list[str] = []
    start = 0
    while start < len(words):
        end = start + max_tokens
        chunk_words = words[start:end]
        chunks.append(" ".join(chunk_words))
        if end >= len(words):
            break
        start += step

    return chunks
