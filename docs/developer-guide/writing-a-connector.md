# Writing a New Atlas Integration Connector

This guide walks you through adding a new third-party data source (e.g., Linear, Jira, Slack) to Atlas by extending the `BaseConnector` abstract class.

---

## 1. Understand the Connector Lifecycle

All connectors implement this lifecycle, defined in [`base_connector.py`](../../backend/app/domain/interfaces/base_connector.py):

```
authenticate(auth_code) → sync() → watch() → teardown()
```

| Method | Called by | Purpose |
|--------|-----------|---------|
| `authenticate(code)` | OAuth callback handler | Exchange code → tokens; persist encrypted |
| `sync()` | Celery `sync_connector_job` | Fetch all data since last cursor; return item counts |
| `watch()` | Background daemon | Yield real-time events (webhooks / polling) |
| `teardown()` | On connector disconnect | Clean up watchers, revoke webhooks |

---

## 2. Register the Provider Enum

Open [`backend/app/domain/models/connector.py`](../../backend/app/domain/models/connector.py) and add your provider to `ConnectorProvider`:

```python
class ConnectorProvider(str, enum.Enum):
    # ... existing providers ...
    LINEAR = "linear"          # ← Add this
```

Then run a new Alembic migration:
```bash
make migrate-create MSG="add_linear_connector_provider"
```

---

## 3. Create the Connector File

Create `backend/app/services/connectors/linear_connector.py`:

```python
"""Atlas — Linear Connector (Issues & Projects)."""
from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential_jitter

from app.core.logging import get_logger
from app.core.security import decrypt_token, encrypt_token
from app.domain.interfaces.base_connector import BaseConnector
from app.domain.models.connector import Connector, ConnectorStatus, OAuthToken
from app.infrastructure.database import get_session_factory

logger = get_logger(__name__)

LINEAR_API_URL = "https://api.linear.app/graphql"


class LinearConnector(BaseConnector):
    """Connector for Linear issues and project cycles."""

    PROVIDER = "linear"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)

    async def _get_access_token(self) -> str:
        """Decrypt and return the stored access token."""
        factory = get_session_factory()
        async with factory() as session:
            token_row = await session.get(OAuthToken, self.connector.id)
            if not token_row:
                raise ValueError("No token found for Linear connector")
            return decrypt_token(token_row.access_token)

    async def authenticate(self, auth_code: str) -> None:
        """Exchange OAuth code for a Linear access token."""
        from app.core.config import get_settings
        settings = get_settings()

        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.linear.app/oauth/token",
                data={
                    "code": auth_code,
                    "redirect_uri": "http://localhost:8000/v1/auth/oauth/linear/callback",
                    "client_id": settings.LINEAR_CLIENT_ID,          # Add to Settings
                    "client_secret": settings.LINEAR_CLIENT_SECRET,   # Add to Settings
                    "grant_type": "authorization_code",
                },
            )
            data = resp.json()

        access_token = data.get("access_token")
        if not access_token:
            raise ValueError(f"Linear OAuth failed: {data}")

        factory = get_session_factory()
        async with factory() as session:
            token = OAuthToken(
                id=uuid.uuid4(),
                connector_id=self.connector.id,
                access_token=encrypt_token(access_token),
                scope=data.get("scope", ""),
            )
            session.add(token)
            self.connector.status = ConnectorStatus.ACTIVE
            session.add(self.connector)
            await session.commit()

        logger.info("Linear authenticated", connector_id=str(self.connector.id))

    @retry(
        retry=retry_if_exception_type(httpx.HTTPStatusError),
        wait=wait_exponential_jitter(initial=2, max=60),
        stop=stop_after_attempt(5),
    )
    async def _graphql(self, query: str, variables: dict | None = None) -> dict:
        """Execute a Linear GraphQL query."""
        token = await self._get_access_token()
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                LINEAR_API_URL,
                json={"query": query, "variables": variables or {}},
                headers={"Authorization": token},
            )
            if resp.status_code == 401:
                await self._mark_requires_reauth()
                resp.raise_for_status()
            resp.raise_for_status()
            return resp.json()

    async def sync(self) -> dict[str, int]:
        """Fetch assigned issues from Linear."""
        issues_query = """
        query MyIssues {
          viewer {
            assignedIssues(filter: { state: { type: { nin: ["completed", "cancelled"] } } }) {
              nodes {
                id title description priority state { name } team { name }
                updatedAt
              }
            }
          }
        }
        """
        data = await self._graphql(issues_query)
        issues = data.get("data", {}).get("viewer", {}).get("assignedIssues", {}).get("nodes", [])
        synced = 0

        for issue in issues:
            # TODO: embed issue → Qdrant; upsert Task node → Neo4j
            logger.debug("Linear issue synced", issue_id=issue["id"])
            synced += 1

        logger.info("Linear sync complete", synced=synced, user_id=str(self.user_id))
        return {"synced": synced, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """Poll Linear every 5 minutes (webhook support planned for Phase 2)."""
        import asyncio
        while True:
            await asyncio.sleep(300)
            yield {"type": "poll_tick", "payload": {}}
```

---

## 4. Register in the Connector Factory

Open [`backend/app/workers/sync_tasks.py`](../../backend/app/workers/sync_tasks.py) and add your connector to `_get_connector_instance`:

```python
from app.services.connectors.linear_connector import LinearConnector

provider_map = {
    ConnectorProvider.GOOGLE_WORKSPACE: GoogleWorkspaceConnector,
    ConnectorProvider.GITHUB: GitHubConnector,
    ConnectorProvider.LOCAL_FS: LocalFSConnector,
    ConnectorProvider.LINEAR: LinearConnector,   # ← Add this
}
```

---

## 5. Add Environment Variables

Add to `.env.example`:
```bash
LINEAR_CLIENT_ID=CHANGE_ME
LINEAR_CLIENT_SECRET=CHANGE_ME
LINEAR_REDIRECT_URI=http://localhost:8000/v1/auth/oauth/linear/callback
```

Add to `backend/app/core/config.py`:
```python
LINEAR_CLIENT_ID: str = ""
LINEAR_CLIENT_SECRET: str = ""
LINEAR_REDIRECT_URI: str = "http://localhost:8000/v1/auth/oauth/linear/callback"
```

---

## 6. Add the OAuth Callback Route

In `backend/app/api/v1/auth.py`:

```python
@router.get("/oauth/linear/callback", summary="Linear OAuth callback")
async def linear_oauth_callback(code: str) -> dict:
    # Route to LinearConnector.authenticate(code)
    return {"status": "ok", "provider": "linear"}
```

---

## 7. Embedding Integration

Once `sync()` fetches items, pipe them to the embedding task:

```python
from app.workers.embedding_tasks import batch_embed_chunks

chunks = [
    {
        "id": str(uuid.uuid4()),
        "source_id": issue["id"],
        "type": "issue",
        "text": f"{issue['title']}\n{issue.get('description', '')}",
        "timestamp": issue["updatedAt"],
        "metadata": {"team": issue.get("team", {}).get("name", ""), "priority": issue["priority"]},
    }
    for issue in issues
]

batch_embed_chunks.apply_async(args=[str(self.user_id), chunks])
```

---

## 8. Graph Integration

After embedding, create a `Task` node in Neo4j:

```python
from app.infrastructure.neo4j_client import run_cypher

await run_cypher(
    """
    MERGE (t:Task {id: $issue_id})
    SET t.title = $title,
        t.user_id = $user_id,
        t.source = 'linear',
        t.updated_at = $updated_at
    WITH t
    MATCH (u:User {id: $user_id})
    MERGE (u)-[:OWNS]->(t)
    """,
    {
        "issue_id": issue["id"],
        "title": issue["title"],
        "user_id": str(self.user_id),
        "updated_at": issue["updatedAt"],
    },
)
```

---

## 9. Checklist Before PR

- [ ] `ConnectorProvider` enum updated + Alembic migration created
- [ ] Connector class extends `BaseConnector` with all 3 abstract methods
- [ ] OAuth tokens stored via `encrypt_token()`, never plaintext
- [ ] All API calls wrapped with `tenacity` retry + backoff
- [ ] 401 responses call `self._mark_requires_reauth()`
- [ ] `sync()` calls `batch_embed_chunks` for all fetched content
- [ ] `sync()` creates/updates Neo4j nodes with `user_id` property
- [ ] Factory in `sync_tasks.py` updated
- [ ] `.env.example` and `config.py` updated with new env vars
- [ ] OAuth callback route added to `auth.py`
- [ ] Unit test for OAuth token exchange (mock HTTP client)
- [ ] Integration test for `sync()` with a test fixture

---

## Questions?

See the existing connectors for reference:
- [`google_workspace.py`](../../backend/app/services/connectors/google_workspace.py) — Full OAuth2 + token refresh pattern
- [`github_connector.py`](../../backend/app/services/connectors/github_connector.py) — Rate limit retry pattern
- [`local_fs.py`](../../backend/app/services/connectors/local_fs.py) — Watchdog + async queue pattern
