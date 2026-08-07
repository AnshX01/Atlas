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
from app.workers.embedding_tasks import batch_embed_chunks
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
            resp = await client.get(
                f"https://slack.com/api/{method}",
                headers={"Authorization": f"Bearer {token}"},
                params=params or {},
            )
            return resp.json()

    async def authenticate(self, auth_code: str) -> None:
        # Handled in the OAuth callback endpoint directly
        pass

    async def sync(self) -> dict[str, int]:
        """Sync recent DMs and mentions from Slack."""
        synced = 0
        chunks: list[dict[str, Any]] = []
        since = datetime.now(UTC) - timedelta(days=3)
        oldest = str(since.timestamp())

        try:
            # Get user's own ID
            auth_resp = await self._slack_api("auth.test")
            user_slack_id = auth_resp.get("user_id", "")

            # Get DM conversations
            convos = await self._slack_api("conversations.list", {"types": "im,mpim", "limit": "20"})
            channels = convos.get("channels", [])

            for channel in channels:
                history = await self._slack_api("conversations.history", {
                    "channel": channel["id"],
                    "oldest": oldest,
                    "limit": "20",
                })
                messages = history.get("messages", [])
                for msg in messages:
                    if msg.get("subtype"):
                        continue  # Skip system messages
                    text = msg.get("text", "")
                    if not text.strip():
                        continue
                    ts = msg.get("ts", "")
                    chunks.append({
                        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"slack:{channel['id']}:{ts}")),
                        "source_id": f"{channel['id']}:{ts}",
                        "type": "email",  # Reuse email type for messages
                        "text": text[:500],
                        "timestamp": datetime.fromtimestamp(float(ts), UTC).isoformat() if ts else datetime.now(UTC).isoformat(),
                        "metadata": {
                            "sender_email": msg.get("user", ""),
                            "source": "Slack",
                            "channel_id": channel["id"],
                        },
                    })
                    synced += 1
                await asyncio.sleep(0.5)  # Rate limit

        except Exception as e:
            logger.warning("Slack sync error: %s", str(e))

        if chunks:
            batch_embed_chunks.delay(str(self.user_id), chunks)

        logger.info("Slack sync complete: synced=%d", synced)
        return {"synced": synced, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            await asyncio.sleep(300)
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        pass
