import pytest
from httpx import AsyncClient
from unittest.mock import patch

@pytest.mark.asyncio
async def test_register_returns_tokens(async_client: AsyncClient):
    response = await async_client.post(
        "/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "SecurePassword123!",
            "full_name": "Test User"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert "tokens" in data
    assert "access_token" in data["tokens"]
    assert "refresh_token" in data["tokens"]
    assert data["user"]["email"] == "test@example.com"

@pytest.mark.asyncio
async def test_login_returns_tokens(async_client: AsyncClient):
    # First register
    await async_client.post(
        "/v1/auth/register",
        json={
            "email": "login@example.com",
            "password": "SecurePassword123!",
            "full_name": "Login User"
        }
    )
    
    # Then login
    response = await async_client.post(
        "/v1/auth/login",
        json={
            "email": "login@example.com",
            "password": "SecurePassword123!"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "tokens" in data
    assert "access_token" in data["tokens"]

@pytest.mark.asyncio
async def test_get_briefing_unauthenticated(async_client: AsyncClient):
    response = await async_client.get("/v1/briefing/daily")
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_get_briefing_authenticated(async_client: AsyncClient):
    # Register and get token
    reg_res = await async_client.post(
        "/v1/auth/register",
        json={
            "email": "briefing@example.com",
            "password": "SecurePassword123!",
            "full_name": "Briefing User"
        }
    )
    assert reg_res.status_code == 201
    token = reg_res.json()["tokens"]["access_token"]
    
    # Mock the pipeline so we don't hit OpenAI
    with patch("app.services.briefing_service.run_atlas_pipeline") as mock_pipeline:
        mock_pipeline.return_value = {"triage_scores": []}
        
        response = await async_client.get(
            "/v1/briefing/daily",
            headers={"Authorization": f"Bearer {token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "focus_score" in data
        assert "items" in data
