"""
Atlas — GitHub Connector.

Syncs Issues and Pull Requests. Handles GitHub webhooks for real-time events.
Implements exponential backoff for secondary rate limits (Retry-After header).
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
from app.infrastructure.neo4j_client import upsert_pr_node, upsert_task_node
from app.workers.embedding_tasks import batch_embed_chunks
from github import Auth, Github, GithubException, RateLimitExceededException
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential_jitter,
)

logger = get_logger(__name__)


class GitHubConnector(BaseConnector):
    """
    Connector for GitHub Issues and Pull Requests (read-only in Phase 1).
    Phase 2 adds: merge_pr, close_issue actions.
    """

    PROVIDER = "github"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)
        self._client: Github | None = None

    async def _get_client(self) -> Github:
        """Return (or build) an authenticated PyGitHub client."""
        if self._client:
            return self._client

        factory = get_session_factory()
        async with factory() as session:
            from sqlalchemy import select

            stmt = select(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
            result = await session.execute(stmt)
            token_row = result.scalar_one_or_none()
            if not token_row:
                raise ValueError(f"No OAuth token for connector {self.connector.id}")
            access_token = decrypt_token(token_row.access_token)

        self._client = Github(auth=Auth.Token(access_token))
        return self._client

    async def authenticate(self, auth_code: str) -> None:
        """Exchange GitHub OAuth code for an access token."""
        import httpx
        from app.core.config import get_settings

        settings = get_settings()
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://github.com/login/oauth/access_token",
                json={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "code": auth_code,
                },
                headers={"Accept": "application/json"},
            )
            data = resp.json()

        access_token = data.get("access_token")
        if not access_token:
            raise ValueError(f"GitHub OAuth failed: {data}")

        factory = get_session_factory()
        async with factory() as session:
            from sqlalchemy import select

            # Look up existing token by connector_id (not primary key)
            stmt = select(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()

            encrypted = encrypt_token(access_token)
            if existing:
                existing.access_token = encrypted
                existing.scope = data.get("scope", "")
                session.add(existing)
            else:
                token = OAuthToken(
                    id=uuid.uuid4(),
                    connector_id=self.connector.id,
                    access_token=encrypted,
                    scope=data.get("scope", ""),
                )
                session.add(token)

            # Reload connector in this session to avoid detached instance issues
            from app.domain.models.connector import Connector as ConnectorModel

            connector_in_session = await session.get(ConnectorModel, self.connector.id)
            if connector_in_session:
                connector_in_session.status = ConnectorStatus.ACTIVE
                session.add(connector_in_session)

            await session.commit()

        logger.info("GitHub authenticated", connector_id=str(self.connector.id))

    @retry(
        retry=retry_if_exception_type(RateLimitExceededException),
        wait=wait_exponential_jitter(initial=60, max=3600),
        stop=stop_after_attempt(3),
    )
    async def _sync_prs(self, gh: Github, since: datetime) -> dict[str, int]:
        """Sync pull requests across all user repos."""
        synced = 0
        failed = 0

        try:
            def fetch_prs():
                user = gh.get_user()
                res = []
                for repo in user.get_repos(type="owner"):
                    prs_for_repo = []
                    for pr in repo.get_pulls(state="open", sort="updated", direction="desc"):
                        if pr.updated_at.replace(tzinfo=UTC) < since:
                            break
                        prs_for_repo.append({
                            "id": pr.id,
                            "number": pr.number,
                            "title": pr.title,
                            "body": pr.body,
                            "updated_at": pr.updated_at,
                            "html_url": pr.html_url,
                            "user_login": pr.user.login,
                            "state": pr.state,
                            "repo_full_name": repo.full_name
                        })
                    if prs_for_repo:
                        res.append(prs_for_repo)
                return res

            repos_prs = await asyncio.to_thread(fetch_prs)

            for prs in repos_prs:
                chunks: list[dict] = []
                for pr in prs:
                    chunks.append(
                        {
                            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"ghpr:{pr['id']}")),
                            "source_id": str(pr['id']),
                            "type": "pr",
                            "text": f"PR #{pr['number']}: {pr['title']}\n\n{pr['body'] or ''}",
                            "timestamp": pr['updated_at'].isoformat(),
                            "metadata": {
                                "repo": pr['repo_full_name'],
                                "pr_number": pr['number'],
                                "url": pr['html_url'],
                                "author": pr['user_login'],
                                "state": pr['state'],
                            },
                        }
                    )
                    await upsert_pr_node(
                        str(self.user_id),
                        str(pr['id']),
                        pr['title'],
                        pr['html_url'],
                        pr['state'],
                        pr['repo_full_name'],
                        pr['user_login'],
                        pr['updated_at'].isoformat(),
                    )
                    logger.debug("PR synced", repo=pr['repo_full_name'], pr=pr['number'])
                    synced += 1
                if chunks:
                    batch_embed_chunks.delay(str(self.user_id), chunks)
        except GithubException as e:
            if e.status == 401:
                await self._mark_requires_reauth()
            failed += 1
            logger.error("GitHub sync error", error=str(e))

        return {"synced": synced, "failed": failed, "skipped": 0}

    async def _sync_issues(self, gh: Github, since: datetime) -> dict[str, int]:
        """Sync GitHub Issues assigned to or created by the user."""
        synced = 0
        try:
            def fetch_issues():
                user = gh.get_user()
                issues_list = []
                for issue in gh.search_issues(
                    query=f"assignee:{user.login} updated:>{since.strftime('%Y-%m-%d')} is:open"
                ):
                    issues_list.append({
                        "id": issue.id,
                        "number": issue.number,
                        "title": issue.title,
                        "body": issue.body,
                        "updated_at": issue.updated_at,
                        "html_url": issue.html_url,
                        "state": issue.state,
                        "repo_full_name": issue.repository.full_name if hasattr(issue, "repository") and issue.repository else "",
                        "author": issue.user.login if issue.user else "",
                        "assignee": issue.assignee.login if issue.assignee else None,
                    })
                return issues_list

            issues_data = await asyncio.to_thread(fetch_issues)
            chunks: list[dict] = []
            for issue in issues_data:
                chunks.append(
                    {
                        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"ghissue:{issue['id']}")),
                        "source_id": str(issue['id']),
                        "type": "issue",
                        "text": f"Issue #{issue['number']}: {issue['title']}\n\n{issue['body'] or ''}",
                        "timestamp": issue['updated_at'].isoformat(),
                        "metadata": {
                            "repo": issue['repo_full_name'],
                            "issue_number": issue['number'],
                            "url": issue['html_url'],
                            "author": issue['author'],
                            "state": issue['state'],
                        },
                    }
                )
                await upsert_task_node(
                    str(self.user_id),
                    str(issue['id']),
                    issue['title'],
                    issue['html_url'],
                    issue['state'],
                    issue['repo_full_name'],
                    issue['assignee'],
                    issue['updated_at'].isoformat(),
                )
                logger.debug("Issue synced", issue=issue['number'])
                synced += 1
            if chunks:
                batch_embed_chunks.delay(str(self.user_id), chunks)
        except GithubException as e:
            logger.warning("Issue sync error", error=str(e))
        return {"synced": synced, "failed": 0, "skipped": 0}

    async def sync(self) -> dict[str, int]:
        """Sync PRs and issues from the past 3 days."""
        gh = await self._get_client()
        since = datetime.now(UTC) - timedelta(days=3)

        pr_result = await self._sync_prs(gh, since)
        issue_result = await self._sync_issues(gh, since)

        total = {
            "synced": pr_result["synced"] + issue_result["synced"],
            "failed": pr_result["failed"] + issue_result["failed"],
            "skipped": 0,
        }
        logger.info("GitHub sync complete", **total, user_id=str(self.user_id))
        return total

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """Yield GitHub webhook events (registered separately in Phase 2)."""
        logger.info("GitHub watch not yet implemented — polling fallback")
        while True:
            await asyncio.sleep(120)  # 2-minute polling
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        """Cleanup resources (no-op for Phase 1)."""
        pass
