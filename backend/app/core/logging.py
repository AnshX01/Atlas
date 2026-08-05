"""
Atlas Backend — Structured JSON Logging.

Uses structlog to produce machine-readable JSON logs compatible
with ELK / Datadog ingestion pipelines.
"""

from __future__ import annotations

import logging
import sys

import structlog
from app.core.config import get_settings


def configure_logging() -> None:
    """
    Configure structlog and stdlib logging.
    Call once at application startup (in FastAPI lifespan).
    """
    settings = get_settings()
    log_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)

    # ── stdlib root logger ────────────────────────────────────────────────────
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    # Silence noisy third-party loggers in production
    if not settings.is_development:
        for noisy in ("uvicorn.access", "sqlalchemy.engine", "httpx"):
            logging.getLogger(noisy).setLevel(logging.WARNING)

    # ── structlog processors ──────────────────────────────────────────────────
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.ExceptionRenderer(),
    ]

    if settings.is_development:
        # Pretty console output in dev
        structlog.configure(
            processors=shared_processors + [structlog.dev.ConsoleRenderer(colors=True)],
            logger_factory=structlog.stdlib.LoggerFactory(),
            wrapper_class=structlog.stdlib.BoundLogger,
            cache_logger_on_first_use=True,
        )
    else:
        # JSON output in staging / production
        structlog.configure(
            processors=shared_processors
            + [structlog.processors.dict_tracebacks, structlog.processors.JSONRenderer()],
            logger_factory=structlog.stdlib.LoggerFactory(),
            wrapper_class=structlog.stdlib.BoundLogger,
            cache_logger_on_first_use=True,
        )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a named structlog logger."""
    return structlog.get_logger(name)
