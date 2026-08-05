"""Atlas — Celery Application Instance."""
from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "atlas",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.sync_tasks",
        "app.workers.embedding_tasks",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,  # Requeue on worker crash
    worker_prefetch_multiplier=1,  # Fair distribution
    task_routes={
        "app.workers.sync_tasks.*": {"queue": "sync"},
        "app.workers.embedding_tasks.*": {"queue": "embedding"},
    },
    beat_schedule={
        # Periodic sync every 15 minutes for all active connectors
        "sync-all-connectors": {
            "task": "app.workers.sync_tasks.sync_all_active_connectors",
            "schedule": 900.0,  # 15 minutes
        },
    },
)
