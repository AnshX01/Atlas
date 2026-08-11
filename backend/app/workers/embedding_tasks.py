"""
Atlas — Celery Embedding Tasks.

Batch-generates and stores vector embeddings for text chunks.
Uses local SentenceTransformer model to avoid API costs for embedding.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from app.infrastructure.qdrant_client import reset_qdrant_client, upsert_vectors
from app.workers.celery_app import celery_app
from celery.utils.log import get_task_logger
from sentence_transformers import SentenceTransformer

logger = get_task_logger(__name__)

_embedder: SentenceTransformer | None = None


def enqueue_embedding_batches(user_id: str, chunks: list[dict[str, Any]], batch_size: int = 100) -> None:
    """Safely enqueue chunks to celery in batches to prevent payload limits and memory leaks."""
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        batch_embed_chunks.delay(user_id, batch)



def get_embedder() -> SentenceTransformer:
    """Lazy-load the local embedding model."""
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        logger.info("Embedding model loaded: all-MiniLM-L6-v2 (384-dim)")
    return _embedder


@celery_app.task(
    name="app.workers.embedding_tasks.batch_embed_chunks",
    queue="embedding",
    max_retries=2,
)
def batch_embed_chunks(user_id: str, chunks: list[dict[str, Any]]) -> dict:
    """
    Celery task: Embed a batch of text chunks and store in Qdrant.

    Args:
        user_id: UUID string — RBAC isolation key for the Qdrant collection.
        chunks: List of dicts with keys:
            - id: UUID string for the point
            - source_id: UUID of the source document/message
            - type: "email" | "pr" | "doc" | "message" | "file"
            - text: The text to embed
            - timestamp: ISO datetime string
            - metadata: Additional payload fields

    Returns:
        {"embedded": int, "failed": int}
    """
    return asyncio.run(_async_embed(uuid.UUID(user_id), chunks))


async def _async_embed(user_id: uuid.UUID, chunks: list[dict[str, Any]]) -> dict:
    """Async implementation of batch embedding."""
    reset_qdrant_client()
    embedder = get_embedder()
    embedded = 0
    failed = 0
    points = []

    EXPECTED_DIM = 384
    MAX_BATCH_SIZE = 32
    MAX_RETRIES = 3

    for i in range(0, len(chunks), MAX_BATCH_SIZE):
        batch = chunks[i:i + MAX_BATCH_SIZE]
        texts = []
        valid_chunks = []
        
        for chunk in batch:
            text = chunk.get("text", "")
            if text.strip():
                texts.append(text)
                valid_chunks.append(chunk)

        if not texts:
            continue

        retries = 0
        while retries <= MAX_RETRIES:
            try:
                # Batch encode
                vectors = embedder.encode(texts).tolist()
                
                for chunk, vector in zip(valid_chunks, vectors):
                    if len(vector) != EXPECTED_DIM:
                        raise ValueError(f"Dimension mismatch for chunk {chunk.get('id')}: expected {EXPECTED_DIM}, got {len(vector)}")
                        
                    points.append(
                        {
                            "id": uuid.UUID(chunk["id"]) if isinstance(chunk["id"], str) else chunk["id"],
                            "vector": vector,
                            "payload": {
                                "source_id": chunk.get("source_id", ""),
                                "type": chunk.get("type", "unknown"),
                                "timestamp": chunk.get("timestamp", ""),
                                "text_chunk": chunk.get("text", "")[:2000],  # Qdrant payload size limit
                                **(chunk.get("metadata", {})),
                            },
                        }
                    )
                    embedded += 1
                break  # Break out of retry loop on success
            except Exception as e:
                # Gracefully handle rate limits (if model is swapped for API)
                if "rate limit" in str(e).lower() or "429" in str(e) or "too many requests" in str(e).lower():
                    retries += 1
                    if retries > MAX_RETRIES:
                        logger.error("Max retries reached for rate limit: error=%s", str(e), exc_info=True)
                        raise
                    logger.warning("Rate limit hit, retrying %d/%d in %ds...", retries, MAX_RETRIES, 2 ** retries)
                    await asyncio.sleep(2 ** retries)
                else:
                    # Do not swallow other errors silently
                    logger.error("Failed to embed batch: error=%s", str(e), exc_info=True)
                    raise

    if points:
        await upsert_vectors(user_id, points)

    logger.info("Batch embedding complete: embedded=%d failed=%d user_id=%s", embedded, failed, str(user_id))
    return {"embedded": embedded, "failed": failed}
