"""Atlas - Slack Connector. Syncs DMs, mentions, and channel messages."""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from app.core.logging import get_logger
from app.core.security import decrypt_token
from app.domain.interfaces.base_connector import BaseConnector
from app.domain.models.connector import Connector, ConnectorStatus, OAuthToken
from app.infrastructure.database import get_session_factory
from app.workers.embedding_tasks import enqueue_embedding_batches
from sqlalchemy import select

logger = get_logger(__name__)


class SlackConnector(BaseConnector):
    PROVIDER = "slack"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)
        self._token: str | None = None

    async def _get_token(self) -> str:
        if self._token:
            return self._token
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
            result = await session.execute(stmt)
            token_row = result.scalar_one_or_none()
            if not token_row:
                raise ValueError(f"No OAuth token for Slack connector {self.connector.id}")
            self._token = decrypt_token(token_row.access_token)
        return self._token

    async def _slack_api(self, method: str, params: dict | None = None) -> dict:
        token = await self._get_token()
        async with httpx.AsyncClient() as client:
            while True:
                resp = await client.get(
                    f"https://slack.com/api/{method}",
                    headers={"Authorization": f"Bearer {token}"},
                    params=params or {},
                )
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", 1))
                    logger.warning("Slack API rate limit hit, sleeping for %d seconds", retry_after)
                    await asyncio.sleep(retry_after)
                    continue
                
                resp.raise_for_status()
                data = resp.json()
                if not data.get("ok"):
                    if data.get("error") == "invalid_auth":
                        await self._mark_requires_reauth()
                    if data.get("error") == "ratelimited":
                        logger.warning("Slack API returned ratelimited error, sleeping for 1 second")
                        await asyncio.sleep(1)
                        continue
                    raise ValueError(f"Slack API error: {data.get('error')}")
                return data

    async def authenticate(self, auth_code: str) -> None:
        # Handled in the OAuth callback endpoint directly
        pass

    async def sync(self) -> dict[str, int]:
        """Sync recent DMs and mentions from Slack."""
        synced = 0
        chunks: list[dict[str, Any]] = []
        since = datetime.now(UTC) - timedelta(days=3)
        oldest = str(since.timestamp())

        # Get user's own ID
        auth_resp = await self._slack_api("auth.test")
        user_slack_id = auth_resp.get("user_id", "")

        # Get channels with pagination
        channels = []
        next_cursor = ""
        while True:
            params = {"types": "public_channel,private_channel,im,mpim", "limit": "100"}
            if next_cursor:
                params["cursor"] = next_cursor
            
            convos = await self._slack_api("conversations.list", params)
            channels.extend(convos.get("channels", []))
            
            next_cursor = convos.get("response_metadata", {}).get("next_cursor", "")
            if not next_cursor:
                break

        for channel in channels:
            channel_id = channel.get("id")
            channel_name = channel.get("name", "")
            
            hist_cursor = ""
            while True:
                params = {
                    "channel": channel_id,
                    "oldest": oldest,
                    "limit": "100",
                }
                if hist_cursor:
                    params["cursor"] = hist_cursor
                
                try:
                    history = await self._slack_api("conversations.history", params)
                except ValueError as e:
                    logger.warning("Failed to fetch history for channel %s: %s", channel_id, e)
                    break

                messages = history.get("messages", [])
                for msg in messages:
                    if msg.get("subtype"):
                        continue  # Skip system messages
                    text = msg.get("text", "")
                    if not text.strip():
                        continue
                    ts = msg.get("ts", "")
                    chunks.append({
                        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"slack:{channel_id}:{ts}")),
                        "source_id": f"{channel_id}:{ts}",
                        "type": "email",  # Reuse email type for messages
                        "text": text[:500],
                        "timestamp": datetime.fromtimestamp(float(ts), UTC).isoformat() if ts else datetime.now(UTC).isoformat(),
                        "metadata": {
                            "sender_email": msg.get("user", ""),
                            "source": "Slack",
                            "channel_id": channel_id,
                            "channel_name": channel_name,
                        },
                    })
                    synced += 1
                
                hist_cursor = history.get("response_metadata", {}).get("next_cursor", "")
                if not hist_cursor:
                    break

        if chunks:
            enqueue_embedding_batches(str(self.user_id), chunks)

        logger.info("Slack sync complete: synced=%d", synced)
        return {"synced": synced, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            await asyncio.sleep(300)
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        pass
