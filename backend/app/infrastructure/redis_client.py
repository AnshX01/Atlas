"""Atlas — Infrastructure: Redis client for Pub/Sub and Celery."""
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

import redis.asyncio as aioredis

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)

_redis_pool: aioredis.ConnectionPool | None = None


def get_redis_pool() -> aioredis.ConnectionPool:
    """Return (or create) the shared Redis connection pool."""
    global _redis_pool
    if _redis_pool is None:
        settings = get_settings()
        _redis_pool = aioredis.ConnectionPool.from_url(
            settings.REDIS_URL,
            max_connections=20,
            decode_responses=True,
        )
        logger.info("Redis connection pool created", url=settings.REDIS_URL)
    return _redis_pool


def get_redis() -> aioredis.Redis:
    """Return a Redis client from the shared pool."""
    return aioredis.Redis(connection_pool=get_redis_pool())


async def close_redis_pool() -> None:
    """Drain and close the Redis pool. Call on shutdown."""
    global _redis_pool
    if _redis_pool:
        await _redis_pool.disconnect()
        _redis_pool = None
        logger.info("Redis pool closed")


# ── Pub/Sub Helpers ───────────────────────────────────────────────────────────
SYNC_EVENTS_CHANNEL = "atlas:sync_events:{user_id}"


async def publish_sync_event(user_id: str, event: dict[str, Any]) -> None:
    """
    Publish a sync progress event to the user's Redis Pub/Sub channel.
    The FastAPI WebSocket relay picks this up and pushes to the Electron client.
    """
    redis = get_redis()
    channel = SYNC_EVENTS_CHANNEL.format(user_id=user_id)
    await redis.publish(channel, json.dumps(event))


async def subscribe_sync_events(user_id: str) -> AsyncGenerator[dict[str, Any], None]:
    """
    Subscribe to sync events for a given user.
    Yields parsed event dicts as they arrive.
    """
    redis = get_redis()
    channel = SYNC_EVENTS_CHANNEL.format(user_id=user_id)
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel)

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                yield json.loads(message["data"])
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
