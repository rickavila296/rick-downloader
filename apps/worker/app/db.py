"""Database engine and session management (SQLModel + SQLite)."""

import contextlib
from collections.abc import Generator
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, event
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings


def get_engine() -> Engine:
    settings = get_settings()
    db_path = Path(settings.db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # Use standard sqlite URL format
    sqlite_url = f"sqlite:///{db_path.resolve()}"
    engine = create_engine(
        sqlite_url,
        connect_args={"check_same_thread": False},
    )
    return engine


engine = get_engine()


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection: Any, connection_record: Any) -> None:
    # Ensure foreign keys are enforced in SQLite
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db() -> None:
    # Ensure all models are registered with SQLModel metadata
    from sqlalchemy import text

    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)

    # Ensure status_detail column exists in legacy databases
    with contextlib.suppress(Exception), engine.connect() as conn:
        res = conn.execute(text("PRAGMA table_info(jobs)"))
        cols = [row[1] for row in res.fetchall()]
        if cols and "status_detail" not in cols:
            conn.execute(text("ALTER TABLE jobs ADD COLUMN status_detail TEXT"))
            conn.commit()


# Initialize DB schemas
init_db()


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
