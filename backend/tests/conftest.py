"""Backend tests — conftest.py"""

from __future__ import annotations

import base64
import os

# Set required env vars before importing anything from app
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("APP_SECRET_KEY", "ci-secret-key-32-characters-xxxx")
os.environ.setdefault(
    "APP_MASTER_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(b"a" * 32).decode(),
)
os.environ.setdefault("JWT_SECRET_KEY", "ci-jwt-secret-key-for-testing-only")
os.environ.setdefault(
    "DATABASE_URL", "sqlite+aiosqlite:///./test_integration.db"
)
os.environ.setdefault("NEO4J_PASSWORD", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "atlas_ci")

import pytest
import sqlalchemy as sa
from app.domain.models import Base
from app.infrastructure.database import get_engine
from httpx import ASGITransport, AsyncClient


@pytest.fixture()
async def setup_db():
    """Create and tear down all tables for integration tests."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        try:
            await conn.execute(
                sa.text("DROP TYPE IF EXISTS connectorprovider, connectorstatus, syncstatus CASCADE")
            )
        except Exception:
            pass
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture(autouse=True)
def mock_external_services():
    from unittest.mock import patch, MagicMock, AsyncMock
    mock_redis = MagicMock()
    mock_pipe = AsyncMock()
    mock_pipe.execute.return_value = [1, 2, 1, 1]
    mock_pipe.__aenter__.return_value = mock_pipe
    mock_redis.pipeline = MagicMock(return_value=mock_pipe)

    with patch("app.infrastructure.redis_client.get_redis", return_value=mock_redis), \
         patch("app.infrastructure.neo4j_client.get_neo4j_driver"), \
         patch("app.infrastructure.qdrant_client.get_qdrant_client"), \
         patch("app.core.rate_limit.get_redis", return_value=mock_redis):
        yield


@pytest.fixture()
async def async_client(setup_db):  # noqa: ANN001
    """Async HTTP client for integration tests — requires a running database."""
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
