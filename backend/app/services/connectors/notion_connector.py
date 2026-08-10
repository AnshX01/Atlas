"""Atlas - Notion Connector. Syncs pages, databases, and tasks."""
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
from app.infrastructure.neo4j_client import upsert_document_node, upsert_task_node
from sqlalchemy import select

logger = get_logger(__name__)

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


class NotionConnector(BaseConnector):
    PROVIDER = "notion"

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
                raise ValueError(f"No OAuth token for Notion connector {self.connector.id}")
            self._token = decrypt_token(token_row.access_token)
        return self._token

    async def _notion_api(self, method: str, path: str, json_body: dict | None = None) -> dict:
        token = await self._get_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient() as client:
            if method == "GET":
                resp = await client.get(f"{NOTION_API}{path}", headers=headers)
            else:
                resp = await client.post(f"{NOTION_API}{path}", headers=headers, json=json_body or {})
            resp.raise_for_status()
            return resp.json()

    async def authenticate(self, auth_code: str) -> None:
        pass  # Handled in OAuth callback

    async def sync(self) -> dict[str, int]:
        """Sync Notion pages and database items."""
        synced = 0
        chunks: list[dict[str, Any]] = []
        since = datetime.now(UTC) - timedelta(days=7)

        try:
            # Search all pages the user has access to
            results = await self._notion_api("POST", "/search", {
                "filter": {"property": "object", "value": "page"},
                "sort": {"direction": "descending", "timestamp": "last_edited_time"},
                "page_size": 50,
            })

            for page in results.get("results", []):
                # Extract title
                title = ""
                props = page.get("properties", {})
                for prop in props.values():
                    if prop.get("type") == "title":
                        title_parts = prop.get("title", [])
                        title = "".join(t.get("plain_text", "") for t in title_parts)
                        break

                if not title.strip():
                    title = "Untitled"

                page_url = page.get("url", "")
                last_edited = page.get("last_edited_time", datetime.now(UTC).isoformat())

                # Determine if this is a task (has status/checkbox property)
                item_type = "document"
                for prop in props.values():
                    if prop.get("type") in ("status", "checkbox"):
                        item_type = "task"
                        break

                chunks.append({
                    "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"notion:{page['id']}")),
                    "source_id": page["id"],
                    "type": item_type,
                    "text": f"{title}",
                    "timestamp": last_edited,
                    "metadata": {
                        "url": page_url,
                        "source": "Notion",
                        "notion_id": page["id"],
                    },
                })
                synced += 1

                try:
                    if item_type == "document":
                        await upsert_document_node(str(self.user_id), page["id"], "notion_page", last_edited)
                    elif item_type == "task":
                        await upsert_task_node(
                            user_id=str(self.user_id),
                            issue_id=page["id"],
                            title=title,
                            url=page_url,
                            state="open",
                            repo="Notion",
                            assignee=None,
                            updated_at=last_edited,
                        )
                except Exception as e:
                    logger.warning("Neo4j upsert failed for Notion item %s: %s", page["id"], str(e))

        except Exception as e:
            logger.warning("Notion sync error: %s", str(e))

        if chunks:
            batch_embed_chunks.delay(str(self.user_id), chunks)

        logger.info("Notion sync complete: synced=%d", synced)
        return {"synced": synced, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            await asyncio.sleep(600)
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        pass
