"""Atlas — Infrastructure: Neo4j async driver wrapper."""

from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from neo4j import AsyncDriver, AsyncGraphDatabase

logger = get_logger(__name__)

_driver: AsyncDriver | None = None


def get_neo4j_driver() -> AsyncDriver:
    """Return (or create) the shared Neo4j async driver."""
    global _driver
    if _driver is None:
        settings = get_settings()
        _driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            max_connection_pool_size=50,
        )
        logger.info("Neo4j driver created", uri=settings.NEO4J_URI)
    return _driver


async def close_neo4j_driver() -> None:
    """Close the Neo4j driver. Call on application shutdown."""
    global _driver
    if _driver:
        await _driver.close()
        _driver = None
        logger.info("Neo4j driver closed")


async def run_cypher(
    query: str,
    parameters: dict[str, Any] | None = None,
    database: str = "neo4j",
) -> list[dict[str, Any]]:
    """
    Execute a Cypher query and return results as a list of dicts.

    IMPORTANT: Always include user_id in WHERE clauses for RBAC isolation.
    Example:
        MATCH (u:User {user_id: $user_id})-[:OWNS]->(d:Document)
        WHERE d.id = $doc_id
        RETURN d
    """
    driver = get_neo4j_driver()
    async with driver.session(database=database) as session:
        result = await session.run(query, parameters or {})
        records = await result.data()
        return records


async def upsert_pr_node(
    user_id: str,
    pr_id: str,
    title: str,
    url: str,
    state: str,
    repo: str,
    author: str,
    updated_at: str,
) -> None:
    """MERGE a PR node and OWNS relationship under the given user. Never raises."""
    query = """
MERGE (u:User {id: $user_id})
MERGE (pr:PR {id: $pr_id, user_id: $user_id})
SET pr.title = $title, pr.url = $url, pr.state = $state, pr.repo = $repo, pr.author = $author, pr.updated_at = $updated_at
MERGE (u)-[:OWNS]->(pr)
"""
    try:
        await run_cypher(
            query,
            {
                "user_id": user_id,
                "pr_id": pr_id,
                "title": title,
                "url": url,
                "state": state,
                "repo": repo,
                "author": author,
                "updated_at": updated_at,
            },
        )
    except Exception as e:
        logger.warning("Neo4j upsert_pr_node failed", pr_id=pr_id, user_id=user_id, error=str(e))
        return


async def upsert_task_node(
    user_id: str,
    issue_id: str,
    title: str,
    url: str,
    state: str,
    repo: str,
    assignee: str | None,
    updated_at: str,
) -> None:
    """MERGE a Task node and OWNS relationship under the given user. Never raises."""
    query = """
MERGE (u:User {id: $user_id})
MERGE (t:Task {id: $issue_id, user_id: $user_id})
SET t.title = $title, t.url = $url, t.state = $state, t.repo = $repo, t.assignee = $assignee, t.updated_at = $updated_at
MERGE (u)-[:OWNS]->(t)
"""
    try:
        await run_cypher(
            query,
            {
                "user_id": user_id,
                "issue_id": issue_id,
                "title": title,
                "url": url,
                "state": state,
                "repo": repo,
                "assignee": assignee,
                "updated_at": updated_at,
            },
        )
    except Exception as e:
        logger.warning(
            "Neo4j upsert_task_node failed", issue_id=issue_id, user_id=user_id, error=str(e)
        )
        return


async def upsert_message_node(
    user_id: str,
    msg_id: str,
    subject: str,
    sender_email: str,
    sender_name: str,
    timestamp: str,
) -> None:
    """MERGE a Message node, Person node by email, and SENT_BY relationship. Never raises."""
    query = """
MERGE (u:User {id: $user_id})
MERGE (m:Message {id: $msg_id, user_id: $user_id})
SET m.subject = $subject, m.timestamp = $timestamp
MERGE (u)-[:OWNS]->(m)
WITH m
MERGE (p:Person {email: $sender_email})
SET p.display_name = $sender_name
MERGE (m)-[:SENT_BY]->(p)
"""
    try:
        await run_cypher(
            query,
            {
                "user_id": user_id,
                "msg_id": msg_id,
                "subject": subject,
                "sender_email": sender_email,
                "sender_name": sender_name,
                "timestamp": timestamp,
            },
        )
    except Exception as e:
        logger.warning(
            "Neo4j upsert_message_node failed", msg_id=msg_id, user_id=user_id, error=str(e)
        )
        return


async def upsert_meeting_node(
    user_id: str,
    event_id: str,
    title: str,
    start_time: str,
    end_time: str,
    attendees: list[str],
) -> None:
    """MERGE a Meeting node, OWNS relationship, and a Person + ATTENDED_BY per attendee. Never raises."""
    meeting_query = """
MERGE (u:User {id: $user_id})
MERGE (mt:Meeting {id: $event_id, user_id: $user_id})
SET mt.title = $title, mt.start_time = $start_time, mt.end_time = $end_time
MERGE (u)-[:OWNS]->(mt)
"""
    attendee_query = """
MATCH (mt:Meeting {id: $event_id, user_id: $user_id})
MERGE (p:Person {email: $email})
MERGE (mt)-[:ATTENDED_BY]->(p)
"""
    try:
        await run_cypher(
            meeting_query,
            {
                "user_id": user_id,
                "event_id": event_id,
                "title": title,
                "start_time": start_time,
                "end_time": end_time,
            },
        )
        for email in attendees:
            await run_cypher(
                attendee_query,
                {"event_id": event_id, "user_id": user_id, "email": email},
            )
    except Exception as e:
        logger.warning(
            "Neo4j upsert_meeting_node failed", event_id=event_id, user_id=user_id, error=str(e)
        )
        return


async def upsert_document_node(
    user_id: str,
    file_path: str,
    file_type: str,
    last_modified: str,
) -> None:
    """MERGE a Document node (keyed on file_path) and OWNS relationship. Never raises."""
    query = """
MERGE (u:User {id: $user_id})
MERGE (d:Document {id: $file_path, user_id: $user_id})
SET d.file_path = $file_path, d.file_type = $file_type, d.last_modified = $last_modified
MERGE (u)-[:OWNS]->(d)
"""
    try:
        await run_cypher(
            query,
            {
                "user_id": user_id,
                "file_path": file_path,
                "file_type": file_type,
                "last_modified": last_modified,
            },
        )
    except Exception as e:
        logger.warning(
            "Neo4j upsert_document_node failed", file_path=file_path, user_id=user_id, error=str(e)
        )
        return


async def initialize_schema_constraints() -> None:
    """
    Create uniqueness constraints and indexes for the Atlas knowledge graph.
    Idempotent — safe to call on every startup.
    """
    constraints = [
        "CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
        "CREATE CONSTRAINT document_id_unique IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
        "CREATE CONSTRAINT person_id_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.id IS UNIQUE",
        "CREATE CONSTRAINT project_id_unique IF NOT EXISTS FOR (pr:Project) REQUIRE pr.id IS UNIQUE",
        "CREATE CONSTRAINT task_id_unique IF NOT EXISTS FOR (t:Task) REQUIRE t.id IS UNIQUE",
        "CREATE CONSTRAINT message_id_unique IF NOT EXISTS FOR (m:Message) REQUIRE m.id IS UNIQUE",
        "CREATE CONSTRAINT meeting_id_unique IF NOT EXISTS FOR (mt:Meeting) REQUIRE mt.id IS UNIQUE",
        # Index for user-scoped traversals
        "CREATE INDEX user_id_index IF NOT EXISTS FOR (n:Document) ON (n.user_id)",
        "CREATE INDEX person_email_index IF NOT EXISTS FOR (p:Person) ON (p.email)",
    ]
    for constraint in constraints:
        await run_cypher(constraint)
    logger.info("Neo4j schema constraints initialized", count=len(constraints))
