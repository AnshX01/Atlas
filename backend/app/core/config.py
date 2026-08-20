"""
Atlas Backend — Application Configuration.

Driven entirely by environment variables (12-factor app).
Pydantic Settings validates all values at startup.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration loaded from environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────────────────────────
    APP_ENV: Literal["development", "staging", "production"] = "development"
    APP_SECRET_KEY: str = "secret"
    APP_MASTER_ENCRYPTION_KEY: str = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="  # Base64-encoded 32-byte AES-256 key

    # ── JWT ──────────────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str = "secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # ── PostgreSQL ────────────────────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///atlas.db"  # e.g. postgresql+asyncpg://user:pass@host/db

    # ── Neo4j ────────────────────────────────────────────────────────────────
    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = "password"

    # ── Qdrant ───────────────────────────────────────────────────────────────
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str = ""

    # ── Redis / Celery ────────────────────────────────────────────────────────
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # ── AI Providers ──────────────────────────────────────────────────────────
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-3-5-sonnet-20241022"

    # Strict local mode: routes all AI calls to Ollama
    OLLAMA_ENABLED: bool = False
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3:8b"

    # ── Google OAuth ─────────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/v1/auth/oauth/google/callback"
    GOOGLE_SCOPES: str = (
        "openid email profile "
        "https://www.googleapis.com/auth/gmail.modify "
        "https://www.googleapis.com/auth/gmail.send "
        "https://www.googleapis.com/auth/calendar.readonly "
        "https://www.googleapis.com/auth/tasks.readonly"
    )

    # ── GitHub OAuth ──────────────────────────────────────────────────────────
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_REDIRECT_URI: str = "http://localhost:8000/v1/auth/oauth/github/callback"
    GITHUB_WEBHOOK_SECRET: str = ""

    # ── Slack OAuth ───────────────────────────────────────────────────────────
    SLACK_CLIENT_ID: str = ""
    SLACK_CLIENT_SECRET: str = ""
    SLACK_REDIRECT_URI: str = "http://localhost:8000/v1/auth/oauth/slack/callback"
    SLACK_SCOPES: str = "channels:history,channels:read,chat:write,groups:history,groups:read,im:history,im:read,mpim:history,mpim:read,users:read,users:read.email"

    # ── Notion OAuth ──────────────────────────────────────────────────────────
    NOTION_CLIENT_ID: str = ""
    NOTION_CLIENT_SECRET: str = ""
    NOTION_REDIRECT_URI: str = "http://localhost:8000/v1/auth/oauth/notion/callback"

    # ── Local File System ─────────────────────────────────────────────────────
    LOCAL_FS_WATCH_PATHS: str = ""
    LOCAL_FS_IGNORE_PATTERNS: str = "node_modules,.git,*.pyc"

    # ── Email (Resend) ────────────────────────────────────────────────────────
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = "Atlas <noreply@atlas-app.com>"

    # ── Frontend ──────────────────────────────────────────────────────────────
    NEXT_PUBLIC_API_URL: AnyHttpUrl = "http://localhost:8000"  # type: ignore[assignment]

    # ── Observability ─────────────────────────────────────────────────────────
    OTEL_EXPORTER_OTLP_ENDPOINT: str = "http://localhost:4317"
    OTEL_SERVICE_NAME: str = "atlas-backend"
    LOG_LEVEL: str = "INFO"

    # ── CORS ──────────────────────────────────────────────────────────────────
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:8080",
        "app://.",  # Electron production
    ]

    @field_validator("APP_MASTER_ENCRYPTION_KEY")
    @classmethod
    def validate_encryption_key(cls, v: str) -> str:
        """Ensure the AES key is properly base64-encoded (32 bytes)."""
        import base64

        try:
            decoded = base64.urlsafe_b64decode(v + "==")
            if len(decoded) < 32:
                raise ValueError("Encryption key must be at least 32 bytes when decoded")
        except Exception as exc:
            raise ValueError(f"Invalid APP_MASTER_ENCRYPTION_KEY: {exc}") from exc
        return v

    @property
    def google_scopes_list(self) -> list[str]:
        """Return Google OAuth scopes as a list."""
        return self.GOOGLE_SCOPES.split()

    @property
    def local_fs_watch_paths_list(self) -> list[str]:
        """Return local FS watch paths as a list."""
        return [p.strip() for p in self.LOCAL_FS_WATCH_PATHS.split(",") if p.strip()]

    @property
    def active_llm_model(self) -> str:
        """Return the active LLM model name based on mode."""
        if self.OLLAMA_ENABLED:
            return self.OLLAMA_MODEL
        if self.OPENAI_API_KEY:
            return self.OPENAI_MODEL
        return self.ANTHROPIC_MODEL

    @property
    def is_development(self) -> bool:
        return self.APP_ENV == "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings. Call once at startup."""
    return Settings()  # type: ignore[call-arg]
