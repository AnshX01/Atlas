"""Atlas — Connector & OAuthToken ORM models."""

from __future__ import annotations

import enum
import uuid

from app.domain.models.base import Base
from sqlalchemy import Enum, ForeignKey, String, Text, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship


class ConnectorProvider(str, enum.Enum):  # noqa: UP042
    """Enumeration of supported third-party integration providers."""

    GOOGLE_WORKSPACE = "google_workspace"
    GITHUB = "github"
    SLACK = "slack"
    NOTION = "notion"
    JIRA = "jira"
    LINEAR = "linear"
    LOCAL_FS = "local_fs"


class ConnectorStatus(str, enum.Enum):  # noqa: UP042
    """Current sync status of a connector."""

    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    RATE_LIMITED = "rate_limited"
    REQUIRES_REAUTH = "requires_reauth"


class Connector(Base):
    """
    Represents an active integration between a User and a third-party provider.
    One user can have multiple connectors (e.g., two GitHub accounts).
    """

    __tablename__ = "connectors"

    __table_args__ = (Index("ix_connectors_user_provider", "user_id", "provider"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    provider: Mapped[ConnectorProvider] = mapped_column(Enum(ConnectorProvider, values_callable=lambda obj: [e.value for e in obj]), nullable=False)
    status: Mapped[ConnectorStatus] = mapped_column(
        Enum(ConnectorStatus, values_callable=lambda obj: [e.value for e in obj]), default=ConnectorStatus.INACTIVE, nullable=False
    )
    display_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    external_account_id: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    user: Mapped[User] = relationship("User", back_populates="connectors")  # noqa: F821
    oauth_token: Mapped[OAuthToken | None] = relationship(
        "OAuthToken", back_populates="connector", uselist=False, cascade="all, delete-orphan"
    )
    sync_logs: Mapped[list[SyncLog]] = relationship(  # noqa: F821
        "SyncLog", back_populates="connector", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Connector id={self.id} provider={self.provider} user={self.user_id}>"


class OAuthToken(Base):
    """
    Encrypted OAuth2 credentials for a connector.
    All token values are AES-256-GCM encrypted before storage.
    The master key never leaves the environment secret manager.
    """

    __tablename__ = "oauth_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    connector_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("connectors.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # All token fields stored AES-256-GCM encrypted (base64 ciphertext)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_type: Mapped[str] = mapped_column(String(32), default="Bearer")
    scope: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Relationships ─────────────────────────────────────────────────────────
    connector: Mapped[Connector] = relationship("Connector", back_populates="oauth_token")

    def __repr__(self) -> str:
        return f"<OAuthToken connector={self.connector_id}>"
