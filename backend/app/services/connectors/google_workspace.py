"""
Atlas — Google Workspace Connector.

Syncs Gmail (messages) and Google Calendar (events).
Implements exponential backoff for rate limits.
Detects 401s and signals requires_reauth.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.logging import get_logger
from app.core.security import decrypt_token, encrypt_token
from app.domain.interfaces.base_connector import BaseConnector
from app.domain.models.connector import Connector, ConnectorStatus, OAuthToken
from app.infrastructure.database import get_session_factory
from app.infrastructure.neo4j_client import upsert_meeting_node, upsert_message_node
from app.workers.embedding_tasks import batch_embed_chunks
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

logger = get_logger(__name__)


class GoogleWorkspaceConnector(BaseConnector):
    """
    Connector for Gmail (read) and Google Calendar (read).

    Phase 1 implementation: Read-only sync. Write actions in Phase 2.
    """

    PROVIDER = "google_workspace"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)
        self._creds: Credentials | None = None

    async def _load_credentials(self) -> Credentials:
        """Load and refresh OAuth credentials from the DB."""
        from app.core.config import get_settings

        settings = get_settings()
        factory = get_session_factory()

        async with factory() as session:
            from sqlalchemy import select

            stmt = select(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
            result = await session.execute(stmt)
            token_row = result.scalar_one_or_none()
            if not token_row:
                raise ValueError(f"No OAuth token for connector {self.connector.id}")

            access_token = decrypt_token(token_row.access_token)
            refresh_token = (
                decrypt_token(token_row.refresh_token) if token_row.refresh_token else None
            )

        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
            token_uri="https://oauth2.googleapis.com/token",
            scopes=settings.google_scopes_list,
        )

        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # Persist refreshed token
                async with factory() as session:
                    from sqlalchemy import select as sel

                    stmt = sel(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
                    result = await session.execute(stmt)
                    token_row = result.scalar_one_or_none()
                    if token_row:
                        token_row.access_token = encrypt_token(creds.token)
                        session.add(token_row)
                        await session.commit()
            except RefreshError:
                await self._mark_requires_reauth()
                raise

        return creds

    async def authenticate(self, auth_code: str) -> None:
        """Exchange authorization code for tokens and persist them.

        Uses direct HTTP token exchange to avoid google-auth-oauthlib PKCE
        warnings/errors that occur when Flow doesn't have the original code_verifier.
        """
        import httpx

        from app.core.config import get_settings

        settings = get_settings()

        # Direct token exchange — bypasses google-auth-oauthlib Flow entirely
        async with httpx.AsyncClient() as http:
            token_res = await http.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "code": auth_code,
                    "grant_type": "authorization_code",
                    "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                },
            )

        if token_res.status_code != 200:
            error_body = token_res.text
            raise ValueError(
                f"Google token exchange failed (HTTP {token_res.status_code}): {error_body}"
            )

        token_data = token_res.json()
        access_token = token_data.get("access_token")
        refresh_token = token_data.get("refresh_token", "")
        scope = token_data.get("scope", "")

        if not access_token:
            raise ValueError(f"No access_token in Google response: {token_data}")

        factory = get_session_factory()
        async with factory() as session:
            from sqlalchemy import select

            # Look up existing token by connector_id (not primary key)
            stmt = select(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            if existing:
                existing.access_token = encrypt_token(access_token)
                if refresh_token:
                    existing.refresh_token = encrypt_token(refresh_token)
                existing.scope = scope
                session.add(existing)
            else:
                token = OAuthToken(
                    id=uuid.uuid4(),
                    connector_id=self.connector.id,
                    access_token=encrypt_token(access_token),
                    refresh_token=encrypt_token(refresh_token) if refresh_token else None,
                    scope=scope,
                )
                session.add(token)

            # Reload connector in this session to avoid detached instance issues
            connector_in_session = await session.get(Connector, self.connector.id)
            if connector_in_session:
                connector_in_session.status = ConnectorStatus.ACTIVE
                session.add(connector_in_session)

            await session.commit()

        logger.info("Google Workspace authenticated", connector_id=str(self.connector.id))

    @retry(
        retry=retry_if_exception_type(HttpError),
        wait=wait_exponential_jitter(initial=2, max=60),
        stop=stop_after_attempt(5),
    )
    def _sync_gmail(
        self, service: Any, since: datetime
    ) -> tuple[dict[str, int], list[dict[str, Any]], list[dict[str, Any]]]:
        """Sync Gmail messages since the given datetime.

        Returns:
            A 3-tuple of (result_dict, chunks_list, neo4j_data_list).
            neo4j_data_list contains dicts with keys needed to call upsert_message_node.
        """
        since_ts = int(since.timestamp())
        query = f"after:{since_ts}"

        results = service.users().messages().list(userId="me", q=query, maxResults=100).execute()
        messages = results.get("messages", [])
        synced = 0
        chunks: list[dict[str, Any]] = []
        neo4j_data: list[dict[str, Any]] = []

        for msg_ref in messages:
            try:
                msg = (
                    service.users()
                    .messages()
                    .get(userId="me", id=msg_ref["id"], format="metadata")
                    .execute()
                )

                # Extract headers into a lookup dict
                headers_list = msg.get("payload", {}).get("headers", [])
                headers = {h["name"]: h["value"] for h in headers_list}

                subject = headers.get("Subject", "")
                from_header = headers.get("From", "")

                # Parse sender display name and email from "Display Name <email>" or bare "email"
                if "<" in from_header and ">" in from_header:
                    sender_name = from_header[: from_header.index("<")].strip().strip('"')
                    sender_email = from_header[
                        from_header.index("<") + 1 : from_header.index(">")
                    ].strip()
                else:
                    sender_email = from_header.strip()
                    sender_name = ""

                # Skip automated service emails that are better handled by their
                # native connectors (GitHub notifications, JIRA, Linear, etc.)
                _skip_senders = {
                    "noreply@github.com",
                    "notifications@github.com",
                    "github.com",
                    "noreply@linear.app",
                    "noreply@atlassian.net",
                    "jira@",
                    "noreply@notion.so",
                }
                if any(skip in sender_email.lower() for skip in _skip_senders):
                    continue

                snippet = msg.get("snippet", "")
                internal_date = msg.get("internalDate", "0")
                timestamp_str = datetime.fromtimestamp(int(internal_date) / 1000, UTC).isoformat()

                chunks.append(
                    {
                        "id": str(uuid.uuid4()),
                        "source_id": msg["id"],
                        "type": "email",
                        "text": f"{subject}\n{snippet}",
                        "timestamp": timestamp_str,
                        "metadata": {
                            "subject": subject,
                            "sender_email": sender_email,
                            "sender_name": sender_name,
                        },
                    }
                )

                neo4j_data.append(
                    {
                        "msg_id": msg["id"],
                        "subject": subject,
                        "sender_email": sender_email,
                        "sender_name": sender_name,
                        "timestamp": timestamp_str,
                    }
                )

                logger.debug("Gmail message synced", msg_id=msg_ref["id"])
                synced += 1
            except HttpError as e:
                if e.resp.status == 401:
                    # Cannot call async _mark_requires_reauth from a sync thread;
                    # re-raise so the caller can handle it.
                    raise
                logger.warning("Failed to fetch Gmail message", msg_id=msg_ref["id"], error=str(e))

        return {"synced": synced, "failed": 0, "skipped": 0}, chunks, neo4j_data

    @retry(
        retry=retry_if_exception_type(HttpError),
        wait=wait_exponential_jitter(initial=2, max=60),
        stop=stop_after_attempt(5),
    )
    def _sync_calendar(
        self, service: Any, since: datetime
    ) -> tuple[dict[str, int], list[dict[str, Any]], list[dict[str, Any]]]:
        """Sync Google Calendar events since the given datetime.

        Returns:
            A 3-tuple of (result_dict, chunks_list, neo4j_data_list).
            neo4j_data_list contains dicts with keys needed to call upsert_meeting_node.
        """
        events_result = (
            service.events()
            .list(
                calendarId="primary",
                timeMin=since.isoformat(),
                maxResults=50,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        events = events_result.get("items", [])
        synced = 0
        chunks: list[dict[str, Any]] = []
        neo4j_data: list[dict[str, Any]] = []

        for event in events:
            start_time = event.get("start", {}).get(
                "dateTime", event.get("start", {}).get("date", "")
            )
            end_time = event.get("end", {}).get("dateTime", event.get("end", {}).get("date", ""))
            attendees = event.get("attendees", [])
            attendee_emails = [a["email"] for a in attendees if "email" in a]

            chunks.append(
                {
                    "id": str(uuid.uuid4()),
                    "source_id": event["id"],
                    "type": "calendar",
                    "text": f"{event.get('summary', '')}\n{event.get('description', '')}",
                    "timestamp": start_time,
                    "metadata": {
                        "attendees": attendee_emails,
                        "start_time": start_time,
                        "end_time": end_time,
                    },
                }
            )

            neo4j_data.append(
                {
                    "event_id": event["id"],
                    "title": event.get("summary", ""),
                    "start_time": start_time,
                    "end_time": end_time,
                    "attendees": attendee_emails,
                }
            )

            logger.debug("Calendar event synced", event_id=event.get("id"))
            synced += 1

        return {"synced": synced, "failed": 0, "skipped": 0}, chunks, neo4j_data

    async def sync(self) -> dict[str, int]:
        """Sync Gmail + Calendar from the past 7 days."""
        creds = await self._load_credentials()
        since = datetime.now(UTC) - timedelta(days=7)

        gmail_service = build("gmail", "v1", credentials=creds)
        calendar_service = build("calendar", "v3", credentials=creds)

        gmail_result, gmail_chunks, gmail_neo4j = await asyncio.to_thread(
            self._sync_gmail, gmail_service, since
        )
        cal_result, cal_chunks, cal_neo4j = await asyncio.to_thread(
            self._sync_calendar, calendar_service, since
        )

        # Write Neo4j nodes asynchronously (failures are silently logged inside helpers)
        await asyncio.gather(
            *[
                upsert_message_node(
                    str(self.user_id),
                    item["msg_id"],
                    item["subject"],
                    item["sender_email"],
                    item["sender_name"],
                    item["timestamp"],
                )
                for item in gmail_neo4j
            ],
            *[
                upsert_meeting_node(
                    str(self.user_id),
                    item["event_id"],
                    item["title"],
                    item["start_time"],
                    item["end_time"],
                    item["attendees"],
                )
                for item in cal_neo4j
            ],
        )

        # Dispatch all chunks to Qdrant via Celery embedding task
        all_chunks = gmail_chunks + cal_chunks
        if all_chunks:
            batch_embed_chunks.delay(str(self.user_id), all_chunks)

        total = {
            "synced": gmail_result["synced"] + cal_result["synced"],
            "failed": gmail_result["failed"] + cal_result["failed"],
            "skipped": 0,
        }
        logger.info("Google Workspace sync complete", **total, user_id=str(self.user_id))
        return total

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """Placeholder: real-time Gmail push via Google Pub/Sub (Phase 2)."""
        logger.info("Google Workspace watch not yet implemented — polling fallback active")
        while True:
            await asyncio.sleep(300)  # 5-minute polling interval
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        """Cleanup resources (no-op for Phase 1)."""
        pass
