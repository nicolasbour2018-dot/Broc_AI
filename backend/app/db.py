from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _apply_lightweight_migrations() -> None:
    """Keep the event MVP schema compatible without introducing Alembic yet."""
    inspector = inspect(engine)
    if "listings" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("listings")}
    if "sold_at" in columns:
        return

    sold_at_type = "TIMESTAMP WITH TIME ZONE" if engine.dialect.name == "postgresql" else "DATETIME"
    with engine.begin() as connection:
        connection.execute(text(f"ALTER TABLE listings ADD COLUMN sold_at {sold_at_type} NULL"))


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()
