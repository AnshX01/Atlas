"""Unit tests for Celery worker tasks (sync and embedding)."""

from __future__ import annotations

import base64
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Patch env vars before importing anything from app
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("APP_SECRET_KEY", "test_secret_key_32_characters_xx")
os.environ.setdefault(
    "APP_MASTER_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(b"a" * 32).decode(),
)
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_here_for_unit_tests")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_workers.db")
os.environ.setdefault("NEO4J_PASSWORD", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")


class TestSyncConnectorJob:
    """Tests for sync_connector_job Celery task."""

    @pytest.mark.asyncio
    async def test_sync_connector_job_retries_on_network_error(self):
        """
        Mock the DB session to raise ConnectionError.
        Verify task.retry(exc=exc) is called.
        """
        from celery.exceptions import Retry

        mock_task = MagicMock()
        mock_task.retry = MagicMock(side_effect=Retry())

        user_id = uuid.uuid4()
        connector_id = uuid.uuid4()

        # Mock the session factory to raise ConnectionError on execute
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(side_effect=ConnectionError("Connection refused"))
        mock_session.commit = AsyncMock()
        mock_session.close = AsyncMock()
        mock_session.rollback = AsyncMock()

        mock_factory = MagicMock()
        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)
        mock_factory.return_value = mock_cm

        with patch("app.workers.sync_tasks.get_session_factory", return_value=mock_factory), \
             patch("app.workers.sync_tasks.reset_engine_for_worker"), \
             patch("app.workers.sync_tasks.reset_qdrant_client"), \
             patch("app.workers.sync_tasks.reset_redis_pool"), \
             patch("app.workers.sync_tasks.publish_sync_event", new_callable=AsyncMock), \
             patch("app.infrastructure.database.dispose_engine", new_callable=AsyncMock):

            from app.workers.sync_tasks import _async_sync_connector

            with pytest.raises(Retry):
                await _async_sync_connector(mock_task, user_id, connector_id)

        mock_task.retry.assert_called_once()
        # Verify the exc kwarg is a ConnectionError
        call_kwargs = mock_task.retry.call_args
        assert isinstance(call_kwargs[1]["exc"], ConnectionError) or \
               isinstance(call_kwargs.kwargs.get("exc"), ConnectionError)

    @pytest.mark.asyncio
    async def test_sync_connector_job_no_retry_on_not_implemented(self):
        """
        Mock DB to return a connector, mock connector.sync() to raise NotImplementedError.
        Verify the error is re-raised directly (not retried).
        """
        mock_task = MagicMock()
        mock_task.retry = MagicMock()

        user_id = uuid.uuid4()
        connector_id = uuid.uuid4()

        # Create a mock connector row
        mock_connector = MagicMock()
        mock_connector.id = connector_id
        mock_connector.user_id = user_id
        mock_connector.provider = MagicMock()
        mock_connector.provider.value = "test_provider"
        mock_connector.status = MagicMock()

        # Mock session that returns the connector
        mock_result = MagicMock()
        mock_result.scalar_one_or_none = MagicMock(return_value=mock_connector)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.get = AsyncMock(return_value=None)

        mock_factory = MagicMock()
        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)
        mock_factory.return_value = mock_cm

        # Mock _get_connector_instance to raise NotImplementedError
        with patch("app.workers.sync_tasks.get_session_factory", return_value=mock_factory), \
             patch("app.workers.sync_tasks.reset_engine_for_worker"), \
             patch("app.workers.sync_tasks.reset_qdrant_client"), \
             patch("app.workers.sync_tasks.reset_redis_pool"), \
             patch("app.workers.sync_tasks.publish_sync_event", new_callable=AsyncMock), \
             patch("app.infrastructure.database.dispose_engine", new_callable=AsyncMock), \
             patch(
                 "app.workers.sync_tasks._get_connector_instance",
                 side_effect=NotImplementedError("Connector not implemented: test"),
             ):

            from app.workers.sync_tasks import _async_sync_connector

            with pytest.raises(NotImplementedError, match="Connector not implemented"):
                await _async_sync_connector(mock_task, user_id, connector_id)

        # retry should NOT have been called for NotImplementedError
        mock_task.retry.assert_not_called()

    @pytest.mark.asyncio
    async def test_sync_all_active_enqueues_correctly(self):
        """Mock DB to return 3 active connectors. Verify apply_async is called 3 times."""
        connector_ids = [uuid.uuid4() for _ in range(3)]
        user_ids = [uuid.uuid4() for _ in range(3)]

        mock_connectors = []
        for i in range(3):
            mc = MagicMock()
            mc.id = connector_ids[i]
            mc.user_id = user_ids[i]
            mock_connectors.append(mc)

        mock_scalars = MagicMock()
        mock_scalars.all = MagicMock(return_value=mock_connectors)
        mock_result = MagicMock()
        mock_result.scalars = MagicMock(return_value=mock_scalars)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_factory = MagicMock()
        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)
        mock_factory.return_value = mock_cm

        mock_apply_async = MagicMock()

        with patch("app.workers.sync_tasks.get_session_factory", return_value=mock_factory), \
             patch("app.workers.sync_tasks.reset_engine_for_worker"), \
             patch("app.workers.sync_tasks.reset_qdrant_client"), \
             patch("app.workers.sync_tasks.reset_redis_pool"), \
             patch("app.infrastructure.database.dispose_engine", new_callable=AsyncMock), \
             patch("app.workers.sync_tasks.sync_connector_job") as mock_task:

            mock_task.apply_async = mock_apply_async

            from app.workers.sync_tasks import _async_sync_all

            result = await _async_sync_all()

        assert result["enqueued"] == 3
        assert mock_apply_async.call_count == 3


class TestBatchEmbedChunks:
    """Tests for batch_embed_chunks Celery task."""

    @pytest.mark.asyncio
    async def test_embed_chunks_failed_counter(self):
        """
        Pass a batch where embedder.encode() raises a non-rate-limit exception.
        Verify the task raises (does not swallow the error).
        """
        user_id = uuid.uuid4()
        chunks = [
            {
                "id": str(uuid.uuid4()),
                "source_id": str(uuid.uuid4()),
                "type": "email",
                "text": "This is a test chunk with content",
                "timestamp": "2024-01-01T00:00:00Z",
                "metadata": {},
            }
        ]

        mock_embedder = MagicMock()
        mock_embedder.encode = MagicMock(side_effect=RuntimeError("CUDA out of memory"))

        with patch("app.workers.embedding_tasks.get_embedder", return_value=mock_embedder), \
             patch("app.workers.embedding_tasks.reset_qdrant_client"), \
             patch("app.workers.embedding_tasks.upsert_vectors", new_callable=AsyncMock):

            from app.workers.embedding_tasks import _async_embed

            with pytest.raises(RuntimeError, match="CUDA out of memory"):
                await _async_embed(user_id, chunks)

    @pytest.mark.asyncio
    async def test_embed_chunks_empty_text_skipped(self):
        """
        Pass chunks where text is empty string or whitespace.
        Verify embedded count is 0 and function returns without error.
        """
        user_id = uuid.uuid4()
        chunks = [
            {
                "id": str(uuid.uuid4()),
                "source_id": str(uuid.uuid4()),
                "type": "email",
                "text": "",
                "timestamp": "2024-01-01T00:00:00Z",
                "metadata": {},
            },
            {
                "id": str(uuid.uuid4()),
                "source_id": str(uuid.uuid4()),
                "type": "doc",
                "text": "   \n\t  ",
                "timestamp": "2024-01-01T00:00:00Z",
                "metadata": {},
            },
        ]

        mock_embedder = MagicMock()
        # encode should NOT be called since all texts are empty/whitespace
        mock_embedder.encode = MagicMock()

        with patch("app.workers.embedding_tasks.get_embedder", return_value=mock_embedder), \
             patch("app.workers.embedding_tasks.reset_qdrant_client"), \
             patch("app.workers.embedding_tasks.upsert_vectors", new_callable=AsyncMock) as mock_upsert:

            from app.workers.embedding_tasks import _async_embed

            result = await _async_embed(user_id, chunks)

        assert result["embedded"] == 0
        assert result["failed"] == 0
        # encode should never be called with empty texts
        mock_embedder.encode.assert_not_called()
        # upsert should not be called since there are no points
        mock_upsert.assert_not_called()

    @pytest.mark.asyncio
    async def test_embed_chunks_rate_limit_retries(self):
        """
        Verify that rate limit errors trigger retries before eventually raising.
        """
        import numpy as np

        user_id = uuid.uuid4()
        chunks = [
            {
                "id": str(uuid.uuid4()),
                "source_id": str(uuid.uuid4()),
                "type": "email",
                "text": "Rate limit test content here",
                "timestamp": "2024-01-01T00:00:00Z",
                "metadata": {},
            }
        ]

        call_count = 0

        def mock_encode(texts):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("429 Too Many Requests")

        mock_embedder = MagicMock()
        mock_embedder.encode = MagicMock(side_effect=mock_encode)

        with patch("app.workers.embedding_tasks.get_embedder", return_value=mock_embedder), \
             patch("app.workers.embedding_tasks.reset_qdrant_client"), \
             patch("app.workers.embedding_tasks.upsert_vectors", new_callable=AsyncMock), \
             patch("asyncio.sleep", new_callable=AsyncMock):

            from app.workers.embedding_tasks import _async_embed

            with pytest.raises(RuntimeError, match="429"):
                await _async_embed(user_id, chunks)

        # Should have retried MAX_RETRIES + 1 times (initial + retries)
        assert call_count == 4  # 1 initial + 3 retries (MAX_RETRIES=3)
