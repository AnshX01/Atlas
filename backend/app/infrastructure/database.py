"""Atlas — Infrastructure: Async SQLAlchemy engine and session factory."""

from __future__ import annotations

import threading
from collections.abc import AsyncGenerator

from app.core.config import get_settings
from app.core.logging import get_logger
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

logger = get_logger(__name__)

_engine = None
_session_factory = None
_engine_lock = threading.Lock()


def get_engine() -> AsyncEngine:
    """Return (or create) the shared async SQLAlchemy engine."""
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        # Double-checked locking pattern
        if _engine is None:
            settings = get_settings()
            is_sqlite = settings.DATABASE_URL.startswith("sqlite")
            
            engine_kwargs = {
                "echo": settings.is_development,
            }
            
            if is_sqlite:
                engine_kwargs.update({
                    "poolclass": NullPool,
                    "connect_args": {"timeout": 15}
                })
            else:
                engine_kwargs.update({
                    "pool_size": 10,
                    "max_overflow": 20,
                    "pool_pre_ping": True,
                    "pool_recycle": 3600,
                })
                
            _engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)
            
            if is_sqlite:
                from sqlalchemy import event
                @event.listens_for(_engine.sync_engine, "connect")
                def set_sqlite_pragma(dbapi_connection, connection_record):
                    cursor = dbapi_connection.cursor()
                    cursor.execute("PRAGMA journal_mode=WAL")
                    cursor.execute("PRAGMA synchronous=NORMAL")
                    cursor.close()
                    
            logger.info("SQLAlchemy async engine created", url=settings.DATABASE_URL.split("@")[-1])
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return (or create) the shared async session factory."""
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
            autocommit=False,
        )
    return _session_factory


def create_worker_session_factory() -> async_sessionmaker[AsyncSession]:
    """
    Create a fresh session factory for Celery worker tasks.

    Each asyncio.run() call in a Celery task creates a new event loop.
    A shared engine's connection pool gets bound to the first event loop
    that used it, causing 'attached to a different loop' errors on
    subsequent calls. This function creates a disposable engine per task.
    """
    settings = get_settings()
    is_sqlite = settings.DATABASE_URL.startswith("sqlite")
    
    engine_kwargs = {
        "echo": False,
    }
    
    if is_sqlite:
        engine_kwargs.update({
            "poolclass": NullPool,
            "connect_args": {"timeout": 15}
        })
    else:
        engine_kwargs.update({
            "pool_size": 5,
            "max_overflow": 5,
            "pool_pre_ping": True,
            "pool_recycle": 300,
        })
        
    engine = create_async_engine(settings.DATABASE_URL, **engine_kwargs)
    
    if is_sqlite:
        from sqlalchemy import event
        @event.listens_for(engine.sync_engine, "connect")
        def set_sqlite_pragma_worker(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
    return async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )


def reset_engine_for_worker() -> None:
    """
    Reset the global engine and session factory.

    Call this at the start of each Celery task's async function to
    ensure a fresh engine is created on the current event loop.
    This allows connectors that import get_session_factory() to
    work correctly inside worker tasks.
    """
    global _engine, _session_factory
    _engine = None
    _session_factory = None


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields a transactional AsyncSession.

    Usage:
        @router.get("/")
        async def handler(session: AsyncSession = Depends(get_async_session)):
            ...
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_all_tables() -> None:
    """Create all tables (dev convenience). Prefer Alembic in production."""
    from app.domain.models import Base

    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("All tables created via SQLAlchemy metadata")


async def dispose_engine() -> None:
    """Dispose the engine pool. Call on application shutdown."""
    global _engine
    if _engine:
        await _engine.dispose()
        _engine = None
        logger.info("SQLAlchemy engine disposed")
