"""Backend tests — conftest.py"""

import pytest
import sqlalchemy as sa
from app.infrastructure.database import Base, engine
from app.main import app
from httpx import ASGITransport, AsyncClient


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(
            sa.text("DROP TYPE IF EXISTS connectorprovider, connectorstatus, syncstatus CASCADE")
        )
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def async_client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
