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
    statements: list[str] = []

    if "sold_at" not in columns:
        sold_at_type = "TIMESTAMP WITH TIME ZONE" if engine.dialect.name == "postgresql" else "DATETIME"
        statements.append(f"ALTER TABLE listings ADD COLUMN sold_at {sold_at_type} NULL")

    if "fun_line" not in columns:
        statements.append("ALTER TABLE listings ADD COLUMN fun_line VARCHAR(180) NULL")

    if statements:
        with engine.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))


def _normalize_legacy_categories() -> None:
    """Convert pre-taxonomy category labels to the current closed list once at startup."""
    from .categories import normalize_category

    with engine.begin() as connection:
        rows = connection.execute(text("SELECT id, category FROM listings")).mappings().all()
        for row in rows:
            normalized = normalize_category(row["category"]).value
            if row["category"] != normalized:
                connection.execute(
                    text("UPDATE listings SET category = :category WHERE id = :id"),
                    {"category": normalized, "id": row["id"]},
                )


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _apply_lightweight_migrations()
    _normalize_legacy_categories()
