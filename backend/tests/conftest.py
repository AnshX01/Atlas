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
    "DATABASE_URL", "postgresql+asyncpg://atlas_ci:atlas_ci@localhost:5432/atlas_ci"
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
        await conn.execute(
            sa.text("DROP TYPE IF EXISTS connectorprovider, connectorstatus, syncstatus CASCADE")
        )
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture()
async def async_client(setup_db):  # noqa: ANN001
    """Async HTTP client for integration tests — requires a running database."""
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
