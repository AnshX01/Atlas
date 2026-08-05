"""
Atlas — Local File System Connector.

Uses watchdog to monitor local directories for file changes.
Supported formats: .txt, .md, .pdf, .docx, .py, .ts, .json, .yaml
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from watchdog.events import (
    FileCreatedEvent,
    FileDeletedEvent,
    FileModifiedEvent,
    FileSystemEvent,
    FileSystemEventHandler,
)
from watchdog.observers import Observer

from app.core.config import get_settings
from app.core.logging import get_logger
from app.domain.interfaces.base_connector import BaseConnector
from app.domain.models.connector import Connector
from app.infrastructure.neo4j_client import upsert_document_node
from app.infrastructure.qdrant_client import delete_by_source_id
from app.services.chunker import chunk_text
from app.workers.embedding_tasks import batch_embed_chunks

logger = get_logger(__name__)

SUPPORTED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".docx", ".py", ".ts", ".tsx",
    ".js", ".json", ".yaml", ".yml", ".csv", ".rst",
}


class _AtlasFileEventHandler(FileSystemEventHandler):
    """Bridge watchdog events into an asyncio queue."""

    def __init__(self, queue: asyncio.Queue) -> None:
        super().__init__()
        self._queue = queue
        self._loop = asyncio.get_event_loop()

    def _enqueue(self, event_type: str, path: str) -> None:
        if Path(path).suffix.lower() in SUPPORTED_EXTENSIONS:
            self._loop.call_soon_threadsafe(
                self._queue.put_nowait,
                {"type": event_type, "path": path},
            )

    def on_created(self, event: FileSystemEvent) -> None:
        if isinstance(event, FileCreatedEvent):
            self._enqueue("file_created", event.src_path)

    def on_modified(self, event: FileSystemEvent) -> None:
        if isinstance(event, FileModifiedEvent):
            self._enqueue("file_modified", event.src_path)

    def on_deleted(self, event: FileSystemEvent) -> None:
        if isinstance(event, FileDeletedEvent):
            self._enqueue("file_deleted", event.src_path)


class LocalFSConnector(BaseConnector):
    """
    Connector for local file system monitoring.
    No OAuth required — uses configured watch paths from settings.
    """

    PROVIDER = "local_fs"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)
        self._observer: Observer | None = None
        self._event_queue: asyncio.Queue = asyncio.Queue(maxsize=1000)

    async def authenticate(self, auth_code: str) -> None:
        """No-op: local FS connector requires no OAuth."""
        logger.info("LocalFS connector requires no authentication")

    def _get_watch_paths(self) -> list[Path]:
        """Return configured watch paths that actually exist."""
        settings = get_settings()
        paths = []
        for raw in settings.local_fs_watch_paths_list:
            p = Path(raw).expanduser().resolve()
            if p.exists() and p.is_dir():
                paths.append(p)
            else:
                logger.warning("Watch path does not exist", path=str(p))
        return paths

    def _should_ignore(self, path: str) -> bool:
        """Return True if the path matches an ignore pattern."""
        settings = get_settings()
        ignore_patterns = settings.LOCAL_FS_IGNORE_PATTERNS.split(",")
        for pattern in ignore_patterns:
            if pattern.strip() in path:
                return True
        return False

    async def _index_existing_files(self, path: Path) -> dict[str, int]:
        """Walk and index all existing supported files in a directory."""
        synced = 0
        failed = 0

        for file_path in path.rglob("*"):
            if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_EXTENSIONS:
                if self._should_ignore(str(file_path)):
                    continue
                try:
                    logger.debug("Indexing file", path=str(file_path))
                    content = file_path.read_text(encoding="utf-8", errors="ignore")
                    text_chunks = chunk_text(content)
                    mtime = datetime.fromtimestamp(file_path.stat().st_mtime, UTC).isoformat()
                    chunks = [
                        {
                            "id": str(uuid.uuid4()),
                            "source_id": str(file_path),
                            "type": "file",
                            "text": chunk,
                            "timestamp": mtime,
                            "metadata": {
                                "file_path": str(file_path),
                                "chunk_index": i,
                                "file_type": file_path.suffix,
                            },
                        }
                        for i, chunk in enumerate(text_chunks)
                    ]
                    if chunks:
                        batch_embed_chunks.delay(str(self.user_id), chunks)
                    await upsert_document_node(
                        str(self.user_id),
                        str(file_path),
                        file_path.suffix,
                        mtime,
                    )
                    synced += 1
                except Exception as e:
                    logger.warning("Failed to index file", path=str(file_path), error=str(e))
                    failed += 1

        return {"synced": synced, "failed": failed, "skipped": 0}

    async def sync(self) -> dict[str, int]:
        """Index all existing files in watched directories."""
        paths = self._get_watch_paths()
        if not paths:
            logger.warning("No valid watch paths configured for LocalFS connector")
            return {"synced": 0, "failed": 0, "skipped": 0}

        total = {"synced": 0, "failed": 0, "skipped": 0}
        for path in paths:
            result = await self._index_existing_files(path)
            for key in total:
                total[key] += result.get(key, 0)

        logger.info("LocalFS initial sync complete", **total, user_id=str(self.user_id))
        return total

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """
        Start watchdog observer and yield file system events.
        Runs indefinitely until teardown() is called.
        """
        paths = self._get_watch_paths()
        if not paths:
            logger.warning("No watch paths — LocalFS watch disabled")
            return

        self._observer = Observer()
        handler = _AtlasFileEventHandler(self._event_queue)

        for path in paths:
            self._observer.schedule(handler, str(path), recursive=True)
            logger.info("Watching directory", path=str(path))

        self._observer.start()

        try:
            while self._observer.is_alive():
                try:
                    event = await asyncio.wait_for(self._event_queue.get(), timeout=1.0)
                    if event["type"] == "file_deleted":
                        await delete_by_source_id(self.user_id, event["path"])
                    elif event["type"] in ("file_created", "file_modified"):
                        file_path = Path(event["path"])
                        try:
                            content = file_path.read_text(encoding="utf-8", errors="ignore")
                            text_chunks = chunk_text(content)
                            mtime = datetime.fromtimestamp(file_path.stat().st_mtime, UTC).isoformat()
                            chunks = [
                                {
                                    "id": str(uuid.uuid4()),
                                    "source_id": str(file_path),
                                    "type": "file",
                                    "text": chunk,
                                    "timestamp": mtime,
                                    "metadata": {
                                        "file_path": str(file_path),
                                        "chunk_index": i,
                                        "file_type": file_path.suffix,
                                    },
                                }
                                for i, chunk in enumerate(text_chunks)
                            ]
                            if chunks:
                                batch_embed_chunks.delay(str(self.user_id), chunks)
                            await upsert_document_node(
                                str(self.user_id),
                                str(file_path),
                                file_path.suffix,
                                mtime,
                            )
                        except Exception as e:
                            logger.warning(
                                "Failed to process file event",
                                event_type=event["type"],
                                path=event["path"],
                                error=str(e),
                            )
                    yield event
                except asyncio.TimeoutError:
                    continue
        finally:
            await self.teardown()

    async def teardown(self) -> None:
        """Stop the watchdog observer."""
        if self._observer and self._observer.is_alive():
            self._observer.stop()
            self._observer.join()
            self._observer = None
            logger.info("LocalFS observer stopped", user_id=str(self.user_id))
