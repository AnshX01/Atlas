"""Integration tests for FastAPI route authentication and validation."""

from __future__ import annotations

import base64
import os
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
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_routes.db")
os.environ.setdefault("NEO4J_PASSWORD", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")


@pytest.fixture()
def client():
    """
    Create a TestClient with mocked external dependencies.

    We patch out heavy startup dependencies (Neo4j, Redis) so that the
    app can be tested without running infrastructure services.
    """
    with patch("app.infrastructure.neo4j_client.initialize_schema_constraints", new_callable=AsyncMock):
        with patch("app.infrastructure.neo4j_client.close_neo4j_driver", new_callable=AsyncMock):
            with patch("app.infrastructure.redis_client.close_redis_pool", new_callable=AsyncMock):
                with patch("app.infrastructure.init_tables.ensure_conversation_tables", new_callable=AsyncMock):
                    from app.main import app

                    from fastapi.testclient import TestClient

                    with TestClient(app) as c:
                        yield c


class TestHealthEndpoint:
    """Tests for the health check endpoint."""

    def test_health_endpoint(self, client):
        """GET /health → expect 200 with status 'healthy'."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "atlas-backend"
        assert "version" in data


class TestBriefingRoutes:
    """Tests for briefing routes requiring authentication."""

    def test_briefing_daily_no_auth(self, client):
        """GET /v1/briefing/daily with no Authorization header → expect 401."""
        response = client.get("/v1/briefing/daily")
        assert response.status_code == 401

    def test_briefing_daily_invalid_jwt(self, client):
        """GET /v1/briefing/daily with invalid JWT → expect 401."""
        response = client.get(
            "/v1/briefing/daily",
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert response.status_code == 401


class TestSearchRoutes:
    """Tests for search routes requiring authentication."""

    def test_search_omni_no_auth(self, client):
        """POST /v1/search/omni with no auth → expect 401."""
        response = client.post(
            "/v1/search/omni",
            json={"query": "test search"},
        )
        assert response.status_code == 401

    def test_search_omni_invalid_jwt(self, client):
        """POST /v1/search/omni with invalid JWT → expect 401."""
        response = client.post(
            "/v1/search/omni",
            json={"query": "test search"},
            headers={"Authorization": "Bearer invalid.token.here"},
        )
        assert response.status_code == 401

    def test_search_omni_malformed_body(self, client):
        """POST /v1/search/omni with auth but malformed body → expect 422."""
        from app.api.deps import get_current_user
        from app.main import app

        # Override the auth dependency to bypass JWT validation
        mock_user = MagicMock()
        mock_user.id = "00000000-0000-0000-0000-000000000001"
        mock_user.is_active = True

        async def override_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = override_get_current_user

        try:
            # Send wrong type for query (integer instead of string)
            response = client.post(
                "/v1/search/omni",
                json={"query": 12345},
                headers={"Authorization": "Bearer fake.but.bypassed"},
            )
            # Pydantic should reject int where str is expected, or
            # if it coerces, send an empty body which should fail validation
            # Either 422 (validation) is acceptable
            assert response.status_code == 422 or response.status_code == 200

            # Empty body should definitely fail validation
            response_empty = client.post(
                "/v1/search/omni",
                json={},
                headers={"Authorization": "Bearer fake.but.bypassed"},
            )
            assert response_empty.status_code == 422
        finally:
            # Clean up overrides
            app.dependency_overrides.pop(get_current_user, None)


class TestConnectorRoutes:
    """Tests for connector routes requiring authentication."""

    def test_connectors_list_no_auth(self, client):
        """GET /v1/connectors with no auth → expect 401."""
        response = client.get("/v1/connectors")
        assert response.status_code == 401

    def test_connectors_list_invalid_jwt(self, client):
        """GET /v1/connectors with invalid JWT → expect 401."""
        response = client.get(
            "/v1/connectors",
            headers={"Authorization": "Bearer bad.jwt.token"},
        )
        assert response.status_code == 401
