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
    start = time.perf_counter()

    # Try the full AI pipeline first, fall back to direct vector search
    try:
        state = await run_atlas_pipeline(
            user_input=payload.query,
            user_id=current_user.id,
            extra_state={"intent": "search"},
        )
        context_items = state.get("context", [])
    except Exception:
        # Fallback: direct vector search without AI rewriting
        context_items = []

    # If AI pipeline returned nothing, do direct semantic search with smart filtering
    if not context_items:
        from sentence_transformers import SentenceTransformer
        from app.infrastructure.qdrant_client import semantic_search

        _embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        query_lower = payload.query.lower()

        # Detect source filter from natural language
        source_filter = None
        if any(kw in query_lower for kw in ["email", "mail", "gmail", "inbox"]):
            source_filter = "email"
        elif any(kw in query_lower for kw in ["pr", "pull request", "merge"]):
            source_filter = "pr"
        elif any(kw in query_lower for kw in ["issue", "bug", "ticket"]):
            source_filter = "issue"
        elif any(kw in query_lower for kw in ["meeting", "calendar", "event", "schedule"]):
            source_filter = "calendar"
        elif any(kw in query_lower for kw in ["task", "todo", "to-do"]):
            source_filter = "task"
        elif any(kw in query_lower for kw in ["file", "document", "doc"]):
            source_filter = "document"

        query_vector = _embedder.encode(payload.query).tolist()
        context_items = await semantic_search(
            user_id=current_user.id,
            query_vector=query_vector,
            limit=payload.limit,
            score_threshold=0.2,
            source_filter=source_filter,
        )

    took_ms = (time.perf_counter() - start) * 1000

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
            source_ids=[],
        )
        for item in context_items[: payload.limit]
    ]

    return OmniSearchResponse(
        original_query=payload.query,
        rewritten_query=payload.query,
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


@connectors_router.delete(
    "/{provider}",
    status_code=status.HTTP_200_OK,
    summary="Disconnect a connector",
)
async def disconnect_connector(
    provider: ConnectorProvider = Path(...),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Disconnect a connector: set status to INACTIVE and delete OAuth tokens.
    The connector record is kept for potential reconnection.
    """
    from app.domain.models.connector import Connector, ConnectorStatus
    from app.domain.models.connector import OAuthToken
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import select, delete as sql_delete

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
                detail=f"No {provider.value} connector found",
            )

        # Delete OAuth tokens
        await session.execute(
            sql_delete(OAuthToken).where(OAuthToken.connector_id == connector.id)
        )

        # Set connector to inactive
        connector.status = ConnectorStatus.INACTIVE
        session.add(connector)
        await session.commit()

    return {"message": f"{provider.value} disconnected successfully"}


@connectors_router.get(
    "/tokens",
    summary="Get all stored connector credentials for the user (for device sync)",
)
async def get_connector_tokens(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return all connector credentials for the authenticated user.
    Credentials are encrypted at rest and decrypted for the response.
    Used for syncing connector config across devices."""
    from app.domain.models.connector import Connector, OAuthToken
    from app.infrastructure.database import get_session_factory
    from app.core.security import decrypt_token
    from sqlalchemy import select
    import json

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(Connector.user_id == current_user.id)
        result = await session.execute(stmt)
        connectors = result.scalars().all()

    tokens = {}
    async with factory() as session:
        for connector in connectors:
            stmt = select(OAuthToken).where(OAuthToken.connector_id == connector.id)
            result = await session.execute(stmt)
            token_row = result.scalar_one_or_none()
            if token_row:
                try:
                    creds = {
                        "access_token": decrypt_token(token_row.access_token),
                    }
                    if token_row.refresh_token:
                        creds["refresh_token"] = decrypt_token(token_row.refresh_token)
                    if token_row.scope:
                        creds["scope"] = token_row.scope
                    tokens[connector.provider.value] = creds
                except Exception:
                    pass  # Skip tokens that can't be decrypted
            elif connector.display_name:
                # For local_fs and other non-OAuth connectors, config is in display_name
                try:
                    tokens[connector.provider.value] = json.loads(connector.display_name)
                except (json.JSONDecodeError, TypeError):
                    tokens[connector.provider.value] = {"display_name": connector.display_name}

    return {"tokens": tokens}


@connectors_router.put(
    "/tokens/{provider}",
    summary="Store connector credentials (for device sync)",
)
async def put_connector_token(
    provider: ConnectorProvider = Path(...),
    payload: dict = {},
    current_user: User = Depends(get_current_user),
) -> dict:
    """Store or update connector credentials. Used when syncing from another device."""
    import uuid as _uuid
    from app.domain.models.connector import Connector, ConnectorStatus, OAuthToken
    from app.infrastructure.database import get_session_factory
    from app.core.security import encrypt_token
    from sqlalchemy import select

    factory = get_session_factory()
    async with factory() as session:
        # Get or create connector
        stmt = select(Connector).where(
            Connector.user_id == current_user.id,
            Connector.provider == provider,
        )
        result = await session.execute(stmt)
        connector = result.scalar_one_or_none()

        if not connector:
            connector = Connector(
                id=_uuid.uuid4(),
                user_id=current_user.id,
                provider=provider,
                status=ConnectorStatus.ACTIVE,
            )
            session.add(connector)
            await session.flush()

        # Store credentials
        credentials = payload.get("credentials", {})
        access_token = credentials.get("access_token") or credentials.get("personal_access_token") or credentials.get("bot_token") or credentials.get("integration_token") or credentials.get("client_id", "")

        if access_token:
            # Upsert OAuth token
            stmt = select(OAuthToken).where(OAuthToken.connector_id == connector.id)
            result = await session.execute(stmt)
            token_row = result.scalar_one_or_none()

            if token_row:
                token_row.access_token = encrypt_token(access_token)
                if credentials.get("refresh_token"):
                    token_row.refresh_token = encrypt_token(credentials["refresh_token"])
            else:
                token_row = OAuthToken(
                    id=_uuid.uuid4(),
                    connector_id=connector.id,
                    access_token=encrypt_token(access_token),
                    refresh_token=encrypt_token(credentials.get("refresh_token", "")) if credentials.get("refresh_token") else None,
                )
                session.add(token_row)

            connector.status = ConnectorStatus.ACTIVE
        else:
            # Non-token config (like local_fs paths)
            import json
            connector.display_name = json.dumps(credentials)
            connector.status = ConnectorStatus.ACTIVE

        await session.commit()

    return {"message": f"{provider.value} credentials stored", "provider": provider.value}


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



@connectors_router.post(
    "/local_fs/configure",
    response_model=ConnectorResponse,
    summary="Configure local file system connector",
)
async def configure_local_fs(
    payload: dict,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> ConnectorResponse:
    """
    Configure and activate the local file system connector.

    Accepts watch_paths (list of directory paths) and an optional display_name.
    Creates or updates the local_fs connector, stores the watch paths as JSON
    in the connector's config, sets status to ACTIVE, and triggers a sync job.
    """
    import json as _json
    import uuid as _uuid

    from app.domain.models.connector import Connector, ConnectorStatus
    from app.infrastructure.database import get_session_factory
    from app.workers.sync_tasks import sync_connector_job
    from sqlalchemy import select

    watch_paths: list[str] = payload.get("watch_paths", [])
    display_name: str = payload.get("display_name", "Local Files")

    if not watch_paths:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="watch_paths must contain at least one directory path",
        )

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(
            Connector.user_id == current_user.id,
            Connector.provider == ConnectorProvider.LOCAL_FS,
        )
        result = await session.execute(stmt)
        connector = result.scalar_one_or_none()

        if connector:
            # Update existing connector
            connector.display_name = _json.dumps({"watch_paths": watch_paths, "name": display_name})
            connector.status = ConnectorStatus.ACTIVE
        else:
            # Create new connector
            connector = Connector(
                id=_uuid.uuid4(),
                user_id=current_user.id,
                provider=ConnectorProvider.LOCAL_FS,
                status=ConnectorStatus.ACTIVE,
                display_name=_json.dumps({"watch_paths": watch_paths, "name": display_name}),
            )
            session.add(connector)

        await session.commit()
        await session.refresh(connector)

    # Trigger background sync job
    sync_connector_job.apply_async(args=[str(current_user.id), str(connector.id)])

    return ConnectorResponse.model_validate(connector)



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

# ── Re-export Routers ────────────────────────────────────────────────────────
from app.api.v1.users import users_router  # noqa: E402

__all__ = ["briefing_router", "search_router", "connectors_router", "actions_router", "users_router"]
