"""Shared test fixtures for the worker test suite."""

from collections.abc import Generator

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.main import app as fastapi_app

# Shared in-memory SQLite database with StaticPool for testing
test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@pytest.fixture(autouse=True)
def setup_test_db(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    import app.models

    SQLModel.metadata.create_all(test_engine)

    # Patch engine everywhere it is imported
    monkeypatch.setattr("app.db.engine", test_engine)
    monkeypatch.setattr("app.jobs.queue.engine", test_engine)
    monkeypatch.setattr("app.jobs.runner.engine", test_engine)

    def override_get_session() -> Generator[Session, None, None]:
        with Session(test_engine) as session:
            yield session

    fastapi_app.dependency_overrides[app.db.get_session] = override_get_session

    yield

    fastapi_app.dependency_overrides.clear()
