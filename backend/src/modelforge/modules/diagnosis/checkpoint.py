"""PostgresSaver assembly and bounded checkpoint retention."""
from __future__ import annotations

from contextlib import contextmanager
import re

from psycopg import sql
from psycopg.conninfo import make_conninfo

from modelforge.errors import AppError


_SAFE_SCHEMA = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


def checkpoint_dsn(settings) -> str:
    schema = settings.ai_checkpoint_schema
    if not _SAFE_SCHEMA.fullmatch(schema):
        raise AppError(503, 'ai_checkpoint_schema_invalid', 'Checkpoint schema is invalid')
    base = (
        settings.ai_checkpoint_dsn.get_secret_value()
        if settings.ai_checkpoint_dsn is not None
        else settings.conninfo()
    )
    return make_conninfo(
        base,
        options=f'-c search_path={schema},public',
    )


@contextmanager
def checkpoint_saver(settings):
    try:
        from langgraph.checkpoint.postgres import PostgresSaver
    except ImportError as error:
        raise AppError(
            503,
            'ai_checkpoint_dependency_unavailable',
            'AI checkpoint dependency is unavailable',
        ) from error
    try:
        with PostgresSaver.from_conn_string(checkpoint_dsn(settings)) as saver:
            yield saver
    except AppError:
        raise
    except Exception as error:
        raise AppError(
            503,
            'ai_checkpoint_unavailable',
            'AI checkpoint storage is unavailable',
        ) from error


def setup_checkpointer(settings) -> None:
    with checkpoint_saver(settings) as saver:
        saver.setup()


def cleanup_expired(pool, settings, *, limit: int = 100) -> int:
    schema = settings.ai_checkpoint_schema
    if not _SAFE_SCHEMA.fullmatch(schema):
        raise AppError(503, 'ai_checkpoint_schema_invalid', 'Checkpoint schema is invalid')
    with pool.connection() as connection:
        rows = connection.execute(
            '''
            SELECT id FROM training_diagnosis_jobs
            WHERE state IN ('ready', 'failed')
              AND finished_at IS NOT NULL
              AND finished_at < now() - (%s * interval '1 hour')
            ORDER BY finished_at
            LIMIT %s
            ''',
            (settings.ai_checkpoint_ttl_hours, limit),
        ).fetchall()
        thread_ids = [f'diagnosis:{row["id"]}' for row in rows]
        if not thread_ids:
            return 0
        for table in ('checkpoints', 'checkpoint_blobs', 'checkpoint_writes'):
            connection.execute(
                sql.SQL('DELETE FROM {}.{} WHERE thread_id = ANY(%s)').format(
                    sql.Identifier(schema),
                    sql.Identifier(table),
                ),
                (thread_ids,),
            )
    return len(thread_ids)
