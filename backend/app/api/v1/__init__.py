"""Atlas — Daily Briefing, OmniSearch, Connectors, and Actions API routers."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from app.api.deps import get_current_user, require_idempotency_key
from app.domain.models.connector import ConnectorProvider
from app.domain.models.user import User
from app.domain.schemas import (
    ActionRequest,
    ActionResponse,
    ConnectorCreateRequest,
    ConnectorResponse,
    DailyBriefingResponse,
    OmniSearchRequest,
    OmniSearchResponse,
    SyncTriggerResponse,
)
from app.services.ai.supervisor_agent import run_atlas_pipeline
from app.services.briefing_service import BriefingService
from fastapi import APIRouter, BackgroundTasks, Depends, Path, status

# ── Briefing Router ───────────────────────────────────────────────────────────
briefing_router = APIRouter(prefix="/briefing", tags=["Briefing"])


@briefing_router.get(
    "/daily",
    response_model=DailyBriefingResponse,
    summary="Get today's AI-generated briefing",
)
async def get_daily_briefing(
    current_user: User = Depends(get_current_user),
) -> DailyBriefingResponse:
    """
    Return the aggregated morning briefing:
    - Focus Score (0-100)
    - Prioritized list of items (emails, PRs, issues, meetings)
    - Recommended actions for top items

    Response time target: < 2.5s (AI streamed asynchronously).
    """
    service = BriefingService(user_id=current_user.id)
    return await service.generate_briefing()


# ── Search Router ─────────────────────────────────────────────────────────────
search_router = APIRouter(prefix="/search", tags=["Search"])


@search_router.post(
    "/omni",
    response_model=OmniSearchResponse,
    summary="Universal semantic search across all connected sources",
)
async def omni_search(
    payload: OmniSearchRequest,
    current_user: User = Depends(get_current_user),
) -> OmniSearchResponse:
    """
    Run hybrid semantic search (vector + graph) across all user's connected sources.

    Target: < 200ms for cached results, < 2.5s for full RAG pipeline.
    """
    start = time.perf_counter()

    state = await run_atlas_pipeline(
        user_input=payload.query,
        user_id=current_user.id,
        extra_state={"intent": "search"},
    )

    took_ms = (time.perf_counter() - start) * 1000
    context_items = state.get("context", [])

    from app.domain.schemas import SearchResult

    results = [
        SearchResult(
            id=item.get("id", str(uuid.uuid4())),
            type=item.get("payload", {}).get("type", "unknown"),
            title=item.get("payload", {}).get("text_chunk", "")[:80],
            excerpt=item.get("payload", {}).get("text_chunk", "")[:300],
            source=item.get("payload", {}).get("source", "Atlas"),
            score=item.get("score", 0.0),
            timestamp=datetime.now(UTC),
            source_ids=state.get("citations", []),
        )
        for item in context_items[: payload.limit]
    ]

    return OmniSearchResponse(
        original_query=payload.query,
        rewritten_query=state.get("input", payload.query),
        results=results,
        took_ms=round(took_ms, 2),
    )


# ── Connectors Router ─────────────────────────────────────────────────────────
connectors_router = APIRouter(prefix="/connectors", tags=["Connectors"])


@connectors_router.get(
    "",
    response_model=list[ConnectorResponse],
    summary="List all connectors for the current user",
)
async def list_connectors(
    current_user: User = Depends(get_current_user),
) -> list[ConnectorResponse]:
    """Return all connectors (active and inactive) for the authenticated user."""
    from app.domain.models.connector import Connector
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import select

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(Connector.user_id == current_user.id)
        result = await session.execute(stmt)
        connectors = result.scalars().all()
    return [ConnectorResponse.model_validate(c) for c in connectors]


@connectors_router.post(
    "",
    response_model=ConnectorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create or retrieve a connector",
)
async def create_connector(
    payload: ConnectorCreateRequest,
    current_user: User = Depends(get_current_user),
) -> ConnectorResponse:
    """
    Create a new connector for the current user and provider.
    If a connector for this provider already exists, return the existing one with 200.
    """
    import uuid as _uuid

    from app.domain.models.connector import Connector, ConnectorStatus
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import select

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(
            Connector.user_id == current_user.id,
            Connector.provider == payload.provider,
        )
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            return ConnectorResponse.model_validate(existing)

        connector = Connector(
            id=_uuid.uuid4(),
            user_id=current_user.id,
            provider=payload.provider,
            status=ConnectorStatus.INACTIVE,
            display_name=payload.display_name,
        )
        session.add(connector)
        await session.commit()
        await session.refresh(connector)
    return ConnectorResponse.model_validate(connector)


@connectors_router.post(
    "/{provider}/sync",
    response_model=SyncTriggerResponse,
    summary="Manually trigger a connector sync",
)
async def trigger_sync(
    provider: ConnectorProvider = Path(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
) -> SyncTriggerResponse:
    """
    Manually trigger a background sync job for the specified provider.
    The sync runs asynchronously via Celery. Track progress via WebSocket.
    """
    from app.domain.models.connector import Connector
    from app.infrastructure.database import get_session_factory
    from app.workers.sync_tasks import sync_connector_job
    from sqlalchemy import select

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(
            Connector.user_id == current_user.id,
            Connector.provider == provider,
        )
        result = await session.execute(stmt)
        connector = result.scalar_one_or_none()

    if not connector:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active {provider.value} connector found",
        )

    task = sync_connector_job.apply_async(args=[str(current_user.id), str(connector.id)])

    return SyncTriggerResponse(
        task_id=task.id,
        connector_id=connector.id,
        provider=provider,
        message=f"Sync job enqueued for {provider.value}. Track via WebSocket.",
    )


# ── Actions Router ─────────────────────────────────────────────────────────────
actions_router = APIRouter(prefix="/actions", tags=["Actions"])


@actions_router.post(
    "/execute",
    response_model=ActionResponse,
    summary="Execute an autonomous action",
)
async def execute_action(
    payload: ActionRequest,
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
) -> ActionResponse:
    """
    Execute an autonomous action on behalf of the user.
    Destructive actions always return requires_confirmation=true.
    """
    state = await run_atlas_pipeline(
        user_input=f"Execute action: {payload.action_type}",
        user_id=current_user.id,
        extra_state={
            "intent": "action",
            "action_type": payload.action_type,
            "action_parameters": payload.parameters,
        },
    )

    result = state.get("result", {})

    return ActionResponse(
        action_type=payload.action_type,
        success=result.get("success", False),
        result=result,
        message=result.get("message", "Action processed"),
        executed_at=datetime.now(UTC),
    )
