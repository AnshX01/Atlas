"""Atlas — Authentication API router."""

from __future__ import annotations

import uuid
from datetime import timedelta

from app.api.deps import get_current_user, get_db
from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.domain.models.connector import Connector, ConnectorProvider, ConnectorStatus
from app.domain.models.user import User
from app.domain.schemas.auth import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── Helper ────────────────────────────────────────────────────────────────────


async def _get_or_create_connector(
    session: AsyncSession,
    user_id: uuid.UUID,
    provider: ConnectorProvider,
) -> Connector:
    """Return existing connector for user+provider, or create an INACTIVE one."""
    result = await session.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.provider == provider,
        )
    )
    connector = result.scalar_one_or_none()
    if connector is not None:
        return connector

    connector = Connector(
        id=uuid.uuid4(),
        user_id=user_id,
        provider=provider,
        status=ConnectorStatus.INACTIVE,
    )
    session.add(connector)
    await session.commit()
    await session.refresh(connector)
    return connector


# ── Registration / Login / Refresh / Me ──────────────────────────────────────


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new Atlas user",
)
async def register(
    payload: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Create a new user account and return JWT token pair."""
    existing = await session.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email {payload.email} already exists",
        )

    user = User(
        id=uuid.uuid4(),
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    settings = get_settings()

    return AuthResponse(
        tokens=TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        ),
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=AuthResponse, summary="Login and receive JWT tokens")
async def login(
    payload: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> AuthResponse:
    """Authenticate with email/password and return JWT token pair."""
    result = await session.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    settings = get_settings()
    return AuthResponse(
        tokens=TokenResponse(
            access_token=create_access_token(str(user.id)),
            refresh_token=create_refresh_token(str(user.id)),
            expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        ),
        user=UserResponse.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse, summary="Refresh access token")
async def refresh_token(
    payload: RefreshRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Exchange a valid refresh token for a new access + refresh token pair."""
    try:
        token_data = decode_token(payload.refresh_token)
        if token_data.get("type") != "refresh":
            raise ValueError("Not a refresh token")
        user_id = uuid.UUID(token_data["sub"])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid refresh token: {exc}",
        ) from exc

    user = await session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=create_refresh_token(str(user.id)),
        expires_in=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=UserResponse, summary="Get current user profile")
async def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the authenticated user's profile."""
    return UserResponse.model_validate(current_user)


# ── OAuth Initiate Endpoints ──────────────────────────────────────────────────


@router.get("/oauth/google/login/initiate", summary="Initiate Google OAuth flow for Login")
async def google_login_initiate() -> RedirectResponse:
    """Redirect the browser to Google OAuth for user login."""
    from google_auth_oauthlib.flow import Flow

    settings = get_settings()
    login_redirect_uri = "http://localhost:8000/v1/auth/oauth/google/login/callback"

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [login_redirect_uri],
            }
        },
        scopes=["openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"],
        redirect_uri=login_redirect_uri,
    )
    auth_url, _ = flow.authorization_url(
        state="login_flow",
        access_type="offline",
        include_granted_scopes="true",
    )
    return RedirectResponse(auth_url)


@router.get("/oauth/google/initiate", summary="Initiate Google OAuth flow")
async def google_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return a Google OAuth authorization URL for the authenticated user."""
    from google_auth_oauthlib.flow import Flow

    settings = get_settings()

    state_token = create_access_token(
        str(current_user.id),
        expires_delta=timedelta(minutes=10),
        extra_claims={"purpose": "oauth_state"},
    )

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
            }
        },
        scopes=settings.google_scopes_list,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )
    auth_url, _ = flow.authorization_url(
        state=state_token,
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        code_challenge=None,
        code_challenge_method=None,
    )
    return {"auth_url": auth_url}


@router.get("/oauth/github/initiate", summary="Initiate GitHub OAuth flow")
async def github_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return a GitHub OAuth authorization URL for the authenticated user."""
    settings = get_settings()

    state_token = create_access_token(
        str(current_user.id),
        expires_delta=timedelta(minutes=10),
        extra_claims={"purpose": "oauth_state"},
    )

    auth_url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={settings.GITHUB_CLIENT_ID}"
        f"&state={state_token}"
        f"&scope=repo,user:email"
    )
    return {"auth_url": auth_url}


# ── OAuth Callback Endpoints ──────────────────────────────────────────────────


@router.get("/oauth/google/login/callback", summary="Google OAuth login callback")
async def google_login_callback(
    code: str,
    state: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle Google OAuth redirect for login. Exchange code for user info, create/login user, redirect with token."""
    import httpx
    
    if state != "login_flow":
        return RedirectResponse("http://localhost:3000/login?error=google_auth_failed", status_code=302)

    settings = get_settings()
    
    # Exchange code for token
    login_redirect_uri = "http://localhost:8000/v1/auth/oauth/google/login/callback"
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": login_redirect_uri,
            },
        )
        if token_res.status_code != 200:
            return RedirectResponse("http://localhost:3000/login?error=google_auth_failed", status_code=302)
            
        access_token = token_res.json().get("access_token")
        
        # Get user info
        user_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        if user_res.status_code != 200:
            return RedirectResponse("http://localhost:3000/login?error=google_auth_failed", status_code=302)
            
        user_info = user_res.json()
        email = user_info.get("email")
        full_name = user_info.get("name")
        
    if not email:
        return RedirectResponse("http://localhost:3000/login?error=google_auth_failed", status_code=302)
        
    # Check if user exists
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    
    if not user:
        # Create user
        user = User(
            id=uuid.uuid4(),
            email=email,
            hashed_password=hash_password(str(uuid.uuid4())), # Random password for OAuth users
            full_name=full_name,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        
    if not user.is_active:
        return RedirectResponse("http://localhost:3000/login?error=account_disabled", status_code=302)
        
    # Generate tokens
    jwt_access = create_access_token(str(user.id))
    jwt_refresh = create_refresh_token(str(user.id))
    
    return RedirectResponse(
        f"http://localhost:3000/login?access_token={jwt_access}&refresh_token={jwt_refresh}",
        status_code=302,
    )


@router.get("/oauth/google/callback", summary="Google OAuth callback")
async def google_oauth_callback(
    code: str,
    state: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle Google OAuth redirect. Exchange code for tokens and activate connector."""
    if state is None:
        return RedirectResponse(
            "http://localhost:3000/settings?error=google_auth_failed",
            status_code=302,
        )

    try:
        state_data = decode_token(state)
        if state_data.get("purpose") != "oauth_state":
            raise ValueError("Invalid token purpose")
        user_id = uuid.UUID(state_data["sub"])

        connector_row = await _get_or_create_connector(
            session, user_id, ConnectorProvider.GOOGLE_WORKSPACE
        )

        from app.services.connectors.google_workspace import GoogleWorkspaceConnector

        connector = GoogleWorkspaceConnector(connector=connector_row, user_id=user_id)
        await connector.authenticate(code)

        # Trigger initial sync in background
        from app.workers.sync_tasks import sync_connector_job

        sync_connector_job.apply_async(args=[str(user_id), str(connector_row.id)], countdown=2)

        return RedirectResponse(
            "http://localhost:3000/settings?connected=google",
            status_code=302,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return RedirectResponse(
            f"http://localhost:3000/settings?error=google_auth_failed:{type(e).__name__}",
            status_code=302,
        )


@router.get("/oauth/github/callback", summary="GitHub OAuth callback")
async def github_oauth_callback(
    code: str,
    state: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle GitHub OAuth redirect. Exchange code for tokens and activate connector."""
    if state is None:
        return RedirectResponse(
            "http://localhost:3000/settings?error=github_auth_failed",
            status_code=302,
        )

    try:
        state_data = decode_token(state)
        if state_data.get("purpose") != "oauth_state":
            raise ValueError("Invalid token purpose")
        user_id = uuid.UUID(state_data["sub"])

        connector_row = await _get_or_create_connector(session, user_id, ConnectorProvider.GITHUB)

        from app.services.connectors.github_connector import GitHubConnector

        connector = GitHubConnector(connector=connector_row, user_id=user_id)
        await connector.authenticate(code)

        # Trigger initial sync in background
        from app.workers.sync_tasks import sync_connector_job

        sync_connector_job.apply_async(args=[str(user_id), str(connector_row.id)], countdown=2)

        return RedirectResponse(
            "http://localhost:3000/settings?connected=github",
            status_code=302,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return RedirectResponse(
            f"http://localhost:3000/settings?error=github_auth_failed:{type(e).__name__}",
            status_code=302,
        )



# ── Slack OAuth ───────────────────────────────────────────────────────────────

@router.get("/oauth/slack/initiate", summary="Initiate Slack OAuth flow")
async def slack_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    if not settings.SLACK_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Slack integration not configured. Add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET to .env",
        )
    state_token = create_access_token(
        str(current_user.id),
        expires_delta=timedelta(minutes=10),
        extra_claims={"purpose": "oauth_state"},
    )
    auth_url = (
        f"https://slack.com/oauth/v2/authorize"
        f"?client_id={settings.SLACK_CLIENT_ID}"
        f"&scope={settings.SLACK_SCOPES}"
        f"&redirect_uri={settings.SLACK_REDIRECT_URI}"
        f"&state={state_token}"
    )
    return {"auth_url": auth_url}


@router.get("/oauth/slack/callback", summary="Slack OAuth callback")
async def slack_oauth_callback(
    code: str,
    state: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if state is None:
        return RedirectResponse("http://localhost:3000/settings?error=slack_auth_failed", status_code=302)
    try:
        state_data = decode_token(state)
        if state_data.get("purpose") != "oauth_state":
            raise ValueError("Invalid token purpose")
        user_id = uuid.UUID(state_data["sub"])

        connector_row = await _get_or_create_connector(session, user_id, ConnectorProvider.SLACK)

        # Exchange code for token
        import httpx
        settings = get_settings()
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://slack.com/api/oauth.v2.access",
                data={
                    "client_id": settings.SLACK_CLIENT_ID,
                    "client_secret": settings.SLACK_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": settings.SLACK_REDIRECT_URI,
                },
            )
            data = resp.json()

        if not data.get("ok"):
            raise ValueError(f"Slack OAuth failed: {data.get('error')}")

        access_token = data.get("access_token") or data.get("authed_user", {}).get("access_token", "")
        from app.core.security import encrypt_token
        from app.domain.models.connector import OAuthToken
        from sqlalchemy import select

        stmt = select(OAuthToken).where(OAuthToken.connector_id == connector_row.id)
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            existing.access_token = encrypt_token(access_token)
            session.add(existing)
        else:
            token = OAuthToken(
                id=uuid.uuid4(),
                connector_id=connector_row.id,
                access_token=encrypt_token(access_token),
                scope=settings.SLACK_SCOPES,
            )
            session.add(token)

        connector_row.status = ConnectorStatus.ACTIVE
        session.add(connector_row)
        await session.commit()

        from app.workers.sync_tasks import sync_connector_job
        sync_connector_job.apply_async(args=[str(user_id), str(connector_row.id)], countdown=2)

        return RedirectResponse("http://localhost:3000/settings?connected=slack", status_code=302)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return RedirectResponse(f"http://localhost:3000/settings?error=slack_auth_failed:{type(e).__name__}", status_code=302)


# ── Notion OAuth ──────────────────────────────────────────────────────────────

@router.get("/oauth/notion/initiate", summary="Initiate Notion OAuth flow")
async def notion_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> dict:
    settings = get_settings()
    if not settings.NOTION_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Notion integration not configured. Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to .env",
        )
    state_token = create_access_token(
        str(current_user.id),
        expires_delta=timedelta(minutes=10),
        extra_claims={"purpose": "oauth_state"},
    )
    auth_url = (
        f"https://api.notion.com/v1/oauth/authorize"
        f"?client_id={settings.NOTION_CLIENT_ID}"
        f"&redirect_uri={settings.NOTION_REDIRECT_URI}"
        f"&response_type=code"
        f"&owner=user"
        f"&state={state_token}"
    )
    return {"auth_url": auth_url}


@router.get("/oauth/notion/callback", summary="Notion OAuth callback")
async def notion_oauth_callback(
    code: str,
    state: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if state is None:
        return RedirectResponse("http://localhost:3000/settings?error=notion_auth_failed", status_code=302)
    try:
        state_data = decode_token(state)
        if state_data.get("purpose") != "oauth_state":
            raise ValueError("Invalid token purpose")
        user_id = uuid.UUID(state_data["sub"])

        connector_row = await _get_or_create_connector(session, user_id, ConnectorProvider.NOTION)

        import httpx
        import base64
        settings = get_settings()
        # Notion uses Basic auth for token exchange
        credentials = base64.b64encode(f"{settings.NOTION_CLIENT_ID}:{settings.NOTION_CLIENT_SECRET}".encode()).decode()
        async with httpx.AsyncClient() as http:
            resp = await http.post(
                "https://api.notion.com/v1/oauth/token",
                json={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.NOTION_REDIRECT_URI,
                },
                headers={"Authorization": f"Basic {credentials}"},
            )
            data = resp.json()

        access_token = data.get("access_token")
        if not access_token:
            raise ValueError(f"Notion OAuth failed: {data}")

        from app.core.security import encrypt_token
        from app.domain.models.connector import OAuthToken
        from sqlalchemy import select

        stmt = select(OAuthToken).where(OAuthToken.connector_id == connector_row.id)
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            existing.access_token = encrypt_token(access_token)
            session.add(existing)
        else:
            token = OAuthToken(
                id=uuid.uuid4(),
                connector_id=connector_row.id,
                access_token=encrypt_token(access_token),
            )
            session.add(token)

        connector_row.status = ConnectorStatus.ACTIVE
        session.add(connector_row)
        await session.commit()

        from app.workers.sync_tasks import sync_connector_job
        sync_connector_job.apply_async(args=[str(user_id), str(connector_row.id)], countdown=2)

        return RedirectResponse("http://localhost:3000/settings?connected=notion", status_code=302)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return RedirectResponse(f"http://localhost:3000/settings?error=notion_auth_failed:{type(e).__name__}", status_code=302)
