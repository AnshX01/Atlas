"""Unit tests for database infrastructure layer."""

from __future__ import annotations

import base64
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

# Patch env vars before importing anything from app
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("APP_SECRET_KEY", "test_secret_key_32_characters_xx")
os.environ.setdefault(
    "APP_MASTER_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(b"a" * 32).decode(),
)
os.environ.setdefault("JWT_SECRET_KEY", "test_jwt_secret_key_here_for_unit_tests")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_unit.db")
os.environ.setdefault("NEO4J_PASSWORD", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")


class TestGetAsyncSession:
    """Tests for the get_async_session generator dependency."""

    @pytest.mark.asyncio
    async def test_session_commit_on_success(self):
        """Verify commit is called when no exception is raised inside the session."""
        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.rollback = AsyncMock()
        mock_session.close = AsyncMock()

        # Create a mock factory that returns a context manager yielding mock_session
        mock_factory = MagicMock()
        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)
        mock_factory.return_value = mock_cm

        with patch("app.infrastructure.database.get_session_factory", return_value=mock_factory):
            from app.infrastructure.database import get_async_session

            gen = get_async_session()
            session = await gen.__anext__()

            # Simulate successful usage — send None to advance past yield
            try:
                await gen.__anext__()
            except StopAsyncIteration:
                pass

        # In the real implementation, commit is called after yield succeeds
        # We verify the session factory pattern works correctly
        mock_session.commit.assert_called_once()
        mock_session.rollback.assert_not_called()
        mock_session.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_session_rollback_on_exception(self):
        """Verify that rollback is called and close is called in finally when an exception occurs."""
        mock_session = AsyncMock()
        mock_session.commit = AsyncMock()
        mock_session.rollback = AsyncMock()
        mock_session.close = AsyncMock()

        mock_factory = MagicMock()
        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_session)
        mock_cm.__aexit__ = AsyncMock(return_value=False)
        mock_factory.return_value = mock_cm

        with patch("app.infrastructure.database.get_session_factory", return_value=mock_factory):
            from app.infrastructure.database import get_async_session

            gen = get_async_session()
            session = await gen.__anext__()

            # Simulate an exception being thrown into the generator
            with pytest.raises(RuntimeError):
                await gen.athrow(RuntimeError("DB error"))

        mock_session.rollback.assert_called_once()
        mock_session.close.assert_called_once()
        mock_session.commit.assert_not_called()


class TestEngineSingleton:
    """Tests for the get_engine singleton pattern."""

    def test_engine_singleton(self):
        """Call get_engine() twice, verify the same object is returned."""
        import app.infrastructure.database as db_module

        # Reset state
        db_module._engine = None
        db_module._session_factory = None

        with patch("app.infrastructure.database.create_async_engine") as mock_create, \
             patch("sqlalchemy.event.listens_for"):
            mock_engine = MagicMock()
            mock_engine.sync_engine = MagicMock()
            mock_create.return_value = mock_engine

            engine1 = db_module.get_engine()
            engine2 = db_module.get_engine()

            assert engine1 is engine2
            # create_async_engine should only be called once (singleton)
            mock_create.assert_called_once()

        # Cleanup
        db_module._engine = None
        db_module._session_factory = None

    def test_reset_engine_for_worker(self):
        """Call reset_engine_for_worker(), verify get_engine() creates a new instance."""
        import app.infrastructure.database as db_module

        # Reset state
        db_module._engine = None
        db_module._session_factory = None

        with patch("app.infrastructure.database.create_async_engine") as mock_create, \
             patch("sqlalchemy.event.listens_for"):
            mock_engine_1 = MagicMock()
            mock_engine_1.sync_engine = MagicMock()
            mock_engine_2 = MagicMock()
            mock_engine_2.sync_engine = MagicMock()
            mock_create.side_effect = [mock_engine_1, mock_engine_2]

            engine1 = db_module.get_engine()
            assert engine1 is mock_engine_1

            # Reset the worker state
            db_module.reset_engine_for_worker()
            assert db_module._engine is None
            assert db_module._session_factory is None

            engine2 = db_module.get_engine()
            assert engine2 is mock_engine_2
            assert engine1 is not engine2

        # Cleanup
        db_module._engine = None
        db_module._session_factory = None

    @pytest.mark.asyncio
    async def test_dispose_engine_clears_singleton(self):
        """Call dispose_engine() and verify the internal _engine is None afterward."""
        import app.infrastructure.database as db_module

        # Set up a mock engine
        mock_engine = AsyncMock()
        mock_engine.dispose = AsyncMock()
        db_module._engine = mock_engine

        await db_module.dispose_engine()

        assert db_module._engine is None
        mock_engine.dispose.assert_called_once()

        # Cleanup
        db_module._session_factory = None


class TestThreadSafety:
    """Tests for thread-safe engine initialization."""

    def test_engine_lock_exists(self):
        """Verify that the module-level _engine_lock is a threading.Lock."""
        import threading

        import app.infrastructure.database as db_module

        assert hasattr(db_module, "_engine_lock")
        assert isinstance(db_module._engine_lock, type(threading.Lock()))
