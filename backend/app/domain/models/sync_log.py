"""Atlas — SyncLog ORM model."""

from __future__ import annotations

import enum
import uuid

from app.domain.models.base import Base
from sqlalchemy import Enum, ForeignKey, Integer, Text, Index
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class SyncStatus(str, enum.Enum):  # noqa: UP042
    """Outcome status of a sync run."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    PARTIAL = "partial"  # Some items failed but sync completed
    FAILED = "failed"


class SyncLog(Base):
    """
    Audit trail for every background sync job.
    Enables debugging, replay, and user-facing sync history.
    """

    __tablename__ = "sync_logs"

    __table_args__ = (Index("ix_sync_logs_connector_created", "connector_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("connectors.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status: Mapped[SyncStatus] = mapped_column(
        Enum(SyncStatus, values_callable=lambda obj: [e.value for e in obj]), default=SyncStatus.PENDING, nullable=False
    )
    items_synced: Mapped[int] = mapped_column(Integer, default=0)
    items_failed: Mapped[int] = mapped_column(Integer, default=0)
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Arbitrary metadata about the sync run (e.g., cursor, last synced ID)
    meta_json: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # ── Relationships ─────────────────────────────────────────────────────────
    connector: Mapped[Connector] = relationship(  # noqa: F821
        "Connector", back_populates="sync_logs"
    )

    def __repr__(self) -> str:
        return f"<SyncLog id={self.id} connector={self.connector_id} status={self.status}>"
