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
from app.core.rate_limit import RateLimiter
from app.core.circuit_breaker import circuit_breaker
from fastapi import APIRouter, BackgroundTasks, Depends, Path, status
from pydantic import BaseModel, Field
from typing import Any

class LocalFSConfigureRequest(BaseModel):
    watch_paths: list[str] = Field(default_factory=list)
    display_name: str = "Local Files"

class PutTokenRequest(BaseModel):
    credentials: dict[str, Any] = Field(default_factory=dict)

class PutTokenResponse(BaseModel):
    message: str
    provider: str

class DisconnectResponse(BaseModel):
    message: str

class ConnectorTokensResponse(BaseModel):
    tokens: dict[str, Any]

class ConversationResponse(BaseModel):
    id: str
    title: str
    created_at: datetime
    last_message: str

class MessageItem(BaseModel):
    id: str | None = None
    role: str = "user"
    content: str = ""
    timestamp: str | None = None

class UpsertConversationRequest(BaseModel):
    id: str | None = None
    title: str = "New Conversation"
    last_message: str = ""
    messages: list[MessageItem] = Field(default_factory=list)

class UpsertConversationResponse(BaseModel):
    id: str
    synced: bool

class MessageResponse(BaseModel):
    id: str
    role: str
    content: str
    timestamp: datetime | str

# ── Briefing Router ───────────────────────────────────────────────────────────
briefing_router = APIRouter(prefix="/briefing", tags=["Briefing"], dependencies=[Depends(RateLimiter(times=10, seconds=60))])


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
search_router = APIRouter(prefix="/search", tags=["Search"], dependencies=[Depends(RateLimiter(times=20, seconds=60))])


@search_router.post(
    "/omni",
    response_model=OmniSearchResponse,
    summary="Universal semantic search across all connected sources",
)
@circuit_breaker(failure_threshold=5, recovery_timeout=60)
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
    except Exception as e:
        logger.warning('AI pipeline failed, falling back to vector search: %s', e)
        # Fallback: direct vector search without AI rewriting
        context_items = []

    # If AI pipeline returned nothing, do direct semantic search with smart filtering
    if not context_items:
        from sentence_transformers import SentenceTransformer
        from app.infrastructure.qdrant_client import semantic_search

        _embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        query_lower = payload.query.lower()

        # Detect source filter from natural language
        source_filter = payload.sources
        if not source_filter:
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
            start_date=payload.start_date,
            end_date=payload.end_date,
        )

    took_ms = (time.perf_counter() - start) * 1000

    from app.domain.schemas import SearchResult
    from app.services.briefing_service import _source_label

    def _parse_timestamp(ts: str | None) -> datetime:
        if ts:
            try:
                return datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.now(UTC)

    results = [
        SearchResult(
            id=item.get("id", str(uuid.uuid4())),
            type=item.get("payload", {}).get("type", "unknown"),
            title=item.get("payload", {}).get("text_chunk", "")[:80],
            excerpt=item.get("payload", {}).get("text_chunk", "")[:300],
            source=_source_label(item.get("payload", {}).get("type", "unknown")),
            score=item.get("score", 0.0),
            timestamp=_parse_timestamp(item.get("payload", {}).get("timestamp")),
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
    _idempotency_key: str = Depends(require_idempotency_key),
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
    response_model=DisconnectResponse,
    status_code=status.HTTP_200_OK,
    summary="Disconnect a connector",
)
async def disconnect_connector(
    provider: ConnectorProvider = Path(...),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
) -> DisconnectResponse:
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

    return DisconnectResponse(message=f"{provider.value} disconnected successfully")


@connectors_router.get(
    "/tokens",
    response_model=ConnectorTokensResponse,
    summary="Get all stored connector credentials for the user (for device sync)",
)
async def get_connector_tokens(
    current_user: User = Depends(get_current_user),
) -> ConnectorTokensResponse:
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

    return ConnectorTokensResponse(tokens=tokens)


@connectors_router.put(
    "/tokens/{provider}",
    response_model=PutTokenResponse,
    summary="Store connector credentials (for device sync)",
)
async def put_connector_token(
    provider: ConnectorProvider = Path(...),
    payload: PutTokenRequest = PutTokenRequest(),
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
) -> PutTokenResponse:
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
        credentials = payload.credentials
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

    return PutTokenResponse(message=f"{provider.value} credentials stored", provider=provider.value)


@connectors_router.post(
    "/{provider}/sync",
    response_model=SyncTriggerResponse,
    summary="Manually trigger a connector sync",
)
async def trigger_sync(
    background_tasks: BackgroundTasks,
    provider: ConnectorProvider = Path(...),
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
    payload: LocalFSConfigureRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
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

    watch_paths: list[str] = payload.watch_paths
    display_name: str = payload.display_name

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

# ── Conversations Router ───────────────────────────────────────────────────────
conversations_router = APIRouter(prefix="/conversations", tags=["Conversations"])


@conversations_router.get("", response_model=list[ConversationResponse], summary="List user's conversations")
async def list_conversations(
    current_user: User = Depends(get_current_user),
) -> list[ConversationResponse]:
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import text

    factory = get_session_factory()
    async with factory() as session:
        result = await session.execute(
            text("SELECT id, title, created_at, last_message FROM user_conversations WHERE user_id = :uid ORDER BY created_at DESC LIMIT 50"),
            {"uid": str(current_user.id)},
        )
        rows = result.fetchall()
    return [ConversationResponse(id=r[0], title=r[1], created_at=r[2], last_message=r[3]) for r in rows]


@conversations_router.post("", response_model=UpsertConversationResponse, summary="Create or sync a conversation")
async def upsert_conversation(
    payload: UpsertConversationRequest,
    current_user: User = Depends(get_current_user),
    _idempotency_key: str = Depends(require_idempotency_key),
) -> UpsertConversationResponse:
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import text
    from fastapi import HTTPException

    conv_id = payload.id or str(uuid.uuid4())
    title = payload.title
    last_message = payload.last_message
    messages = payload.messages

    factory = get_session_factory()
    async with factory() as session:
        # Prevent cross-user overwrite: verify ownership if the conversation exists
        auth_check = await session.execute(
            text("SELECT user_id FROM user_conversations WHERE id = :cid"),
            {"cid": conv_id},
        )
        existing_owner = auth_check.scalar_one_or_none()
        if existing_owner and str(existing_owner) != str(current_user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

        await session.execute(
            text("""INSERT INTO user_conversations (id, user_id, title, last_message, created_at)
                    VALUES (:id, :uid, :title, :last_msg, NOW())
                    ON CONFLICT (id) DO UPDATE SET title = :title, last_message = :last_msg"""),
            {"id": conv_id, "uid": str(current_user.id), "title": title, "last_msg": last_message},
        )
        # Store messages
        if messages:
            for msg in messages:
                await session.execute(
                    text("""INSERT INTO conversation_messages (id, conversation_id, role, content, timestamp)
                            VALUES (:id, :conv_id, :role, :content, :ts)
                            ON CONFLICT (id) DO NOTHING"""),
                    {
                        "id": msg.id or str(uuid.uuid4()),
                        "conv_id": conv_id,
                        "role": msg.role,
                        "content": msg.content,
                        "ts": msg.timestamp or datetime.now(UTC).isoformat(),
                    },
                )
        await session.commit()
    return UpsertConversationResponse(id=conv_id, synced=True)


@conversations_router.get("/{conversation_id}/messages", response_model=list[MessageResponse], summary="Get conversation messages")
async def get_conversation_messages(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
) -> list[MessageResponse]:
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import text
    from app.core.exceptions import NotFoundError

    factory = get_session_factory()
    async with factory() as session:
        auth_check = await session.execute(
            text("SELECT 1 FROM user_conversations WHERE id = :cid AND user_id = :uid"),
            {"cid": conversation_id, "uid": str(current_user.id)},
        )
        if not auth_check.scalar_one_or_none():
            raise NotFoundError(f"Conversation {conversation_id} not found")

        result = await session.execute(
            text("SELECT id, role, content, timestamp FROM conversation_messages WHERE conversation_id = :cid ORDER BY timestamp ASC"),
            {"cid": conversation_id},
        )
        rows = result.fetchall()
    return [MessageResponse(id=r[0], role=r[1], content=r[2], timestamp=r[3]) for r in rows]


@conversations_router.delete("/{conversation_id}", summary="Delete conversation")
async def delete_conversation(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    from app.infrastructure.database import get_session_factory
    from sqlalchemy import text

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text("DELETE FROM conversation_messages WHERE conversation_id = :cid"),
            {"cid": conversation_id},
        )
        await session.execute(
            text("DELETE FROM user_conversations WHERE id = :cid AND user_id = :uid"),
            {"cid": conversation_id, "uid": str(current_user.id)},
        )
        await session.commit()
    return {"status": "deleted", "id": conversation_id}


# ── Re-export Routers ────────────────────────────────────────────────────────
from app.api.v1.users import users_router  # noqa: E402
from app.api.v1.gmail import gmail_router  # noqa: E402

__all__ = ["briefing_router", "search_router", "connectors_router", "actions_router", "conversations_router", "users_router", "gmail_router"]
