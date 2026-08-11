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
from pydantic import BaseModel

class SendOTPRequest(BaseModel):
    email: str

class SendOTPResponse(BaseModel):
    message: str
    dev_otp: str | None = None

class VerifyOTPRequest(BaseModel):
    email: str
    otp: str

class VerifyOTPResponse(BaseModel):
    verified: bool

class OAuthInitiateResponse(BaseModel):
    auth_url: str

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

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not verify_password(payload.password, user.hashed_password):
        # Check if this user signed up via OAuth
        stmt = select(Connector).where(
            Connector.user_id == user.id,
            Connector.provider == ConnectorProvider.GOOGLE_WORKSPACE,
        )
        oauth_result = await session.execute(stmt)
        oauth_connector = oauth_result.scalar_one_or_none()
        if oauth_connector:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This account was created with Google. Please use 'Sign in with Google' instead.",
            )
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


# ── Email OTP Verification ─────────────────────────────────────────────────


@router.post("/send-otp", response_model=SendOTPResponse, summary="Send OTP to email for verification")
async def send_otp(payload: SendOTPRequest) -> SendOTPResponse:
    """Generate and send a one-time verification code to the provided email."""
    from app.services.email_service import send_otp_email

    email = payload.email
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Valid email required")
    otp = await send_otp_email(email)
    # In dev mode (no Resend key), return OTP in response
    settings = get_settings()
    response: dict = {"message": "OTP sent to your email"}
    if not settings.RESEND_API_KEY:
        response["dev_otp"] = otp  # Only in dev mode
    return SendOTPResponse(**response)


@router.post("/verify-otp", response_model=VerifyOTPResponse, summary="Verify OTP code")
async def verify_otp_endpoint(payload: VerifyOTPRequest) -> VerifyOTPResponse:
    """Verify a one-time code previously sent to an email address."""
    from app.services.email_service import verify_otp

    email = payload.email
    otp = payload.otp
    if not email or not otp:
        raise HTTPException(status_code=422, detail="Email and OTP required")
    if verify_otp(email, otp):
        return VerifyOTPResponse(verified=True)
    raise HTTPException(status_code=400, detail="Invalid or expired verification code")


# ── OAuth Initiate Endpoints ──────────────────────────────────────────────────


@router.get("/oauth/google/login/initiate", summary="Initiate Google OAuth flow for Login")
async def google_login_initiate() -> RedirectResponse:
    """Redirect the browser to Google OAuth for user login."""
    from urllib.parse import urlencode

    settings = get_settings()
    redirect_uri = settings.GOOGLE_REDIRECT_URI

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        "access_type": "offline",
        "state": "login_flow",
        "prompt": "consent",
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(auth_url)


@router.get("/oauth/google/initiate", response_model=OAuthInitiateResponse, summary="Initiate Google OAuth flow")
async def google_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> OAuthInitiateResponse:
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
    return OAuthInitiateResponse(auth_url=auth_url)


@router.get("/oauth/github/initiate", response_model=OAuthInitiateResponse, summary="Initiate GitHub OAuth flow")
async def github_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> OAuthInitiateResponse:
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
    return OAuthInitiateResponse(auth_url=auth_url)


# ── OAuth Callback Endpoints ──────────────────────────────────────────────────


@router.get("/oauth/google/login/callback", summary="Google OAuth login callback (legacy)")
async def google_login_callback(
    code: str = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Legacy endpoint — redirects to the main callback handler."""
    # This endpoint exists for backward compatibility
    # The login flow now uses /oauth/google/callback with state=login_flow
    return RedirectResponse(
        f"http://localhost:19876/oauth-callback?error=use_main_callback",
        status_code=302,
    )


@router.get("/oauth/google/callback", summary="Google OAuth callback")
async def google_oauth_callback(
    code: str = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle Google OAuth redirect. Routes to login flow or connector flow based on state."""
    import httpx
    
    # Handle error from Google
    if error or not code:
        if state == "login_flow":
            return RedirectResponse(f"http://localhost:19876/oauth-callback?error={error or 'no_code'}", status_code=302)
        return RedirectResponse(
            f"http://localhost:3000/settings?error=google_auth_failed",
            status_code=302,
        )

    # ── Login Flow (state == "login_flow") ─────────────────────────────────
    if state == "login_flow":
        settings = get_settings()
        try:
            async with httpx.AsyncClient() as client:
                token_res = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": settings.GOOGLE_CLIENT_ID,
                        "client_secret": settings.GOOGLE_CLIENT_SECRET,
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                    },
                )
                if token_res.status_code != 200:
                    error_detail = token_res.json().get("error_description", "token_exchange_failed")
                    return RedirectResponse(f"http://localhost:19876/oauth-callback?error={error_detail}", status_code=302)
                    
                access_token = token_res.json().get("access_token")
                
                user_res = await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"}
                )
                if user_res.status_code != 200:
                    return RedirectResponse("http://localhost:19876/oauth-callback?error=userinfo_failed", status_code=302)
                    
                user_info = user_res.json()
                email = user_info.get("email")
                full_name = user_info.get("name")
        except Exception:
            return RedirectResponse("http://localhost:19876/oauth-callback?error=exchange_error", status_code=302)
            
        if not email:
            return RedirectResponse("http://localhost:19876/oauth-callback?error=no_email", status_code=302)
        
        try:
            result = await session.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
            
            if not user:
                user = User(
                    id=uuid.uuid4(),
                    email=email,
                    hashed_password=hash_password(str(uuid.uuid4())),
                    full_name=full_name,
                    is_active=True,
                )
                session.add(user)
                await session.commit()
                await session.refresh(user)
                
            if not user.is_active:
                return RedirectResponse("http://localhost:19876/oauth-callback?error=account_disabled", status_code=302)
                
            jwt_access = create_access_token(str(user.id))
            jwt_refresh = create_refresh_token(str(user.id))
            
            return RedirectResponse(
                f"http://localhost:19876/oauth-callback?access_token={jwt_access}&refresh_token={jwt_refresh}",
                status_code=302,
            )
        except Exception:
            import traceback
            traceback.print_exc()
            return RedirectResponse("http://localhost:19876/oauth-callback?error=server_error", status_code=302)

    # ── Connector Flow (state is a JWT token) ──────────────────────────────
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
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """Handle GitHub OAuth redirect. Exchange code for tokens and activate connector."""
    if error or not code:
        return RedirectResponse(
            "http://localhost:3000/settings?error=github_auth_failed",
            status_code=302,
        )

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

@router.get("/oauth/slack/initiate", response_model=OAuthInitiateResponse, summary="Initiate Slack OAuth flow")
async def slack_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> OAuthInitiateResponse:
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
    return OAuthInitiateResponse(auth_url=auth_url)


@router.get("/oauth/slack/callback", summary="Slack OAuth callback")
async def slack_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if error or not code:
        return RedirectResponse("http://localhost:3000/settings?error=slack_auth_failed", status_code=302)
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

@router.get("/oauth/notion/initiate", response_model=OAuthInitiateResponse, summary="Initiate Notion OAuth flow")
async def notion_oauth_initiate(
    current_user: User = Depends(get_current_user),
) -> OAuthInitiateResponse:
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
    return OAuthInitiateResponse(auth_url=auth_url)


@router.get("/oauth/notion/callback", summary="Notion OAuth callback")
async def notion_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if error or not code:
        return RedirectResponse("http://localhost:3000/settings?error=notion_auth_failed", status_code=302)
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
