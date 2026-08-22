"""Ensure conversation sync tables exist."""

from app.infrastructure.database import get_session_factory
from sqlalchemy import text


async def ensure_conversation_tables() -> None:
    """Create conversation-related tables if they do not already exist.

    This is idempotent and safe to call on every startup.
    """
    factory = get_session_factory()
    statements = [
        """
        CREATE TABLE IF NOT EXISTS user_conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT 'New Conversation',
            last_message TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_user_conversations_user ON user_conversations(user_id, created_at DESC);
        """,
        """
        CREATE TABLE IF NOT EXISTS conversation_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES user_conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv ON conversation_messages(conversation_id, timestamp ASC);
        """,
        """
        CREATE TABLE IF NOT EXISTS user_profile_pictures (
            user_id TEXT PRIMARY KEY,
            image_data TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        """
    ]
    
    async with factory() as session:
        for stmt in statements:
            await session.execute(text(stmt.strip()))
        await session.commit()
