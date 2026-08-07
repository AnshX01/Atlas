"""Atlas — Infrastructure: Qdrant vector store client."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    Filter,
    FilterSelector,
    MatchValue,
    PointStruct,
    VectorParams,
)

logger = get_logger(__name__)

# Embedding dimension for the default model (all-MiniLM-L6-v2 = 384)
EMBEDDING_DIM = 384

_client: AsyncQdrantClient | None = None


def get_qdrant_client() -> AsyncQdrantClient:
    """Return (or create) the shared Qdrant async client."""
    global _client
    if _client is None:
        settings = get_settings()
        kwargs: dict[str, Any] = {
            "host": settings.QDRANT_HOST,
            "port": settings.QDRANT_PORT,
        }
        if settings.QDRANT_API_KEY:
            kwargs["api_key"] = settings.QDRANT_API_KEY
        _client = AsyncQdrantClient(**kwargs)
        logger.info("Qdrant client created", host=settings.QDRANT_HOST)
    return _client


def reset_qdrant_client() -> None:
    """Reset the global Qdrant client for use in Celery workers with fresh event loops."""
    global _client
    _client = None


def _collection_name(user_id: uuid.UUID) -> str:
    """Return the per-user Qdrant collection name. Enforces RBAC isolation."""
    return f"user_workspace_{user_id}"


async def ensure_user_collection(user_id: uuid.UUID) -> None:
    """Create the user's vector collection if it doesn't already exist."""
    client = get_qdrant_client()
    name = _collection_name(user_id)
    existing = await client.get_collections()
    existing_names = [c.name for c in existing.collections]

    if name not in existing_names:
        await client.create_collection(
            collection_name=name,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        logger.info("Qdrant collection created", collection=name)


async def upsert_vectors(
    user_id: uuid.UUID,
    points: list[dict[str, Any]],  # Each: {"id": UUID, "vector": list[float], "payload": dict}
) -> None:
    """
    Insert or update vector points in the user's collection.

    Payload fields (Section 5.3):
        source_id: UUID of the source document/message
        type: "email" | "pr" | "doc" | "message" | "file"
        timestamp: ISO datetime string
        text_chunk: The actual text that was embedded
        user_id: Must always be included for RBAC
    """
    client = get_qdrant_client()
    await ensure_user_collection(user_id)

    structured_points = [
        PointStruct(
            id=str(p["id"]),
            vector=p["vector"],
            payload={**p.get("payload", {}), "user_id": str(user_id)},
        )
        for p in points
    ]
    await client.upsert(collection_name=_collection_name(user_id), points=structured_points)


async def semantic_search(
    user_id: uuid.UUID,
    query_vector: list[float],
    limit: int = 10,
    score_threshold: float = 0.6,
    source_filter: str | None = None,
) -> list[dict[str, Any]]:
    """
    Perform cosine similarity search in the user's vector collection.

    Args:
        user_id: RBAC isolation — only searches this user's collection.
        query_vector: Embedding of the search query.
        limit: Max results to return.
        score_threshold: Minimum cosine similarity score.
        source_filter: Optional filter by payload "type" field.

    Returns empty list if the user's collection doesn't exist yet
    (first sync hasn't run).
    """
    from qdrant_client.http.exceptions import UnexpectedResponse

    client = get_qdrant_client()
    query_filter = None

    if source_filter:
        query_filter = Filter(must=[{"key": "type", "match": MatchValue(value=source_filter)}])

    try:
        response = await client.query_points(
            collection_name=_collection_name(user_id),
            query=query_vector,
            limit=limit,
            score_threshold=score_threshold,
            query_filter=query_filter,
            with_payload=True,
        )
    except UnexpectedResponse as e:
        if e.status_code == 404:
            # Collection doesn't exist yet — no data has been synced
            logger.info(
                "Qdrant collection not found (no data synced yet)",
                user_id=str(user_id),
            )
            return []
        raise

    return [
        {
            "id": str(r.id),
            "score": r.score,
            "payload": r.payload,
        }
        for r in response.points
    ]


async def delete_by_source_id(user_id: uuid.UUID, source_id: str) -> None:
    """
    Tombstone: remove all vectors for a deleted source document.
    Called when a file is deleted locally or in Google Drive.
    Prevents hallucinated references to deleted content.
    """
    client = get_qdrant_client()
    await client.delete(
        collection_name=_collection_name(user_id),
        points_selector=FilterSelector(
            filter=Filter(must=[{"key": "source_id", "match": MatchValue(value=source_id)}])
        ),
    )
    logger.info("Tombstoned vectors for deleted source", source_id=source_id, user_id=str(user_id))
