"""
Atlas Backend — FastAPI Application Factory.

Startup sequence:
  1. Configure logging (structlog)
  2. Initialize OpenTelemetry instrumentation
  3. Connect to PostgreSQL, Neo4j, Qdrant, Redis
  4. Run Alembic migrations (dev only)
  5. Mount API routers under /v1
  6. Register WebSocket endpoint for real-time updates
  7. Register RFC 7807 exception handlers
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.api.v1 import (
    actions_router,
    briefing_router,
    connectors_router,
    conversations_router,
    search_router,
    users_router,
)
from app.api.v1.auth import router as auth_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, get_logger
from app.core.security import decode_token
from app.infrastructure.database import dispose_engine
from app.infrastructure.neo4j_client import (
    close_neo4j_driver,
    initialize_schema_constraints,
)
from app.infrastructure.redis_client import close_redis_pool, subscribe_sync_events

logger = get_logger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application lifecycle — startup and shutdown."""
    # ── Startup ───────────────────────────────────────────────────────────────
    configure_logging()
    logger.info("Atlas Backend starting", env=settings.APP_ENV)

    # Initialize conversation sync tables (idempotent)
    try:
        from app.infrastructure.init_tables import ensure_conversation_tables

        await ensure_conversation_tables()
    except Exception as e:
        logger.warning("Could not ensure conversation tables", error=str(e))

    # Initialize Neo4j schema constraints (idempotent)
    try:
        await initialize_schema_constraints()
    except Exception as e:
        logger.warning("Neo4j not reachable at startup", error=str(e))

    logger.info("Atlas Backend ready ✓", version="0.1.0")

    yield  # ← Application runs here

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Atlas Backend shutting down...")
    await dispose_engine()
    await close_neo4j_driver()
    await close_redis_pool()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    """Application factory — creates and configures the FastAPI app."""
    app = FastAPI(
        title="Atlas API",
        description="Atlas Personal Command Center — AI Chief of Staff Backend",
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Exception Handlers ────────────────────────────────────────────────────
    register_exception_handlers(app)

    # ── API Routers ───────────────────────────────────────────────────────────
    api_prefix = "/v1"
    app.include_router(auth_router, prefix=api_prefix)
    app.include_router(briefing_router, prefix=api_prefix)
    app.include_router(search_router, prefix=api_prefix)
    app.include_router(connectors_router, prefix=api_prefix)
    app.include_router(actions_router, prefix=api_prefix)
    app.include_router(users_router, prefix=api_prefix)
    app.include_router(conversations_router, prefix=api_prefix)

    # ── Health & Metrics ──────────────────────────────────────────────────────
    @app.get("/health", tags=["System"], summary="Health check")
    async def health_check() -> dict[str, Any]:
        return {"status": "healthy", "service": "atlas-backend", "version": "0.1.0"}

    @app.get("/metrics", tags=["System"], summary="Prometheus metrics stub")
    async def metrics() -> dict[str, str]:
        # TODO: Integrate prometheus_client in production
        return {"status": "metrics_endpoint_placeholder"}

    # ── WebSocket: Real-time Sync Events ──────────────────────────────────────
    @app.websocket("/ws/{user_id}")
    async def sync_events_websocket(
        websocket: WebSocket, user_id: str, token: str = Query(default="")
    ) -> None:
        """
        WebSocket endpoint: relay Redis Pub/Sub sync events to the Electron client.

        The Electron frontend connects here to receive real-time connector
        sync progress, PR notifications, and AI insight pushes.

        Auth: JWT token validated from query param before accepting the connection.
        """
        try:
            payload = decode_token(token)
            if payload.get("sub") != user_id:
                raise ValueError("user_id mismatch")
        except Exception:
            await websocket.close(code=4001)
            return

        await websocket.accept()
        logger.info("WebSocket connected", user_id=user_id)

        try:
            async for event in subscribe_sync_events(user_id):
                await websocket.send_json(event)
        except WebSocketDisconnect:
            logger.info("WebSocket disconnected", user_id=user_id)
        except Exception as e:
            logger.error("WebSocket error", user_id=user_id, error=str(e))
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)

    return app


# ── Entry Point ───────────────────────────────────────────────────────────────
app = create_app()
