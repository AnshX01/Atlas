"""
Atlas — Celery Sync Tasks.

Background jobs for third-party connector synchronization.
Each job:
  1. Instantiates the appropriate connector
  2. Calls connector.sync()
  3. Writes a SyncLog entry
  4. Publishes progress events to Redis Pub/Sub
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from app.domain.models.connector import ConnectorProvider, ConnectorStatus
from app.domain.models.sync_log import SyncLog, SyncStatus
from app.infrastructure.database import get_session_factory
from app.infrastructure.redis_client import publish_sync_event
from app.workers.celery_app import celery_app
from celery.utils.log import get_task_logger

logger = get_task_logger(__name__)


def _get_connector_instance(connector_row: object, user_id: uuid.UUID) -> object:
    """Factory: return the appropriate connector implementation."""
    from app.services.connectors.github_connector import GitHubConnector
    from app.services.connectors.google_workspace import GoogleWorkspaceConnector
    from app.services.connectors.local_fs import LocalFSConnector

    provider_map = {
        ConnectorProvider.GOOGLE_WORKSPACE: GoogleWorkspaceConnector,
        ConnectorProvider.GITHUB: GitHubConnector,
        ConnectorProvider.LOCAL_FS: LocalFSConnector,
    }
    cls = provider_map.get(connector_row.provider)
    if not cls:
        raise NotImplementedError(f"Connector not implemented: {connector_row.provider}")
    return cls(connector=connector_row, user_id=user_id)


@celery_app.task(
    bind=True,
    name="app.workers.sync_tasks.sync_connector_job",
    queue="sync",
    max_retries=3,
    default_retry_delay=60,
)
def sync_connector_job(self, user_id: str, connector_id: str) -> dict:
    """
    Celery task: Sync a single connector for a user.

    Args:
        user_id: UUID string of the owning user.
        connector_id: UUID string of the connector to sync.
    """
    return asyncio.run(
        _async_sync_connector(self, uuid.UUID(user_id), uuid.UUID(connector_id))
    )


async def _async_sync_connector(task, user_id: uuid.UUID, connector_id: uuid.UUID) -> dict:
    """Async implementation of the sync job."""
    factory = get_session_factory()

    async with factory() as session:
        from app.domain.models.connector import Connector
        from sqlalchemy import select

        stmt = select(Connector).where(
            Connector.id == connector_id,
            Connector.user_id == user_id,  # RBAC: enforce user ownership
        )
        result = await session.execute(stmt)
        connector_row = result.scalar_one_or_none()

        if not connector_row:
            logger.error("Connector not found or access denied", connector_id=str(connector_id))
            return {"status": "error", "message": "Connector not found"}

        # Create SyncLog entry
        sync_log = SyncLog(
            id=uuid.uuid4(),
            connector_id=connector_id,
            status=SyncStatus.RUNNING,
        )
        session.add(sync_log)
        await session.commit()

    # Publish start event
    await publish_sync_event(
        str(user_id),
        {
            "event": "sync_started",
            "connector_id": str(connector_id),
            "provider": connector_row.provider.value,
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )

    try:
        connector = _get_connector_instance(connector_row, user_id)
        result = await connector.sync()

        # Update SyncLog to success
        async with factory() as session:
            sync_log_obj = await session.get(SyncLog, sync_log.id)
            if sync_log_obj:
                sync_log_obj.status = SyncStatus.SUCCESS
                sync_log_obj.items_synced = result.get("synced", 0)
                sync_log_obj.items_failed = result.get("failed", 0)
                session.add(sync_log_obj)

            connector_row.status = ConnectorStatus.ACTIVE
            session.add(connector_row)
            await session.commit()

        # Publish completion event
        await publish_sync_event(
            str(user_id),
            {
                "event": "sync_complete",
                "connector_id": str(connector_id),
                "provider": connector_row.provider.value,
                "synced": result.get("synced", 0),
                "failed": result.get("failed", 0),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

        logger.info("Sync completed", connector_id=str(connector_id), **result)
        return {"status": "success", **result}

    except Exception as exc:
        logger.error("Sync failed", connector_id=str(connector_id), error=str(exc))

        async with factory() as session:
            sync_log_obj = await session.get(SyncLog, sync_log.id)
            if sync_log_obj:
                sync_log_obj.status = SyncStatus.FAILED
                sync_log_obj.error_msg = str(exc)[:2000]
                session.add(sync_log_obj)
            await session.commit()

        await publish_sync_event(
            str(user_id),
            {
                "event": "sync_error",
                "connector_id": str(connector_id),
                "error": str(exc),
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

        raise task.retry(exc=exc)


@celery_app.task(name="app.workers.sync_tasks.sync_all_active_connectors", queue="sync")
def sync_all_active_connectors() -> dict:
    """Beat task: enqueue sync jobs for all active connectors across all users."""
    return asyncio.run(_async_sync_all())


async def _async_sync_all() -> dict:
    from app.domain.models.connector import Connector
    from sqlalchemy import select

    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(Connector.status == ConnectorStatus.ACTIVE)
        result = await session.execute(stmt)
        connectors = result.scalars().all()

    enqueued = 0
    for connector in connectors:
        sync_connector_job.apply_async(
            args=[str(connector.user_id), str(connector.id)],
            countdown=enqueued * 2,  # stagger to avoid thundering herd
        )
        enqueued += 1

    logger.info("Enqueued sync jobs", count=enqueued)
    return {"enqueued": enqueued}
