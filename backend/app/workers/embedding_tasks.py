"""
Atlas — Celery Embedding Tasks.

Batch-generates and stores vector embeddings for text chunks.
Uses local SentenceTransformer model to avoid API costs for embedding.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from app.infrastructure.qdrant_client import upsert_vectors
from app.workers.celery_app import celery_app
from celery.utils.log import get_task_logger
from sentence_transformers import SentenceTransformer

logger = get_task_logger(__name__)

_embedder: SentenceTransformer | None = None


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
    return asyncio.get_event_loop().run_until_complete(_async_embed(uuid.UUID(user_id), chunks))


async def _async_embed(user_id: uuid.UUID, chunks: list[dict[str, Any]]) -> dict:
    """Async implementation of batch embedding."""
    embedder = get_embedder()
    embedded = 0
    failed = 0
    points = []

    for chunk in chunks:
        try:
            text = chunk.get("text", "")
            if not text.strip():
                continue

            vector = embedder.encode(text).tolist()
            points.append(
                {
                    "id": uuid.UUID(chunk["id"]) if isinstance(chunk["id"], str) else chunk["id"],
                    "vector": vector,
                    "payload": {
                        "source_id": chunk.get("source_id", ""),
                        "type": chunk.get("type", "unknown"),
                        "timestamp": chunk.get("timestamp", ""),
                        "text_chunk": text[:2000],  # Qdrant payload size limit
                        **(chunk.get("metadata", {})),
                    },
                }
            )
            embedded += 1
        except Exception as e:
            logger.warning("Failed to embed chunk", chunk_id=chunk.get("id"), error=str(e))
            failed += 1

    if points:
        await upsert_vectors(user_id, points)

    logger.info("Batch embedding complete", embedded=embedded, failed=failed, user_id=str(user_id))
    return {"embedded": embedded, "failed": failed}
